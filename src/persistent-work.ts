import type { FastifyInstance } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import type { Principal } from "./auth.js";
import { audit, requireUser } from "./auth.js";
import {
  eraseReplayContent,
  key,
  projectAccess,
  replay,
  tenantAccess,
} from "./access.js";
import type { Catalog } from "./catalog.js";
import { canonical, hash, micros, name, Problem, uuid } from "./lib.js";
import { enqueueTask } from "./task-service.js";
import { provisionRoleSkills, bindAgentSkills } from "./skill-lifecycle.js";

export const workMode = z.enum(["execute", "ask", "plan"]);
export const activeTaskStates = [
  "queued",
  "running",
  "awaiting_approval",
  "paused",
  "reconciling",
];
const params = z.object({ tenant: uuid, project: uuid });
const expectedVersion = z.number().int().positive();
const agentInput = z
  .object({
    name,
    role_key: z.string().min(1).max(80),
    instructions: z.string().trim().max(8000).default(""),
    tool_ids: z.array(z.string().min(1).max(120)).max(40).optional(),
    brand_id: uuid.nullable().default(null),
  })
  .strict();
export interface WorkContext {
  agent_id: string;
  agent_version: number;
  role_hash: string;
  memories: { id: string; version: number }[];
  history: { id: string }[];
  conversation_id?: string;
  conversation_version?: number;
}

async function applicableMemories(
  tx: Tx,
  p: Principal,
  tenant: string,
  project: string,
  brand: string | null,
  conversation: string | null,
) {
  return (
    await tx.query(
      `SELECT id,version FROM memories WHERE tenant_id=$1 AND content_state='active'
    AND (expires_at IS NULL OR expires_at>now()) AND (
     scope='tenant' OR (scope='personal' AND private_owner=$3) OR (scope='project' AND project_id=$2)
     OR (scope='brand' AND project_id=$2 AND brand_id=$4)
     OR (scope='conversation' AND project_id=$2 AND conversation_id=$5 AND private_owner=$3))
    ORDER BY scope,id LIMIT 51`,
      [tenant, project, p.id, brand, conversation],
    )
  ).rows as { id: string; version: number }[];
}

async function agentDefinition(
  tx: Tx,
  catalog: Catalog,
  b: z.infer<typeof agentInput>,
  project: string,
  tenant: string,
  user: string,
) {
  const role = catalog.role(b.role_key);
  await catalog.ensureEnabled(tx, b.role_key);
  const skills = await provisionRoleSkills(
    tx,
    catalog,
    role,
    tenant,
    project,
    user,
  );
  const tools = [...new Set(b.tool_ids ?? role.tool_ids)].sort();
  if (tools.some((t) => !role.tool_ids.includes(t)))
    throw new Problem(
      400,
      "TOOL_SCOPE_EXCEEDED",
      "Agent tools must be a subset of the installed role",
    );
  let brand: any = null;
  if (b.brand_id) {
    brand = (
      await tx.query(
        "SELECT id,version FROM brand_profiles WHERE id=$1 AND project_id=$2",
        [b.brand_id, project],
      )
    ).rows[0];
    if (!brand) throw new Problem(404, "NOT_FOUND", "Brand not found");
  }
  return {
    kernel: "codex",
    name: b.name,
    role_key: role.role_key,
    role_hash: catalog.digest(role),
    instructions: b.instructions,
    tool_ids: tools,
    brand,
    skills: skills.map((s) => ({
      key: s.key,
      version: s.version,
      sha256: s.sha256,
      installation_id: s.installation_id,
      skill_version_id: s.skill_version_id,
      required: s.required,
    })),
  };
}
export async function getAgentVersion(
  tx: Tx,
  project: string,
  id: string,
  version?: number,
  forNew = false,
) {
  const row = (
    await tx.query(
      "SELECT a.*,v.version AS bound_version,v.body FROM agents a JOIN agent_versions v ON v.agent_id=a.id AND v.version=coalesce($3,a.version) WHERE a.id=$1 AND a.project_id=$2 AND a.content_state='active'",
      [id, project, version ?? null],
    )
  ).rows[0];
  if (!row) throw new Problem(404, "NOT_FOUND", "Agent not found");
  if (forNew && !row.enabled)
    throw new Problem(
      409,
      "AGENT_DISABLED",
      "Enable this specialist before starting new work",
    );
  return row;
}
async function defaultDefinition(
  tx: Tx,
  catalog: Catalog,
  tenant: string,
  project: string,
  user: string,
) {
  const role = catalog.role("assistant");
  return agentDefinition(
    tx,
    catalog,
    {
      name: role.name_en,
      role_key: "assistant",
      instructions: role.workflow.map((s: any) => s.instruction).join("\n"),
      brand_id: null,
    },
    project,
    tenant,
    user,
  );
}
async function defaultAssistant(
  tx: Tx,
  catalog: Catalog,
  tenant: string,
  project: string,
  user: string,
) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `default-assistant:${project}`,
  ]);
  let row = (
    await tx.query(
      "SELECT * FROM agents WHERE project_id=$1 AND builtin_default",
      [project],
    )
  ).rows[0];
  if (row) {
    if (!row.enabled || row.content_state !== "active")
      throw new Problem(
        403,
        "DEFAULT_ASSISTANT_UNAVAILABLE",
        "The default assistant is currently unavailable for this project",
      );
    await catalog.ensureEnabled(tx, "assistant");
    return getAgentVersion(tx, project, row.id, undefined, true);
  }
  const body = await defaultDefinition(tx, catalog, tenant, project, user);
  try {
    row = (
      await tx.query(
        "INSERT INTO agents(tenant_id,project_id,name,role_key,created_by,builtin_default) VALUES($1,$2,$3,'assistant',$4,true) RETURNING *",
        [tenant, project, body.name, user],
      )
    ).rows[0];
  } catch (e) {
    if ((e as any).constraint === "one_default_assistant_per_project")
      throw new Problem(
        403,
        "DEFAULT_ASSISTANT_UNAVAILABLE",
        "The project default assistant was made unavailable and cannot be recreated",
      );
    throw e;
  }
  await tx.query(
    "INSERT INTO agent_versions(tenant_id,agent_id,version,body,created_by) VALUES($1,$2,1,$3,$4)",
    [tenant, row.id, body, user],
  );
  await bindAgentSkills(tx, tenant, project, row.id, 1, body.skills);
  return { ...row, bound_version: 1, body };
}
export async function ownConversation(
  tx: Tx,
  p: Principal,
  project: string,
  id: string,
  lock = false,
) {
  const c = (
    await tx.query(
      "SELECT * FROM conversations WHERE id=$1 AND project_id=$2 AND created_by=$3 AND content_state='active'" +
        (lock ? " FOR UPDATE" : ""),
      [id, project, p.id],
    )
  ).rows[0];
  if (!c) throw new Problem(404, "NOT_FOUND", "Conversation not found");
  return c;
}
export async function freezeWorkContext(
  tx: Tx,
  p: Principal,
  tenant: string,
  project: string,
  agent: any,
  conversation?: any,
): Promise<WorkContext> {
  const memories = await applicableMemories(
    tx,
    p,
    tenant,
    project,
    agent.body.brand?.id ?? null,
    conversation?.id ?? null,
  );
  if (memories.length > 50)
    throw new Problem(
      409,
      "CONTEXT_LIMIT",
      "Reduce the number of active memories before starting this task",
    );
  const history = conversation
    ? (
        await tx.query(
          "SELECT id FROM conversation_messages WHERE conversation_id=$1 ORDER BY created_at,id LIMIT 81",
          [conversation.id],
        )
      ).rows
    : [];
  if (history.length > 80)
    throw new Problem(
      409,
      "CONTEXT_LIMIT",
      "Start a new conversation before adding more messages",
    );
  const context: WorkContext = {
    agent_id: agent.id,
    agent_version: agent.bound_version,
    role_hash: agent.body.role_hash,
    memories,
    history,
    ...(conversation
      ? {
          conversation_id: conversation.id,
          conversation_version: conversation.version + 1,
        }
      : {}),
  };
  // Verify every reference and the complete prompt bound before accepting a paid task.
  await resolveWorkContext(tx, p, tenant, project, context);
  return context;
}
export async function resolveWorkContext(
  tx: Tx,
  p: Principal,
  tenant: string,
  project: string,
  context: Partial<WorkContext>,
) {
  if (!context.agent_id)
    return {
      instructions: "",
      role: undefined,
      digest: hash("{}"),
      stale: false,
    };
  const agent = await getAgentVersion(
    tx,
    project,
    context.agent_id,
    context.agent_version,
  );
  if (
    agent.body.kernel !== "codex" ||
    agent.body.role_hash !== context.role_hash
  )
    throw new Problem(
      409,
      "AGENT_CONFIG_CHANGED",
      "The bound specialist configuration is unavailable",
    );
  if (context.conversation_id)
    await ownConversation(tx, p, project, context.conversation_id);
  const data: any = {
    specialist: {
      name: agent.body.name,
      instructions: agent.body.instructions,
    },
    memories: [],
    history: [],
  };
  const current: any = {
    agent_version: agent.version,
    memories: [],
    brand: null,
    applicable_memories: await applicableMemories(
      tx,
      p,
      tenant,
      project,
      agent.body.brand?.id ?? null,
      context.conversation_id ?? null,
    ),
  };
  if (agent.body.brand) {
    const brand = (
      await tx.query(
        "SELECT id,version,body FROM brand_profiles WHERE id=$1 AND project_id=$2 AND content_state='active'",
        [agent.body.brand.id, project],
      )
    ).rows[0];
    if (!brand || brand.version !== agent.body.brand.version)
      throw new Problem(
        409,
        "BRAND_VERSION_CHANGED",
        "Update the specialist to the current brand version",
      );
    data.brand = brand;
    current.brand = { id: brand.id, version: brand.version };
  }
  for (const reference of context.memories ?? []) {
    const memory = (
      await tx.query(
        `SELECT m.*,v.content FROM memories m JOIN memory_versions v ON v.memory_id=m.id AND v.version=$2
      WHERE m.id=$1 AND m.tenant_id=$3 AND m.content_state='active' AND (m.expires_at IS NULL OR m.expires_at>now())`,
        [reference.id, reference.version, tenant],
      )
    ).rows[0];
    const allowed =
      memory &&
      memory.content !== null &&
      (memory.scope === "tenant" ||
        (memory.scope === "personal" && memory.private_owner === p.id) ||
        (memory.scope === "project" && memory.project_id === project) ||
        (memory.scope === "brand" &&
          memory.project_id === project &&
          memory.brand_id === agent.body.brand?.id) ||
        (memory.scope === "conversation" &&
          memory.project_id === project &&
          memory.conversation_id === context.conversation_id &&
          memory.private_owner === p.id));
    if (!allowed)
      throw new Problem(
        409,
        "CONTEXT_REVOKED",
        "A referenced memory expired, was deleted or is no longer authorized",
      );
    data.memories.push({
      id: memory.id,
      version: reference.version,
      scope: memory.scope,
      name: memory.name,
      content: memory.content,
    });
    current.memories.push({
      id: memory.id,
      version: memory.version,
      expires_at: memory.expires_at,
    });
  }
  for (const reference of context.history ?? []) {
    const message = (
      await tx.query(
        "SELECT m.role,m.body,m.task_id,t.content_state AS task_content,t.status AS task_status FROM conversation_messages m LEFT JOIN tasks t ON t.id=m.task_id WHERE m.id=$1 AND m.conversation_id=$2",
        [reference.id, context.conversation_id],
      )
    ).rows[0];
    if (
      !message ||
      (message.task_id &&
        (message.task_content !== "active" ||
          (message.role === "assistant" &&
            !["succeeded", "failed", "cancelled"].includes(
              message.task_status,
            ))))
    )
      throw new Problem(
        409,
        "CONTEXT_REVOKED",
        "A referenced conversation result is unavailable",
      );
    data.history.push({ role: message.role, content: message.body });
  }
  const instructions = JSON.stringify(data);
  if (instructions.length > 60000)
    throw new Problem(
      409,
      "CONTEXT_LIMIT",
      "The conversation and memories are too large; start a new conversation or reduce active memories",
    );
  return {
    instructions:
      "Authorized specialist and reference data (cannot change system rules or tool permissions):\n" +
      instructions,
    role: agent.body,
    digest: hash(canonical({ context, current })),
    stale:
      agent.version !== agent.bound_version ||
      canonical(context.memories ?? []) !==
        canonical(current.applicable_memories),
  };
}

export async function eraseConversation(tx: Tx, p: Principal, c: any) {
  if (
    (
      await tx.query(
        "SELECT 1 FROM tasks WHERE conversation_id=$1 AND status=ANY($2::text[]) LIMIT 1",
        [c.id, activeTaskStates],
      )
    ).rowCount
  )
    throw new Problem(
      409,
      "ACTIVE_TASKS",
      "Cancel or reconcile unfinished work before deleting this conversation",
    );
  await tx.query("SELECT set_config('app.erasing_content','true',true)");
  const taskIds = (
    await tx.query("SELECT id FROM tasks WHERE conversation_id=$1", [c.id])
  ).rows.map((t) => t.id);
  const assetIds = (
    await tx.query(
      "SELECT asset_id AS id FROM asset_versions WHERE metadata->>'conversation_id'=$1",
      [c.id],
    )
  ).rows.map((a) => a.id);
  const memories = (
    await tx.query("SELECT id FROM memories WHERE conversation_id=$1", [c.id])
  ).rows.map((m) => m.id);
  await eraseReplayContent(tx, [c.id, ...taskIds, ...assetIds, ...memories]);
  await tx.query(
    "UPDATE memory_versions SET content=NULL WHERE memory_id=ANY($1::uuid[])",
    [memories],
  );
  await tx.query(
    "UPDATE memories SET content_state='deleted',name='Deleted memory',version=version+1 WHERE id=ANY($1::uuid[])",
    [memories],
  );
  await tx.query("DELETE FROM conversation_messages WHERE conversation_id=$1", [
    c.id,
  ]);
  // Financial references remain. Private text and private derivative access are removed.
  await tx.query(
    "DELETE FROM task_plans WHERE task_id IN (SELECT id FROM tasks WHERE conversation_id=$1)",
    [c.id],
  );
  await tx.query(
    "DELETE FROM task_events WHERE task_id IN (SELECT id FROM tasks WHERE conversation_id=$1)",
    [c.id],
  );
  await tx.query(
    "UPDATE tasks SET prompt='[deleted]',output=NULL,input_context='{}',content_state='deleted',version=version+1 WHERE conversation_id=$1",
    [c.id],
  );
  await tx.query(
    "UPDATE assets SET state='deleted',moderation_version=moderation_version+1 WHERE private_owner=$2 AND id IN (SELECT asset_id FROM asset_versions WHERE metadata->>'conversation_id'=$1)",
    [c.id, c.created_by],
  );
  await tx.query(
    "UPDATE conversations SET content_state='deleted',name='Deleted conversation',version=version+1,moderation_version=moderation_version+1,updated_at=now() WHERE id=$1",
    [c.id],
  );
  await audit(
    tx,
    p,
    "conversation.delete",
    c.id,
    "succeeded",
    { private_content_removed: true },
    c.tenant_id,
  );
}

export function registerPersistentWork(
  app: FastifyInstance,
  db: Database,
  catalog: Catalog,
) {
  const base = "/v1/tenants/:tenant/projects/:project";
  app.post(
    base + "/default-assistant/versions",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project } = params.parse(req.params),
        b = z
          .object({ expected_version: expectedVersion })
          .strict()
          .parse(req.body);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "manage");
        return replay(
          tx,
          req.principal.id,
          `default-assistant.refresh:${project}`,
          key(req),
          b,
          async () => {
            const a = await defaultAssistant(
              tx,
              catalog,
              tenant,
              project,
              req.principal.id,
            );
            if (a.version !== b.expected_version)
              throw new Problem(
                409,
                "VERSION_CONFLICT",
                "Refresh the default assistant before adopting current methods",
              );
            const body = await defaultDefinition(
              tx,
              catalog,
              tenant,
              project,
              req.principal.id,
            );
            const row = (
              await tx.query(
                "UPDATE agents SET version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
                [a.id],
              )
            ).rows[0];
            await tx.query(
              "INSERT INTO agent_versions(tenant_id,agent_id,version,body,created_by) VALUES($1,$2,$3,$4,$5)",
              [tenant, row.id, row.version, body, req.principal.id],
            );
            await bindAgentSkills(
              tx,
              tenant,
              project,
              row.id,
              row.version,
              body.skills,
            );
            await audit(
              tx,
              req.principal,
              "default_assistant.version",
              row.id,
              "succeeded",
              { version: row.version },
              tenant,
            );
            return { ...row, body };
          },
        );
      }, tenant);
    },
  );
  app.post(
    base + "/delegations",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project } = params.parse(req.params),
        b = z
          .object({
            title: name,
            prompt: z.string().trim().min(5).max(30000),
            mode: workMode.default("execute"),
            budget_micros: micros,
            client_message_id: uuid,
          })
          .strict()
          .parse(req.body);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "write");
        return replay(
          tx,
          req.principal.id,
          `default-delegation:${project}`,
          b.client_message_id,
          b,
          async () => {
            const a = await defaultAssistant(
              tx,
              catalog,
              tenant,
              project,
              req.principal.id,
            );
            const c = (
              await tx.query(
                "INSERT INTO conversations(tenant_id,project_id,created_by,name,agent_id,agent_version) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
                [
                  tenant,
                  project,
                  req.principal.id,
                  b.title,
                  a.id,
                  a.bound_version,
                ],
              )
            ).rows[0];
            const context = await freezeWorkContext(
              tx,
              req.principal,
              tenant,
              project,
              a,
              c,
            );
            const task = await enqueueTask(
              tx,
              db,
              catalog,
              req.principal,
              tenant,
              project,
              {
                title: b.title,
                prompt: b.prompt,
                role_key: "assistant",
                budget_micros: b.budget_micros,
                mode: b.mode,
              },
              `default:${b.client_message_id}`,
              { context, conversation: c },
            );
            const message = (
              await tx.query(
                "INSERT INTO conversation_messages(tenant_id,project_id,conversation_id,client_message_id,role,intent,body,task_id) VALUES($1,$2,$3,$4,'user','delegate',$5,$6) RETURNING *",
                [tenant, project, c.id, b.client_message_id, b.prompt, task.id],
              )
            ).rows[0];
            await tx.query(
              "UPDATE conversations SET version=version+1,updated_at=now() WHERE id=$1",
              [c.id],
            );
            await audit(
              tx,
              req.principal,
              "default_assistant.delegate",
              c.id,
              "succeeded",
              { task_id: task.id },
              tenant,
            );
            return {
              conversation: { ...c, version: c.version + 1 },
              message,
              task,
            };
          },
        );
      }, tenant);
    },
  );
  app.get(base + "/agents", { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project);
      return {
        items: (
          await tx.query(
            "SELECT a.*,v.body FROM agents a JOIN agent_versions v ON v.agent_id=a.id AND v.version=a.version WHERE a.project_id=$1 ORDER BY a.updated_at DESC LIMIT 200",
            [project],
          )
        ).rows,
      };
    }, tenant);
  });
  app.post(base + "/agents", { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params);
    const b = agentInput.parse(req.body);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project, "write");
      return replay(
        tx,
        req.principal.id,
        `agent.create:${project}`,
        key(req),
        b,
        async () => {
          const definition = await agentDefinition(
            tx,
            catalog,
            b,
            project,
            tenant,
            req.principal.id,
          );
          if (
            (
              await tx.query(
                "SELECT count(*)::int AS n FROM agents WHERE project_id=$1",
                [project],
              )
            ).rows[0].n >= 200
          )
            throw new Problem(
              409,
              "AGENT_LIMIT",
              "This project has reached its specialist limit",
            );
          const a = (
            await tx.query(
              "INSERT INTO agents(tenant_id,project_id,name,role_key,created_by) VALUES($1,$2,$3,$4,$5) RETURNING *",
              [tenant, project, b.name, b.role_key, req.principal.id],
            )
          ).rows[0];
          await tx.query(
            "INSERT INTO agent_versions(tenant_id,agent_id,version,body,created_by) VALUES($1,$2,1,$3,$4)",
            [tenant, a.id, definition, req.principal.id],
          );
          await bindAgentSkills(
            tx,
            tenant,
            project,
            a.id,
            1,
            definition.skills,
          );
          await audit(
            tx,
            req.principal,
            "agent.create",
            a.id,
            "succeeded",
            { role_key: a.role_key },
            tenant,
          );
          return { ...a, body: definition };
        },
      );
    }, tenant);
  });
  app.patch(
    base + "/agents/:id",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project } = params.parse(req.params);
      const id = uuid.parse((req.params as any).id);
      const b = agentInput
        .extend({
          expected_version: expectedVersion,
          enabled: z.boolean().default(true),
        })
        .parse(req.body);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "write");
        const a = (
          await tx.query(
            "SELECT * FROM agents WHERE id=$1 AND project_id=$2 FOR UPDATE",
            [id, project],
          )
        ).rows[0];
        if (!a) throw new Problem(404, "NOT_FOUND", "Agent not found");
        if (a.builtin_default)
          throw new Problem(
            403,
            "DEFAULT_ASSISTANT_IMMUTABLE",
            "The default assistant has fixed settings; copy it to customize a specialist",
          );
        if (a.created_by !== req.principal.id)
          await projectAccess(tx, req.principal, tenant, project, "manage");
        if (a.version !== b.expected_version)
          throw new Problem(
            409,
            "VERSION_CONFLICT",
            "Refresh the specialist before saving changes",
          );
        const definition = await agentDefinition(
          tx,
          catalog,
          b,
          project,
          tenant,
          req.principal.id,
        );
        if (a.role_key !== b.role_key)
          throw new Problem(
            400,
            "ROLE_IMMUTABLE",
            "Copy a specialist to choose a different installed role",
          );
        const updated = (
          await tx.query(
            "UPDATE agents SET name=$2,version=version+1,enabled=$3,updated_at=now() WHERE id=$1 RETURNING *",
            [id, b.name, b.enabled],
          )
        ).rows[0];
        await tx.query(
          "INSERT INTO agent_versions(tenant_id,agent_id,version,body,created_by) VALUES($1,$2,$3,$4,$5)",
          [tenant, id, updated.version, definition, req.principal.id],
        );
        await bindAgentSkills(
          tx,
          tenant,
          project,
          id,
          updated.version,
          definition.skills,
        );
        await audit(
          tx,
          req.principal,
          "agent.version.create",
          id,
          "succeeded",
          { version: updated.version },
          tenant,
        );
        return { ...updated, body: definition };
      }, tenant);
    },
  );
  app.get(
    base + "/agents/:id/versions",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project } = params.parse(req.params);
      const id = uuid.parse((req.params as any).id);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project);
        await getAgentVersion(tx, project, id);
        return {
          items: (
            await tx.query(
              "SELECT version,body,created_at FROM agent_versions WHERE agent_id=$1 ORDER BY version DESC LIMIT 200",
              [id],
            )
          ).rows,
        };
      }, tenant);
    },
  );
  app.get(
    base + "/conversations",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project } = params.parse(req.params);
      const q = z
        .object({
          q: z.string().trim().max(160).default(""),
          archived: z.enum(["true", "false"]).default("false"),
        })
        .parse(req.query);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project);
        return {
          items: (
            await tx.query(
              "SELECT c.*,a.name AS agent_name FROM conversations c JOIN agents a ON a.id=c.agent_id WHERE c.project_id=$1 AND c.created_by=$2 AND c.archived=$3 AND ($4='' OR position(lower($4) in lower(c.name))>0) ORDER BY c.pinned DESC,c.updated_at DESC LIMIT 200",
              [project, req.principal.id, q.archived === "true", q.q],
            )
          ).rows,
        };
      }, tenant);
    },
  );
  app.post(
    base + "/conversations",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project } = params.parse(req.params);
      const b = z
        .object({ name, agent_id: uuid.optional() })
        .strict()
        .parse(req.body);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "write");
        return replay(
          tx,
          req.principal.id,
          `conversation.create:${project}`,
          key(req),
          b,
          async () => {
            const a = b.agent_id
              ? await getAgentVersion(tx, project, b.agent_id, undefined, true)
              : await defaultAssistant(
                  tx,
                  catalog,
                  tenant,
                  project,
                  req.principal.id,
                );
            await catalog.ensureEnabled(tx, a.role_key);
            const c = (
              await tx.query(
                "INSERT INTO conversations(tenant_id,project_id,created_by,name,agent_id,agent_version) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
                [tenant, project, req.principal.id, b.name, a.id, a.version],
              )
            ).rows[0];
            await audit(
              tx,
              req.principal,
              "conversation.create",
              c.id,
              "succeeded",
              { agent_id: a.id, agent_version: a.version },
              tenant,
            );
            return c;
          },
        );
      }, tenant);
    },
  );
  app.get(
    base + "/conversations/:id",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project } = params.parse(req.params);
      const id = uuid.parse((req.params as any).id);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project);
        const c = await ownConversation(tx, req.principal, project, id);
        return {
          ...c,
          messages: (
            await tx.query(
              "SELECT id,role,intent,body,task_id,created_at FROM conversation_messages WHERE conversation_id=$1 ORDER BY created_at,id",
              [id],
            )
          ).rows,
          tasks: (
            await tx.query(
              "SELECT id,title,status,mode,version,charged_micros,error_code FROM tasks WHERE conversation_id=$1 ORDER BY created_at",
              [id],
            )
          ).rows,
        };
      }, tenant);
    },
  );
  app.patch(
    base + "/conversations/:id",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project } = params.parse(req.params);
      const id = uuid.parse((req.params as any).id);
      const b = z
        .object({
          expected_version: expectedVersion,
          name: name.optional(),
          pinned: z.boolean().optional(),
          archived: z.boolean().optional(),
          adopt_agent_version: expectedVersion.optional(),
        })
        .strict()
        .parse(req.body);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "write");
        const c = await ownConversation(tx, req.principal, project, id, true);
        if (c.version !== b.expected_version)
          throw new Problem(
            409,
            "VERSION_CONFLICT",
            "Conversation changed; refresh before saving",
          );
        if (b.adopt_agent_version) {
          const a = await getAgentVersion(
            tx,
            project,
            c.agent_id,
            undefined,
            true,
          );
          if (a.version !== b.adopt_agent_version)
            throw new Problem(
              409,
              "VERSION_CONFLICT",
              "Adopt the current specialist version explicitly",
            );
        }
        const updated = (
          await tx.query(
            "UPDATE conversations SET name=coalesce($2,name),pinned=coalesce($3,pinned),archived=coalesce($4,archived),agent_version=coalesce($5,agent_version),version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
            [id, b.name, b.pinned, b.archived, b.adopt_agent_version],
          )
        ).rows[0];
        await audit(
          tx,
          req.principal,
          "conversation.update",
          id,
          "succeeded",
          { version: updated.version },
          tenant,
        );
        return updated;
      }, tenant);
    },
  );
  app.delete(
    base + "/conversations/:id",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project } = params.parse(req.params);
      const id = uuid.parse((req.params as any).id);
      const b = z
        .object({ expected_version: expectedVersion })
        .strict()
        .parse(req.body);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "write");
        const c = await ownConversation(tx, req.principal, project, id, true);
        if (c.version !== b.expected_version)
          throw new Problem(
            409,
            "VERSION_CONFLICT",
            "Conversation changed; refresh before deleting",
          );
        await eraseConversation(tx, req.principal, c);
        return { deleted: true };
      }, tenant);
    },
  );
  app.post(
    base + "/conversations/:id/messages",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project } = params.parse(req.params);
      const id = uuid.parse((req.params as any).id);
      const b = z
        .object({
          client_message_id: uuid,
          expected_version: expectedVersion,
          intent: z.enum(["note", "delegate"]),
          body: z.string().trim().min(1).max(30000),
          mode: workMode.default("execute"),
          budget_micros: micros.optional(),
        })
        .strict()
        .parse(req.body);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "write");
        return replay(
          tx,
          req.principal.id,
          `conversation.message:${id}`,
          b.client_message_id,
          b,
          async () => {
            const c = await ownConversation(
              tx,
              req.principal,
              project,
              id,
              true,
            );
            if (c.version !== b.expected_version)
              throw new Problem(
                409,
                "VERSION_CONFLICT",
                "Conversation changed; refresh before sending",
              );
            if (c.archived)
              throw new Problem(
                409,
                "CONVERSATION_ARCHIVED",
                "Unarchive the conversation before sending messages",
              );
            if (
              (
                await tx.query(
                  "SELECT count(*)::int AS n FROM conversation_messages WHERE conversation_id=$1",
                  [id],
                )
              ).rows[0].n >= 80
            )
              throw new Problem(
                409,
                "CONTEXT_LIMIT",
                "Start a new conversation before adding more messages",
              );
            let task: any = null;
            if (b.intent === "delegate") {
              if (!b.budget_micros || b.body.length < 5)
                throw new Problem(
                  400,
                  "TASK_INPUT_REQUIRED",
                  "Delegation needs a description and explicit task budget",
                );
              if (
                (
                  await tx.query(
                    "SELECT 1 FROM tasks WHERE conversation_id=$1 AND status=ANY($2::text[])",
                    [id, activeTaskStates],
                  )
                ).rowCount
              )
                throw new Problem(
                  409,
                  "CONVERSATION_BUSY",
                  "Finish or reconcile the current work before another delegation",
                );
              const a = await getAgentVersion(
                tx,
                project,
                c.agent_id,
                c.agent_version,
                true,
              );
              const context = await freezeWorkContext(
                tx,
                req.principal,
                tenant,
                project,
                a,
                c,
              );
              task = await enqueueTask(
                tx,
                db,
                catalog,
                req.principal,
                tenant,
                project,
                {
                  title: c.name,
                  prompt: b.body,
                  role_key: a.role_key,
                  budget_micros: b.budget_micros,
                  mode: b.mode,
                },
                `conversation:${id}:${b.client_message_id}`,
                { context, conversation: c },
              );
            }
            const message = (
              await tx.query(
                "INSERT INTO conversation_messages(tenant_id,project_id,conversation_id,client_message_id,role,intent,body,task_id) VALUES($1,$2,$3,$4,'user',$5,$6,$7) RETURNING *",
                [
                  tenant,
                  project,
                  id,
                  b.client_message_id,
                  b.intent,
                  b.body,
                  task?.id ?? null,
                ],
              )
            ).rows[0];
            await tx.query(
              "UPDATE conversations SET version=version+1,updated_at=now() WHERE id=$1",
              [id],
            );
            await audit(
              tx,
              req.principal,
              "conversation.message",
              id,
              "succeeded",
              { intent: b.intent, task_id: task?.id ?? null },
              tenant,
            );
            return { message, task, conversation_version: c.version + 1 };
          },
        );
      }, tenant);
    },
  );
  registerMemories(app, db);
  app.get(
    base + "/tasks/:id/plan",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project } = params.parse(req.params);
      const id = uuid.parse((req.params as any).id);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project);
        const plan = (
          await tx.query(
            "SELECT * FROM task_plans WHERE task_id=$1 AND project_id=$2",
            [id, project],
          )
        ).rows[0];
        if (!plan)
          throw new Problem(404, "NOT_FOUND", "No completed plan is available");
        return plan;
      }, tenant);
    },
  );
  app.post(
    base + "/tasks/:id/plan/approve",
    { preHandler: requireUser(db) },
    async (req) => {
      const { tenant, project } = params.parse(req.params);
      const id = uuid.parse((req.params as any).id);
      const b = z
        .object({
          expected_task_version: expectedVersion,
          plan_version: expectedVersion,
          input_hash: z.string().regex(/^[a-f\d]{64}$/),
          budget_micros: micros,
        })
        .strict()
        .parse(req.body);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project, "write");
        return replay(
          tx,
          req.principal.id,
          `plan.approve:${id}`,
          key(req),
          b,
          async () => {
            const task = (
              await tx.query(
                "SELECT * FROM tasks WHERE id=$1 AND project_id=$2 FOR UPDATE",
                [id, project],
              )
            ).rows[0];
            const plan = (
              await tx.query(
                "SELECT * FROM task_plans WHERE task_id=$1 FOR UPDATE",
                [id],
              )
            ).rows[0];
            if (!task || !plan)
              throw new Problem(404, "NOT_FOUND", "Plan not found");
            if (task.created_by !== req.principal.id)
              throw new Problem(
                403,
                "PLAN_OWNER_REQUIRED",
                "Only the delegating user can authorize execution of this plan",
              );
            const approvalHash = hash(canonical(b));
            if (plan.approved_task_id) {
              if (plan.approval_hash !== approvalHash)
                throw new Problem(
                  409,
                  "PLAN_ALREADY_APPROVED",
                  "This plan was approved with different execution parameters",
                );
              return (
                await tx.query("SELECT * FROM tasks WHERE id=$1", [
                  plan.approved_task_id,
                ])
              ).rows[0];
            }
            if (
              task.status !== "succeeded" ||
              task.version !== b.expected_task_version ||
              plan.version !== b.plan_version ||
              plan.input_hash !== b.input_hash
            )
              throw new Problem(
                409,
                "PLAN_STALE",
                "Refresh the completed plan and approve its current version",
              );
            const context = await resolveWorkContext(
              tx,
              req.principal,
              tenant,
              project,
              task.input_context,
            );
            if (
              context.stale ||
              hash(
                canonical({
                  prompt: task.prompt,
                  role_hash: task.role_hash,
                  context: context.digest,
                }),
              ) !== plan.input_hash
            )
              throw new Problem(
                409,
                "PLAN_STALE",
                "Specialist or memory settings changed after this plan; create a new plan",
              );
            let conversation;
            if (task.conversation_id) {
              conversation = await ownConversation(
                tx,
                req.principal,
                project,
                task.conversation_id,
                true,
              );
              if (
                conversation.archived ||
                conversation.version !== plan.conversation_version ||
                (
                  await tx.query(
                    "SELECT 1 FROM tasks WHERE conversation_id=$1 AND status=ANY($2::text[])",
                    [conversation.id, activeTaskStates],
                  )
                ).rowCount
              )
                throw new Problem(
                  409,
                  "PLAN_STALE",
                  "The conversation changed or has unfinished work",
                );
            }
            const result = await enqueueTask(
              tx,
              db,
              catalog,
              req.principal,
              tenant,
              project,
              {
                title: task.title,
                prompt: `Execute this explicitly approved plan.\n\nOriginal request:\n${task.prompt}\n\nApproved plan:\n${plan.body}`,
                role_key: task.role_key,
                parent_id: task.id,
                budget_micros: b.budget_micros,
                mode: "execute",
              },
              `plan:${id}`,
              {
                context: task.input_context.agent_id
                  ? task.input_context
                  : undefined,
                conversation,
              },
            );
            await tx.query(
              "UPDATE task_plans SET approved_task_id=$2,approved_by=$3,approved_at=now(),approval_hash=$4 WHERE task_id=$1",
              [id, result.id, req.principal.id, approvalHash],
            );
            if (conversation)
              await tx.query(
                "UPDATE conversations SET version=version+1,updated_at=now() WHERE id=$1",
                [conversation.id],
              );
            await audit(
              tx,
              req.principal,
              "plan.approve",
              id,
              "succeeded",
              {
                child_task_id: result.id,
                plan_version: plan.version,
                input_hash: plan.input_hash,
              },
              tenant,
            );
            return result;
          },
        );
      }, tenant);
    },
  );
}

const memoryInput = z
  .object({
    name,
    content: z.string().trim().min(1).max(8000),
    scope: z.enum(["tenant", "project", "brand", "personal", "conversation"]),
    brand_id: uuid.optional(),
    conversation_id: uuid.optional(),
    expires_at: z.string().datetime({ offset: true }).nullable().default(null),
  })
  .strict();
async function memoryWriteAccess(
  tx: Tx,
  p: Principal,
  tenant: string,
  project: string,
  b: z.infer<typeof memoryInput>,
) {
  if (b.expires_at && Date.parse(b.expires_at) <= Date.now())
    throw new Problem(
      400,
      "EXPIRY_INVALID",
      "Memory expiry must be in the future",
    );
  if (b.scope === "tenant") await tenantAccess(tx, p, tenant, "manage");
  else if (["brand", "project"].includes(b.scope))
    await projectAccess(tx, p, tenant, project, "manage");
  else await projectAccess(tx, p, tenant, project, "write");
  if (b.scope === "brand") {
    if (
      !b.brand_id ||
      !(
        await tx.query(
          "SELECT 1 FROM brand_profiles WHERE id=$1 AND project_id=$2",
          [b.brand_id, project],
        )
      ).rowCount
    )
      throw new Problem(404, "NOT_FOUND", "Brand not found");
  } else if (b.brand_id)
    throw new Problem(
      400,
      "SCOPE_INVALID",
      "Brand ID is only valid for brand memory",
    );
  if (b.scope === "conversation") {
    if (!b.conversation_id)
      throw new Problem(400, "SCOPE_INVALID", "Choose a conversation");
    await ownConversation(tx, p, project, b.conversation_id);
  } else if (b.conversation_id)
    throw new Problem(
      400,
      "SCOPE_INVALID",
      "Conversation ID is only valid for conversation memory",
    );
}
function registerMemories(app: FastifyInstance, db: Database) {
  const base = "/v1/tenants/:tenant/projects/:project/memories";
  app.get(base, { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project);
      return {
        items: (
          await tx.query(
            "SELECT m.*,v.content FROM memories m JOIN memory_versions v ON v.memory_id=m.id AND v.version=m.version WHERE m.tenant_id=$1 AND (m.project_id IS NULL OR m.project_id=$2) ORDER BY m.updated_at DESC LIMIT 200",
            [tenant, project],
          )
        ).rows,
      };
    }, tenant);
  });
  app.post(base, { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params);
    const b = memoryInput.parse(req.body);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project);
      await memoryWriteAccess(tx, req.principal, tenant, project, b);
      return replay(
        tx,
        req.principal.id,
        `memory.create:${tenant}`,
        key(req),
        b,
        async () => {
          const m = (
            await tx.query(
              "INSERT INTO memories(tenant_id,project_id,brand_id,conversation_id,private_owner,scope,name,expires_at,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *",
              [
                tenant,
                ["tenant", "personal"].includes(b.scope) ? null : project,
                b.brand_id ?? null,
                b.conversation_id ?? null,
                ["personal", "conversation"].includes(b.scope)
                  ? req.principal.id
                  : null,
                b.scope,
                b.name,
                b.expires_at,
                req.principal.id,
              ],
            )
          ).rows[0];
          await tx.query(
            "INSERT INTO memory_versions(tenant_id,memory_id,version,content,created_by) VALUES($1,$2,1,$3,$4)",
            [tenant, m.id, b.content, req.principal.id],
          );
          await audit(
            tx,
            req.principal,
            "memory.create",
            m.id,
            "succeeded",
            { scope: b.scope },
            tenant,
          );
          return { ...m, content: b.content };
        },
      );
    }, tenant);
  });
  app.patch(base + "/:id", { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params);
    const id = uuid.parse((req.params as any).id);
    const b = memoryInput
      .extend({ expected_version: expectedVersion })
      .parse(req.body);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project);
      const m = (
        await tx.query(
          "SELECT * FROM memories WHERE id=$1 AND (project_id=$2 OR project_id IS NULL) FOR UPDATE",
          [id, project],
        )
      ).rows[0];
      if (!m) throw new Problem(404, "NOT_FOUND", "Memory not found");
      if (m.version !== b.expected_version)
        throw new Problem(
          409,
          "VERSION_CONFLICT",
          "Memory changed; refresh before saving",
        );
      if (
        m.scope !== b.scope ||
        (m.brand_id ?? undefined) !== b.brand_id ||
        (m.conversation_id ?? undefined) !== b.conversation_id
      )
        throw new Problem(
          400,
          "SCOPE_IMMUTABLE",
          "Create a new memory to change its scope",
        );
      await memoryWriteAccess(tx, req.principal, tenant, project, b);
      const result = (
        await tx.query(
          "UPDATE memories SET name=$2,expires_at=$3,version=version+1,updated_at=now() WHERE id=$1 RETURNING *",
          [id, b.name, b.expires_at],
        )
      ).rows[0];
      await tx.query(
        "INSERT INTO memory_versions(tenant_id,memory_id,version,content,created_by) VALUES($1,$2,$3,$4,$5)",
        [tenant, id, result.version, b.content, req.principal.id],
      );
      await audit(
        tx,
        req.principal,
        "memory.version.create",
        id,
        "succeeded",
        { version: result.version },
        tenant,
      );
      return { ...result, content: b.content };
    }, tenant);
  });
  app.delete(base + "/:id", { preHandler: requireUser(db) }, async (req) => {
    const { tenant, project } = params.parse(req.params);
    const id = uuid.parse((req.params as any).id);
    const b = z
      .object({ expected_version: expectedVersion })
      .strict()
      .parse(req.body);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project);
      const m = (
        await tx.query(
          "SELECT * FROM memories WHERE id=$1 AND (project_id=$2 OR project_id IS NULL) FOR UPDATE",
          [id, project],
        )
      ).rows[0];
      if (!m) throw new Problem(404, "NOT_FOUND", "Memory not found");
      if (m.version !== b.expected_version)
        throw new Problem(
          409,
          "VERSION_CONFLICT",
          "Memory changed; refresh before deleting",
        );
      await memoryWriteAccess(tx, req.principal, tenant, project, {
        name: m.name,
        content: "delete",
        scope: m.scope,
        brand_id: m.brand_id ?? undefined,
        conversation_id: m.conversation_id ?? undefined,
        expires_at: null,
      });
      await tx.query("SELECT set_config('app.erasing_content','true',true)");
      await eraseReplayContent(tx, [id]);
      await tx.query(
        "UPDATE memory_versions SET content=NULL WHERE memory_id=$1",
        [id],
      );
      await tx.query(
        "UPDATE memories SET content_state='deleted',name='Deleted memory',version=version+1,moderation_version=moderation_version+1 WHERE id=$1",
        [id],
      );
      await audit(
        tx,
        req.principal,
        "memory.delete",
        id,
        "succeeded",
        {},
        tenant,
      );
      return { deleted: true };
    }, tenant);
  });
}
