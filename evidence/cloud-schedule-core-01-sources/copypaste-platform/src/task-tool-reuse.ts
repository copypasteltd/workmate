import type { Tx } from "./db.js";
import { canonical, hash, Problem } from "./lib.js";

export async function lockTaskTools(tx: Tx, taskId: string) {
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [
    "task-tool:" + taskId,
  ]);
}

function identifiers(value: unknown, found = new Set<string>()): string[] {
  if (
    typeof value === "string" &&
    /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value)
  )
    found.add(value);
  else if (value && typeof value === "object")
    for (const child of Object.values(value)) identifiers(child, found);
  return [...found];
}

/** Only completed transactional writes are reused, and only in a later native
 * attempt of this task. Ordinary reads always recheck and read current sources. */
export async function reuseCompletedTaskTool(
  tx: Tx,
  task: any,
  fencing: string,
  name: string,
  callId: string,
  input: unknown,
  effect: () => Promise<unknown>,
) {
  const digest = hash(canonical(input));
  const old =
    task.attempt > 1
      ? (
          await tx.query(
            `SELECT * FROM task_tool_receipts
    WHERE task_id=$1 AND tool_name=$2 AND input_hash=$3 AND attempt<$4 ORDER BY attempt DESC,created_at DESC LIMIT 1`,
            [task.id, name, digest, task.attempt],
          )
        ).rows[0]
      : null;
  if (old) {
    if (old.output_version_ids.length) {
      const available = (
        await tx.query(
          `SELECT v.id FROM asset_versions v JOIN assets a ON a.id=v.asset_id
        WHERE v.id=ANY($1::uuid[]) AND a.state='active' AND a.retention_expires_at>clock_timestamp()
        AND v.erased_at IS NULL AND task_asset_version_sources_available(v.id)`,
          [old.output_version_ids],
        )
      ).rowCount;
      if (available !== old.output_version_ids.length)
        throw new Problem(
          409,
          "COMPLETED_TOOL_OUTPUT_UNAVAILABLE",
          "A completed operation's output is no longer available; do not recreate it automatically",
        );
    }
    if (
      ["video_project_queue", "video_project_edit", "video_project_render"].includes(name) &&
      !(
        await tx.query(
          `SELECT 1 FROM creative_projects p JOIN video_renders r ON r.video_id=p.id
           WHERE p.id=$1 AND p.project_id=$2 AND p.kind='video' AND p.content_state='active'
           AND p.retention_expires_at>clock_timestamp() AND r.id=$3 AND r.version=$4`,
          [old.result.project.id, task.project_id, old.result.render.id, old.result.project.version],
        )
      ).rowCount
    )
      throw new Problem(
        409,
        "COMPLETED_TOOL_OUTPUT_UNAVAILABLE",
        "The previously queued video project is no longer available",
      );
    return old.result;
  }
  const result = await effect();
  const ids = identifiers(result);
  const versions = ids.length
    ? (
        await tx.query(
          "SELECT id FROM asset_versions WHERE metadata->>'task_id'=$1 AND (id=ANY($2::uuid[]) OR asset_id=ANY($2::uuid[])) ORDER BY id",
          [task.id, ids],
        )
      ).rows.map((v) => v.id)
    : [];
  await tx.query(
    `INSERT INTO task_tool_receipts(tenant_id,project_id,task_id,attempt,fencing_token,call_id,tool_name,input_hash,result,output_version_ids)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [
      task.tenant_id,
      task.project_id,
      task.id,
      task.attempt,
      fencing,
      callId,
      name,
      digest,
      JSON.stringify(result),
      versions,
    ],
  );
  return result;
}
