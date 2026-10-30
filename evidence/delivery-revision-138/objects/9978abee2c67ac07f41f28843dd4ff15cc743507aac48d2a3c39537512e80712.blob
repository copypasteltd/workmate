import { z } from "zod";
import type { Tx } from "./db.js";
import type { Principal } from "./auth.js";
import type { Catalog } from "./catalog.js";
import type { Storage } from "./storage.js";
import { canonical, hash, name, Problem } from "./lib.js";
import {
  brandDefinition,
  brandVersion,
  checkBrandDefinition,
} from "./brand-production.js";
import { assertAgentRuntime } from "./runtime-profiles.js";
import { bindAgentSkills } from "./skill-lifecycle.js";

export const profileRevisionKinds = [
  "agents",
  "brand_profiles",
  "memories",
] as const;
export type ProfileRevisionKind = (typeof profileRevisionKinds)[number];
export const isProfileRevision = (kind: string): kind is ProfileRevisionKind =>
  (profileRevisionKinds as readonly string[]).includes(kind);
const specialist = z
  .object({
    name,
    instructions: z.string().trim().max(8000),
    tool_ids: z
      .array(z.string().min(1).max(120))
      .max(40)
      .refine((v) => new Set(v).size === v.length, "Choose each tool once")
      .transform((v) => [...v].sort()),
  })
  .strict();
const memory = z
  .object({
    name,
    content: z.string().trim().min(1).max(8000),
    expires_at: z
      .string()
      .datetime({ offset: true })
      .nullable()
      .transform((v) => (v === null ? null : new Date(v).toISOString())),
  })
  .strict();
export function profileRevisionDefinition(
  kind: ProfileRevisionKind,
  value: unknown,
): any {
  return kind === "agents"
    ? specialist.parse(value)
    : kind === "brand_profiles"
      ? brandDefinition.parse(value)
      : memory.parse(value);
}
export const revisionFactTable = (kind: string) =>
  isProfileRevision(kind)
    ? "admin_profile_revisions"
    : "admin_content_revisions";
const unavailable = () =>
  new Problem(
    409,
    "REVISION_DEPENDENCY_UNAVAILABLE",
    "Restore the fixed sources before revising this content",
  );
export async function jsonbRevisionDigest(tx: Tx, body: unknown) {
  return (
    await tx.query(
      "SELECT encode(digest($1::jsonb::text,'sha256'),'hex') AS sha256",
      [JSON.stringify(body)],
    )
  ).rows[0].sha256 as string;
}

/** A tenant-wide memory also affects projects denied to an otherwise broad admin. */
export async function assertProfileRevisionScope(
  tx: Tx,
  actor: Principal,
  row: any,
  permissions: readonly string[],
) {
  if (row.project_id) return;
  const deny = await tx.query(
    `SELECT 1 FROM admin_bindings b JOIN admin_roles r ON r.key=b.role_key
    JOIN projects p ON p.id=b.scope_id WHERE b.principal_id=$1 AND b.effect='deny' AND b.scope_kind='project'
    AND (b.expires_at IS NULL OR b.expires_at>clock_timestamp()) AND p.tenant_id=$2
    AND r.permissions ?| $3::text[] LIMIT 1`,
    [actor.id, row.tenant_id, permissions],
  );
  if (deny.rowCount)
    throw new Problem(
      403,
      "ADMIN_FORBIDDEN",
      "A project restriction prevents a revision that affects this entire enterprise",
    );
}
export async function assertProfileRevisionSource(
  tx: Tx,
  kind: ProfileRevisionKind,
  row: any,
) {
  if (kind === "agents" && row.builtin_default)
    throw new Problem(
      403,
      "DEFAULT_ASSISTANT_IMMUTABLE",
      "The default assistant has fixed settings; revise a customer specialist instead",
    );
  if (kind === "memories" && row.conversation_id) {
    const owner = await tx.query(
      `SELECT id FROM conversations WHERE id=$1 AND tenant_id=$2 AND project_id=$3
      AND created_by=$4 AND content_state='active' FOR SHARE`,
      [row.conversation_id, row.tenant_id, row.project_id, row.private_owner],
    );
    if (!owner.rowCount) throw unavailable();
  }
  if (kind === "memories" && row.brand_id) {
    const brand = await tx.query(
      "SELECT id FROM brand_profiles WHERE id=$1 AND tenant_id=$2 AND project_id=$3 AND content_state='active' FOR SHARE",
      [row.brand_id, row.tenant_id, row.project_id],
    );
    if (!brand.rowCount) throw unavailable();
  }
}

export async function profileRevisionSnapshot(
  tx: Tx,
  kind: ProfileRevisionKind,
  row: any,
) {
  let definition: any, current: any, before: any;
  if (kind === "agents") {
    current = (
      await tx.query(
        "SELECT * FROM agent_versions WHERE agent_id=$1 AND version=$2",
        [row.id, row.version],
      )
    ).rows[0];
    if (!current?.body?.role_hash) throw unavailable();
    definition = specialist.parse({
      name: row.name,
      instructions: current.body.instructions ?? "",
      tool_ids: current.body.tool_ids ?? [],
    });
    before = {
      body: current.body,
      enabled: row.enabled,
      builtin_default: row.builtin_default,
    };
  } else if (kind === "brand_profiles") {
    current = (
      await tx.query(
        "SELECT * FROM brand_profile_versions WHERE brand_id=$1 AND version=$2 AND erased_at IS NULL",
        [row.id, row.version],
      )
    ).rows[0];
    if (!current) throw unavailable();
    // Legacy drafts must explicitly supply missing font/right declarations.
    definition =
      row.body.schema_version === 2
        ? brandDefinition.parse(row.body)
        : {
            schema_version: 2,
            name: row.name,
            colors: row.body.colors ?? ["#1F5EFF"],
            tone: row.body.tone ?? "",
            approved_copy: row.body.approved_copy ?? "",
            fonts: row.body.fonts ?? [],
            logos: [],
            font_bindings: [],
            facts: [],
            locales: row.body.locales ?? ["zh-Hant-HK", "en-HK"],
            channels: row.body.channels ?? ["social"],
            restrictions: row.body.restrictions ?? "",
          };
    before = { name: row.name, body: row.body, sha256: current.sha256 };
  } else {
    current = (
      await tx.query(
        "SELECT * FROM memory_versions WHERE memory_id=$1 AND version=$2",
        [row.id, row.version],
      )
    ).rows[0];
    if (current?.content == null) throw unavailable();
    definition = memory.parse({
      name: row.name,
      content: current.content,
      expires_at: row.expires_at?.toISOString() ?? null,
    });
    before = {
      definition,
      scope: row.scope,
      private_owner: row.private_owner,
      project_id: row.project_id,
      brand_id: row.brand_id,
      conversation_id: row.conversation_id,
    };
  }
  return {
    definition,
    current,
    before_sha256: hash(canonical(before)),
    target_version: row.version + 1,
  };
}

async function specialistSources(
  tx: Tx,
  catalog: Catalog,
  row: any,
  current: any,
) {
  const body = current.body;
  const role = catalog.role(body.role_key, body.role_hash);
  await catalog.ensureEnabled(tx, body.role_key, body.role_hash);
  await tx.query(
    "SELECT id FROM codex_runtime_profiles WHERE id=$1 FOR SHARE",
    [body.runtime_profile_id],
  );
  await tx.query(
    "SELECT id FROM internal_capability_versions WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE",
    [body.capability_version_ids ?? []],
  );
  await assertAgentRuntime(tx, {
    runtime_profile_id: body.runtime_profile_id,
    body,
  });
  const skills: any[] = body.skills ?? [];
  await tx.query("SELECT lock_adoption_skill_versions($1::uuid[])", [
    skills.map((s) => s.skill_version_id),
  ]);
  const installations = (
    await tx.query(
      `SELECT i.*,v.skill_key,v.package_version,v.content_hash,v.state AS package_state
    FROM skill_installations i JOIN skill_versions v ON v.id=i.skill_version_id
    WHERE i.id=ANY($1::uuid[]) ORDER BY i.id FOR SHARE OF i`,
      [skills.map((s) => s.installation_id)],
    )
  ).rows;
  if (
    installations.length !== skills.length ||
    skills.some(
      (s) =>
        !installations.some(
          (i) =>
            i.id === s.installation_id &&
            i.tenant_id === row.tenant_id &&
            i.project_id === row.project_id &&
            i.skill_version_id === s.skill_version_id &&
            i.enabled &&
            i.state === "installed" &&
            i.package_state === "verified" &&
            i.skill_key === s.key &&
            i.package_version === s.version &&
            i.content_hash === s.sha256,
        ),
    )
  )
    throw unavailable();
  if (body.brand)
    await brandVersion(tx, row.project_id, body.brand.id, body.brand.version);
  return role;
}
export async function prepareProfileRevision(
  tx: Tx,
  catalog: Catalog,
  storage: Storage,
  kind: ProfileRevisionKind,
  row: any,
  definition: any,
) {
  await assertProfileRevisionSource(tx, kind, row);
  const before = await profileRevisionSnapshot(tx, kind, row);
  let body: any, sha256: string, previous: string;
  if (kind === "agents") {
    const role = await specialistSources(tx, catalog, row, before.current);
    if (definition.tool_ids.some((id: string) => !role.tool_ids.includes(id)))
      throw new Problem(
        400,
        "TOOL_SCOPE_EXCEEDED",
        "Choose tools from this specialist's pinned role",
      );
    // Settings never adopt newer runtime, models, methods, templates or brands.
    body = {
      ...before.current.body,
      name: definition.name,
      instructions: definition.instructions,
      tool_ids: definition.tool_ids,
    };
    sha256 = await jsonbRevisionDigest(tx, body);
    previous = await jsonbRevisionDigest(tx, before.current.body);
  } else if (kind === "brand_profiles") {
    await checkBrandDefinition(tx, storage, row.project_id, definition);
    body = definition;
    sha256 = await jsonbRevisionDigest(tx, {
      name: definition.name,
      body: definition,
    });
    previous = before.current.sha256;
  } else {
    if (
      definition.expires_at &&
      Date.parse(definition.expires_at) <= Date.now()
    )
      throw new Problem(
        400,
        "EXPIRY_INVALID",
        "Choose a future memory expiry or no expiry",
      );
    body = {
      ...definition,
      scope: row.scope,
      project_id: row.project_id,
      brand_id: row.brand_id,
      conversation_id: row.conversation_id,
      private_owner: row.private_owner,
    };
    sha256 = await jsonbRevisionDigest(tx, body);
    previous = await jsonbRevisionDigest(tx, { ...body, ...before.definition });
  }
  if (
    sha256 === previous &&
    canonical(before.definition) === canonical(definition)
  )
    throw new Problem(
      422,
      "CONTENT_REVISION_UNCHANGED",
      "Change the content before preparing a revision",
    );
  return { ...before, body, sha256 };
}

export async function commitProfileRevision(
  tx: Tx,
  actor: Principal,
  kind: ProfileRevisionKind,
  row: any,
  body: any,
  revisionId: string,
) {
  const target = row.version + 1;
  if (kind === "agents") {
    await tx.query(
      "UPDATE agents SET name=$2,version=version+1,moderation_version=moderation_version+1,updated_at=clock_timestamp() WHERE id=$1",
      [row.id, body.name],
    );
    await tx.query(
      `INSERT INTO agent_versions(tenant_id,agent_id,version,body,created_by,created_by_admin,admin_revision_id)
      VALUES($1,$2,$3,$4,NULL,$5,$6)`,
      [row.tenant_id, row.id, target, body, actor.id, revisionId],
    );
    await bindAgentSkills(
      tx,
      row.tenant_id,
      row.project_id,
      row.id,
      target,
      body.skills,
    );
  } else if (kind === "brand_profiles") {
    await tx.query(
      "SELECT set_config('app.admin_profile_revision_id',$1,true)",
      [revisionId],
    );
    await tx.query(
      "UPDATE brand_profiles SET name=$2,body=$3,version=version+1,moderation_version=moderation_version+1 WHERE id=$1",
      [row.id, body.name, body],
    );
    await tx.query(
      "SELECT set_config('app.admin_profile_revision_id','',true)",
    );
  } else {
    await tx.query(
      "UPDATE memories SET name=$2,expires_at=$3,version=version+1,moderation_version=moderation_version+1,updated_at=clock_timestamp() WHERE id=$1",
      [row.id, body.name, body.expires_at],
    );
    await tx.query(
      `INSERT INTO memory_versions(tenant_id,memory_id,version,content,created_by,created_by_admin,admin_revision_id)
      VALUES($1,$2,$3,$4,NULL,$5,$6)`,
      [row.tenant_id, row.id, target, body.content, actor.id, revisionId],
    );
  }
}

export async function profileRevisionOptions(
  tx: Tx,
  catalog: Catalog,
  kind: ProfileRevisionKind,
  row: any,
  query: string,
) {
  const empty = {
    agents: [],
    brands: [],
    assets: [] as any[],
    connections: [],
    templates: [],
    skills: [],
    truncated: false,
    tool_choices: [] as { id: string; name: string }[],
  };
  if (kind === "agents") {
    const v = await profileRevisionSnapshot(tx, kind, row);
    const role = catalog.role(
      v.current.body.role_key,
      v.current.body.role_hash,
    );
    return {
      ...empty,
      tool_choices: role.tool_ids.map((id: string) => ({ id, name: id })),
    };
  }
  if (kind !== "brand_profiles") return empty;
  const rows = (
    await tx.query(
      `SELECT v.id,a.id AS asset_id,a.name,v.version,v.mime_type,v.bytes
    FROM assets a JOIN asset_versions v ON v.asset_id=a.id WHERE a.tenant_id=$1 AND a.project_id=$2
    AND a.private_owner IS NULL AND a.state='active' AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL
    AND v.mime_type IN('image/png','font/ttf','font/otf','application/octet-stream')
    AND a.name ILIKE $3 ORDER BY a.name,v.version DESC,v.id LIMIT 201`,
      [row.tenant_id, row.project_id, "%" + query + "%"],
    )
  ).rows;
  return { ...empty, assets: rows.slice(0, 200), truncated: rows.length > 200 };
}
export function profileRevisionDependencies(
  kind: ProfileRevisionKind,
  body: any,
): string[] {
  if (kind === "agents")
    return [
      `${body.role_key} · ${body.role_hash}`,
      `Codex ${body.runtime_version} · ${body.runtime_profile_id}`,
      ...(body.capability_version_ids ?? []).map((id: string) => `Model ${id}`),
      ...(body.skills ?? []).map(
        (s: any) => `${s.key} · ${s.version} · ${s.sha256}`,
      ),
      ...(body.brand
        ? [`Brand ${body.brand.id} · v${body.brand.version}`]
        : []),
    ];
  if (kind === "brand_profiles")
    return [
      ...(body.logos ?? []).map(
        (s: any) => `Logo ${s.key} · ${s.asset_id} · v${s.version}`,
      ),
      ...(body.font_bindings ?? []).map(
        (s: any) =>
          `Font ${s.key} · ${s.source.builtin ?? s.source.asset_id + " · v" + s.source.version}`,
      ),
    ];
  return [];
}
