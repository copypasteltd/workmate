import type { Database } from "./db.js";
import { settle } from "./billing.js";
import { event } from "./tasks.js";

/** Only an unclaimed task can be re-dispatched. A running/uncertain model or
 * external operation is never re-executed through this repair path. */
export async function recoverQueuedClaims(db: Database) {
  return db.tx(
    async (tx) => {
      const tasks = (
        await tx.query(
          "SELECT * FROM tasks WHERE status='queued' AND data_mode=$1 AND next_claim_retry_at<=now() ORDER BY next_claim_retry_at,id FOR UPDATE SKIP LOCKED LIMIT 20",
          [db.config.DEMO_MODE ? "simulated" : "configured_services"],
        )
      ).rows;
      let repaired = 0;
      for (const t of tasks) {
        const outbox = (
          await tx.query(
            "SELECT * FROM outbox WHERE topic='task.run' AND payload->>'task_id'=$1 ORDER BY created_at DESC,id DESC LIMIT 1",
            [t.id],
          )
        ).rows[0];
        if (outbox && !outbox.dispatched_at) {
          await tx.query(
            "UPDATE tasks SET next_claim_retry_at=now()+interval '1 minute' WHERE id=$1",
            [t.id],
          );
          continue;
        }
        // Queue identity can only inspect queue state; it cannot read customer
        // content. Existing queue jobs take precedence over a recovery request.
        const job = outbox?.queue_job_id
          ? (
              await db.queue.query(
                "SELECT state FROM pgboss.job WHERE id=$1 AND name='task.run'",
                [outbox.queue_job_id],
              )
            ).rows[0]
          : (
              await db.queue.query(
                "SELECT state FROM pgboss.job WHERE name='task.run' AND data->>'task'=$1 ORDER BY created_on DESC LIMIT 1",
                [t.id],
              )
            ).rows[0];
        if (job && ["created", "retry", "active"].includes(job.state)) {
          await tx.query(
            "UPDATE tasks SET next_claim_retry_at=now()+interval '1 minute' WHERE id=$1",
            [t.id],
          );
          continue;
        }
        if (
          t.content_state !== "active" ||
          t.cancel_requested ||
          t.claim_retry_count >= 8
        ) {
          await settle(tx, t.tenant_id, t.id, 0, t.created_by);
          const status =
            t.content_state !== "active" || t.cancel_requested
              ? "cancelled"
              : "failed";
          await tx.query(
            "UPDATE tasks SET status=$2,error_code='CLAIM_RECOVERY_EXHAUSTED',version=version+1,updated_at=now() WHERE id=$1",
            [t.id, status],
          );
          if (t.content_state === "active")
            await event(tx, t.tenant_id, t.id, "task.finished", {
              status,
              error_code: "CLAIM_RECOVERY_EXHAUSTED",
            });
        } else {
          await tx.query(
            "INSERT INTO outbox(tenant_id,topic,payload) VALUES($1,'task.run',$2)",
            [t.tenant_id, { task_id: t.id }],
          );
          await tx.query(
            "UPDATE tasks SET claim_retry_count=claim_retry_count+1,next_claim_retry_at=now()+make_interval(secs=>least(3600,60*power(2,claim_retry_count)::int)) WHERE id=$1",
            [t.id],
          );
          await event(tx, t.tenant_id, t.id, "task.dispatch_recovered", {});
          repaired++;
        }
      }
      return repaired;
    },
    undefined,
    true,
  );
}
