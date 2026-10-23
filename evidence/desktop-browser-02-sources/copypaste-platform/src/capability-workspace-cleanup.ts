import path from "node:path";
import type { Database, Tx } from "./db.js";
import { removeOwnedUUIDDirectory } from "./owned-directory-cleanup.js";

export function capabilityWorkspacePurgeDTO(row: any) {
  return {
    validation_id: row.validation_id,
    state: row.state,
    version: row.version,
    attempts: row.attempts,
    next_attempt_at: new Date(row.next_attempt_at).toISOString(),
    completed_at: row.completed_at
      ? new Date(row.completed_at).toISOString()
      : null,
    error_code: row.error_code ?? null,
  };
}

export async function queueCapabilityWorkspacePurge(
  tx: Tx,
  id: string,
  evidence: any,
) {
  if (evidence.workspace_cleanup_completed !== false) return;
  await tx.query(
    "INSERT INTO capability_workspace_purges(validation_id,error_code) VALUES($1,$2) ON CONFLICT(validation_id) DO NOTHING",
    [id, evidence.workspace_cleanup_error_code ?? "WORKSPACE_CLEANUP_PENDING"],
  );
}

/** One immediate filesystem attempt per locked job; later passes use the DB
 * clock. This never invokes Codex or the gateway, and never rewrites receipts.
 */
export async function purgeCapabilityWorkspaces(
  db: Database,
  remove: (parent: string, id: string) => Promise<void> = (parent, id) =>
    removeOwnedUUIDDirectory(parent, id, { retry: false }),
  limit = 10,
) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 100)
    throw new Error("CAPABILITY_PURGE_BATCH_INVALID");
  const mode = db.config.DEMO_MODE ? "simulated" : "configured_services";
  const candidates = (
    await db.control.query(
      "SELECT p.validation_id FROM capability_workspace_purges p JOIN capability_validations v ON v.id=p.validation_id JOIN capability_releases r ON r.id=v.release_id WHERE p.state='queued' AND p.next_attempt_at<=now() AND v.state<>'running' AND r.data_mode=$1 ORDER BY p.next_attempt_at,p.validation_id LIMIT $2",
      [mode, limit],
    )
  ).rows;
  for (const { validation_id: id } of candidates) {
    await db.tx(
      async (tx) => {
        const job = (
          await tx.query(
            "SELECT p.* FROM capability_workspace_purges p JOIN capability_validations v ON v.id=p.validation_id JOIN capability_releases r ON r.id=v.release_id WHERE p.validation_id=$1 AND p.state='queued' AND p.next_attempt_at<=now() AND v.state<>'running' AND r.data_mode=$2 FOR UPDATE OF p SKIP LOCKED",
            [id, mode],
          )
        ).rows[0];
        if (!job) return;
        try {
          await remove(
            path.resolve(db.config.DATA_DIR, "capability-verification"),
            id,
          );
          await tx.query(
            "UPDATE capability_workspace_purges SET state='completed',version=version+1,attempts=attempts+1,completed_at=now(),error_code=NULL WHERE validation_id=$1",
            [id],
          );
        } catch (error: any) {
          const code = ["EBUSY", "EPERM", "EACCES", "ENOTEMPTY"].includes(
            error.code,
          )
            ? "WORKSPACE_BUSY"
            : "WORKSPACE_CLEANUP_FAILED";
          await tx.query(
            "UPDATE capability_workspace_purges SET state=CASE WHEN attempts>=7 THEN 'failed' ELSE 'queued' END,version=version+1,attempts=attempts+1,error_code=$2,next_attempt_at=now()+make_interval(secs=>least(3600,30*(attempts+1))) WHERE validation_id=$1",
            [id, code],
          );
        }
      },
      undefined,
      true,
    );
  }
}
