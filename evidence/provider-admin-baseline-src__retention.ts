import type { Database } from "./db.js";
import type { Storage } from "./storage.js";
import { purgeCapabilityWorkspaces } from "./capability-workspace-cleanup.js";

export const retentionPolicy = {
  files_days: 90,
  task_content_days: 90,
  report_days: 90,
  task_events_days: 30,
  notification_days: 30,
  replay_result_days: 7,
  adoption_comparison_hours: 24,
  runtime_cache: "remove_after_terminal",
  financial_audit_minimum_days: 365,
  online_erasure_target_hours: 24,
} as const;
/** All clocks are PostgreSQL clocks. Small committed batches survive restarts. */
export class RetentionService {
  private lastSweep = 0;
  constructor(
    private db: Database,
    private storage: Storage,
    private active = (_id: string) => false,
  ) {}
  async advance(force = false) {
    await this.purgeRuntime();
    await purgeCapabilityWorkspaces(this.db);
    if (!force && Date.now() - this.lastSweep < 60_000) return;
    await this.expireContent();
    this.lastSweep = Date.now();
  }
  async expireContent(limit = 100) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 1000)
      throw new Error("RETENTION_BATCH_INVALID");
    return this.db.tx(
      async (tx) => {
        if (
          !(
            await tx.query(
              "SELECT pg_try_advisory_xact_lock(hashtextextended('content-retention',0)) AS locked",
            )
          ).rows[0].locked
        )
          return null;
        const counts: Record<string, number> = {};
        counts.adoption_previews =
          (
            await tx.query(
              "DELETE FROM agent_adoption_previews WHERE id IN (SELECT id FROM agent_adoption_previews WHERE expires_at<now()-interval '24 hours' ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT $1)",
              [limit],
            )
          ).rowCount ?? 0;
        for (const [table, column, condition] of [
          ["assets", "state", "true"],
          ["creative_projects", "content_state", "true"],
          ["analytics_datasets", "content_state", "true"],
          [
            "tasks",
            "content_state",
            "status IN ('succeeded','failed','cancelled')",
          ],
        ]) {
          // Only static identifiers above enter SQL. The same irreversible-delete
          // trigger as user/admin deletion journals every expired online copy.
          const r = await tx.query(
            `UPDATE ${table} SET ${column}='deleted',moderation_version=moderation_version+1 WHERE id IN (SELECT id FROM ${table} WHERE ${column}<>'deleted' AND retention_expires_at<=now() AND ${condition} ORDER BY retention_expires_at,id FOR UPDATE SKIP LOCKED LIMIT $1)`,
            [limit],
          );
          counts[table] = r.rowCount ?? 0;
        }
        counts.memories =
          (
            await tx.query(
              "UPDATE memories SET content_state='deleted',moderation_version=moderation_version+1 WHERE id IN (SELECT id FROM memories WHERE content_state<>'deleted' AND expires_at<=now() ORDER BY expires_at,id FOR UPDATE SKIP LOCKED LIMIT $1)",
              [limit],
            )
          ).rowCount ?? 0;
        const events = await tx.query(
          "WITH old AS (SELECT id FROM task_events WHERE created_at<now()-interval '30 days' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT $1),gone AS (DELETE FROM task_events WHERE id IN (SELECT id FROM old) RETURNING task_id,tenant_id,seq) INSERT INTO task_event_retention(task_id,tenant_id,pruned_through) SELECT task_id,tenant_id,max(seq) FROM gone GROUP BY task_id,tenant_id ON CONFLICT(task_id) DO UPDATE SET pruned_through=greatest(task_event_retention.pruned_through,excluded.pruned_through),updated_at=now() RETURNING task_id",
          [limit * 10],
        );
        counts.event_tasks = events.rowCount ?? 0;
        counts.notifications =
          (
            await tx.query(
              "DELETE FROM notifications WHERE id IN (SELECT id FROM notifications WHERE created_at<now()-interval '30 days' ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT $1)",
              [limit * 10],
            )
          ).rowCount ?? 0;
        // Retain uniqueness and request hashes. An old network retry must not
        // recreate a paid task after its serialized response has expired.
        counts.replays =
          (
            await tx.query(
              "UPDATE request_replays SET response='{}',revoked_at=now() WHERE (actor_id,action,key) IN (SELECT actor_id,action,key FROM request_replays WHERE revoked_at IS NULL AND created_at<now()-interval '7 days' ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT $1)",
              [limit * 10],
            )
          ).rowCount ?? 0;
        counts.tool_results =
          (
            await tx.query(
              "UPDATE tool_operations SET result=NULL WHERE id IN (SELECT o.id FROM tool_operations o JOIN tasks t ON t.id=o.task_id WHERE o.result IS NOT NULL AND o.created_at<now()-interval '7 days' AND t.status IN ('succeeded','failed','cancelled') ORDER BY o.created_at,o.id FOR UPDATE OF o SKIP LOCKED LIMIT $1)",
              [limit * 10],
            )
          ).rowCount ?? 0;
        return counts;
      },
      undefined,
      true,
    );
  }
  async purgeRuntime(limit = 10) {
    const candidates = (
      await this.db.control.query(
        "SELECT task_id FROM runtime_cache_purges WHERE state='queued' AND next_attempt_at<=now() ORDER BY next_attempt_at,task_id LIMIT $1",
        [limit],
      )
    ).rows;
    for (const { task_id: id } of candidates) {
      if (this.active(id)) continue;
      await this.db.tx(
        async (tx) => {
          const job = (
            await tx.query(
              "SELECT p.*,t.status FROM runtime_cache_purges p JOIN tasks t ON t.id=p.task_id WHERE p.task_id=$1 AND p.state='queued' AND p.next_attempt_at<=now() FOR UPDATE OF p,t SKIP LOCKED",
              [id],
            )
          ).rows[0];
          if (
            !job ||
            this.active(id) ||
            !["succeeded", "failed", "cancelled"].includes(job.status)
          )
            return;
          try {
            await this.storage.removeRuntime(job.tenant_id, id);
            await tx.query(
              "UPDATE runtime_cache_purges SET state='completed',attempts=attempts+1,completed_at=now(),error_code=NULL WHERE task_id=$1",
              [id],
            );
          } catch (e) {
            const c = (e as NodeJS.ErrnoException).code;
            const code =
              e instanceof Error && /^ERASURE_/.test(e.message)
                ? e.message
                : ["EBUSY", "EPERM", "EACCES"].includes(c ?? "")
                  ? "RUNTIME_CACHE_BUSY"
                  : "RUNTIME_CACHE_CLEANUP_FAILED";
            await tx.query(
              "UPDATE runtime_cache_purges SET state=CASE WHEN attempts>=7 THEN 'failed' ELSE 'queued' END,attempts=attempts+1,error_code=$2,next_attempt_at=now()+make_interval(secs=>least(3600,30*(attempts+1))) WHERE task_id=$1",
              [id, code],
            );
          }
        },
        undefined,
        true,
      );
    }
  }
}
