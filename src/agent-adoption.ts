import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import type { Principal } from "./auth.js";
import { audit, requireUser } from "./auth.js";
import { key, projectAccess, replay } from "./access.js";
import { canonical, hash, hmac, Problem, uuid } from "./lib.js";
import { validFederation } from "./federation-session.js";
import {
  capabilityDefinition,
  confirmedAgentCapabilities,
  gatewayFingerprint,
} from "./capability-bindings.js";
import {
  bindAgentSkills,
  provisionRoleSkills,
  skillVersionId,
} from "./skill-lifecycle.js";
import {
  agentDefinition,
  agentInput,
  defaultDefinition,
  getAgentVersion,
  ownConversation,
  retainTemplateProvenance,
  retainBrandVersion,
} from "./persistent-work.js";
import { fixedBrandVersion } from "./brand-bindings.js";

const version = z.number().int().positive().safe();
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const params = z.object({ tenant: uuid, project: uuid });
export const agentVersionProposal = z
  .object({
    expected_version: version,
    definition: agentInput.extend({ enabled: z.boolean() }).optional(),
  })
  .strict();
export const conversationAdoptionProposal = z
  .object({
    expected_version: version,
    target_agent_version: version,
    name: z.string().trim().min(1).max(160).optional(),
  })
  .strict();
const kind = z.enum(["default_assistant", "specialist", "conversation"]);
const capability = z
  .object({
    id: uuid,
    profile_key: z.string().min(1).max(120),
    model_alias: z.string().max(200).nullable(),
    reasoning_effort: z
      .enum(["low", "medium", "high", "xhigh", "max"])
      .nullable(),
    state: z.enum(["ready", "unavailable", "unrecorded"]),
    input_micros_per_million: z.string().regex(/^\d+$/).nullable(),
    output_micros_per_million: z.string().regex(/^\d+$/).nullable(),
    micros_per_image: z.string().regex(/^\d+$/).nullable(),
  })
  .strict();
const snapshot = z
  .object({
    agent_id: uuid,
    agent_version: version,
    recorded: z.boolean(),
    runtime_version: z.string().max(120).nullable(),
    capabilities: z.array(capability).max(8),
    skills: z
      .array(
        z
          .object({
            key: z.string().min(1).max(120),
            version: z.string().min(1).max(120),
            sha256: digest,
            installation_id: uuid.nullable(),
          })
          .strict(),
      )
      .max(40),
    tool_ids: z.array(z.string().min(1).max(120)).max(40),
    brand: z.object({ id: uuid, version }).strict().nullable(),
  })
  .strict();
export const adoptionComparison = z
  .object({
    kernel: z.literal("codex"),
    gateway_policy: z.literal("company_internal_only"),
    data_mode: z.enum(["simulated", "configured_services"]),
    effect: z.literal("future_tasks_only"),
    source: snapshot,
    target: snapshot,
    changed_fields: z
      .array(
        z.enum([
          "name",
          "instructions",
          "enabled",
          "runtime",
          "models",
          "reasoning_effort",
          "rates",
          "skills",
          "tools",
          "brand",
        ]),
      )
      .max(10),
  })
  .strict();
export const adoptionResult = z
  .object({
    preview_id: uuid,
    kind,
    resource_id: uuid,
    agent_id: uuid,
    version,
    agent_version: version,
  })
  .strict();
export const adoptionPreview = z
  .object({
    id: uuid,
    kind,
    resource_id: uuid,
    project_id: uuid,
    expected_version: version,
    preview_hash: digest,
    expires_at: z.string().datetime(),
    state: z.enum(["ready", "consumed"]),
    comparison: adoptionComparison,
    result: adoptionResult.nullable(),
  })
  .strict();
export const adoptionConfirmation = z
  .object({
    preview_hash: digest,
    proposal: z.union([agentVersionProposal, conversationAdoptionProposal]),
  })
  .strict();
type Proposal =
  | z.infer<typeof agentVersionProposal>
  | z.infer<typeof conversationAdoptionProposal>;
type Kind = z.infer<typeof kind>;
type Scope = { tenant: string; project: string };
const stale = () =>
  new Problem(
    409,
    "ADOPTION_PREVIEW_STALE",
    "Settings, access or published capabilities changed. Compare the versions again.",
  );
const sealedHash = (db: Database, domain: string, data: unknown) =>
  hmac(db.config.MASTER_KEY!, `agent-adoption:${domain}:${canonical(data)}`);

/** Hold current user/session and project authority until the short commit ends. */
export async function authority(
  tx: Tx,
  p: Principal,
  scope: Scope,
  minimum: "write" | "manage",
) {
  await tx.query("SELECT set_config('app.actor_id',$1,true)", [p.id]);
  const user = (
    await tx.query(
      "SELECT status,auth_version FROM users WHERE id=$1 FOR SHARE",
      [p.id],
    )
  ).rows[0];
  const session = (
    await tx.query(
      "SELECT *,expires_at>now() AS valid FROM sessions WHERE id=$1 AND user_id=$2 FOR SHARE",
      [p.sessionId, p.id],
    )
  ).rows[0];
  if (
    !user ||
    user.status !== "active" ||
    user.auth_version !== p.authVersion ||
    !session ||
    !session.valid ||
    session.revoked_at ||
    session.auth_version !== p.authVersion ||
    session.audience !== p.audience ||
    !(await validFederation(tx, session))
  )
    throw new Problem(401, "SESSION_EXPIRED", "Please sign in again");
  await tx.query("SELECT id FROM tenants WHERE id=$1 FOR SHARE", [
    scope.tenant,
  ]);
  const membership = (
    await tx.query(
      "SELECT version,role,status FROM memberships WHERE tenant_id=$1 AND user_id=$2 FOR SHARE",
      [scope.tenant, p.id],
    )
  ).rows[0];
  await tx.query(
    "SELECT id FROM projects WHERE id=$1 AND tenant_id=$2 FOR SHARE",
    [scope.project, scope.tenant],
  );
  const binding = (
    await tx.query(
      "SELECT * FROM project_members WHERE project_id=$1 AND user_id=$2 FOR SHARE",
      [scope.project, p.id],
    )
  ).rows[0];
  await projectAccess(tx, p, scope.tenant, scope.project, minimum);
  return {
    membership,
    binding: binding ? { role: binding.role } : null,
    auth_version: p.authVersion,
  };
}

async function describe(
  tx: Tx,
  db: Database,
  catalog: Catalog,
  agent: any,
  body: any,
  agentVersion: number,
  target: boolean,
) {
  if (target) await confirmedAgentCapabilities(tx, db.config, catalog, body);
  const profile = body.runtime_profile_id
    ? (
        await tx.query("SELECT * FROM codex_runtime_profiles WHERE id=$1", [
          body.runtime_profile_id,
        ])
      ).rows[0]
    : undefined;
  const ids: string[] = body.capability_version_ids ?? [];
  const rows = ids.length
    ? (
        await tx.query(
          "SELECT * FROM internal_capability_versions WHERE id=ANY($1::uuid[]) ORDER BY profile_key,id",
          [ids],
        )
      ).rows
    : [];
  let recorded =
    !!profile &&
    profile.kernel === "codex" &&
    profile.pinned_version === body.runtime_version &&
    rows.length === ids.length &&
    ids.length > 0;
  const capabilities: z.infer<typeof capability>[] = [];
  for (const row of rows) {
    const parsed = capabilityDefinition.safeParse(row.body);
    const valid =
      parsed.success &&
      hash(canonical(row.body)) === row.fingerprint &&
      parsed.data.profile_key === row.profile_key &&
      parsed.data.data_mode === row.data_mode &&
      parsed.data.ready === row.ready;
    if (!valid) recorded = false;
    if (
      target &&
      (!valid ||
        row.revoked ||
        row.data_mode !==
          (db.config.DEMO_MODE ? "simulated" : "configured_services") ||
        (parsed.success &&
          parsed.data.gateway_fingerprint !== gatewayFingerprint(db.config)))
    )
      throw stale();
    const b = valid && parsed.success ? parsed.data : null;
    capabilities.push({
      id: row.id,
      profile_key: row.profile_key,
      model_alias: b?.model_alias ?? null,
      reasoning_effort: b?.reasoning_effort ?? null,
      state: !b
        ? "unrecorded"
        : row.ready && !row.revoked
          ? "ready"
          : "unavailable",
      input_micros_per_million:
        b?.wire_protocol === "responses" && b.rates[0] != null
          ? String(b.rates[0])
          : null,
      output_micros_per_million:
        b?.wire_protocol === "responses" && b.rates[1] != null
          ? String(b.rates[1])
          : null,
      micros_per_image:
        b?.wire_protocol === "images" && b.rates[0] != null
          ? String(b.rates[0])
          : null,
    });
  }
  if (target) {
    if (
      !recorded ||
      profile.state !== "enabled" ||
      profile.id !== catalog.runtimeProfile.id ||
      profile.transport !== "stdio" ||
      profile.gateway_policy !== "company_internal_only" ||
      profile.automatic_fallback ||
      profile.pinned_version !== db.config.CODEX_VERSION ||
      new Set(ids).size !== ids.length
    )
      throw stale();
    for (const binding of catalog.role(body.role_key, body.role_hash).model_bindings) {
      const selected = capabilities.find(
        (c) => c.profile_key === binding.profile_key,
      );
      if (!selected || (binding.required && selected.state !== "ready"))
        throw new Problem(
          409,
          "CAPABILITY_VERSION_UNAVAILABLE",
          "A required model capability is unavailable",
        );
    }
  }
  return snapshot.parse({
    agent_id: agent.id,
    agent_version: agentVersion,
    recorded,
    runtime_version: recorded ? profile.pinned_version : null,
    capabilities,
    skills: (body.skills ?? []).map((s: any) => ({
      key: s.key,
      version: s.version,
      sha256: s.sha256,
      installation_id: s.installation_id ?? null,
    })),
    tool_ids: [...(body.tool_ids ?? [])].sort(),
    brand: body.brand ?? null,
  });
}

async function lockReferences(tx: Tx, catalog: Catalog, body: any) {
  await tx.query("SELECT lock_task_capability_versions($1,$2::uuid[])", [
    body.runtime_profile_id,
    body.capability_version_ids,
  ]);
  const packages = await catalog.boundSkills(catalog.role(body.role_key, body.role_hash));
  await tx.query("SELECT lock_adoption_skill_versions($1::uuid[])", [
    packages.map((s) => skillVersionId(s.key, s.version, s.sha256)),
  ]);
}

async function prepare(
  tx: Tx,
  db: Database,
  catalog: Catalog,
  p: Principal,
  scope: Scope,
  resourceId: string,
  input: Proposal,
  requested: "agent" | "conversation",
) {
  const initialConversation =
    requested === "conversation"
      ? await ownConversation(tx, p, scope.project, resourceId)
      : null;
  const agentId = initialConversation?.agent_id ?? resourceId;
  const initialAgent = (
    await tx.query(
      "SELECT * FROM agents WHERE id=$1 AND project_id=$2 AND content_state='active'",
      [agentId, scope.project],
    )
  ).rows[0];
  if (!initialAgent)
    throw new Problem(404, "NOT_FOUND", "Specialist not found");
  const actualKind: Kind = initialConversation
    ? "conversation"
    : initialAgent.builtin_default
      ? "default_assistant"
      : "specialist";
  const access = await authority(
    tx,
    p,
    scope,
    actualKind === "default_assistant" ||
      (actualKind === "specialist" && initialAgent.created_by !== p.id)
      ? "manage"
      : "write",
  );
  const conversation = initialConversation
    ? await ownConversation(tx, p, scope.project, resourceId, true)
    : null;
  const row = (
    await tx.query(
      "SELECT * FROM agents WHERE id=$1 AND project_id=$2 AND content_state='active' FOR UPDATE",
      [agentId, scope.project],
    )
  ).rows[0];
  if (!row || (conversation && conversation.agent_id !== agentId))
    throw stale();
  const resource = conversation ?? row;
  if (resource.version !== input.expected_version)
    throw new Problem(
      409,
      "VERSION_CONFLICT",
      "The resource changed. Reload before comparing versions.",
    );
  const source = await getAgentVersion(
    tx,
    scope.project,
    row.id,
    conversation?.agent_version,
  );
  let target: any;
  const current = await catalog.currentCapabilities(tx);
  if (conversation) {
    const proposal = conversationAdoptionProposal.parse(input);
    if (!row.enabled || proposal.target_agent_version !== row.version)
      throw stale();
    target = await getAgentVersion(tx, scope.project, row.id);
    await lockReferences(tx, catalog, target.body);
    const planned = await provisionRoleSkills(
      tx,
      catalog,
      catalog.role(row.role_key),
      scope.tenant,
      scope.project,
      p.id,
      true,
      false,
    );
    if (
      target.body.role_hash !== catalog.digest(catalog.role(row.role_key)) ||
      canonical(
        target.body.skills.map((s: any) => [
          s.key,
          s.skill_version_id,
          s.installation_id,
        ]),
      ) !==
        canonical(
          planned.map((s) => [s.key, s.skill_version_id, s.installation_id]),
        )
    )
      throw stale();
    // Follow-up work must use the exact current default, never a fallback.
    if (
      (target.body.capability_version_ids ?? []).some(
        (id: string) => ![...current.values()].some((c) => c.id === id),
      )
    )
      throw stale();
  } else {
    const proposal = agentVersionProposal.parse(input);
    if (row.builtin_default && (proposal.definition || !row.enabled))
      throw new Problem(
        400,
        "DEFAULT_ASSISTANT_IMMUTABLE",
        "Default assistant settings are fixed",
      );
    if (
      !row.builtin_default &&
      (!proposal.definition || proposal.definition.role_key !== row.role_key)
    )
      throw new Problem(
        400,
        "ROLE_IMMUTABLE",
        "An existing specialist keeps its role",
      );
    const ids = catalog
      .role(row.role_key)
      .model_bindings.map((b: any) => current.get(b.profile_key)?.id)
      .filter(Boolean);
    await tx.query("SELECT lock_task_capability_versions($1,$2::uuid[])", [
      catalog.runtimeProfile.id,
      ids,
    ]);
    const packages = await catalog.boundSkills(catalog.role(row.role_key));
    await tx.query("SELECT lock_adoption_skill_versions($1::uuid[])", [
      packages.map((s) => skillVersionId(s.key, s.version, s.sha256)),
    ]);
    const body = row.builtin_default
      ? await defaultDefinition(
          tx,
          catalog,
          scope.tenant,
          scope.project,
          p.id,
          true,
        )
      : await agentDefinition(
          tx,
          catalog,
          retainBrandVersion(proposal.definition!, source.body),
          scope.project,
          scope.tenant,
          p.id,
          true,
        );
    target = {
      ...row,
      version: row.version + 1,
      body: retainTemplateProvenance(body, source.body),
    };
  }
  await catalog.ensureEnabled(tx, row.role_key);
  const from = await describe(
    tx,
    db,
    catalog,
    row,
    source.body,
    source.bound_version,
    false,
  );
  const to = await describe(
    tx,
    db,
    catalog,
    row,
    target.body,
    conversation ? target.bound_version : target.version,
    true,
  );
  const changed: z.infer<typeof adoptionComparison>["changed_fields"] = [];
  const different = (a: unknown, b: unknown) => canonical(a) !== canonical(b);
  const select = (
    s: z.infer<typeof snapshot>,
    keys: (keyof z.infer<typeof capability>)[],
  ) => s.capabilities.map((c) => [c.profile_key, ...keys.map((k) => c[k])]);
  if (
    different(
      conversation?.name ?? source.body.name,
      conversation
        ? ((input as z.infer<typeof conversationAdoptionProposal>).name ??
            conversation.name)
        : target.body.name,
    )
  )
    changed.push("name");
  if (different(source.body.instructions, target.body.instructions))
    changed.push("instructions");
  if (
    !conversation &&
    (input as z.infer<typeof agentVersionProposal>).definition?.enabled !==
      undefined &&
    (input as any).definition.enabled !== row.enabled
  )
    changed.push("enabled");
  if (different(from.runtime_version, to.runtime_version))
    changed.push("runtime");
  if (different(select(from, ["model_alias"]), select(to, ["model_alias"])))
    changed.push("models");
  if (
    different(
      select(from, ["reasoning_effort"]),
      select(to, ["reasoning_effort"]),
    )
  )
    changed.push("reasoning_effort");
  if (
    different(
      select(from, [
        "input_micros_per_million",
        "output_micros_per_million",
        "micros_per_image",
      ]),
      select(to, [
        "input_micros_per_million",
        "output_micros_per_million",
        "micros_per_image",
      ]),
    )
  )
    changed.push("rates");
  if (
    different(from.skills, to.skills) ||
    source.body.role_hash !== target.body.role_hash
  )
    changed.push("skills");
  if (different(from.tool_ids, to.tool_ids)) changed.push("tools");
  if (different(from.brand, to.brand)) changed.push("brand");
  const comparison = adoptionComparison.parse({
    kernel: "codex",
    gateway_policy: "company_internal_only",
    data_mode: db.config.DEMO_MODE ? "simulated" : "configured_services",
    effect: "future_tasks_only",
    source: from,
    target: to,
    changed_fields: changed,
  });
  const sourceHash = sealedHash(db, "source", {
    kind: actualKind,
    id: resourceId,
    version: resource.version,
    enabled: row.enabled,
    name: resource.name,
    pinned: conversation?.pinned ?? null,
    archived: conversation?.archived ?? null,
    body: source.body,
  });
  const contextHash = sealedHash(db, "context", {
    access,
    definition: target.body,
    catalog: catalog.digest(catalog.role(row.role_key)),
    gateway: gatewayFingerprint(db.config),
    heads: [...current.values()]
      .filter((c) => (target.body.capability_version_ids ?? []).includes(c.id))
      .map((c) => ({
        profile_key: c.profile_key,
        id: c.id,
        publication_id: c.publication_id ?? null,
        revision: c.head_revision ?? null,
      }))
      .sort((a, b) => a.profile_key.localeCompare(b.profile_key)),
  });
  const guards = {
    access_hash: sealedHash(db, "access", access),
    role_hash: catalog.digest(catalog.role(row.role_key)),
    runtime_profile_id: target.body.runtime_profile_id,
    runtime_version: target.body.runtime_version,
    capability_version_ids: target.body.capability_version_ids,
    heads: [...current.values()]
      .filter((c) => (target.body.capability_version_ids ?? []).includes(c.id))
      .map((c) => ({
        profile_key: c.profile_key,
        id: c.id,
        publication_id: c.publication_id ?? null,
        revision: c.head_revision ?? null,
      }))
      .sort((a, b) => a.profile_key.localeCompare(b.profile_key)),
    target_agent_version: conversation ? target.bound_version : row.version,
    skill_state: (
      await provisionRoleSkills(
        tx,
        catalog,
        catalog.role(row.role_key),
        scope.tenant,
        scope.project,
        p.id,
        true,
        false,
      )
    ).map((s) => ({
      key: s.key,
      skill_version_id: s.skill_version_id,
      installation_id: s.installation_id,
      installation_version: s.installation_version,
    })),
    brand: target.body.brand ?? null,
    brand_version_id: target.body.brand_version_id ?? null,
  };
  return {
    kind: actualKind,
    agent: row,
    conversation,
    source,
    target,
    comparison,
    sourceHash,
    contextHash: sealedHash(db, "complete-context", { contextHash, guards }),
    guards,
  };
}

function present(row: any) {
  return adoptionPreview.parse({
    id: row.id,
    kind: row.kind,
    resource_id: row.resource_id,
    project_id: row.project_id,
    expected_version: row.expected_version,
    preview_hash: row.preview_hash,
    expires_at: row.expires_at.toISOString(),
    state: row.consumed_at ? "consumed" : "ready",
    comparison: row.comparison,
    result: row.result ?? null,
  });
}

async function ownPreview(
  tx: Tx,
  p: Principal,
  scope: Scope,
  id: string,
  lock = false,
) {
  const row = (
    await tx.query(
      "SELECT *,expires_at>clock_timestamp() AS live FROM agent_adoption_previews WHERE id=$1 AND tenant_id=$2 AND project_id=$3 AND actor_id=$4 AND session_id=$5 AND auth_version=$6" +
        (lock ? " FOR UPDATE" : ""),
      [id, scope.tenant, scope.project, p.id, p.sessionId, p.authVersion],
    )
  ).rows[0];
  if (!row)
    throw new Problem(
      404,
      "NOT_FOUND",
      "Comparison not found. Create a new comparison in this session.",
    );
  return row;
}

async function currentAccess(tx: Tx, p: Principal, scope: Scope, row: any) {
  const agent = (
    await tx.query(
      "SELECT created_by FROM agents WHERE id=$1 AND project_id=$2 AND content_state='active'",
      [row.agent_id, scope.project],
    )
  ).rows[0];
  if (!agent) throw new Problem(404, "NOT_FOUND", "Specialist not found");
  const access = await authority(
    tx,
    p,
    scope,
    row.kind === "default_assistant" ||
      (row.kind === "specialist" && agent.created_by !== p.id)
      ? "manage"
      : "write",
  );
  if (row.kind === "conversation")
    await ownConversation(tx, p, scope.project, row.conversation_id);
  return access;
}

/** Recheck only persisted metadata; private proposal text is never required here. */
async function checkGuards(
  tx: Tx,
  db: Database,
  catalog: Catalog,
  p: Principal,
  scope: Scope,
  row: any,
  access: unknown,
) {
  const guards = row.guards;
  if (sealedHash(db, "access", access) !== guards.access_hash) throw stale();
  const agent = await getAgentVersion(tx, scope.project, row.agent_id);
  const conversation =
    row.kind === "conversation"
      ? await ownConversation(tx, p, scope.project, row.conversation_id)
      : null;
  const resource = conversation ?? agent;
  if (
    resource.version !== row.expected_version ||
    agent.version !== guards.target_agent_version ||
    catalog.digest(catalog.role(agent.role_key)) !== guards.role_hash
  )
    throw stale();
  const source = conversation
    ? await getAgentVersion(
        tx,
        scope.project,
        agent.id,
        conversation.agent_version,
      )
    : agent;
  const sourceHash = sealedHash(db, "source", {
    kind: row.kind,
    id: row.resource_id,
    version: resource.version,
    enabled: agent.enabled,
    name: resource.name,
    pinned: conversation?.pinned ?? null,
    archived: conversation?.archived ?? null,
    body: source.body,
  });
  if (sourceHash !== row.source_hash) throw stale();
  const current = await catalog.currentCapabilities(tx);
  const heads = [...current.values()]
    .filter((c) => guards.capability_version_ids.includes(c.id))
    .map((c) => ({
      profile_key: c.profile_key,
      id: c.id,
      publication_id: c.publication_id ?? null,
      revision: c.head_revision ?? null,
    }))
    .sort((a, b) => a.profile_key.localeCompare(b.profile_key));
  if (canonical(heads) !== canonical(guards.heads)) throw stale();
  const body = {
    role_key: agent.role_key,
    runtime_profile_id: guards.runtime_profile_id,
    runtime_version: guards.runtime_version,
    capability_version_ids: guards.capability_version_ids,
  };
  await lockReferences(tx, catalog, body);
  await confirmedAgentCapabilities(tx, db.config, catalog, body);
  const skills = (
    await provisionRoleSkills(
      tx,
      catalog,
      catalog.role(agent.role_key),
      scope.tenant,
      scope.project,
      p.id,
      true,
      false,
    )
  ).map((s) => ({
    key: s.key,
    skill_version_id: s.skill_version_id,
    installation_id: s.installation_id,
    installation_version: s.installation_version,
  }));
  if (canonical(skills) !== canonical(guards.skill_state)) throw stale();
  if (guards.brand_version_id) {
    const brand = await fixedBrandVersion(tx, scope.project, guards.brand_version_id);
    if (canonical(brand) !== canonical(guards.brand)) throw stale();
  } else if (guards.brand) {
    const brand = (
      await tx.query(
        "SELECT id,version FROM brand_profiles WHERE id=$1 AND project_id=$2 AND content_state='active' FOR SHARE",
        [guards.brand.id, scope.project],
      )
    ).rows[0];
    if (!brand || canonical(brand) !== canonical(guards.brand)) throw stale();
  }
  await catalog.ensureEnabled(tx, agent.role_key);
}

export function registerAgentAdoption(
  app: FastifyInstance,
  db: Database,
  catalog: Catalog,
) {
  const base = "/v1/tenants/:tenant/projects/:project";
  const auth = { preHandler: requireUser(db) };
  const previewRoute =
    (requested: "agent" | "conversation") =>
    async (req: FastifyRequest, reply: any) => {
      reply.header("Cache-Control", "no-store");
      const scope = params.parse(req.params),
        resourceId = uuid.parse((req.params as any).id);
      const input =
        requested === "agent"
          ? agentVersionProposal.parse(req.body)
          : conversationAdoptionProposal.parse(req.body);
      const result = await db.tx(async (tx) => {
        await projectAccess(
          tx,
          req.principal,
          scope.tenant,
          scope.project,
          "write",
        );
        const receipt = await replay(
          tx,
          req.principal.id,
          `agent-adoption.preview:${scope.project}:${resourceId}`,
          key(req),
          { session_id: req.principal.sessionId, input },
          async () => {
            const prepared = await prepare(
              tx,
              db,
              catalog,
              req.principal,
              scope,
              resourceId,
              input,
              requested,
            );
            await tx.query(
              "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
              [`agent-adoption.previews:${scope.project}:${req.principal.id}`],
            );
            const count = (
              await tx.query(
                "SELECT count(*)::int AS n FROM agent_adoption_previews WHERE project_id=$1 AND actor_id=$2 AND consumed_at IS NULL AND expires_at>now()",
                [scope.project, req.principal.id],
              )
            ).rows[0].n;
            if (count >= 20)
              throw new Problem(
                429,
                "ADOPTION_PREVIEW_LIMIT",
                "Finish an existing comparison or wait for it to expire",
              );
            const id = randomUUID();
            const proposalHash = sealedHash(db, "proposal", input);
            const times = (
              await tx.query(
                "SELECT now() AS created_at,now()+interval '5 minutes' AS expires_at",
              )
            ).rows[0];
            const previewHash = sealedHash(db, "preview", {
              id,
              actor: req.principal.id,
              session: req.principal.sessionId,
              kind: prepared.kind,
              scope,
              source: prepared.sourceHash,
              proposal: proposalHash,
              context: prepared.contextHash,
              comparison: prepared.comparison,
              expires_at: times.expires_at.toISOString(),
            });
            const row = (
              await tx.query(
                `INSERT INTO agent_adoption_previews(id,tenant_id,project_id,actor_id,session_id,auth_version,kind,resource_id,agent_id,conversation_id,expected_version,source_hash,proposal_hash,context_hash,preview_hash,comparison,created_at,expires_at,guards)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`,
                [
                  id,
                  scope.tenant,
                  scope.project,
                  req.principal.id,
                  req.principal.sessionId,
                  req.principal.authVersion,
                  prepared.kind,
                  resourceId,
                  prepared.agent.id,
                  prepared.conversation?.id ?? null,
                  input.expected_version,
                  prepared.sourceHash,
                  proposalHash,
                  prepared.contextHash,
                  previewHash,
                  prepared.comparison,
                  times.created_at,
                  times.expires_at,
                  prepared.guards,
                ],
              )
            ).rows[0];
            return present(row);
          },
        );
        const row = await ownPreview(tx, req.principal, scope, receipt.id);
        const access = await currentAccess(tx, req.principal, scope, row);
        if (!row.consumed_at) {
          if (!row.live)
            throw new Problem(
              409,
              "ADOPTION_PREVIEW_EXPIRED",
              "Compare the versions again before confirming",
            );
          await checkGuards(tx, db, catalog, req.principal, scope, row, access);
        }
        return present(row);
      }, scope.tenant);
      reply.header("Cache-Control", "no-store");
      return reply.code(201).send(result);
    };
  app.post(base + "/agents/:id/version-previews", auth, previewRoute("agent"));
  app.post(
    base + "/conversations/:id/adoption-previews",
    auth,
    previewRoute("conversation"),
  );
  app.get(base + "/version-adoption-previews/:id", auth, async (req, reply) => {
    reply.header("Cache-Control", "no-store");
    z.object({}).strict().parse(req.query);
    const scope = params.parse(req.params),
      id = uuid.parse((req.params as any).id);
    const result = await db.tx(async (tx) => {
      await projectAccess(
        tx,
        req.principal,
        scope.tenant,
        scope.project,
        "write",
      );
      const row = await ownPreview(tx, req.principal, scope, id);
      const access = await currentAccess(tx, req.principal, scope, row);
      if (!row.consumed_at) {
        if (!row.live)
          throw new Problem(
            409,
            "ADOPTION_PREVIEW_EXPIRED",
            "Compare the versions again before confirming",
          );
        await checkGuards(tx, db, catalog, req.principal, scope, row, access);
      }
      return present(row);
    }, scope.tenant);
    reply.header("Cache-Control", "no-store");
    return result;
  });
  app.post(
    base + "/version-adoption-previews/:id/confirmations",
    auth,
    async (req, reply) => {
      reply.header("Cache-Control", "no-store");
      const scope = params.parse(req.params),
        id = uuid.parse((req.params as any).id),
        input = adoptionConfirmation.parse(req.body);
      const result = await db.tx(async (tx) => {
        await projectAccess(
          tx,
          req.principal,
          scope.tenant,
          scope.project,
          "write",
        );
        const initial = await ownPreview(tx, req.principal, scope, id);
        await currentAccess(tx, req.principal, scope, initial);
        return replay(
          tx,
          req.principal.id,
          `agent-adoption.confirm:${scope.project}:${id}`,
          key(req),
          { session_id: req.principal.sessionId, ...input },
          async () => {
            const row = await ownPreview(tx, req.principal, scope, id, true);
            if (row.consumed_at)
              throw new Problem(
                409,
                "ADOPTION_PREVIEW_CONSUMED",
                "This comparison has already been confirmed",
              );
            if (!row.live)
              throw new Problem(
                409,
                "ADOPTION_PREVIEW_EXPIRED",
                "Compare the versions again before confirming",
              );
            if (
              row.preview_hash !== input.preview_hash ||
              row.proposal_hash !== sealedHash(db, "proposal", input.proposal)
            )
              throw new Problem(
                409,
                "ADOPTION_PROPOSAL_CHANGED",
                "The proposal differs from the reviewed comparison",
              );
            const proposal =
              row.kind === "conversation"
                ? conversationAdoptionProposal.parse(input.proposal)
                : agentVersionProposal.parse(input.proposal);
            const prepared = await prepare(
              tx,
              db,
              catalog,
              req.principal,
              scope,
              row.resource_id,
              proposal,
              row.kind === "conversation" ? "conversation" : "agent",
            );
            if (
              prepared.kind !== row.kind ||
              prepared.sourceHash !== row.source_hash ||
              prepared.contextHash !== row.context_hash ||
              canonical(prepared.comparison) !== canonical(row.comparison)
            )
              throw stale();
            let resourceVersion: number, agentVersion: number;
            if (prepared.conversation) {
              const body = conversationAdoptionProposal.parse(proposal);
              const updated = (
                await tx.query(
                  "UPDATE conversations SET name=coalesce($2,name),agent_version=$3,version=version+1,updated_at=now() WHERE id=$1 AND version=$4 RETURNING version",
                  [
                    row.resource_id,
                    body.name,
                    body.target_agent_version,
                    body.expected_version,
                  ],
                )
              ).rows[0];
              if (!updated) throw stale();
              resourceVersion = updated.version;
              agentVersion = body.target_agent_version;
            } else {
              const body = agentVersionProposal.parse(proposal);
              const definition = retainTemplateProvenance(
                prepared.agent.builtin_default
                  ? await defaultDefinition(
                      tx,
                      catalog,
                      scope.tenant,
                      scope.project,
                      req.principal.id,
                    )
                  : await agentDefinition(
                      tx,
                      catalog,
                      retainBrandVersion(body.definition!, prepared.source.body),
                      scope.project,
                      scope.tenant,
                      req.principal.id,
                    ),
                prepared.source.body,
              );
              const updated = (
                await tx.query(
                  "UPDATE agents SET name=$2,enabled=$3,version=version+1,updated_at=now() WHERE id=$1 AND version=$4 RETURNING version",
                  [
                    row.agent_id,
                    definition.name,
                    body.definition?.enabled ?? true,
                    body.expected_version,
                  ],
                )
              ).rows[0];
              if (!updated) throw stale();
              await tx.query(
                "INSERT INTO agent_versions(tenant_id,agent_id,version,body,created_by) VALUES($1,$2,$3,$4,$5)",
                [
                  scope.tenant,
                  row.agent_id,
                  updated.version,
                  definition,
                  req.principal.id,
                ],
              );
              await bindAgentSkills(
                tx,
                scope.tenant,
                scope.project,
                row.agent_id,
                updated.version,
                definition.skills,
              );
              resourceVersion = updated.version;
              agentVersion = updated.version;
            }
            const result = adoptionResult.parse({
              preview_id: id,
              kind: row.kind,
              resource_id: row.resource_id,
              agent_id: row.agent_id,
              version: resourceVersion,
              agent_version: agentVersion,
            });
            await audit(
              tx,
              req.principal,
              "agent.version.adopt",
              row.resource_id,
              "succeeded",
              {
                preview_id: id,
                preview_hash: row.preview_hash,
                kind: row.kind,
                version: resourceVersion,
                agent_version: agentVersion,
              },
              scope.tenant,
            );
            await tx.query(
              "UPDATE agent_adoption_previews SET consumed_at=now(),result=$2 WHERE id=$1",
              [id, result],
            );
            return result;
          },
        );
      }, scope.tenant);
      reply.header("Cache-Control", "no-store");
      return result;
    },
  );
}
