import type { Tx } from "./db.js";
import type { Storage } from "./storage.js";
import { canonical, hash, Problem } from "./lib.js";
import {
  type SeoCheckpoint,
  type SeoDocument,
  type SeoFinding,
  validateSeoCheckpoint,
} from "./seo-crawl.js";
import { assertSeoSources } from "./seo-source-access.js";

export type SeoResult = {
  run_id: string;
  spec_hash: string;
  checkpoint_sha256: string;
  created_at: string;
  coverage: {
    id: string;
    state: SeoCheckpoint["state"];
    page_requests: number;
    robots_requests: number;
    max_pages: number;
    byte_budget_used: number;
    states: Record<string, number>;
    limitations: string[];
    data_mode: string;
  };
  findings: SeoFinding[];
  comparison: ReturnType<
    typeof import("./seo-crawl.js").compareSeoFindings
  > | null;
};
export function serializeSeoDocument(document: SeoDocument) {
  const { raw, ...body } = document;
  return Buffer.from(
    JSON.stringify({ ...body, raw_base64: raw.toString("base64") }),
  );
}
export async function readSeoDocument(
  tx: Tx,
  storage: Storage,
  run: any,
  id: string,
): Promise<SeoDocument> {
  await assertSeoSources(tx, {
    id: run.task_id,
    input_context: { seo_audit_id: run.id },
  });
  const row = (
    await tx.query(
      `SELECT d.*,v.storage_key,v.sha256,v.bytes FROM seo_documents d
    JOIN asset_versions v ON v.asset_id=d.asset_id AND v.version=d.asset_version
    JOIN assets a ON a.id=d.asset_id WHERE d.id=$1 AND d.project_id=$2 AND a.private_owner=$3
      AND a.state='active' AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL`,
      [id, run.project_id, run.private_owner],
    )
  ).rows[0];
  if (!row)
    throw new Problem(
      403,
      "SEO_SOURCE_REVOKED",
      "The retained website source is unavailable",
    );
  const bytes = await storage.get(row.storage_key);
  if (
    bytes.length !== Number(row.bytes) ||
    hash(bytes) !== row.sha256 ||
    row.sha256 !== row.container_sha256
  )
    throw new Problem(
      409,
      "SEO_SOURCE_INVALID",
      "The retained website source does not match its immutable digest",
    );
  const { raw_base64, ...body } = JSON.parse(bytes.toString("utf8"));
  const raw = Buffer.from(raw_base64, "base64"),
    result = { ...body, raw } as SeoDocument;
  if (
    result.id !== row.id ||
    result.kind !== row.kind ||
    hash(result.url) !== row.url_sha256 ||
    hash(raw) !== result.raw_sha256 ||
    (result.text !== null &&
      hash(Buffer.from(result.text, "utf8")) !== result.source_sha256) ||
    (result.page && result.page.source_sha256 !== result.source_sha256)
  )
    throw new Problem(
      409,
      "SEO_SOURCE_INVALID",
      "The website evidence no longer matches its recorded source",
    );
  return result;
}
export async function readSeoResult(
  tx: Tx,
  storage: Storage,
  run: any,
): Promise<SeoResult> {
  await assertSeoSources(tx, {
    id: run.task_id,
    input_context: { seo_audit_id: run.id },
  });
  if (!run.result_asset_version_id)
    throw new Problem(
      409,
      "SEO_CRAWL_NOT_READY",
      "The confirmed website scope is still being collected",
    );
  const row = (
    await tx.query(
      `SELECT v.* FROM asset_versions v JOIN assets a ON a.id=v.asset_id
    WHERE v.id=$1 AND a.project_id=$2 AND a.private_owner=$3 AND a.state='active'
      AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL`,
      [run.result_asset_version_id, run.project_id, run.private_owner],
    )
  ).rows[0];
  if (!row)
    throw new Problem(
      403,
      "SEO_SOURCE_REVOKED",
      "The retained website result is unavailable",
    );
  const bytes = await storage.get(row.storage_key);
  if (hash(bytes) !== row.sha256 || bytes.length !== Number(row.bytes))
    throw new Problem(
      409,
      "SEO_SOURCE_INVALID",
      "The result digest does not match",
    );
  const result = JSON.parse(bytes.toString("utf8")) as SeoResult;
  validateSeoCheckpoint(run.checkpoint);
  if (
    result.run_id !== run.id ||
    result.spec_hash !== run.spec_hash ||
    result.checkpoint_sha256 !== hash(canonical(run.checkpoint))
  )
    throw new Problem(
      409,
      "SEO_SOURCE_INVALID",
      "The result does not match its frozen crawl checkpoint",
    );
  return result;
}
