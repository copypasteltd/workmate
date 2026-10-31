import type { Tx } from "./db.js";
import type { Storage } from "./storage.js";
import { Problem, uuid } from "./lib.js";
import { assertTaskContentSources } from "./task-content-sources.js";
import { assertWorkflowContract, collectWorkflowOutputs } from "./workflow-contracts.js";

const unavailable = () => new Problem(409, "WORKFLOW_READ_SOURCE_UNAVAILABLE", "A source or fixed deliverable of this workflow is no longer available");

/** Reading retained content requires current source access, never a running
 * execution lease. In particular, successful runs cannot serve cached text
 * after their input or output versions have been withdrawn. */
export async function assertWorkflowReadAccess(tx: Tx, storage: Storage, run: any, origin: any) {
  await tx.query("SAVEPOINT workflow_read_access");
  try {
    if (!origin || origin.id !== run.origin_task_id || origin.tenant_id !== run.tenant_id
      || origin.project_id !== run.project_id || origin.created_by !== run.private_owner
      || origin.private_owner !== run.private_owner || origin.content_state !== "active"
      || new Date(origin.retention_expires_at).getTime() <= Date.now()) throw unavailable();
    await assertTaskContentSources(tx, origin);
    await assertWorkflowContract(tx, run);
    const files: { asset_version_id: string; asset_id?: string; sha256?: string }[] = [];
    const children = new Set<string>();
    for (const result of run.results ?? []) {
      if (result.kind === "codex" && result.task_id) children.add(uuid.parse(result.task_id));
      for (const file of result.files ?? (result.asset_version_id ? [result] : []))
        files.push({ asset_version_id: uuid.parse(file.asset_version_id),
          ...(file.asset_id ? { asset_id: uuid.parse(file.asset_id) } : {}), ...(file.sha256 ? { sha256: file.sha256 } : {}) });
    }
    if (children.size > 8 || files.length > 8 * 201) throw unavailable();
    for (const id of children) {
      const child = (await tx.query(`SELECT * FROM tasks WHERE id=$1 AND tenant_id=$2 AND project_id=$3
        AND created_by=$4 AND private_owner=$4 AND content_state='active' AND retention_expires_at>clock_timestamp()
        AND coalesce(cloud_workflow_run_id,desktop_workflow_run_id)=$5`,
      [id, run.tenant_id, run.project_id, run.private_owner, run.id])).rows[0];
      if (!child) throw unavailable();
      await assertTaskContentSources(tx, child);
    }
    if (files.length) {
      const available = await tx.query(`SELECT v.id FROM jsonb_to_recordset($1::jsonb)
        AS expected(asset_version_id uuid,asset_id uuid,sha256 text)
        JOIN asset_versions v ON v.id=expected.asset_version_id
        JOIN assets a ON a.id=v.asset_id
        WHERE (expected.asset_id IS NULL OR expected.asset_id=a.id) AND (expected.sha256 IS NULL OR expected.sha256=v.sha256)
        AND a.tenant_id=$2 AND a.project_id=$3 AND (a.private_owner IS NULL OR a.private_owner=$4)
        AND a.state='active' AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL
        AND task_asset_version_sources_available(v.id) FOR SHARE OF a NOWAIT`,
      [JSON.stringify(files), run.tenant_id, run.project_id, run.private_owner]);
      if (available.rows.length !== files.length) throw unavailable();
    }
    if (Object.keys(run.named_outputs ?? {}).length) await collectWorkflowOutputs(tx, storage, run, run.results);
    await tx.query("RELEASE SAVEPOINT workflow_read_access");
  } catch (error) {
    await tx.query("ROLLBACK TO SAVEPOINT workflow_read_access");
    await tx.query("RELEASE SAVEPOINT workflow_read_access");
    if ((error as { code?: string }).code === "55P03")
      throw new Problem(409, "WORKFLOW_READ_SOURCE_BUSY", "A workflow source is changing; refresh and retry");
    throw error;
  }
}
