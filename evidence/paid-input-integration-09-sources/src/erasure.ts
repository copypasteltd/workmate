import { randomUUID } from "node:crypto";
import type { Database, Tx } from "./db.js";
import type { Storage } from "./storage.js";
import { eraseReplayContent } from "./access.js";

const targets = new Set([
  "assets",
  "tasks",
  "agents",
  "conversations",
  "memories",
  "brand_profiles",
  "analytics_datasets",
  "workflows",
  "workflow_runs",
  "workflow_schedules",
  "creative_projects",
  "workspace_nodes",
]);
const activeStates = [
  "queued",
  "running",
  "paused",
  "awaiting_approval",
  "reconciling",
  "needs_input",
];
function errorCode(e: unknown) {
  const code = (e as NodeJS.ErrnoException)?.code;
  if (code === "EBUSY" || code === "EPERM" || code === "EACCES")
    return "ERASURE_STORAGE_BUSY";
  if (e instanceof Error && /^ERASURE_/.test(e.message)) return e.message;
  return "ERASURE_IO_FAILED";
}
export class ErasureService {
  private lastOrphanSweep = 0;
  constructor(
    private db: Database,
    private storage: Storage,
    private runtimeActive = (_id: string) => false,
  ) {}
  async advance(limit = 2) {
    for (let n = 0; n < limit; n++) {
      const token = randomUUID();
      const job = await this.db.tx(
        async (tx) => {
          const row = (
            await tx.query(
              "SELECT * FROM deletion_jobs WHERE state IN ('queued','cleaning') AND next_attempt_at<=now() AND (lease_until IS NULL OR lease_until<now()) ORDER BY next_attempt_at,id FOR UPDATE SKIP LOCKED LIMIT 1",
            )
          ).rows[0];
          if (!row) return null;
          await tx.query(
            "UPDATE deletion_jobs SET state='cleaning',lease_token=$2,lease_until=now()+interval '2 minutes',attempts=attempts+1 WHERE id=$1",
            [row.id, token],
          );
          return row;
        },
        undefined,
        true,
      );
      if (!job) break;
      try {
        await this.clean(job.id, token);
      } catch (e) {
        // The current transaction (including item results) rolled back. An
        // already removed object is safe to remove again on the next attempt.
        await this.db.control.query(
          "UPDATE deletion_jobs SET state=CASE WHEN attempts>=8 THEN 'failed' ELSE 'queued' END,exceptions=$3,next_attempt_at=now()+make_interval(secs=>least(3600,30*attempts)),lease_until=NULL,lease_token=NULL WHERE id=$1 AND lease_token=$2",
          [job.id, token, JSON.stringify([errorCode(e)])],
        );
      }
    }
    if (Date.now() - this.lastOrphanSweep > 60_000) {
      this.lastOrphanSweep = Date.now();
      await this.sweepOrphans();
    }
  }
  private async clean(id: string, token: string) {
    await this.db.tx(
      async (tx) => {
        const job = (
          await tx.query(
            "SELECT * FROM deletion_jobs WHERE id=$1 AND lease_token=$2 FOR UPDATE",
            [id, token],
          )
        ).rows[0];
        if (!job) return;
        if (!targets.has(job.target_type))
          throw new Error("ERASURE_TARGET_INVALID");
        const row = (
          await tx.query(
            `SELECT * FROM ${job.target_type} WHERE id=$1 FOR UPDATE`,
            [job.target_id],
          )
        ).rows[0];
        const state =
          job.target_type === "assets" ? row?.state : row?.content_state;
        if (row && state !== "deleted")
          throw new Error("ERASURE_TARGET_NOT_DELETED");
        if (
          job.target_type === "tasks" &&
          row &&
          (activeStates.includes(row.status) || this.runtimeActive(row.id))
        ) {
          await tx.query(
            "UPDATE deletion_jobs SET state='queued',next_attempt_at=now()+interval '30 seconds',lease_until=NULL,lease_token=NULL,attempts=greatest(0,attempts-1),exceptions='[\"WAITING_FOR_EXECUTION_TO_CLOSE\"]' WHERE id=$1",
            [id],
          );
          return;
        }
        // Only a verified deleted target enters controlled content erasure.
        // Immutable source bindings allow this transaction to scrub their data.
        await tx.query("SELECT set_config('app.erasing_content','true',true)");
        await this.scrub(tx, job);
        const items = (
          await tx.query(
            "SELECT * FROM deletion_items WHERE job_id=$1 AND state<>'completed' ORDER BY id FOR UPDATE",
            [id],
          )
        ).rows;
        for (const item of items) {
          try {
            if (item.kind === "object") {
              await tx.query(
                "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
                ["object:" + item.locator],
              );
              // Legacy copies may share a key. Retain the bytes until the last
              // live/quarantined reference is deleted, without exposing them.
              const live = await tx.query(
                "SELECT 1 FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.storage_key=$1 AND a.state<>'deleted' LIMIT 1",
                [item.locator],
              );
              if (!live.rowCount) {
                await tx.query(
                  "INSERT INTO object_erasure_tombstones(storage_key) VALUES($1) ON CONFLICT DO NOTHING",
                  [item.locator],
                );
                await this.storage.remove(item.locator);
              }
              await tx.query(
                "UPDATE asset_versions SET erased_at=now(),metadata='{}' WHERE asset_id=$1 AND storage_key=$2",
                [job.target_id, item.locator],
              );
            } else if (item.kind === "upload")
              await this.storage.removeUpload(item.locator);
            else await this.storage.removeRuntime(job.tenant_id, item.locator);
            await tx.query(
              "UPDATE deletion_items SET state='completed',attempts=attempts+1,error_code=NULL,completed_at=now() WHERE id=$1",
              [item.id],
            );
          } catch (e) {
            // Per-item failure is persisted; other items still make progress.
            await tx.query(
              "UPDATE deletion_items SET state='failed',attempts=attempts+1,error_code=$2 WHERE id=$1",
              [item.id, errorCode(e)],
            );
          }
        }
        const children = (
          await tx.query(
            "SELECT d.state FROM deletion_dependencies e JOIN deletion_jobs d ON d.id=e.child_job_id WHERE e.job_id=$1 AND d.state<>'completed'",
            [id],
          )
        ).rows;
        const failures = (
          await tx.query(
            "SELECT DISTINCT error_code FROM deletion_items WHERE job_id=$1 AND state='failed'",
            [id],
          )
        ).rows.map((r) => r.error_code);
        if (children.length)
          failures.push(
            children.some((c) => c.state === "failed")
              ? "DEPENDENT_ERASURE_FAILED"
              : "WAITING_FOR_DEPENDENT_ERASURE",
          );
        if (
          failures.length === 1 &&
          failures[0] === "WAITING_FOR_DEPENDENT_ERASURE"
        ) {
          await tx.query(
            "UPDATE deletion_jobs SET state='queued',exceptions=$2,attempts=greatest(0,attempts-1),next_attempt_at=now()+interval '30 seconds',lease_until=NULL,lease_token=NULL WHERE id=$1",
            [id, JSON.stringify(failures)],
          );
          return;
        }
        await tx.query(
          "UPDATE deletion_jobs SET state=$2,exceptions=$3,completed_at=CASE WHEN $2='completed' THEN now() END,next_attempt_at=now()+make_interval(secs=>least(3600,30*attempts)),lease_until=NULL,lease_token=NULL WHERE id=$1",
          [
            id,
            failures.length
              ? job.attempts >= 8
                ? "failed"
                : "queued"
              : "completed",
            JSON.stringify(failures),
          ],
        );
      },
      undefined,
      true,
    );
  }
  private async scrub(tx: Tx, j: any) {
    const id = j.target_id;
    await eraseReplayContent(tx, [id]);
    switch (j.target_type) {
      case "workspace_nodes":
        await tx.query(
          "UPDATE workspace_nodes SET name='[deleted]',asset_version_id=NULL WHERE id=$1",
          [id],
        );
        break;
      case "assets":
        await tx.query("UPDATE assets SET name='[deleted]' WHERE id=$1", [id]);
        await tx.query(
          "UPDATE upload_sessions SET filename='[deleted]',result=NULL WHERE result->>'id'=$1",
          [id],
        );
        break;
      case "tasks":
        await tx.query(
          "UPDATE conversations SET version=version+1,updated_at=now() WHERE id IN (SELECT conversation_id FROM conversation_messages WHERE task_id=$1)",
          [id],
        );
        await tx.query("DELETE FROM conversation_messages WHERE task_id=$1", [
          id,
        ]);
        await tx.query(
          "UPDATE tasks SET title='[deleted]',prompt='[deleted]',output=NULL,input_context='{}',runtime_thread=NULL,runtime_turn=NULL WHERE id=$1",
          [id],
        );
        await tx.query("DELETE FROM task_events WHERE task_id=$1", [id]);
        await tx.query("DELETE FROM task_plans WHERE task_id=$1", [id]);
        await tx.query("DELETE FROM task_input_checkpoints WHERE task_id=$1", [
          id,
        ]);
        await tx.query("DELETE FROM task_tool_receipts WHERE task_id=$1", [id]);
        await tx.query(
          "UPDATE tool_operations SET result=NULL WHERE task_id=$1",
          [id],
        );
        // Private derivatives belong to this erased task; explicitly published
        // project copies have their own immutable objects and survive.
        await tx.query(
          "UPDATE assets SET state='deleted',moderation_version=moderation_version+1 WHERE private_owner IS NOT NULL AND id IN (SELECT asset_id FROM asset_versions WHERE metadata->>'task_id'=$1)",
          [id],
        );
        await tx.query(
          "INSERT INTO deletion_dependencies(job_id,child_job_id) SELECT $2,d.id FROM deletion_jobs d JOIN asset_versions v ON d.target_type='assets' AND d.target_id=v.asset_id WHERE v.metadata->>'task_id'=$1 ON CONFLICT DO NOTHING",
          [id, j.id],
        );
        break;
      case "memories":
        await tx.query(
          "UPDATE memory_versions SET content=NULL WHERE memory_id=$1",
          [id],
        );
        await tx.query("UPDATE memories SET name='[deleted]' WHERE id=$1", [
          id,
        ]);
        break;
      case "agents":
        await tx.query(
          "UPDATE agent_versions SET body='{}' WHERE agent_id=$1",
          [id],
        );
        await tx.query("UPDATE agents SET name='[deleted]' WHERE id=$1", [id]);
        break;
      case "conversations":
        await tx.query(
          "DELETE FROM conversation_messages WHERE conversation_id=$1",
          [id],
        );
        await tx.query(
          "UPDATE conversations SET name='[deleted]' WHERE id=$1",
          [id],
        );
        break;
      case "brand_profiles":
      case "creative_projects":
        if (j.target_type === "creative_projects") {
          const videoOutputs = (
            await tx.query(
              "SELECT unnest(ARRAY[mp4_asset_id,project_asset_id,script_asset_id,storyboard_asset_id,subtitles_asset_id,probe_asset_id]) AS id FROM video_renders WHERE video_id=$1",
              [id],
            )
          ).rows
            .map((a) => a.id)
            .filter(Boolean);
          if (videoOutputs.length) {
            await tx.query(
              "UPDATE assets SET state='deleted',moderation_version=moderation_version+1 WHERE id=ANY($1::uuid[]) AND state<>'deleted'",
              [videoOutputs],
            );
            await tx.query(
              "INSERT INTO deletion_dependencies(job_id,child_job_id) SELECT $2,d.id FROM deletion_jobs d WHERE d.target_type='assets' AND d.target_id=ANY($1::uuid[]) ON CONFLICT DO NOTHING",
              [videoOutputs, j.id],
            );
          }
          await tx.query(
            "SELECT set_config('app.erasing_content','true',true)",
          );
          await tx.query(
            "UPDATE video_project_versions SET definition='{}' WHERE video_id=$1 AND definition<>'{}'",
            [id],
          );
          await tx.query(
            "UPDATE video_renders SET probe='{}' WHERE video_id=$1 AND probe<>'{}'",
            [id],
          );
          await tx.query(
            "SELECT set_config('app.erasing_content','false',true)",
          );
          const units = (
            await tx.query(
              "SELECT id FROM creative_matrix_units WHERE batch_id=$1",
              [id],
            )
          ).rows.map((u) => u.id);
          if (units.length) {
            await eraseReplayContent(tx, units);
            const outputIds = (
              await tx.query(
                "SELECT unnest(ARRAY[png_asset_id,svg_asset_id,source_asset_id]) AS id FROM creative_matrix_attempts WHERE unit_id=ANY($1::uuid[])",
                [units],
              )
            ).rows
              .map((a) => a.id)
              .filter(Boolean);
            if (outputIds.length) {
              await tx.query(
                "UPDATE assets SET state='deleted',moderation_version=moderation_version+1 WHERE id=ANY($1::uuid[]) AND state<>'deleted'",
                [outputIds],
              );
              await tx.query(
                "INSERT INTO deletion_dependencies(job_id,child_job_id) SELECT $2,d.id FROM deletion_jobs d WHERE d.target_type='assets' AND d.target_id=ANY($1::uuid[]) ON CONFLICT DO NOTHING",
                [outputIds, j.id],
              );
            }
            await tx.query(
              "SELECT set_config('app.erasing_content','true',true)",
            );
            await tx.query(
              "UPDATE creative_matrix_revisions SET input='{}' WHERE unit_id=ANY($1::uuid[]) AND input<>'{}'",
              [units],
            );
            await tx.query(
              "SELECT set_config('app.erasing_content','false',true)",
            );
          }
        }
        await tx.query(
          `UPDATE ${j.target_type} SET name='[deleted]',body='{}' WHERE id=$1`,
          [id],
        );
        break;
      case "analytics_datasets":
        await tx.query("SELECT set_config('app.erasing_content','true',true)");
        await tx.query(
          "UPDATE analytics_datasets SET name='[deleted]',rows='[]',raw_csv=NULL,source_filename=NULL,source_sha256=NULL,import_key=NULL,spec_hash=NULL,import_spec=NULL,import_metadata=NULL,metric_snapshot=NULL,source_asset_version_id=NULL,supersedes_id=NULL,correction_ancestors='{}' WHERE id=$1",
          [id],
        );
        await tx.query("SELECT set_config('app.erasing_content','false',true)");
        break;
      case "workflows":
        await tx.query(
          "UPDATE workflows SET name='[deleted]',definition='{}' WHERE id=$1",
          [id],
        );
        break;
      case "workflow_runs":
        await tx.query(
          "UPDATE workflow_runs SET definition='{}',results='[]' WHERE id=$1",
          [id],
        );
        break;
      case "workflow_schedules":
        await tx.query(
          "UPDATE workflow_schedule_versions SET body='{}' WHERE schedule_id=$1",
          [id],
        );
        break;
    }
  }
  async sweepOrphans(before = new Date(Date.now() - 86_400_000)) {
    let removed = 0;
    for (const key of await this.storage.orphanCandidates(before)) {
      await this.db.tx(
        async (tx) => {
          await tx.query(
            "SELECT pg_advisory_xact_lock(hashtextextended($1,0))",
            ["object:" + key],
          );
          if (
            (
              await tx.query(
                "SELECT 1 FROM asset_versions WHERE storage_key=$1 LIMIT 1",
                [key],
              )
            ).rowCount
          )
            return;
          await tx.query(
            "INSERT INTO object_erasure_tombstones(storage_key) VALUES($1) ON CONFLICT DO NOTHING",
            [key],
          );
          await this.storage.remove(key);
          removed++;
        },
        undefined,
        true,
      );
    }
    return removed;
  }
}
