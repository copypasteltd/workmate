import type { FastifyInstance } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Database, Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import { audit, requireAdmin, type Principal } from "./auth.js";
import {
  can,
  lockAdminAccess,
  permit,
  requireSensitiveAdmin,
} from "./admin-access.js";
import { key, replay } from "./access.js";
import { canonical, equal, hash, hmac, Problem, uuid } from "./lib.js";
import { groupCreateInput, groupDefinitionHash } from "./agent-group-model.js";
import {
  prepareAdminGroupRevision,
  commitAdminGroupRevision,
} from "./agent-groups.js";
import {
  projectConfigurationInput,
  resolveProjectConfigurationDefinition,
} from "./project-configuration.js";
import { solutionCreate, solutionDigest } from "./solution-model.js";
import { freezeSolutionDefinition } from "./solution-service.js";

const kinds = z.enum(["agent_groups", "project_configurations", "solutions"]);
type Kind = z.infer<typeof kinds>;
const params = z.object({ kind: kinds, id: uuid });
const digest = z.string().regex(/^[a-f0-9]{64}$/);
const input = z
  .object({
    expected_version: z.number().int().positive(),
    expected_moderation_version: z.number().int().nonnegative(),
    definition: z.record(z.string(), z.unknown()),
    reason: z.string().trim().min(3).max(2000),
  })
  .strict();
const ticketBody = z
  .object({
    protocol: z.literal(1),
    actor_id: uuid,
    session_id: uuid,
    auth_version: z.number().int().nonnegative(),
    kind: kinds,
    source_id: uuid,
    source_version: z.number().int().positive(),
    source_moderation_version: z.number().int().nonnegative(),
    before_sha256: digest,
    after_sha256: digest,
    input_sha256: digest,
    target_version: z.number().int().positive(),
    expires_at: z.string().datetime({ offset: true }),
  })
  .strict();
const ticketSchema = ticketBody.extend({ signature: digest });
type Ticket = z.infer<typeof ticketSchema>;
const base = "/v1/admin/content-revisions/:kind/:id";
const permissions = [
  "admin.content.read",
  "admin.content.body.read",
  "admin.content.version.create",
];
const missing = () =>
  new Problem(
    404,
    "NOT_FOUND",
    "Editable content not found in your current scope",
  );
const changed = () =>
  new Problem(
    409,
    "CONTENT_REVISION_CHANGED",
    "The content or its dependencies changed. Refresh and review a new preview",
  );
const action = (kind: Kind, id: string) =>
  `admin.content.revision:${kind}:${id}`;
const fingerprint = (value: unknown) => hash(canonical(value));
const tables: Record<Kind, string> = {
  agent_groups: "agent_groups",
  project_configurations: "project_configurations",
  solutions: "solution_versions",
};

function definition(kind: Kind, value: unknown): any {
  return kind === "agent_groups"
    ? groupCreateInput.parse(value)
    : kind === "project_configurations"
      ? projectConfigurationInput.parse(value)
      : solutionCreate.parse(value);
}
function normalize(kind: Kind, value: unknown) {
  const parsed = input.parse(value);
  return { ...parsed, definition: definition(kind, parsed.definition) };
}
async function access(tx: Tx, actor: Principal, row: any) {
  await requireSensitiveAdmin(tx, actor);
  for (const permission of permissions)
    await permit(tx, actor, permission, {
      tenant: row.tenant_id,
      project: row.project_id,
    });
}
async function load(
  tx: Tx,
  actor: Principal,
  kind: Kind,
  id: string,
  locked = false,
  allowInactive = false,
) {
  // Table names come exclusively from the closed enum above, never request text.
  let row = (await tx.query(`SELECT * FROM ${tables[kind]} WHERE id=$1`, [id]))
    .rows[0];
  if (!row) throw missing();
  await access(tx, actor, row);
  if (!allowInactive) {
    const project = (
      await tx.query(
        `SELECT p.id FROM projects p JOIN tenants t ON t.id=p.tenant_id
      WHERE p.id=$1 AND p.tenant_id=$2 AND NOT p.archived AND t.status='active' FOR SHARE OF p,t`,
        [row.project_id, row.tenant_id],
      )
    ).rows[0];
    if (!project) throw missing();
  }
  // Match customer writers' lock order, including draft save/publication.
  if (kind === "project_configurations")
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "project-configuration:" + row.project_id,
    ]);
  row = (
    await tx.query(
      `SELECT * FROM ${tables[kind]} WHERE id=$1 ${locked ? "FOR UPDATE" : "FOR SHARE"}`,
      [id],
    )
  ).rows[0];
  if (!row) throw missing();
  if (kind === "solutions")
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "solution-family:" + row.tenant_id + ":" + row.family_id,
    ]);
  if (
    !allowInactive &&
    (kind === "solutions"
      ? row.state === "disabled"
      : row.content_state !== "active" ||
        (kind === "agent_groups" && row.state !== "active"))
  )
    throw new Problem(
      409,
      "CONTENT_REVISION_UNAVAILABLE",
      "Restore or enable this content before revising it",
    );
  return row;
}
async function snapshot(tx: Tx, kind: Kind, row: any) {
  let current: any, value: any, before: any;
  if (kind === "agent_groups") {
    current = (
      await tx.query(
        "SELECT * FROM agent_group_versions WHERE group_id=$1 AND version=$2 AND erased_at IS NULL",
        [row.id, row.version],
      )
    ).rows[0];
    if (!current) throw missing();
    const b = current.body;
    value = definition(kind, {
      project_id: row.project_id,
      workspace_id: row.workspace_id,
      name: b.name,
      coordinator_agent_id: b.coordinator_agent_id,
      members: b.members,
    });
    before = current.body;
  } else if (kind === "project_configurations") {
    current = row.current_version
      ? (
          await tx.query(
            "SELECT body,sha256 FROM project_configuration_versions WHERE configuration_id=$1 AND version=$2 AND erased_at IS NULL",
            [row.id, row.current_version],
          )
        ).rows[0]
      : null;
    value = definition(kind, row.draft);
    before = {
      draft: row.draft,
      published_version: row.current_version,
      published: current?.body ?? null,
    };
  } else {
    value = definition(kind, row.definition);
    before = {
      definition: row.definition,
      frozen: row.frozen,
      state: row.state,
    };
  }
  const next =
    kind === "solutions"
      ? Number(
          (
            await tx.query(
              "SELECT max(version)+1 AS n FROM solution_versions WHERE tenant_id=$1 AND family_id=$2",
              [row.tenant_id, row.family_id],
            )
          ).rows[0].n,
        )
      : kind === "project_configurations"
        ? row.current_version + 1
        : row.version + 1;
  return {
    definition: value,
    before_sha256: fingerprint(before),
    current,
    target_version: next,
  };
}
async function prepare(
  tx: Tx,
  catalog: Catalog,
  actor: Principal,
  kind: Kind,
  row: any,
  b: ReturnType<typeof normalize>,
) {
  if (
    row.version !== b.expected_version ||
    (row.moderation_version ?? 0) !== b.expected_moderation_version
  )
    throw changed();
  const before = await snapshot(tx, kind, row);
  let body: any, sha256: string;
  if (kind === "agent_groups") {
    const ids = [
      b.definition.coordinator_agent_id,
      ...b.definition.members.map((m: any) => m.agent_id),
    ].sort();
    await tx.query(
      "SELECT id FROM agents WHERE id=ANY($1::uuid[]) AND tenant_id=$2 AND project_id=$3 ORDER BY id FOR SHARE",
      [ids, row.tenant_id, row.project_id],
    );
    body = await prepareAdminGroupRevision(tx, catalog, row, b.definition);
    for (const binding of body.bindings)
      await resolveProjectConfigurationDefinition(
        tx,
        catalog,
        row.tenant_id,
        row.project_id,
        projectConfigurationInput.parse({
          schema_version: 1,
          name: body.name,
          default_agent: {
            id: binding.agent_id,
            version: binding.agent_version,
          },
        }),
        actor,
      );
    sha256 = groupDefinitionHash(body);
  } else if (kind === "project_configurations") {
    const old = new Set<string>(before.definition.connection_ids);
    if (b.definition.connection_ids.some((id: string) => !old.has(id)))
      await permit(tx, actor, "admin.connections.read", {
        tenant: row.tenant_id,
        project: row.project_id,
      });
    body = await resolveProjectConfigurationDefinition(
      tx,
      catalog,
      row.tenant_id,
      row.project_id,
      b.definition,
      actor,
    );
    sha256 = fingerprint(body);
  } else {
    if (b.definition.project_id !== row.project_id) throw changed();
    body = {
      definition: b.definition,
      frozen: await freezeSolutionDefinition(tx, b.definition, true),
    };
    const profiles = [
      ...new Set<string>(body.frozen.map((v: any) => v.runtime_profile_id)),
    ];
    const enabledProfiles = await tx.query(
      "SELECT id FROM codex_runtime_profiles WHERE id=ANY($1::uuid[]) AND state='enabled' ORDER BY id FOR SHARE",
      [profiles],
    );
    const skills = [
      ...new Set<string>(body.frozen.flatMap((v: any) => v.skill_version_ids)),
    ];
    const verifiedSkills = await tx.query(
      "SELECT id FROM skill_versions WHERE id=ANY($1::uuid[]) AND state='verified' ORDER BY id FOR SHARE",
      [skills],
    );
    if (
      enabledProfiles.rowCount !== profiles.length ||
      verifiedSkills.rowCount !== skills.length
    )
      throw new Problem(
        409,
        "REVISION_DEPENDENCY_UNAVAILABLE",
        "Select currently enabled Codex templates and verified skills",
      );
    for (const binding of body.frozen)
      await catalog.ensureEnabled(tx, binding.role_key, binding.role_hash);
    sha256 = solutionDigest(body);
  }
  const previous =
    kind === "agent_groups"
      ? groupDefinitionHash(before.current.body)
      : kind === "project_configurations"
        ? before.current?.sha256
        : row.definition_hash;
  if (
    sha256 === previous &&
    fingerprint(before.definition) === fingerprint(b.definition)
  )
    throw new Problem(
      422,
      "CONTENT_REVISION_UNCHANGED",
      "Change the content before preparing a revision",
    );
  return { ...before, body, sha256 };
}
function dependencySummary(kind: Kind, body: any): string[] {
  if (kind === "agent_groups")
    return (body?.bindings ?? []).map(
      (b: any) => `${b.name} · v${b.agent_version} · ${b.role_key}`,
    );
  if (kind === "solutions")
    return (body ?? []).map(
      (b: any) => `${b.name} · v${b.template_version} · ${b.role_key}`,
    );
  const r = body?.resolved;
  if (!r) return [];
  return [r.default_agent, r.brand, ...(r.resources ?? [])]
    .filter(Boolean)
    .map((v: any) => `${v.name} · v${v.version}`)
    .concat(
      (r.connections ?? []).map(
        (v: any) =>
          `${v.name} · ${v.provider} · v${v.auth_version} · ${v.configuration_hash.slice(0, 8)}`,
      ),
    );
}
function verify(
  db: Database,
  actor: Principal,
  kind: Kind,
  id: string,
  ticket: Ticket,
  applying = false,
) {
  const { signature, ...body } = ticket;
  if (
    !equal(
      signature,
      hmac(
        db.config.MASTER_KEY!,
        "admin-content-revision-v1:" + canonical(body),
      ),
    ) ||
    ticket.actor_id !== actor.id ||
    ticket.kind !== kind ||
    ticket.source_id !== id ||
    (applying &&
      (ticket.session_id !== actor.sessionId ||
        ticket.auth_version !== actor.authVersion))
  )
    throw new Problem(
      409,
      "CONTENT_REVISION_PREVIEW_INVALID",
      "Prepare a new preview with your current administrator session",
    );
}
async function now(tx: Tx) {
  return new Date(
    (await tx.query("SELECT clock_timestamp() AS t")).rows[0].t,
  ).getTime();
}
async function history(tx: Tx, kind: Kind, row: any, before?: string) {
  const scope =
    kind === "solutions"
      ? "r.target_id IN (SELECT id FROM solution_versions WHERE tenant_id=$2 AND family_id=$3)"
      : "r.source_id=$3";
  const values = [
    kind,
    row.tenant_id,
    kind === "solutions" ? row.family_id : row.id,
  ];
  const anchor = before
    ? (
        await tx.query(
          `SELECT r.created_at,r.id FROM admin_content_revisions r WHERE r.kind=$1 AND r.tenant_id=$2 AND ${scope} AND r.id=$4`,
          [...values, before],
        )
      ).rows[0]
    : null;
  if (before && !anchor) throw missing();
  const rows = (
    await tx.query(
      `SELECT r.id,r.source_id,r.target_id,r.source_version,r.target_version,r.before_sha256,r.after_sha256,r.actor_id,p.name AS administrator_name,r.reason,r.created_at
    FROM admin_content_revisions r JOIN admin_principals p ON p.id=r.actor_id WHERE r.kind=$1 AND r.tenant_id=$2 AND ${scope}
    AND ($4::timestamptz IS NULL OR (r.created_at,r.id)<($4::timestamptz,$5::uuid)) ORDER BY r.created_at DESC,r.id DESC LIMIT 21`,
      [...values, anchor?.created_at ?? null, anchor?.id ?? null],
    )
  ).rows;
  return {
    items: rows.slice(0, 20),
    next_before: rows.length > 20 ? rows[19].id : null,
  };
}
async function options(tx: Tx, actor: Principal, row: any, query = "") {
  const args = [row.tenant_id, row.project_id, "%" + query + "%"];
  const agents = (
    await tx.query(
      "SELECT id,name,version FROM agents WHERE tenant_id=$1 AND project_id=$2 AND enabled AND content_state='active' AND name ILIKE $3 ORDER BY name,id LIMIT 201",
      args,
    )
  ).rows;
  const brands = (
    await tx.query(
      "SELECT v.brand_id AS id,v.name,v.version FROM brand_profiles b JOIN brand_profile_versions v ON v.brand_id=b.id AND v.version=b.version WHERE b.tenant_id=$1 AND b.project_id=$2 AND b.content_state='active' AND v.erased_at IS NULL AND v.name ILIKE $3 ORDER BY v.name,v.brand_id LIMIT 201",
      args,
    )
  ).rows;
  const assets = (
    await tx.query(
      "SELECT v.id,a.name,v.version FROM assets a JOIN asset_versions v ON v.asset_id=a.id WHERE a.tenant_id=$1 AND a.project_id=$2 AND a.private_owner IS NULL AND a.state='active' AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL AND a.name ILIKE $3 ORDER BY a.name,v.version DESC,v.id LIMIT 201",
      args,
    )
  ).rows;
  const connections = (await can(tx, actor, "admin.connections.read", {
    tenant: row.tenant_id,
    project: row.project_id,
  }))
    ? (
        await tx.query(
          "SELECT c.id,c.name,c.provider FROM connections c JOIN connector_profiles p ON p.connection_id=c.id WHERE c.tenant_id=$1 AND $2::uuid=ANY(p.project_ids) AND c.state='connected' AND p.catalog_state='complete' AND c.name ILIKE $3 ORDER BY c.name,c.id LIMIT 201",
          args,
        )
      ).rows
    : [];
  const templates = (
    await tx.query(
      "SELECT t.id,t.role_key,v.body->>'name' AS name,v.version,v.body->'skill_version_ids' AS skill_version_ids FROM agent_templates t JOIN agent_template_versions v ON v.template_id=t.id AND v.version=t.current_version WHERE (v.body->>'name') ILIKE $1 OR t.role_key ILIKE $1 ORDER BY t.role_key,t.id LIMIT 201",
      [args[2]],
    )
  ).rows;
  const skills = (
    await tx.query(
      `SELECT id,skill_key AS name,package_version AS version FROM skill_versions
    WHERE id IN(SELECT jsonb_array_elements_text(v.body->'skill_version_ids')::uuid FROM agent_templates t
      JOIN agent_template_versions v ON v.template_id=t.id AND v.version=t.current_version)
    AND state='verified' AND skill_key ILIKE $1 ORDER BY skill_key,id LIMIT 201`,
      [args[2]],
    )
  ).rows;
  return {
    agents: agents.slice(0, 200),
    brands: brands.slice(0, 200),
    assets: assets.slice(0, 200),
    connections: connections.slice(0, 200),
    templates: templates.slice(0, 200),
    skills: skills.slice(0, 200),
    truncated: [agents, brands, assets, connections, templates, skills].some(
      (a) => a.length > 200,
    ),
  };
}

export function registerAdminContentRevisions(
  app: FastifyInstance,
  db: Database,
  catalog: Catalog,
) {
  app.get(base, { preHandler: requireAdmin(db) }, async (req) => {
    const { kind, id } = params.parse(req.params);
    return db.tx(
      async (tx) => {
        await lockAdminAccess(tx);
        const row = await load(tx, req.principal, kind, id),
          current = await snapshot(tx, kind, row);
        await audit(
          tx,
          req.principal,
          "admin.content.revision.read",
          id,
          "succeeded",
          { kind },
          row.tenant_id,
        );
        return {
          kind,
          id,
          tenant_id: row.tenant_id,
          project_id: row.project_id,
          version: row.version,
          moderation_version: row.moderation_version ?? 0,
          published_version: row.current_version ?? null,
          definition: current.definition,
          options: await options(tx, req.principal, row),
          history: await history(tx, kind, row),
        };
      },
      undefined,
      true,
    );
  });
  app.get(base + "/options", { preHandler: requireAdmin(db) }, async (req) => {
    const { kind, id } = params.parse(req.params),
      q = z
        .object({ q: z.string().trim().max(160).default("") })
        .strict()
        .parse(req.query);
    return db.tx(
      async (tx) => {
        await lockAdminAccess(tx);
        const row = await load(tx, req.principal, kind, id);
        await audit(
          tx,
          req.principal,
          "admin.content.revision.options.read",
          id,
          "succeeded",
          { kind, query_sha256: fingerprint(q.q) },
          row.tenant_id,
        );
        return options(tx, req.principal, row, q.q);
      },
      undefined,
      true,
    );
  });
  app.get(base + "/history", { preHandler: requireAdmin(db) }, async (req) => {
    const { kind, id } = params.parse(req.params),
      q = z.object({ before: uuid.optional() }).strict().parse(req.query);
    return db.tx(
      async (tx) => {
        await lockAdminAccess(tx);
        const row = await load(tx, req.principal, kind, id);
        return history(tx, kind, row, q.before);
      },
      undefined,
      true,
    );
  });
  app.post(
    base + "/previews",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const { kind, id } = params.parse(req.params),
        b = normalize(kind, req.body);
      return db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          const row = await load(tx, req.principal, kind, id),
            prepared = await prepare(tx, catalog, req.principal, kind, row, b);
          const body = ticketBody.parse({
            protocol: 1,
            actor_id: req.principal.id,
            session_id: req.principal.sessionId,
            auth_version: req.principal.authVersion,
            kind,
            source_id: id,
            source_version: row.version,
            source_moderation_version: row.moderation_version ?? 0,
            before_sha256: prepared.before_sha256,
            after_sha256: prepared.sha256,
            input_sha256: fingerprint(b),
            target_version: prepared.target_version,
            expires_at: new Date((await now(tx)) + 300_000).toISOString(),
          });
          const changes = Object.keys(b.definition)
            .filter(
              (k) =>
                canonical(prepared.definition[k] ?? null) !==
                canonical(b.definition[k] ?? null),
            )
            .map((field) => ({
              field,
              before: prepared.definition[field] ?? null,
              after: b.definition[field] ?? null,
            }));
          const oldDependencies = dependencySummary(
            kind,
            kind === "solutions" ? row.frozen : prepared.current?.body,
          );
          const newDependencies = dependencySummary(
            kind,
            kind === "solutions" ? prepared.body.frozen : prepared.body,
          );
          if (canonical(oldDependencies) !== canonical(newDependencies))
            changes.push({
              field: "dependencies",
              before: oldDependencies,
              after: newDependencies,
            });
          await audit(
            tx,
            req.principal,
            "admin.content.revision.preview",
            id,
            "succeeded",
            {
              kind,
              before_sha256: prepared.before_sha256,
              after_sha256: prepared.sha256,
            },
            row.tenant_id,
          );
          return {
            request: b,
            ticket: {
              ...body,
              signature: hmac(
                db.config.MASTER_KEY!,
                "admin-content-revision-v1:" + canonical(body),
              ),
            },
            changes,
            effect:
              kind === "solutions"
                ? "new_method_draft"
                : kind === "project_configurations"
                  ? "publish_and_replace_draft"
                  : "new_team_version",
          };
        },
        undefined,
        true,
      );
    },
  );
  app.post(base + "/apply", { preHandler: requireAdmin(db) }, async (req) => {
    const { kind, id } = params.parse(req.params),
      raw = input
        .extend({ ticket: ticketSchema, confirmed: z.literal(true) })
        .strict()
        .parse(req.body);
    const { ticket, confirmed: _, ...value } = raw,
      b = normalize(kind, value),
      requestKey = key(req);
    verify(db, req.principal, kind, id, ticket, true);
    if (ticket.input_sha256 !== fingerprint(b)) throw changed();
    return db.tx(
      async (tx) => {
        await lockAdminAccess(tx);
        const row = await load(tx, req.principal, kind, id, true);
        return replay(
          tx,
          req.principal.id,
          action(kind, id),
          requestKey,
          { ...b, ticket },
          async () => {
            if ((await now(tx)) >= Date.parse(ticket.expires_at))
              throw new Problem(
                409,
                "CONTENT_REVISION_PREVIEW_EXPIRED",
                "Prepare a new preview; this one expired",
              );
            const p = await prepare(tx, catalog, req.principal, kind, row, b);
            if (
              ticket.before_sha256 !== p.before_sha256 ||
              ticket.after_sha256 !== p.sha256 ||
              ticket.target_version !== p.target_version
            )
              throw changed();
            const revisionId = randomUUID(),
              targetId = kind === "solutions" ? randomUUID() : id;
            await tx.query(
              `INSERT INTO admin_content_revisions(id,kind,source_id,target_id,tenant_id,project_id,source_version,source_moderation_version,target_version,before_sha256,after_sha256,actor_id,reason)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
              [
                revisionId,
                kind,
                id,
                targetId,
                row.tenant_id,
                row.project_id,
                row.version,
                row.moderation_version ?? 0,
                p.target_version,
                p.before_sha256,
                p.sha256,
                req.principal.id,
                b.reason,
              ],
            );
            if (kind === "agent_groups")
              await commitAdminGroupRevision(
                tx,
                req.principal,
                row,
                p.body,
                revisionId,
              );
            else if (kind === "project_configurations") {
              await tx.query(
                "INSERT INTO project_configuration_versions(configuration_id,version,tenant_id,project_id,body,sha256,created_by,created_by_admin,admin_revision_id) VALUES($1,$2,$3,$4,$5,$6,NULL,$7,$8)",
                [
                  id,
                  p.target_version,
                  row.tenant_id,
                  row.project_id,
                  p.body,
                  p.sha256,
                  req.principal.id,
                  revisionId,
                ],
              );
              await tx.query(
                "UPDATE project_configurations SET draft=$2,name=$3,current_version=$4,version=version+1,moderation_version=moderation_version+1,updated_at=clock_timestamp() WHERE id=$1",
                [id, b.definition, b.definition.name, p.target_version],
              );
            } else
              await tx.query(
                `INSERT INTO solution_versions(id,tenant_id,project_id,family_id,version,definition,frozen,definition_hash,state,created_by,created_by_admin,admin_revision_id)
          VALUES($1,$2,$3,$4,$5,$6,$7,$8,'draft',NULL,$9,$10)`,
                [
                  targetId,
                  row.tenant_id,
                  row.project_id,
                  row.family_id,
                  p.target_version,
                  b.definition,
                  JSON.stringify(p.body.frozen),
                  p.sha256,
                  req.principal.id,
                  revisionId,
                ],
              );
            await audit(
              tx,
              req.principal,
              "admin.content.revision.create",
              revisionId,
              "succeeded",
              {
                kind,
                source_id: id,
                target_id: targetId,
                version: p.target_version,
                before_sha256: p.before_sha256,
                after_sha256: p.sha256,
              },
              row.tenant_id,
            );
            return {
              revision_id: revisionId,
              kind,
              source_id: id,
              target_id: targetId,
              version: p.target_version,
              sha256: p.sha256,
              created_by_admin: req.principal.id,
              request_sha256: ticket.input_sha256,
              preview_signature: ticket.signature,
            };
          },
        );
      },
      undefined,
      true,
    );
  });
  app.post(
    base + "/requests/:request",
    { preHandler: requireAdmin(db) },
    async (req) => {
      const {
        kind,
        id,
        request: requestKey,
      } = params
        .extend({ request: z.string().regex(/^[\w:-]{16,128}$/) })
        .parse(req.params);
      const { ticket } = z
        .object({ ticket: ticketSchema })
        .strict()
        .parse(req.body);
      verify(db, req.principal, kind, id, ticket);
      return db.tx(
        async (tx) => {
          await lockAdminAccess(tx);
          await load(tx, req.principal, kind, id, false, true);
          await tx.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            [`${req.principal.id}:${action(kind, id)}:${requestKey}`],
          );
          const saved = (
            await tx.query(
              "SELECT response,revoked_at FROM request_replays WHERE actor_id=$1 AND action=$2 AND key=$3",
              [req.principal.id, action(kind, id), requestKey],
            )
          ).rows[0];
          if (saved?.revoked_at) return { status: "removed" };
          if (saved) {
            if (
              saved.response?.request_sha256 !== ticket.input_sha256 ||
              saved.response?.preview_signature !== ticket.signature
            )
              throw new Problem(
                409,
                "IDEMPOTENCY_CONFLICT",
                "This key belongs to a different revision; keep the original request metadata",
              );
            return { status: "applied", result: saved.response };
          }
          return {
            status:
              (await now(tx)) >= Date.parse(ticket.expires_at)
                ? "expired_not_applied"
                : "pending",
            expires_at: ticket.expires_at,
          };
        },
        undefined,
        true,
      );
    },
  );
}
