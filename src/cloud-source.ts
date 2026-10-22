import { recordTaskSourceRead } from "./task-content-sources.js";
import { zipSync } from "fflate";
import type { Tx } from "./db.js";
import { saveAsset, type Storage } from "./storage.js";
import { validateSourcePath } from "./code-workspace.js";
import { hash, Problem } from "./lib.js";

async function root(tx: Tx, t: any, write = false) {
  if (!t.conversation_id || !t.private_owner)
    throw new Problem(
      409,
      "PRIVATE_WORKSPACE_REQUIRED",
      "Use a private conversation for persistent working sources",
    );
  if (write)
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
      "cloudtree:" + t.project_id,
    ]);
  const row = (
    await tx.query(
      "SELECT w.id AS workspace_id,n.id AS root_id FROM cloud_workspaces w JOIN workspace_nodes n ON n.workspace_id=w.id JOIN conversations c ON c.id=w.conversation_id WHERE w.tenant_id=$1 AND w.project_id=$2 AND w.conversation_id=$3 AND w.private_owner=$4 AND c.created_by=$4 AND c.content_state='active' AND w.content_state='active' AND n.root_kind='working_files' AND n.content_state='active'",
      [t.tenant_id, t.project_id, t.conversation_id, t.private_owner],
    )
  ).rows[0];
  if (!row)
    throw new Problem(404, "NOT_FOUND", "Authorized working files not found");
  return row;
}
async function find(tx: Tx, workspace: string, parent: string, name: string) {
  return (
    await tx.query(
      "SELECT n.*,v.asset_id,v.version AS source_version,v.storage_key,v.bytes,v.sha256,v.mime_type,v.metadata,a.current_version,a.private_owner AS asset_owner,a.state AS asset_state FROM workspace_nodes n LEFT JOIN asset_versions v ON v.id=n.asset_version_id LEFT JOIN assets a ON a.id=v.asset_id WHERE n.workspace_id=$1 AND n.parent_id=$2 AND lower(n.name)=lower($3) AND n.content_state='active'",
      [workspace, parent, name],
    )
  ).rows[0];
}
async function resolve(tx: Tx, t: any, relative: string, create = false) {
  const path = validateSourcePath(relative).normalize("NFC"),
    parts = path.split("/"),
    r = await root(tx, t, create);
  let parent = r.root_id;
  for (const name of parts.slice(0, -1)) {
    let n = await find(tx, r.workspace_id, parent, name);
    if (!n && !create) return { ...r, path, parent, file: undefined };
    if (!n)
      n = (
        await tx.query(
          "INSERT INTO workspace_nodes(tenant_id,project_id,workspace_id,parent_id,name,kind,private_owner,created_by) VALUES($1,$2,$3,$4,$5,'directory',$6,$7) RETURNING *",
          [
            t.tenant_id,
            t.project_id,
            r.workspace_id,
            parent,
            name,
            t.private_owner,
            t.created_by,
          ],
        )
      ).rows[0];
    if (n.kind !== "directory")
      throw new Problem(
        409,
        "WORKSPACE_PARENT_INVALID",
        "A file already occupies part of this source path",
      );
    parent = n.id;
  }
  return {
    ...r,
    path,
    parent,
    file: await find(tx, r.workspace_id, parent, parts.at(-1)!),
  };
}
function available(n: any) {
  if (n.kind !== "file" || n.asset_state !== "active" || !n.storage_key)
    throw new Problem(
      410,
      "REFERENCE_UNAVAILABLE",
      "This working source was removed or is unavailable",
    );
  if (Number(n.bytes) > 1_000_000)
    throw new Problem(413, "SOURCE_LIMIT", "A source file is limited to 1 MB");
}
export async function readCloudSource(
  tx: Tx,
  storage: Storage,
  t: any,
  path: string,
) {
  const r = await resolve(tx, t, path);
  if (!r.file) return undefined;
  available(r.file);
  const bytes = await storage.get(r.file.storage_key);
  if (hash(bytes) !== r.file.sha256)
    throw new Error("WORKING_SOURCE_INTEGRITY_FAILED");
  await recordTaskSourceRead(
    tx,
    t,
    "asset_version",
    r.file.asset_version_id,
    r.file.asset_version_id,
    r.file.sha256,
  );
  return {
    path: r.path,
    content: bytes.toString("utf8"),
    sha256: r.file.sha256,
    node_id: r.file.id,
    asset_version_id: r.file.asset_version_id,
  };
}
export async function writeCloudSource(
  tx: Tx,
  storage: Storage,
  t: any,
  path: string,
  content: string,
  expected?: string,
) {
  const bytes = Buffer.from(content);
  if (bytes.length > 1_000_000)
    throw new Problem(413, "SOURCE_LIMIT", "A source file is limited to 1 MB");
  const r = await resolve(tx, t, path, true),
    n = r.file;
  if (n) {
    available(n);
    if (!expected || expected !== n.sha256)
      throw new Problem(
        409,
        "CODE_VERSION_CONFLICT",
        "Read the current working file and provide its exact hash before editing",
      );
  } else if (expected)
    throw new Problem(
      409,
      "CODE_VERSION_CONFLICT",
      "The source entry no longer exists at this path",
    );
  const totals = (
    await tx.query(
      `WITH RECURSIVE tree AS (SELECT id,kind,asset_version_id FROM workspace_nodes WHERE id=$1 UNION ALL SELECT x.id,x.kind,x.asset_version_id FROM workspace_nodes x JOIN tree p ON x.parent_id=p.id WHERE x.content_state='active') SELECT count(*) FILTER(WHERE kind='file')::int AS files,coalesce(sum(v.bytes),0)::text AS bytes FROM tree LEFT JOIN asset_versions v ON v.id=tree.asset_version_id`,
      [r.root_id],
    )
  ).rows[0];
  if (
    Number(totals.files) + (n ? 0 : 1) > 500 ||
    Number(totals.bytes) - Number(n?.bytes ?? 0) + bytes.length > 20_000_000
  )
    throw new Problem(
      413,
      "SOURCE_WORKSPACE_LIMIT",
      "Working sources are limited to 500 files and 20 MB",
    );
  const reuse =
    n?.asset_owner === t.private_owner &&
    n.current_version === n.source_version &&
    n.metadata?.conversation_id === t.conversation_id;
  const asset = await saveAsset(tx, storage, {
    tenant: t.tenant_id,
    project: t.project_id,
    user: t.created_by,
    name: r.path.split("/").at(-1)!,
    mime: "text/plain",
    bytes,
    kind: "source_file",
    ...(reuse ? { asset: n.asset_id, expectedVersion: n.current_version } : {}),
    metadata: { task_id: t.id, workspace_area: "working_files" },
  });
  let entry = n;
  if (!entry)
    entry = (
      await tx.query(
        "SELECT * FROM workspace_nodes WHERE workspace_id=$1 AND asset_version_id=$2",
        [r.workspace_id, asset.version.id],
      )
    ).rows[0];
  if (!entry) throw new Error("WORKING_SOURCE_INDEX_MISSING");
  if (n && !reuse) {
    await tx.query("SELECT set_config('app.erasing_content','true',true)");
    await tx.query(
      "UPDATE workspace_nodes SET content_state='deleted',moderation_version=moderation_version+1 WHERE workspace_id=$1 AND asset_version_id=$2 AND id<>$3",
      [r.workspace_id, asset.version.id, n.id],
    );
    await tx.query("SELECT set_config('app.erasing_content','false',true)");
  }
  await tx.query(
    "UPDATE workspace_nodes SET parent_id=$2,name=$3,asset_version_id=$4,version=version+1,moderation_version=moderation_version+1,updated_at=now() WHERE id=$1",
    [entry.id, r.parent, r.path.split("/").at(-1), asset.version.id],
  );
  return {
    path: r.path,
    bytes: bytes.length,
    sha256: asset.version.sha256,
    node_id: entry.id,
    asset_version_id: asset.version.id,
  };
}
export async function bundleCloudSources(tx: Tx, storage: Storage, t: any) {
  const r = await root(tx, t),
    rows = (
      await tx.query(
        `WITH RECURSIVE tree AS (SELECT id,name::text AS path,kind,asset_version_id FROM workspace_nodes WHERE parent_id=$1 AND content_state='active' UNION ALL SELECT n.id,p.path||'/'||n.name,n.kind,n.asset_version_id FROM workspace_nodes n JOIN tree p ON n.parent_id=p.id WHERE n.content_state='active') SELECT tree.*,v.storage_key,v.bytes,v.sha256,a.state AS asset_state FROM tree LEFT JOIN asset_versions v ON v.id=tree.asset_version_id LEFT JOIN assets a ON a.id=v.asset_id WHERE tree.kind='file' ORDER BY tree.path LIMIT 501`,
        [r.root_id],
      )
    ).rows;
  if (!rows.length)
    throw new Problem(
      409,
      "SOURCE_REQUIRED",
      "Write a working source before packaging",
    );
  const data: Record<string, Uint8Array> = {},
    files: { path: string; bytes: number; sha256: string }[] = [];
  let total = 0;
  for (const n of rows) {
    available(n);
    validateSourcePath(n.path);
    total += Number(n.bytes);
    if (files.length >= 500 || total > 20_000_000)
      throw new Problem(
        413,
        "SOURCE_WORKSPACE_LIMIT",
        "Working sources exceed the packaging limit",
      );
    const bytes = await storage.get(n.storage_key);
    if (hash(bytes) !== n.sha256)
      throw new Error("WORKING_SOURCE_INTEGRITY_FAILED");
    data[n.path] = bytes;
    files.push({ path: n.path, bytes: bytes.length, sha256: n.sha256 });
  }
  if (
    (
      await tx.query(
        "SELECT count(*)::int AS n FROM workspace_nodes WHERE id=ANY($1::uuid[]) AND content_state='active'",
        [rows.map((n) => n.id)],
      )
    ).rows[0].n !== rows.length
  )
    throw new Problem(
      409,
      "CONTEXT_REVOKED",
      "A working file was removed during packaging",
    );
  data["copypaste-manifest.json"] = Buffer.from(
    JSON.stringify(
      {
        files,
        execution_validation: "not_executed",
        note: "Source is packaged from authorized persistent working versions. Run project checks in an authorized native environment.",
      },
      null,
      2,
    ),
  );
  return { bytes: Buffer.from(zipSync(data)), files };
}
