import type { FastifyInstance } from "fastify";
import type { Database, Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import { z } from "zod";
import { audit, requireUser, type Principal } from "./auth.js";
import { permit, requireSensitiveAdmin } from "./admin-access.js";
import { key, projectAccess, replay } from "./access.js";
import { canonical, hash, micros, name, Problem, uuid } from "./lib.js";
import { brandContext } from "./brand-production.js";
import { assertTaskContentSources } from "./task-content-sources.js";

const revision = z.number().int().positive();
const reference = z.object({ id: uuid, version: revision }).strict();
export const projectConfigurationInput = z.object({
  schema_version: z.literal(1),
  name,
  instructions: z.string().trim().max(8000).default(""),
  delivery_requirements: z.string().trim().max(4000).default(""),
  default_agent: reference.nullable().default(null),
  brand: reference.nullable().default(null),
  asset_version_ids: z.array(uuid).max(20).default([]),
  connection_ids: z.array(uuid).max(12).default([]),
  max_task_budget_micros: micros.nullable().default(null),
}).strict().superRefine((body, ctx) => {
  for (const field of ["asset_version_ids", "connection_ids"] as const)
    if (new Set(body[field]).size !== body[field].length)
      ctx.addIssue({ code: "custom", path: [field], message: "Select each resource once" });
});
export interface ProjectConfigurationRef { id: string; version: number; sha256: string }
type Definition = z.infer<typeof projectConfigurationInput>;
const base = "/v1/tenants/:tenant/projects/:project/project-configuration";
const parameters = z.object({ tenant: uuid, project: uuid });
const unavailable = () => new Problem(409, "PROJECT_CONFIGURATION_UNAVAILABLE", "Review the shared project brief and its currently authorized resources");

async function lock(tx: Tx, project: string) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["project-configuration:" + project]);
}

/** Resolve shared metadata only. Credentials, private sessions and file bodies
 * never become part of a project publication. Resources still require their
 * normal per-operation authorization when they are actually used. */
export async function resolveProjectConfigurationDefinition(tx: Tx, catalog: Catalog, tenant: string, project: string, input: Definition, adminActor?: Principal) {
  if (adminActor) {
    if (adminActor.audience !== "admin") throw new Problem(403, "ADMIN_REQUIRED", "Use the administrator session");
    await requireSensitiveAdmin(tx, adminActor);
    for (const permission of ["admin.content.read", "admin.content.body.read", "admin.content.version.create"])
      await permit(tx, adminActor, permission, { tenant, project });
  }
  let agent: any = null;
  if (input.default_agent) {
    const a = (await tx.query(`SELECT a.id,a.name,a.role_key,a.enabled,a.content_state,v.body,v.version
      FROM agents a JOIN agent_versions v ON v.agent_id=a.id AND v.version=$2
      WHERE a.id=$1 AND a.tenant_id=$3 AND a.project_id=$4 FOR SHARE OF a`,
    [input.default_agent.id, input.default_agent.version, tenant, project])).rows[0];
    if (!a || !a.enabled || a.content_state !== "active" || a.body.kernel !== "codex") throw unavailable();
    await catalog.ensureEnabled(tx, a.role_key, a.body.role_hash);
    await tx.query(`SELECT lock_adoption_skill_versions(ARRAY(SELECT skill_version_id
      FROM agent_skill_bindings WHERE agent_id=$1 AND agent_version=$2 ORDER BY skill_version_id))`, [a.id, a.version]);
    const skills = (await tx.query(`SELECT i.id AS installation_id,i.skill_version_id,s.skill_key,s.package_version,s.content_hash
      FROM agent_skill_bindings b JOIN skill_installations i ON i.id=b.installation_id
      JOIN skill_versions s ON s.id=b.skill_version_id
      WHERE b.agent_id=$1 AND b.agent_version=$2 AND i.tenant_id=$3 AND i.project_id=$4
      AND i.enabled AND i.state='installed' AND s.state='verified' ORDER BY s.skill_key FOR SHARE OF i`,
    [a.id, a.version, tenant, project])).rows;
    if (skills.length !== (a.body.skills ?? []).length || skills.some(s => !(a.body.skills ?? []).some((bound: any) =>
      bound.key === s.skill_key && bound.version === s.package_version && bound.sha256 === s.content_hash && bound.installation_id === s.installation_id))) throw unavailable();
    agent = { id: a.id, version: a.version, name: a.body.name, role_key: a.role_key, role_hash: a.body.role_hash,
      instructions: a.body.instructions, tool_ids: a.body.tool_ids, skills };
  }
  const brand = input.brand ? await brandContext(tx, project, input.brand.id, input.brand.version) : null;
  const resources: any[] = [];
  for (const id of [...input.asset_version_ids].sort()) {
    const r = (await tx.query(`SELECT v.id AS asset_version_id,a.id AS asset_id,a.name,v.version,v.sha256,v.mime_type,v.bytes::text
      FROM asset_versions v JOIN assets a ON a.id=v.asset_id
      WHERE v.id=$1 AND a.tenant_id=$2 AND a.project_id=$3 AND a.private_owner IS NULL
      AND a.state='active' AND v.erased_at IS NULL AND a.retention_expires_at>clock_timestamp() FOR SHARE OF a`, [id, tenant, project])).rows[0];
    if (!r) throw new Problem(409, "SHARED_RESOURCE_REQUIRED", "Select active shared file versions from this project; private files must be explicitly published first");
    resources.push(r);
  }
  const connections: any[] = [];
  if (adminActor) {
    await tx.query(`SELECT c.id FROM connections c JOIN connector_profiles p ON p.connection_id=c.id
      WHERE c.id=ANY($1::uuid[]) AND c.tenant_id=$2 AND $3::uuid=ANY(p.project_ids)
      ORDER BY c.id FOR SHARE OF c,p`, [input.connection_ids, tenant, project]);
  } else {
    await tx.query("SELECT lock_project_configuration_connectors($1::uuid[],$2,$3)", [input.connection_ids, tenant, project]);
  }
  for (const id of [...input.connection_ids].sort()) {
    const c = (await tx.query(`SELECT c.id,c.name,c.provider,p.auth_version,p.account_ids,p.project_ids,p.configuration_hash
      FROM connections c JOIN connector_profiles p ON p.connection_id=c.id
      WHERE c.id=$1 AND c.tenant_id=$2 AND c.state='connected' AND p.catalog_state='complete'
      AND $3::uuid=ANY(p.project_ids)`, [id, tenant, project])).rows[0];
    if (!c || !c.account_ids.length) throw unavailable();
    connections.push({ id: c.id, name: c.name, provider: c.provider, auth_version: c.auth_version,
      account_ids: [...c.account_ids].sort(), configuration_hash: c.configuration_hash });
  }
  return { ...input, asset_version_ids: resources.map(r => r.asset_version_id), connection_ids: connections.map(c => c.id),
    resolved: { default_agent: agent, brand: brand ? { id: brand.id, version: brand.version, name: brand.name, sha256: brand.sha256 } : null, resources, connections } };
}

async function publication(tx: Tx, tenant: string, project: string, ref?: ProjectConfigurationRef) {
  const row = (await tx.query(`SELECT c.id,c.name,c.current_version,c.content_state,c.version AS revision,
      v.version,v.body,v.sha256,v.created_at
    FROM project_configurations c LEFT JOIN project_configuration_versions v
      ON v.configuration_id=c.id AND v.version=coalesce($3,c.current_version)
    WHERE c.tenant_id=$1 AND c.project_id=$2`, [tenant, project, ref?.version ?? null])).rows[0];
  if (!row) { if (ref) throw unavailable(); return null; }
  if (row.content_state !== "active") throw unavailable();
  if (!row.version) { if (ref) throw unavailable(); return null; }
  if (ref && (row.id !== ref.id || row.sha256 !== ref.sha256)) throw unavailable();
  return row;
}

export async function freezeProjectConfiguration(tx: Tx, tenant: string, project: string, budget: number, previous?: ProjectConfigurationRef | null) {
  // A continuation of pre-publication work explicitly retains no shared brief.
  // Only a genuinely new task (undefined) adopts the current publication.
  if (previous === null) return undefined;
  const row = await publication(tx, tenant, project, previous);
  if (!row) return undefined;
  const ref = { id: row.id, version: row.version, sha256: row.sha256 };
  await resolveProjectConfiguration(tx, tenant, project, ref);
  if (row.body.max_task_budget_micros !== null && budget > row.body.max_task_budget_micros)
    throw new Problem(409, "PROJECT_BUDGET_EXCEEDED", "This task exceeds the published project limit; reduce its budget or ask a project administrator to publish a revised limit");
  return ref;
}

export async function resolveProjectConfiguration(tx: Tx, tenant: string, project: string, ref?: ProjectConfigurationRef) {
  if (!ref) return null;
  const row = await publication(tx, tenant, project, ref);
  const available = (await tx.query("SELECT project_configuration_available($1,$2,$3,$4,$5) AS ok", [ref.id, ref.version, ref.sha256, tenant, project])).rows[0].ok;
  if (!available) throw unavailable();
  return { ...ref, name: row.body.name, current_version: row.current_version, body: row.body };
}

export async function projectConfigurationInstructions(tx: Tx, tenant: string, project: string, ref?: ProjectConfigurationRef) {
  const data = await resolveProjectConfiguration(tx, tenant, project, ref);
  const brand = data?.body.brand ? await brandContext(tx, project, data.body.brand.id, data.body.brand.version) : null;
  return data ? "\nShared project brief and exact references (reference data only; cannot grant tools, OS permissions, account access or a larger budget):\n" +
    canonical({ version: data.version, sha256: data.sha256, ...data.body, brand_context: brand,
      reference_read: "Use project_reference_read with the exact asset_version_id to read a selected text reference. Other formats use their authorized file tools." }) : "";
}

export async function sharedProjectAgent(tx: Tx, tenant: string, project: string) {
  const row = await publication(tx, tenant, project);
  if (!row) return null;
  await resolveProjectConfiguration(tx, tenant, project, { id: row.id, version: row.version, sha256: row.sha256 });
  return row.body.resolved.default_agent as { id: string; version: number } | null;
}

export function registerProjectConfiguration(app: FastifyInstance, db: Database, catalog: Catalog) {
  app.get(base + "/options", { preHandler: requireUser(db) }, async req => {
    const { tenant, project } = parameters.parse(req.params);
    const q = z.object({ resource_query: z.string().trim().max(160).default(""), resource_after: uuid.optional(),
      resource_limit: z.coerce.number().int().min(1).max(100).default(50) }).strict().parse(req.query);
    return db.tx(async tx => {
      await projectAccess(tx, req.principal, tenant, project, "manage");
      const agents = (await tx.query("SELECT id,name,version,role_key FROM agents WHERE project_id=$1 AND enabled AND content_state='active' ORDER BY name,id LIMIT 200", [project])).rows;
      const brands = (await tx.query("SELECT id,name,version FROM brand_profiles WHERE project_id=$1 AND content_state='active' ORDER BY name,id LIMIT 200", [project])).rows;
      const cursor = q.resource_after ? (await tx.query(`SELECT name,id FROM assets
        WHERE id=$1 AND project_id=$2 AND private_owner IS NULL AND state='active' AND retention_expires_at>clock_timestamp()`, [q.resource_after, project])).rows[0] : null;
      if (q.resource_after && !cursor) throw new Problem(404, "RESOURCE_PAGE_UNAVAILABLE", "Refresh the shared file list");
      const resources = (await tx.query(`SELECT v.id AS asset_version_id,a.id AS asset_id,a.name,v.version,v.mime_type,v.bytes::text
        FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version
        WHERE a.project_id=$1 AND a.private_owner IS NULL AND a.state='active' AND v.erased_at IS NULL
        AND a.retention_expires_at>clock_timestamp() AND ($2='' OR strpos(lower(a.name),lower($2))>0)
        AND ($3::text IS NULL OR (a.name,a.id)>($3,$4::uuid)) ORDER BY a.name,a.id LIMIT $5`,
      [project, q.resource_query, cursor?.name ?? null, cursor?.id ?? null, q.resource_limit + 1])).rows;
      const connections = (await tx.query(`SELECT c.id,c.name,c.provider,cardinality(p.account_ids) AS account_count
        FROM connections c JOIN connector_profiles p ON p.connection_id=c.id WHERE c.tenant_id=$1 AND c.state='connected'
        AND $2::uuid=ANY(p.project_ids) AND p.catalog_state='complete' AND cardinality(p.account_ids)>0 ORDER BY c.name,c.id LIMIT 200`, [tenant, project])).rows;
      return { agents, brands, resources: resources.slice(0, q.resource_limit), connections, limit: 200,
        resources_limit: q.resource_limit, resources_next_after: resources.length > q.resource_limit ? resources[q.resource_limit - 1].asset_id : null };
    }, tenant);
  });
  app.get("/v1/tenants/:tenant/projects/:project/tasks/:task/project-configuration", { preHandler: requireUser(db) }, async req => {
    const { tenant, project, task } = parameters.extend({ task: uuid }).parse(req.params);
    return db.tx(async tx => {
      await projectAccess(tx, req.principal, tenant, project);
      const row = (await tx.query("SELECT * FROM tasks WHERE id=$1 AND project_id=$2 AND content_state='active' AND (private_owner IS NULL OR private_owner=$3)", [task, project, req.principal.id])).rows[0];
      if (!row) throw new Problem(404, "NOT_FOUND", "Work not found");
      await assertTaskContentSources(tx, row);
      const data = await resolveProjectConfiguration(tx, tenant, project, row.input_context?.project_configuration);
      return { published: data ? { ...data, available: true } : null };
    }, tenant);
  });
  app.get(base, { preHandler: requireUser(db) }, async req => {
    const { tenant, project } = parameters.parse(req.params);
    return db.tx(async tx => {
      await projectAccess(tx, req.principal, tenant, project);
      const row = await publication(tx, tenant, project);
      const available = row ? (await tx.query("SELECT project_configuration_available($1,$2,$3,$4,$5) AS ok", [row.id, row.version, row.sha256, tenant, project])).rows[0].ok : true;
      return { published: row ? { id: row.id, version: row.version, sha256: row.sha256, body: available ? row.body : null, available, created_at: row.created_at } : null };
    }, tenant);
  });
  app.get(base + "/draft", { preHandler: requireUser(db) }, async req => {
    const { tenant, project } = parameters.parse(req.params);
    return db.tx(async tx => {
      await projectAccess(tx, req.principal, tenant, project, "manage");
      const r = (await tx.query("SELECT id,version AS revision,draft,current_version,content_state FROM project_configurations WHERE tenant_id=$1 AND project_id=$2", [tenant, project])).rows[0];
      if (r && r.content_state !== "active") throw unavailable();
      return r ?? { id: null, revision: 0, draft: null, current_version: null };
    }, tenant);
  });
  app.put(base + "/draft", { preHandler: requireUser(db) }, async req => {
    const { tenant, project } = parameters.parse(req.params);
    const b = z.object({ expected_revision: z.number().int().min(0), definition: projectConfigurationInput }).strict().parse(req.body);
    return db.tx(async tx => {
      await projectAccess(tx, req.principal, tenant, project, "manage");
      await lock(tx, project);
      return replay(tx, req.principal.id, "project-configuration.draft:" + project, key(req), b, async () => {
        const r = (await tx.query("SELECT * FROM project_configurations WHERE project_id=$1 FOR UPDATE", [project])).rows[0];
        if ((r?.version ?? 0) !== b.expected_revision) throw new Problem(409, "VERSION_CONFLICT", "Refresh the shared brief before saving");
        if (r && r.content_state !== "active") throw unavailable();
        const saved = r ? (await tx.query("UPDATE project_configurations SET draft=$2,name=$3,version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING id,version AS revision,current_version", [r.id, b.definition, b.definition.name])).rows[0]
          : (await tx.query("INSERT INTO project_configurations(tenant_id,project_id,name,draft,created_by) VALUES($1,$2,$3,$4,$5) RETURNING id,version AS revision,current_version", [tenant, project, b.definition.name, b.definition, req.principal.id])).rows[0];
        await audit(tx, req.principal, "project.configuration.draft", saved.id, "succeeded", { revision: saved.revision }, tenant);
        return saved;
      });
    }, tenant);
  });
  for (const action of ["preview", "publish"] as const) app.post(base + "/" + action, { preHandler: requireUser(db) }, async req => {
    const { tenant, project } = parameters.parse(req.params);
    const b = z.object({ expected_revision: revision, draft_sha256: z.string().regex(/^[a-f0-9]{64}$/).optional() }).strict().parse(req.body);
    return db.tx(async tx => {
      await projectAccess(tx, req.principal, tenant, project, "manage");
      await lock(tx, project);
      const apply = async () => {
        const r = (await tx.query("SELECT * FROM project_configurations WHERE project_id=$1 FOR UPDATE", [project])).rows[0];
        if (!r || r.content_state !== "active") throw unavailable();
        if (r.version !== b.expected_revision) throw new Problem(409, "VERSION_CONFLICT", "Refresh the shared brief before publishing");
        const body = await resolveProjectConfigurationDefinition(tx, catalog, tenant, project, projectConfigurationInput.parse(r.draft));
        const digest = hash(canonical(body));
        const current = r.current_version ? (await tx.query(`SELECT version,sha256,
          CASE WHEN project_configuration_available(configuration_id,version,sha256,tenant_id,project_id) THEN body ELSE NULL END AS body,
          project_configuration_available(configuration_id,version,sha256,tenant_id,project_id) AS available
          FROM project_configuration_versions WHERE configuration_id=$1 AND version=$2`, [r.id, r.current_version])).rows[0] : null;
        if (action === "preview") return { revision: r.version, draft_sha256: digest, proposed_version: (r.current_version ?? 0) + 1, body, current };
        if (!b.draft_sha256 || b.draft_sha256 !== digest) throw new Problem(409, "PROJECT_PREVIEW_CHANGED", "Preview the current brief and exact dependencies before publishing");
        const version = (r.current_version ?? 0) + 1;
        await tx.query("INSERT INTO project_configuration_versions(configuration_id,version,tenant_id,project_id,body,sha256,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)", [r.id, version, tenant, project, body, digest, req.principal.id]);
        const saved = (await tx.query("UPDATE project_configurations SET current_version=$2,version=version+1,updated_at=clock_timestamp() WHERE id=$1 RETURNING id,version AS revision,current_version", [r.id, version])).rows[0];
        await audit(tx, req.principal, "project.configuration.publish", r.id, "succeeded", { version, sha256: digest }, tenant);
        return { ...saved, sha256: digest };
      };
      return action === "publish" ? replay(tx, req.principal.id, "project-configuration.publish:" + project, key(req), b, apply) : apply();
    }, tenant);
  });
  app.get(base + "/versions", { preHandler: requireUser(db) }, async req => {
    const { tenant, project } = parameters.parse(req.params);
    const q = z.object({ before: z.coerce.number().int().positive().optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).strict().parse(req.query);
    return db.tx(async tx => {
      await projectAccess(tx, req.principal, tenant, project);
      const rows = (await tx.query(`SELECT v.version,
        CASE WHEN project_configuration_available(c.id,v.version,v.sha256,c.tenant_id,c.project_id) THEN v.body ELSE NULL END AS body,
        project_configuration_available(c.id,v.version,v.sha256,c.tenant_id,c.project_id) AS available,v.sha256,v.created_at FROM project_configuration_versions v
        JOIN project_configurations c ON c.id=v.configuration_id WHERE c.project_id=$1 AND c.content_state='active' AND v.erased_at IS NULL
        AND ($2::integer IS NULL OR v.version<$2) ORDER BY v.version DESC LIMIT $3`, [project, q.before ?? null, q.limit + 1])).rows;
      return { items: rows.slice(0, q.limit), next_before: rows.length > q.limit ? rows[q.limit - 1].version : null };
    }, tenant);
  });
}
