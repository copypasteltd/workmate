import type { Tx } from "./db.js";
import { Problem } from "./lib.js";

/** The scoped definer locks read-only source tables without granting broader
 * update permissions to the application role. */
export async function assertTaskContentSources(tx: Tx, task: { id: string }) {
  await tx.query("SAVEPOINT content_source_locks");
  try {
    if (
      !(await tx.query("SELECT lock_task_content_sources($1) AS ok", [task.id]))
        .rows[0].ok
    )
      throw new Problem(
        409,
        "TASK_SOURCE_REVOKED",
        "A source used by this result is no longer available",
      );
    await tx.query("RELEASE SAVEPOINT content_source_locks");
  } catch (error) {
    await tx.query("ROLLBACK TO SAVEPOINT content_source_locks");
    await tx.query("RELEASE SAVEPOINT content_source_locks");
    if ((error as { code?: string }).code === "55P03")
      throw new Problem(
        409,
        "TASK_SOURCE_BUSY",
        "A source is changing; refresh and retry",
      );
    throw error;
  }
}

/** Only model-authorized tool transactions record reads. UI previews do not
 * pretend that a model consumed content. A duplicate replay keeps its first fact. */
export async function recordTaskSourceRead(
  tx: Tx,
  task: any,
  kind: "asset_version" | "cloud_reference" | "dataset",
  resource: string,
  version?: string,
  sha256?: string,
) {
  if (task.status !== "running") return;
  const running = (
    await tx.query(
      "SELECT nullif(current_setting('app.task_id',true),'') AS id",
    )
  ).rows[0].id;
  if (!running) return;
  if (running !== task.id)
    throw new Problem(
      409,
      "TASK_SOURCE_SCOPE_INVALID",
      "The model read belongs to another task",
    );
  await tx.query(
    "INSERT INTO task_source_reads(tenant_id,project_id,task_id,kind,resource_id,asset_version_id,sha256) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT DO NOTHING",
    [
      task.tenant_id,
      task.project_id,
      task.id,
      kind,
      resource,
      version ?? null,
      sha256 ?? null,
    ],
  );
  await assertTaskContentSources(tx, task);
}
