import type { Tx } from "./db.js";
import type { Storage } from "./storage.js";
import { hash, Problem } from "./lib.js";
const permittedScope =
  "w.project_id=$1 AND w.content_state='active' AND (w.private_owner IS NULL OR (w.conversation_id=$2 AND w.private_owner=$3))";
export async function listCloudReferences(
  tx: Tx,
  t: any,
  query?: string,
  cursor?: string,
) {
  const rows = (
    await tx.query(
      `SELECT n.id AS workspace_node_id,n.name,n.kind,n.parent_id,n.workspace_id,n.asset_version_id,n.version,n.root_kind,n.reference_state FROM workspace_nodes n JOIN cloud_workspaces w ON w.id=n.workspace_id WHERE ${permittedScope} AND n.content_state='active' AND ($4::text IS NULL OR n.name ILIKE $4 ESCAPE '\\') AND ($5::uuid IS NULL OR n.id>$5) ORDER BY n.id LIMIT 101`,
      [
        t.project_id,
        t.conversation_id ?? null,
        t.private_owner ?? null,
        query ? "%" + query.replace(/[\\%_]/g, "\\$&") + "%" : null,
        cursor ?? null,
      ],
    )
  ).rows;
  return {
    items: rows.slice(0, 100),
    ...(rows.length > 100 ? { next_cursor: rows[99].workspace_node_id } : {}),
  };
}
export async function readCloudReference(
  tx: Tx,
  storage: Storage,
  t: any,
  nodeId: string,
  versionId: string,
) {
  const n = (
    await tx.query(
      `SELECT n.*,v.storage_key,v.mime_type,v.bytes,v.sha256,a.id AS asset_id,a.state AS asset_state FROM workspace_nodes n JOIN cloud_workspaces w ON w.id=n.workspace_id LEFT JOIN asset_versions v ON v.id=n.asset_version_id LEFT JOIN assets a ON a.id=v.asset_id WHERE ${permittedScope} AND n.id=$4 AND n.content_state='active'`,
      [
        t.project_id,
        t.conversation_id ?? null,
        t.private_owner ?? null,
        nodeId,
      ],
    )
  ).rows[0];
  if (!n)
    throw new Problem(404, "NOT_FOUND", "Authorized file reference not found");
  if (n.kind !== "file" || n.asset_version_id !== versionId)
    throw new Problem(
      409,
      "REFERENCE_CHANGED",
      "Select the current pinned file reference before reading",
    );
  if (n.asset_state !== "active" || !n.storage_key)
    throw new Problem(
      410,
      "REFERENCE_UNAVAILABLE",
      "The referenced source file is no longer available",
    );
  const summary = {
    workspace_node_id: n.id,
    asset_id: n.asset_id,
    asset_version_id: n.asset_version_id,
    name: n.name,
    content_type: n.mime_type,
    size_bytes: Number(n.bytes),
    sha256: n.sha256,
  };
  if (!/^(text\/|application\/json)/.test(n.mime_type))
    return { ...summary, text_available: false };
  if (Number(n.bytes) > 1_000_000)
    throw new Problem(
      413,
      "REFERENCE_TEXT_LIMIT",
      "Text references are limited to 1 MB per read",
    );
  const bytes = await storage.get(n.storage_key);
  if (hash(bytes) !== n.sha256) throw new Error("REFERENCE_INTEGRITY_FAILED");
  return { ...summary, text: bytes.toString("utf8"), text_available: true };
}
