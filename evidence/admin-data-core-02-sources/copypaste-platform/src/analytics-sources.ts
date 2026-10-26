import type { Tx } from "./db.js";
import type { Storage } from "./storage.js";
import { Problem, hash } from "./lib.js";
import { XLSX_MIME } from "./analytics-workbook.js";
export async function campaignSource(
  tx: Tx,
  storage: Storage,
  project: string,
  version: string,
) {
  const v = (
    await tx.query(
      "SELECT v.id,v.storage_key,v.sha256,v.bytes,v.mime_type,v.metadata,a.name,a.private_owner FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=$1 AND a.project_id=$2 AND a.state='active' FOR SHARE OF a",
      [version, project],
    )
  ).rows[0];
  if (!v)
    throw new Problem(
      404,
      "NOT_FOUND",
      "The source file version is unavailable",
    );
  if (v.private_owner)
    throw new Problem(
      403,
      "IMPORT_SOURCE_PRIVATE",
      "Publish an explicit shared project copy before importing private data into project analytics",
    );
  if (Number(v.bytes) > 5_000_000)
    throw new Problem(
      413,
      "IMPORT_FILE_SIZE",
      "Campaign imports support source files up to 5 MB",
    );
  const bytes = await storage.get(v.storage_key);
  if (bytes.length !== Number(v.bytes) || hash(bytes) !== v.sha256)
    throw new Problem(
      409,
      "SOURCE_INTEGRITY_FAILED",
      "Original file checksum verification failed",
    );
  // Names on the asset can change independently of an immutable version.
  // New uploads retain their original name; older versions use their own MIME
  // type so renaming or replacing the asset cannot change the selected parser.
  const filename =
    typeof v.metadata?.source_filename === "string"
      ? v.metadata.source_filename
      : v.mime_type === XLSX_MIME
        ? "campaign-source.xlsx"
        : v.mime_type === "text/csv"
          ? "campaign-source.csv"
          : v.name;
  return { ...v, name: filename, bytes };
}
