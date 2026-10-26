import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import { audit, requireUser } from "./auth.js";
import { key, projectAccess, replay, tenantAccess } from "./access.js";
import { canonical, hash, Problem, uuid } from "./lib.js";
import { effectivePlan } from "./plans.js";

const installationFields =
  "id,project_id,skill_version_id,enabled,version,state";
const skillFields =
  "id,name,skill_key,package_version,initcap(replace(skill_key,'-',' ')) AS name_en,version,source,content_hash,body->'tool_ids' AS tool_ids,body->'required_connectors' AS required_connectors,state";
const page = {
  cursor: uuid.optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
};
const tenantOf = (req: FastifyRequest) =>
  uuid.parse((req.params as any).tenant ?? req.headers["x-tenant-id"]);
export const skillVersionId = (key: string, version: string, sha: string) => {
  const h = hash(canonical({ key, version, sha }));
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
};
export async function seedSkillVersions(db: Database, catalog: Catalog) {
  await db.tx(
    async (tx) => {
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('skill-catalog-seed',0))",
      );
      for (const s of catalog.skills) {
        await catalog.verifySkill(s);
        const definition = catalog.skillDefinitions.find(
          (d: any) => d.skill_key === s.key && d.version === s.version,
        );
        if (!definition)
          throw new Error("Packaged Skill has no reviewed definition");
        await tx.query(
          `INSERT INTO skill_versions(id,skill_key,package_version,version,name,source,content_hash,body)
        VALUES($1,$2,$3,1,$4,'copypaste-packaged',$5,$6) ON CONFLICT(id) DO NOTHING`,
          [
            skillVersionId(s.key, s.version, s.sha256),
            s.key,
            s.version,
            definition.purpose,
            s.sha256,
            {
              tool_ids: definition.tool_ids,
              required_connectors: [],
              input_schema: { type: "object" },
              output_schema: { type: "object" },
              package_state: "integrity_verified",
              qualification: s.qualification,
              ai_network_policy: "internal_only",
            },
          ],
        );
      }
      // Adopt pre-025 specialist versions without changing their historic body.
      await tx.query(`INSERT INTO skill_installations(tenant_id,project_id,skill_version_id,created_by)
      SELECT DISTINCT a.tenant_id,a.project_id,s.id,a.created_by FROM agents a JOIN agent_versions v ON v.agent_id=a.id
      CROSS JOIN LATERAL jsonb_array_elements(v.body->'skills') b JOIN skill_versions s ON s.skill_key=b->>'key' AND s.package_version=b->>'version' AND s.content_hash=b->>'sha256'
      WHERE NOT EXISTS(SELECT 1 FROM skill_installations i WHERE i.project_id=a.project_id AND i.skill_version_id=s.id)
      ON CONFLICT DO NOTHING`);
      await tx.query(`INSERT INTO agent_skill_bindings(tenant_id,project_id,agent_id,agent_version,installation_id,skill_version_id,required)
      SELECT a.tenant_id,a.project_id,a.id,v.version,i.id,s.id,true FROM agents a JOIN agent_versions v ON v.agent_id=a.id
      CROSS JOIN LATERAL jsonb_array_elements(v.body->'skills') b JOIN skill_versions s ON s.skill_key=b->>'key' AND s.package_version=b->>'version' AND s.content_hash=b->>'sha256'
      JOIN LATERAL (SELECT * FROM skill_installations x WHERE x.project_id=a.project_id AND x.skill_version_id=s.id ORDER BY x.created_at DESC,x.id DESC LIMIT 1) i ON true
      WHERE NOT EXISTS(SELECT 1 FROM agent_skill_bindings z WHERE z.agent_id=a.id AND z.agent_version=v.version) ON CONFLICT DO NOTHING`);
    },
    undefined,
    true,
  );
}
async function projectLock(tx: Tx, project: string) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    `skill-project:${project}`,
  ]);
}
/** Only a never-installed preset dependency can be provisioned automatically. */
export async function provisionRoleSkills(
  tx: Tx,
  catalog: Catalog,
  role: any,
  tenant: string,
  project: string,
  user: string,
  forNew = true,
  createMissing = true,
) {
  await projectLock(tx, project);
  const packages = await catalog.boundSkills(role);
  const out: any[] = [];
  for (const s of packages) {
    const versionId = skillVersionId(s.key, s.version, s.sha256);
    if (createMissing)
      await tx.query(
        `INSERT INTO skill_installations(tenant_id,project_id,skill_version_id,created_by)
      SELECT $1,$2,$3,$4 WHERE NOT EXISTS(SELECT 1 FROM skill_installations WHERE project_id=$2 AND skill_version_id=$3)`,
        [tenant, project, versionId, user],
      );
    const row = (
      await tx.query(
        "SELECT * FROM skill_installations WHERE project_id=$1 AND skill_version_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
        [project, versionId],
      )
    ).rows[0];
    if (
      (createMissing && !row) ||
      (row && (row.state !== "installed" || (forNew && !row.enabled)))
    )
      throw new Problem(
        409,
        "SKILL_INSTALLATION_REQUIRED",
        "Enable the required project method before starting new work",
      );
    if (
      !(
        await tx.query(
          "SELECT 1 FROM skill_versions WHERE id=$1 AND state='verified'",
          [versionId],
        )
      ).rowCount
    )
      throw new Problem(
        403,
        "SKILL_REVOKED",
        "This method version is unavailable",
      );
    out.push({
      ...s,
      installation_id: row?.id ?? null,
      ...(!createMissing ? { installation_version: row?.version ?? null } : {}),
      skill_version_id: versionId,
      required: role.skill_bindings.find((b: any) => b.skill_key === s.key)
        .required,
    });
  }
  return out;
}
export async function bindAgentSkills(
  tx: Tx,
  tenant: string,
  project: string,
  agent: string,
  version: number,
  skills: any[],
) {
  for (const s of skills)
    await tx.query(
      `INSERT INTO agent_skill_bindings(tenant_id,project_id,agent_id,agent_version,installation_id,skill_version_id,required)
    VALUES($1,$2,$3,$4,$5,$6,$7)`,
      [
        tenant,
        project,
        agent,
        version,
        s.installation_id,
        s.skill_version_id,
        s.required,
      ],
    );
}
/** Freeze exact installations once; ordinary disable never changes an accepted task. */
export async function freezeTaskSkills(
  tx: Tx,
  catalog: Catalog,
  task: any,
  forNew = true,
) {
  const packages = await provisionRoleSkills(
    tx,
    catalog,
    catalog.forTask(task),
    task.tenant_id,
    task.project_id,
    task.created_by,
    forNew,
  );
  if (task.input_context?.agent_id) {
    const bound = (
      await tx.query(
        "SELECT installation_id,skill_version_id FROM agent_skill_bindings WHERE agent_id=$1 AND agent_version=$2",
        [task.input_context.agent_id, task.input_context.agent_version],
      )
    ).rows;
    if (
      bound.length !== packages.length ||
      packages.some(
        (s) =>
          !bound.some(
            (b) =>
              b.installation_id === s.installation_id &&
              b.skill_version_id === s.skill_version_id,
          ),
      )
    )
      throw new Problem(
        409,
        "AGENT_SKILL_BINDING_CHANGED",
        "Save a new specialist version to adopt the current method installation",
      );
  }
  for (const s of packages)
    await tx.query(
      `INSERT INTO task_skill_bindings(tenant_id,project_id,task_id,installation_id,skill_version_id,content_hash)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
      [
        task.tenant_id,
        task.project_id,
        task.id,
        s.installation_id,
        s.skill_version_id,
        s.sha256,
      ],
    );
}
export async function assertTaskSkills(tx: Tx, catalog: Catalog, task: any) {
  let rows = (
    await tx.query(
      `SELECT b.*,i.state AS installation_state,v.state AS package_state,v.skill_key,v.package_version,v.content_hash AS current_hash
    FROM task_skill_bindings b JOIN skill_installations i ON i.id=b.installation_id JOIN skill_versions v ON v.id=b.skill_version_id WHERE b.task_id=$1`,
      [task.id],
    )
  ).rows;
  // Forward compatibility for work accepted before migration 025. Disabled or
  // removed dependencies cannot be silently restored by this one-time adoption.
  if (!rows.length) {
    await freezeTaskSkills(tx, catalog, task, false);
    return assertTaskSkills(tx, catalog, task);
  }
  const expected = await catalog.boundSkills(catalog.forTask(task));
  if (
    rows.length !== expected.length ||
    rows.some(
      (r) =>
        r.installation_state !== "installed" ||
        r.package_state !== "verified" ||
        r.content_hash !== r.current_hash ||
        !expected.some(
          (s) =>
            s.key === r.skill_key &&
            s.version === r.package_version &&
            s.sha256 === r.content_hash,
        ),
    )
  )
    throw new Problem(
      403,
      "SKILL_REVOKED",
      "A bound method was removed or security-revoked",
    );
  return rows;
}
export function registerSkillLifecycle(
  app: FastifyInstance,
  db: Database,
  catalog: Catalog,
) {
  const base = "/v1/tenants/:tenant/projects/:project";
  const versions = async (req: FastifyRequest) => {
    const tenant = tenantOf(req),
      q = z.object({ ...page, project_id: uuid.optional() }).parse(req.query);
    return db.tx(async (tx) => {
      await tenantAccess(tx, req.principal, tenant);
      const project = (req.params as any).project ?? q.project_id;
      if (project)
        await projectAccess(tx, req.principal, tenant, uuid.parse(project));
      const rows = (
        await tx.query(
          `SELECT ${skillFields} FROM skill_versions WHERE ($1::uuid IS NULL OR id>$1) ORDER BY id LIMIT $2`,
          [q.cursor ?? null, q.limit + 1],
        )
      ).rows;
      return {
        items: rows.slice(0, q.limit),
        next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
      };
    }, tenant);
  };
  app.get("/v1/skill-versions", { preHandler: requireUser(db) }, versions);
  app.get(base + "/skill-versions", { preHandler: requireUser(db) }, versions);
  app.get(
    base + "/skill-versions/:skill_version_id",
    { preHandler: requireUser(db) },
    async (req) => {
      const tenant = tenantOf(req),
        project = uuid.parse((req.params as any).project),
        id = uuid.parse((req.params as any).skill_version_id);
      return db.tx(async (tx) => {
        await projectAccess(tx, req.principal, tenant, project);
        const row = (
          await tx.query("SELECT * FROM skill_versions WHERE id=$1", [id])
        ).rows[0];
        if (!row)
          throw new Problem(404, "NOT_FOUND", "Method version not found");
        const pkg = catalog.skills.find(
          (s) =>
            s.key === row.skill_key &&
            s.version === row.package_version &&
            s.sha256 === row.content_hash,
        );
        if (!pkg)
          throw new Problem(
            409,
            "SKILL_VERSION_UNAVAILABLE",
            "The exact package version is unavailable",
          );
        const instructions = await catalog.verifySkill(pkg);
        return {
          id: row.id,
          name: row.name,
          name_en: row.skill_key
            .split("-")
            .map((s: string) => s.charAt(0).toUpperCase() + s.slice(1))
            .join(" "),
          package_version: row.package_version,
          content_hash: row.content_hash,
          source: row.source,
          instructions,
          ...row.body,
        };
      }, tenant);
    },
  );
  const installations = async (req: FastifyRequest) => {
    const tenant = tenantOf(req),
      q = z.object({ ...page, project_id: uuid.optional() }).parse(req.query);
    const project = uuid.parse((req.params as any).project ?? q.project_id);
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project);
      const rows = (
        await tx.query(
          `SELECT ${installationFields} FROM skill_installations WHERE project_id=$1 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $3`,
          [project, q.cursor ?? null, q.limit + 1],
        )
      ).rows;
      return {
        items: rows.slice(0, q.limit),
        next_cursor: rows.length > q.limit ? rows[q.limit - 1].id : null,
      };
    }, tenant);
  };
  app.get(
    "/v1/skill-installations",
    { preHandler: requireUser(db) },
    installations,
  );
  app.get(
    base + "/skill-installations",
    { preHandler: requireUser(db) },
    installations,
  );
  const install = async (req: FastifyRequest) => {
    const tenant = tenantOf(req),
      b = z
        .object({
          project_id: uuid.optional(),
          skill_version_id: uuid,
          enabled: z.boolean(),
        })
        .strict()
        .parse(req.body);
    const project = uuid.parse((req.params as any).project ?? b.project_id);
    if (b.project_id && b.project_id !== project)
      throw new Problem(404, "NOT_FOUND", "Project not found");
    return db.tx(async (tx) => {
      await projectAccess(tx, req.principal, tenant, project, "manage");
      await projectLock(tx, project);
      return replay(
        tx,
        req.principal.id,
        `skill.install:${project}`,
        key(req),
        b,
        async () => {
          if (
            !(
              await tx.query(
                "SELECT 1 FROM skill_versions WHERE id=$1 AND state='verified'",
                [b.skill_version_id],
              )
            ).rowCount
          )
            throw new Problem(404, "NOT_FOUND", "Method version not found");
          const old = (
            await tx.query(
              "SELECT * FROM skill_installations WHERE project_id=$1 AND skill_version_id=$2 ORDER BY created_at DESC,id DESC LIMIT 1",
              [project, b.skill_version_id],
            )
          ).rows[0];
          if (old?.state === "revoked")
            throw new Problem(
              403,
              "SKILL_REVOKED",
              "A revoked package version cannot be reinstalled",
            );
          if (old?.state === "installed")
            return (
              await tx.query(
                `SELECT ${installationFields} FROM skill_installations WHERE id=$1`,
                [old.id],
              )
            ).rows[0];
          // Reinstalling an uninstalled package needs a new identity, so old task
          // snapshots stay invalid; the prior row remains a permanent tombstone.
          const row = (
            await tx.query(
              `INSERT INTO skill_installations(tenant_id,project_id,skill_version_id,enabled,created_by) VALUES($1,$2,$3,$4,$5) RETURNING ${installationFields}`,
              [
                tenant,
                project,
                b.skill_version_id,
                b.enabled,
                req.principal.id,
              ],
            )
          ).rows[0];
          await audit(
            tx,
            req.principal,
            "skill.install",
            row.id,
            "succeeded",
            { skill_version_id: b.skill_version_id },
            tenant,
          );
          return row;
        },
      );
    }, tenant);
  };
  app.post("/v1/skill-installations", { preHandler: requireUser(db) }, install);
  app.post(
    base + "/skill-installations",
    { preHandler: requireUser(db) },
    install,
  );
  const change = async (req: FastifyRequest) => {
    const tenant = tenantOf(req),
      id = uuid.parse((req.params as any).installation_id);
    const remove = req.method === "DELETE";
    const b = remove
      ? {}
      : z
          .object({
            expected_version: z.number().int().positive(),
            enabled: z.boolean().optional(),
            security_revoke: z.boolean().optional(),
          })
          .strict()
          .refine(
            (x) => x.enabled !== undefined || x.security_revoke === true,
            "Choose a method change",
          )
          .parse(req.body);
    return db.tx(async (tx) => {
      await tenantAccess(tx, req.principal, tenant);
      const row = (
        await tx.query("SELECT * FROM skill_installations WHERE id=$1", [id])
      ).rows[0];
      if (
        !row ||
        ((req.params as any).project &&
          row.project_id !== (req.params as any).project)
      )
        throw new Problem(404, "NOT_FOUND", "Method installation not found");
      await projectAccess(tx, req.principal, tenant, row.project_id, "manage");
      await projectLock(tx, row.project_id);
      return replay(
        tx,
        req.principal.id,
        `skill.${remove ? "uninstall" : "update"}:${id}`,
        key(req),
        b,
        async () => {
          const live = (
            await tx.query(
              "SELECT * FROM skill_installations WHERE id=$1 FOR UPDATE",
              [id],
            )
          ).rows[0];
          if (!remove && live.version !== (b as any).expected_version)
            throw new Problem(
              409,
              "VERSION_CONFLICT",
              "Refresh the method installation before changing it",
            );
          if (live.state !== "installed")
            throw new Problem(
              409,
              "SKILL_REMOVED",
              "This installation is already removed or revoked",
            );
          const state = remove
            ? "uninstalled"
            : (b as any).security_revoke
              ? "revoked"
              : "installed";
          const updated = (
            await tx.query(
              `UPDATE skill_installations SET state=$2,enabled=$3,version=version+1,updated_at=now() WHERE id=$1 RETURNING ${installationFields}`,
              [
                id,
                state,
                state === "installed"
                  ? ((b as any).enabled ?? live.enabled)
                  : false,
              ],
            )
          ).rows[0];
          await audit(
            tx,
            req.principal,
            `skill.${state === "installed" ? "update" : state}`,
            id,
            "succeeded",
            { from_version: live.version, enabled: updated.enabled },
            tenant,
          );
          return remove ? { ok: true } : updated;
        },
      );
    }, tenant);
  };
  for (const path of [
    "/v1/skill-installations/:installation_id",
    base + "/skill-installations/:installation_id",
  ]) {
    app.patch(path, { preHandler: requireUser(db) }, change);
    app.delete(path, { preHandler: requireUser(db) }, change);
  }
  const effective = async (req: FastifyRequest) => {
    const tenant = tenantOf(req),
      id = uuid.parse((req.params as any).agent_id);
    return db.tx(async (tx) => {
      await tenantAccess(tx, req.principal, tenant);
      const agent = (
        await tx.query(
          "SELECT a.*,v.body FROM agents a JOIN agent_versions v ON v.agent_id=a.id AND v.version=a.version WHERE a.id=$1",
          [id],
        )
      ).rows[0];
      if (
        !agent ||
        ((req.params as any).project &&
          agent.project_id !== (req.params as any).project)
      )
        throw new Problem(404, "NOT_FOUND", "Specialist not found");
      await projectAccess(tx, req.principal, tenant, agent.project_id);
      const role = catalog.role(agent.role_key, agent.body.role_hash),
        missing: string[] = [],
        ids: string[] = [];
      const rows = (
        await tx.query(
          `SELECT b.skill_version_id,i.enabled,i.state,v.skill_key,v.state AS package_state,i.version FROM agent_skill_bindings b JOIN skill_installations i ON i.id=b.installation_id JOIN skill_versions v ON v.id=b.skill_version_id WHERE b.agent_id=$1 AND b.agent_version=$2`,
          [id, agent.version],
        )
      ).rows;
      for (const binding of role.skill_bindings) {
        const s = rows.find((r) => r.skill_key === binding.skill_key);
        if (
          !s ||
          !s.enabled ||
          s.state !== "installed" ||
          s.package_state !== "verified"
        )
          missing.push(`skill:${binding.skill_key}`);
        else ids.push(s.skill_version_id);
      }
      try {
        await catalog.ensureEnabled(tx, agent.role_key, agent.body.role_hash);
      } catch {
        missing.push("platform_method_disabled");
      }
      const ready = await catalog.availableFor(tx, db.config, role);
      if (!ready.available) missing.push(ready.reason!);
      const plan = await effectivePlan(tx, tenant, req.principal.id);
      if (
        !plan.body.capabilities.includes("text") ||
        (plan.body.role_keys && !plan.body.role_keys.includes(role.role_key))
      )
        missing.push("plan:text");
      if (!agent.enabled) missing.push("specialist_disabled");
      const implemented = new Set([
        "asset.read",
        "asset.write",
        "code.read",
        "code.patch",
        "delivery.package",
        "layout.render",
        "video.render",
        "video.generate.internal",
        "font.inspect",
        "image.generate.internal",
        "image.edit.internal",
        "dataset.read",
      ]);
      return {
        agent_id: id,
        project_id: agent.project_id,
        skill_version_ids: ids,
        tool_ids: missing.length
          ? []
          : agent.body.tool_ids.filter((tool: string) => implemented.has(tool)),
        missing_dependencies: missing,
        policy_version: Math.max(
          1,
          plan.version,
          ...rows.map((r) => r.version),
        ),
      };
    }, tenant);
  };
  app.get(
    "/v1/agents/:agent_id/effective-capabilities",
    { preHandler: requireUser(db) },
    effective,
  );
  app.get(
    base + "/agents/:agent_id/effective-capabilities",
    { preHandler: requireUser(db) },
    effective,
  );
}
