import type { Tx } from "./db.js";
import { Problem } from "./lib.js";

export async function assertSeoSources(
  tx: Tx,
  task: any,
  ownExecution = false,
) {
  const id = task.input_context?.seo_audit_id;
  if (!id) return;
  const check = async () =>
    (
      await tx.query(
        "SELECT id FROM seo_runs WHERE id=$1 AND task_id=$2 AND invalidated_at IS NULL AND seo_run_sources_available(id)",
        [id, task.id],
      )
    ).rowCount;
  if (!(await check()))
    throw new Problem(
      403,
      "SEO_SOURCE_REVOKED",
      "A retained website source is unavailable or expired",
    );
  await tx.query("SAVEPOINT seo_source_locks");
  try {
    // Heartbeats and runtime events also update the executing task. Serialize
    // those short transactions instead of mistaking their row locks for source
    // moderation or attempting concurrent SHARE-to-UPDATE lock upgrades.
    if (ownExecution)
      await tx.query("SELECT id FROM tasks WHERE id=$1 FOR UPDATE", [task.id]);
    // Source-task moderation must be fenced as well as asset moderation. A
    // retained cache source can belong to an earlier independent audit.
    await tx.query(
      `WITH RECURSIVE runs AS (
      SELECT id,previous_run_id FROM seo_runs WHERE id=$1
      UNION SELECT p.id,p.previous_run_id FROM seo_runs p JOIN runs c ON p.id=c.previous_run_id
    ), documents AS (
      SELECT id,run_id,cache_source_id FROM seo_documents WHERE run_id IN(SELECT id FROM runs)
      UNION SELECT p.id,p.run_id,p.cache_source_id FROM seo_documents p JOIN documents c ON p.id=c.cache_source_id
    ) SELECT t.id FROM tasks t WHERE t.id IN(
      SELECT task_id FROM seo_runs WHERE id IN(SELECT id FROM runs) OR id IN(SELECT run_id FROM documents)
    ) AND ($2::uuid IS NULL OR t.id<>$2) ORDER BY t.id FOR SHARE OF t NOWAIT`,
      [id, ownExecution ? task.id : null],
    );
    // Include earlier comparison runs and every retained conditional-cache ancestor.
    // Lifecycle changes and erasure lock the parent asset first. Versions are
    // append-only for cp_app; locking them would require unnecessary UPDATE grants.
    await tx.query(
      `WITH RECURSIVE runs AS (
      SELECT id,previous_run_id,result_asset_version_id,report_asset_version_id FROM seo_runs WHERE id=$1
      UNION SELECT p.id,p.previous_run_id,p.result_asset_version_id,p.report_asset_version_id FROM seo_runs p JOIN runs c ON p.id=c.previous_run_id
    ), documents AS (
      SELECT d.id,d.cache_source_id,d.asset_id,d.asset_version FROM seo_documents d WHERE d.run_id IN(SELECT id FROM runs)
      UNION SELECT p.id,p.cache_source_id,p.asset_id,p.asset_version FROM seo_documents p JOIN documents c ON p.id=c.cache_source_id
    ) SELECT a.id FROM assets a JOIN asset_versions v ON v.asset_id=a.id
      WHERE (EXISTS(SELECT 1 FROM documents d WHERE d.asset_id=a.id AND d.asset_version=v.version)
        OR EXISTS(SELECT 1 FROM runs r WHERE r.result_asset_version_id=v.id OR r.report_asset_version_id=v.id))
      ORDER BY a.id,v.id FOR SHARE OF a NOWAIT`,
      [id],
    );
    if (!(await check()))
      throw new Problem(
        403,
        "SEO_SOURCE_REVOKED",
        "A retained website source is unavailable or expired",
      );
    await tx.query("RELEASE SAVEPOINT seo_source_locks");
  } catch (error) {
    await tx.query("ROLLBACK TO SAVEPOINT seo_source_locks");
    await tx.query("RELEASE SAVEPOINT seo_source_locks");
    if ((error as { code?: string }).code === "55P03")
      throw new Problem(
        403,
        "SEO_SOURCE_CHANGING",
        "A website source is being changed; execution stopped before using it",
      );
    throw error;
  }
}

export async function seoCrawlReady(tx: Tx, task: any) {
  if (!task.input_context?.seo_audit_id) return true;
  return !!(
    await tx.query(
      "SELECT 1 FROM seo_runs WHERE id=$1 AND task_id=$2 AND state IN('complete','partial') AND result_asset_version_id IS NOT NULL AND invalidated_at IS NULL",
      [task.input_context.seo_audit_id, task.id],
    )
  ).rowCount;
}
