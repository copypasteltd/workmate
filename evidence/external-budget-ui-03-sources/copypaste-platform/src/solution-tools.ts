import { z } from "zod";
import type { Tx } from "./db.js";
import type { Catalog } from "./catalog.js";
import type { Storage } from "./storage.js";
import { hash, Problem, uuid } from "./lib.js";
import {
  assertTaskContentSources,
  recordTaskContentRead,
} from "./task-content-sources.js";

export const solutionToolListInput = z
  .object({
    after_id: uuid.optional(),
    limit: z.number().int().min(1).max(20).default(10),
  })
  .strict();
export const solutionToolReadInput = z
  .object({ installation_id: uuid })
  .strict();
export const solutionSourceReadInput = z
  .object({ asset_version_id: uuid })
  .strict();

export async function listTaskSolutions(
  tx: Tx,
  t: any,
  b: z.infer<typeof solutionToolListInput>,
) {
  const rows = (
    await tx.query(
      `SELECT i.id AS installation_id,s.id AS solution_version_id,i.name,s.version,s.definition->'required_assets' AS required_assets,
      s.definition->'required_connectors' AS required_connectors,s.frozen
     FROM solution_installations i JOIN solution_versions s ON s.id=i.solution_version_id JOIN projects p ON p.id=s.project_id
     WHERE i.tenant_id=$1 AND i.project_id=$2 AND i.created_by=$3 AND s.state='published' AND NOT p.archived
      AND ($4::uuid IS NULL OR i.id>$4) ORDER BY i.id LIMIT $5`,
      [
        t.tenant_id,
        t.project_id,
        t.created_by,
        b.after_id ?? null,
        b.limit + 1,
      ],
    )
  ).rows;
  return {
    items: rows.slice(0, b.limit).map(({ frozen, ...row }) => ({
      ...row,
      role_keys: frozen.map((f: any) => f.role_key),
      applicable_to_current_role: frozen.some(
        (f: any) => f.role_key === t.role_key && f.role_hash === t.role_hash,
      ),
    })),
    next_after_id:
      rows.length > b.limit ? rows[b.limit - 1].installation_id : null,
    guidance:
      "Read a published installed method without inheriting another role's permissions. User-provided local permissions stay in force.",
  };
}
export async function readTaskSolution(
  tx: Tx,
  catalog: Catalog,
  t: any,
  b: z.infer<typeof solutionToolReadInput>,
) {
  const row = (
    await tx.query(
      `SELECT s.* FROM solution_installations i JOIN solution_versions s ON s.id=i.solution_version_id JOIN projects p ON p.id=s.project_id
     WHERE i.id=$1 AND i.tenant_id=$2 AND i.project_id=$3 AND i.created_by=$4 AND s.state='published' AND NOT p.archived FOR SHARE OF s NOWAIT`,
      [b.installation_id, t.tenant_id, t.project_id, t.created_by],
    )
  ).rows[0];
  if (!row)
    throw new Problem(404, "NOT_FOUND", "Published installed method not found");
  const binding = row.frozen.find(
    (f: any) => f.role_key === t.role_key && f.role_hash === t.role_hash,
  );
  if (!binding)
    throw new Problem(
      409,
      "SOLUTION_ROLE_REQUIRED",
      "Start work with one of this method's exact pinned roles",
    );
  await catalog.ensureEnabled(tx, t.role_key, t.role_hash);
  if (t.status === "running") {
    const current = (
      await tx.query(
        "SELECT nullif(current_setting('app.task_id',true),'') AS id",
      )
    ).rows[0].id;
    if (current !== t.id)
      throw new Problem(
        409,
        "TASK_SOURCE_SCOPE_INVALID",
        "The method read belongs to another task",
      );
    await tx.query(
      "INSERT INTO solution_method_reads(tenant_id,project_id,task_id,solution_version_id,definition_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING",
      [t.tenant_id, t.project_id, t.id, row.id, row.definition_hash],
    );
    await assertTaskContentSources(tx, t);
  }
  return {
    solution_version_id: row.id,
    version: row.version,
    definition_hash: row.definition_hash,
    name: row.definition.name,
    instructions: row.definition.instructions,
    role_key: binding.role_key,
    skill_version_ids: binding.skill_version_ids,
    required_assets: row.definition.required_assets,
    required_connectors: row.definition.required_connectors,
    execution_location: t.execution_location,
    private_materials_or_credentials_copied: false,
    guidance:
      "Apply only within the current task's authorized inputs, tools and budget. Ask the customer for missing target materials; this read does not approve paid work or local access.",
  };
}
export async function readSolutionSource(
  tx: Tx,
  storage: Storage,
  t: any,
  b: z.infer<typeof solutionSourceReadInput>,
) {
  const approved = t.input_context?.solution_trial?.bindings?.assets?.find(
    (v: any) => v.asset_version_id === b.asset_version_id,
  );
  if (!approved)
    throw new Problem(
      404,
      "NOT_FOUND",
      "The exact approved trial input was not found",
    );
  const row = (
    await tx.query(
      `SELECT v.*,a.name FROM asset_versions v JOIN assets a ON a.id=v.asset_id
     WHERE v.id=$1 AND a.tenant_id=$2 AND a.project_id=$3 AND (a.private_owner IS NULL OR a.private_owner=$4)
      AND a.state='active' AND v.erased_at IS NULL AND a.retention_expires_at>clock_timestamp()
      AND v.sha256=$5 AND task_asset_version_sources_available(v.id) FOR SHARE OF a NOWAIT`,
      [
        b.asset_version_id,
        t.tenant_id,
        t.project_id,
        t.created_by,
        approved.sha256,
      ],
    )
  ).rows[0];
  if (!row)
    throw new Problem(
      404,
      "NOT_FOUND",
      "The exact approved trial input is no longer available",
    );
  if (
    !["text/plain", "text/csv", "application/json", "image/svg+xml"].includes(
      row.mime_type,
    ) ||
    Number(row.bytes) > 500000
  )
    throw new Problem(
      422,
      "SOLUTION_SOURCE_READER_REQUIRED",
      "Use the role's exact-version image, spreadsheet, media or code reader for this input",
    );
  const bytes = await storage.get(row.storage_key);
  if (bytes.length !== Number(row.bytes) || hash(bytes) !== row.sha256)
    throw new Problem(
      409,
      "SOLUTION_SOURCE_INTEGRITY",
      "The approved source bytes changed",
    );
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new Problem(
      422,
      "SOLUTION_SOURCE_ENCODING",
      "Choose a valid UTF-8 text source",
    );
  }
  await recordTaskContentRead(
    tx,
    t,
    "asset_version",
    row.id,
    row.id,
    row.sha256,
  );
  return {
    asset_version_id: row.id,
    sha256: row.sha256,
    name: row.name,
    mime_type: row.mime_type,
    text,
  };
}
