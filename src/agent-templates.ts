import type { FastifyInstance, FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import type { Principal } from "./auth.js";
import { requireUser } from "./auth.js";
import { key, projectAccess, replay, tenantAccess } from "./access.js";
import { canonical, hash, name, Problem, uuid } from "./lib.js";
import { skillVersionId } from "./skill-lifecycle.js";
import { agentInput, createSpecialist } from "./persistent-work.js";
import { authorizeExecutionPlan } from "./plans.js";
import { CodexRuntimeAdapter } from "./runtime.js";

const tenantOf = (request: FastifyRequest) =>
  uuid.parse(request.headers["x-tenant-id"]);
const useTemplate = z
  .object({
    project_id: uuid,
    template_version: z.number().int().positive(),
    name: name.optional(),
    overrides: z
      .object({
        name: name.optional(),
        role_description: z.string().trim().min(1).max(6000).optional(),
        brand_version_id: uuid.optional(),
        locale: z.enum(["zh-HK", "en-HK"]).optional(),
        delivery_preferences: z
          .array(z.string().trim().min(1).max(240))
          .max(12)
          .optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
// This is the current product-tool surface, not the larger proposed catalog.
// Unsupported professional tools remain explicit dependencies.
const implementedTools = new Set([
  "asset.read",
  "asset.write",
  "dataset.read",
  "code.read",
  "code.patch",
  "delivery.package",
  "layout.render",
  "document.render",
  "video.render",
  "video.generate.internal",
  "font.inspect",
  "image.generate.internal",
  "image.edit.internal",
  "sheet.calculate",
  "chart.render",
  "connector.read",
]);

export async function seedAgentTemplates(db: Database, catalog: Catalog) {
  await db.tx(
    async (tx) => {
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('agent-template-catalog-seed',0))",
      );
      for (const role of [catalog.defaultAssistant, ...catalog.roles]) {
        const bindings = (await catalog.boundSkills(role)).map((skill) => ({
          skill_key: skill.key,
          skill_version_id: skillVersionId(
            skill.key,
            skill.version,
            skill.sha256,
          ),
          version: skill.version,
          content_hash: skill.sha256,
          required: role.skill_bindings.find(
            (binding: any) => binding.skill_key === skill.key,
          ).required,
        }));
        const required = role.input_contract.required_fields ?? [],
          optional = role.input_contract.optional_fields ?? [];
        const preset = {
          role_key: role.role_key,
          category: role.category,
          runtime_profile_id: catalog.runtimeProfile.id,
          skill_bindings: bindings,
          model_bindings: role.model_bindings,
          tool_ids: role.tool_ids,
          input_schema: {
            type: "object",
            properties: Object.fromEntries(
              [...required, ...optional].map((field) => [
                field,
                { type: "string" },
              ]),
            ),
            required,
          },
          steps: role.workflow.map((step: any) => step.instruction),
          deliverables: role.deliverables.map((deliverable: any) => ({
            name: deliverable.label,
            format: deliverable.format,
            editable_scope: deliverable.editable_scope,
          })),
          acceptance_checks: role.acceptance_checks,
          ai_gateway_policy: "company_internal_only",
        };
        const body = {
          name: role.display_name,
          role_description: role.workflow
            .map((step: any) => step.instruction)
            .join("; "),
          examples: [
            role.sample_task ??
              "Prepare an evidence-based written answer from authorized materials.",
          ],
          skill_version_ids: bindings.map(
            (binding) => binding.skill_version_id,
          ),
          required_connectors: [],
          kind:
            role.role_key === "assistant" ? "default_helper" : "role_preset",
          ...(role.role_key === "assistant"
            ? {}
            : { preset_definition: preset }),
          qualification_state: "unverified",
          runtime_profile_id: catalog.runtimeProfile.id,
          role_key: role.role_key,
          category: role.category,
          role_hash: catalog.digest(role),
        };
        const definitionHash = hash(canonical(body));
        await tx.query(
          "INSERT INTO agent_templates(role_key) VALUES($1) ON CONFLICT(role_key) DO NOTHING",
          [role.role_key],
        );
        const template = (
          await tx.query(
            "SELECT * FROM agent_templates WHERE role_key=$1 FOR UPDATE",
            [role.role_key],
          )
        ).rows[0];
        let version = (
          await tx.query(
            "SELECT * FROM agent_template_versions WHERE template_id=$1 AND definition_hash=$2",
            [template.id, definitionHash],
          )
        ).rows[0];
        if (!version) {
          const next = (
            await tx.query(
              "SELECT coalesce(max(version),0)+1 AS next FROM agent_template_versions WHERE template_id=$1",
              [template.id],
            )
          ).rows[0].next;
          version = (
            await tx.query(
              "INSERT INTO agent_template_versions(template_id,version,definition_hash,runtime_profile_id,body) VALUES($1,$2,$3,$4,$5) RETURNING *",
              [
                template.id,
                next,
                definitionHash,
                catalog.runtimeProfile.id,
                body,
              ],
            )
          ).rows[0];
        }
        await tx.query(
          "UPDATE agent_templates SET current_version=$2 WHERE id=$1",
          [template.id, version.version],
        );
      }
    },
    undefined,
    true,
  );
}
async function templateVersion(tx: Tx, id: string, version?: number) {
  const row = (
    await tx.query(
      "SELECT v.*,t.role_key FROM agent_templates t JOIN agent_template_versions v ON v.template_id=t.id AND v.version=coalesce($2,t.current_version) WHERE t.id=$1",
      [id, version ?? null],
    )
  ).rows[0];
  if (!row)
    throw new Problem(404, "TEMPLATE_NOT_FOUND", "Template version not found");
  return row;
}
async function presentationContext(tx: Tx, catalog: Catalog, db: Database) {
  const capabilityMap = await catalog.currentCapabilities(tx);
  const configured = await catalog.publicConfigured(tx, db.config, true);
  const runtimes = (
    await tx.query("SELECT id,state,pinned_version FROM codex_runtime_profiles")
  ).rows;
  const capabilities = (
    await tx.query(
      "SELECT id,ready,revoked FROM internal_capability_versions WHERE id=ANY($1::uuid[])",
      [[...(await catalog.currentCapabilities(tx)).values()].map((v) => v.id)],
    )
  ).rows;
  return { configured, runtimes, capabilities, capabilityMap };
}
function present(
  context: Awaited<ReturnType<typeof presentationContext>>,
  catalog: Catalog,
  db: Database,
  row: any,
) {
  const configured = context.configured.find(
    (role: any) => role.role_key === row.role_key,
  );
  const runtime = context.runtimes.find(
    (profile) => profile.id === row.runtime_profile_id,
  );
  const disabled =
    !configured ||
    configured.reason === "ROLE_DISABLED" ||
    runtime?.state !== "enabled";
  const { role_hash, role_key, category, ...body } = row.body;
  const role = catalog.role(row.role_key);
  const unsupportedTool = role.tool_ids.find(
    (tool: string) => !implementedTools.has(tool),
  );
  const missingCapability = role.model_bindings.find(
    (binding: any) =>
      binding.required &&
      !context.capabilities.some(
        (capability) =>
          capability.id ===
            context.capabilityMap.get(binding.profile_key)?.id &&
          capability.ready &&
          !capability.revoked,
      ),
  );
  const reason = disabled
    ? "TEMPLATE_DISABLED"
    : runtime?.pinned_version !== db.config.CODEX_VERSION ||
        row.runtime_profile_id !== catalog.runtimeProfile.id ||
        role_hash !== catalog.digest(role)
      ? "TEMPLATE_VERSION_NOT_SUPPORTED"
      : unsupportedTool
        ? "TOOL_NOT_IMPLEMENTED:" + unsupportedTool
        : missingCapability
          ? "CAPABILITY:" + missingCapability.profile_key
          : (configured?.reason ?? null);
  return {
    ...body,
    id: row.template_id,
    version: row.version,
    state: disabled ? "disabled" : "published",
    template_version_id: row.id,
    runtime_profile_id: row.runtime_profile_id,
    definition_hash: row.definition_hash,
    role_key,
    category,
    data_mode: db.config.DEMO_MODE ? "simulated" : "configured_services",
    available: !!configured?.available && reason === null,
    availability_reason: reason,
  };
}
async function assess(
  tx: Tx,
  db: Database,
  catalog: Catalog,
  actor: Principal,
  tenant: string,
  row: any,
  input: z.infer<typeof useTemplate>,
) {
  await projectAccess(tx, actor, tenant, input.project_id, "write");
  const role = catalog.role(row.role_key),
    missing: string[] = [],
    optional: string[] = [],
    capabilities: string[] = [],
    skills: string[] = [];
  let unavailable = false,
    policyVersion = 1;
  if (
    row.body.role_hash !== catalog.digest(role) ||
    row.runtime_profile_id !== catalog.runtimeProfile.id
  ) {
    missing.push("TEMPLATE_VERSION_NOT_SUPPORTED");
    unavailable = true;
  }
  const runtime = (
    await tx.query("SELECT * FROM codex_runtime_profiles WHERE id=$1", [
      row.runtime_profile_id,
    ])
  ).rows[0];
  if (
    !runtime ||
    runtime.state !== "enabled" ||
    runtime.pinned_version !== db.config.CODEX_VERSION
  ) {
    missing.push("RUNTIME_PROFILE_UNAVAILABLE");
    unavailable = true;
  }
  try {
    await catalog.ensureEnabled(tx, row.role_key);
  } catch {
    missing.push("ROLE_DISABLED");
    unavailable = true;
  }
  try {
    const plan = await authorizeExecutionPlan(tx, tenant, actor.id, role);
    policyVersion = plan.version;
  } catch (error) {
    missing.push(error instanceof Problem ? error.code : "PLAN_UNAVAILABLE");
  }
  const currentCapabilities = await catalog.currentCapabilities(tx);
  for (const binding of role.model_bindings) {
    const configured = currentCapabilities.get(binding.profile_key),
      current =
        configured &&
        (
          await tx.query(
            "SELECT id,ready,revoked FROM internal_capability_versions WHERE id=$1",
            [configured.id],
          )
        ).rows[0];
    if (!current || !current.ready || current.revoked)
      (binding.required ? missing : optional).push(
        "CAPABILITY:" + binding.profile_key,
      );
    else capabilities.push(current.id);
  }
  for (const tool of role.tool_ids)
    if (!implementedTools.has(tool)) {
      missing.push("TOOL_NOT_IMPLEMENTED:" + tool);
      unavailable = true;
    }
  const packages = await catalog.boundSkills(role);
  for (const skill of packages) {
    const id = skillVersionId(skill.key, skill.version, skill.sha256),
      version = (
        await tx.query(
          "SELECT state,content_hash FROM skill_versions WHERE id=$1",
          [id],
        )
      ).rows[0],
      installed = (
        await tx.query(
          "SELECT state,enabled FROM skill_installations WHERE project_id=$1 AND skill_version_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
          [input.project_id, id],
        )
      ).rows[0];
    if (
      !version ||
      version.state !== "verified" ||
      version.content_hash !== skill.sha256
    ) {
      missing.push("SKILL_UNAVAILABLE:" + skill.key);
      unavailable = true;
    } else if (
      installed &&
      (installed.state !== "installed" || !installed.enabled)
    )
      missing.push("SKILL_INSTALLATION_REQUIRED:" + skill.key);
    else skills.push(id);
  }
  if (input.overrides?.brand_version_id)
    missing.push("BRAND_VERSION_BINDING_NOT_IMPLEMENTED");
  try {
    await new CodexRuntimeAdapter(db.config).version();
  } catch (error) {
    missing.push(error instanceof Problem ? error.code : "CODEX_NOT_AVAILABLE");
    unavailable = true;
  }
  return {
    template_id: row.template_id,
    template_version: row.version,
    project_id: input.project_id,
    state: missing.length
      ? unavailable
        ? "unavailable"
        : "needs_configuration"
      : "ready",
    missing_required_dependencies: [...new Set(missing)],
    optional_unavailable_dependencies: [...new Set(optional)],
    resolved_skill_version_ids: skills,
    resolved_capability_version_ids: capabilities,
    policy_version: policyVersion,
    expires_at: new Date(Date.now() + 5 * 60_000).toISOString(),
    data_mode: db.config.DEMO_MODE ? "simulated" : "configured_services",
    qualification_state: "unverified",
  };
}
function canonicalAgent(agent: any) {
  return {
    id: agent.id,
    project_id: agent.project_id,
    name: agent.name,
    agent_version_id: agent.agent_version_id,
    version: agent.bound_version,
    tool_ids: agent.body.tool_ids,
    capability_id: "internal-text-v1",
    template_version_id: agent.template_version_id,
    skill_installation_ids: agent.body.skills.map(
      (skill: any) => skill.installation_id,
    ),
    role_description: agent.body.instructions,
    instructions: agent.body.instructions,
    role_key: agent.role_key,
    preset_definition_hash: agent.body.preset_definition_hash,
    runtime_profile_id: agent.runtime_profile_id,
  };
}
export function registerAgentTemplates(
  app: FastifyInstance,
  db: Database,
  catalog: Catalog,
) {
  app.get(
    "/v1/agent-templates",
    { preHandler: requireUser(db) },
    async (request) => {
      const tenant = tenantOf(request),
        query = z
          .object({
            project_id: uuid.optional(),
            category: z
              .enum(["engineering", "design", "marketing", "operations"])
              .optional(),
            q: z.string().trim().max(160).default(""),
            cursor: uuid.optional(),
            limit: z.coerce.number().int().min(1).max(100).default(50),
          })
          .strict()
          .parse(request.query);
      return db.tx(async (tx) => {
        await tenantAccess(tx, request.principal, tenant);
        if (query.project_id)
          await projectAccess(tx, request.principal, tenant, query.project_id);
        const predicate =
            "($1::text IS NULL OR v.body->>'category'=$1) AND ($2::text='' OR position(lower($2) in lower((v.body->>'name')||' '||(v.body->>'role_description')||' '||t.role_key))>0)",
          args = [query.category ?? null, query.q];
        if (
          query.cursor &&
          !(
            await tx.query(
              `SELECT 1 FROM agent_templates t JOIN agent_template_versions v ON v.template_id=t.id AND v.version=t.current_version WHERE ${predicate} AND t.id=$3`,
              [...args, query.cursor],
            )
          ).rowCount
        )
          throw new Problem(
            410,
            "CURSOR_UNAVAILABLE",
            "Refresh the template list",
          );
        const rows = (
          await tx.query(
            `SELECT v.*,t.role_key FROM agent_templates t JOIN agent_template_versions v ON v.template_id=t.id AND v.version=t.current_version WHERE ${predicate} AND ($3::uuid IS NULL OR t.id>$3) ORDER BY t.id LIMIT $4`,
            [...args, query.cursor ?? null, query.limit + 1],
          )
        ).rows;
        const selected = rows.slice(0, query.limit);
        const context = await presentationContext(tx, catalog, db);
        return {
          items: selected.map((row) => present(context, catalog, db, row)),
          next_cursor:
            rows.length > query.limit ? selected.at(-1)!.template_id : null,
        };
      }, tenant);
    },
  );
  app.get(
    "/v1/agent-templates/:id",
    { preHandler: requireUser(db) },
    async (request) => {
      const tenant = tenantOf(request),
        id = uuid.parse((request.params as any).id),
        query = z
          .object({ version: z.coerce.number().int().positive().optional() })
          .strict()
          .parse(request.query);
      return db.tx(async (tx) => {
        await tenantAccess(tx, request.principal, tenant);
        return present(
          await presentationContext(tx, catalog, db),
          catalog,
          db,
          await templateVersion(tx, id, query.version),
        );
      }, tenant);
    },
  );
  app.post(
    "/v1/agent-templates/:id/preflights",
    { preHandler: requireUser(db) },
    async (request, reply) => {
      const tenant = tenantOf(request),
        id = uuid.parse((request.params as any).id),
        input = useTemplate.parse(request.body);
      const result = await db.tx(async (tx) => {
        await projectAccess(
          tx,
          request.principal,
          tenant,
          input.project_id,
          "write",
        );
        return replay(
          tx,
          request.principal.id,
          "template.preflight:" + id,
          key(request),
          { tenant, ...input },
          async () => {
            const row = await templateVersion(tx, id, input.template_version),
              result = {
                id: randomUUID(),
                ...(await assess(
                  tx,
                  db,
                  catalog,
                  request.principal,
                  tenant,
                  row,
                  input,
                )),
              };
            await tx.query(
              "INSERT INTO agent_template_preflights(id,tenant_id,project_id,actor_id,template_version_id,request_hash,result,expires_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
              [
                result.id,
                tenant,
                input.project_id,
                request.principal.id,
                row.id,
                hash(canonical(input)),
                result,
                result.expires_at,
              ],
            );
            return result;
          },
        );
      }, tenant);
      return reply.code(201).send(result);
    },
  );
  app.post(
    "/v1/agent-templates/:id/instances",
    { preHandler: requireUser(db) },
    async (request, reply) => {
      const tenant = tenantOf(request),
        id = uuid.parse((request.params as any).id),
        input = useTemplate.parse(request.body);
      const result = await db.tx(async (tx) => {
        await projectAccess(
          tx,
          request.principal,
          tenant,
          input.project_id,
          "write",
        );
        return replay(
          tx,
          request.principal.id,
          "template.instantiate:" + id,
          key(request),
          { tenant, ...input },
          async () => {
            const row = await templateVersion(tx, id, input.template_version),
              check = await assess(
                tx,
                db,
                catalog,
                request.principal,
                tenant,
                row,
                input,
              );
            if (check.state !== "ready")
              throw new Problem(
                409,
                "TEMPLATE_PREREQUISITES_REQUIRED",
                "Resolve the template's current prerequisites before creating a specialist",
                check,
              );
            const custom = input.overrides ?? {},
              instructions = [
                custom.role_description ?? row.body.role_description,
                custom.locale ? "Preferred locale: " + custom.locale : "",
                ...(custom.delivery_preferences ?? []),
              ]
                .filter(Boolean)
                .join("\n");
            const agent = await createSpecialist(
              tx,
              catalog,
              request.principal,
              tenant,
              input.project_id,
              agentInput.parse({
                name: custom.name ?? input.name ?? row.body.name,
                role_key: row.role_key,
                instructions,
              }),
              {
                id: row.id,
                version: row.version,
                definition_hash: hash(
                  canonical(row.body.preset_definition ?? row.body),
                ),
              },
            );
            return canonicalAgent(agent);
          },
        );
      }, tenant);
      return reply.code(201).send(result);
    },
  );
}
