import type pg from "pg";

/** Called only inside the owner transaction on an isolated restored database.
 * Restoring a snapshot cannot prove what happened later on its physical nodes. */
export async function fenceRestoredDedicatedCloud(owner: Pick<pg.Client, "query">, restoreId: string) {
  if (!(await owner.query("SELECT to_regclass('public.cloud_runtime_sessions') AS name")).rows[0].name) return { sessions: 0, nodes: 0 };
  const environment = (await owner.query(`SELECT state,restore_id,
    (SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()) AS marker
    FROM recovery_environment WHERE singleton`)).rows[0];
  if (environment?.state !== "quarantined" || environment.restore_id !== restoreId || environment.marker !== "copypaste:recovery:" + restoreId)
    throw new Error("DEDICATED_RESTORE_ISOLATION_REQUIRED");
  await owner.query("SELECT pg_advisory_xact_lock(hashtextextended('dedicated-cloud-control',0))");
  const rows = (await owner.query(`UPDATE cloud_runtime_sessions SET state='reconciling',
    last_error='RESTORED_COMPUTER_REQUIRES_RECONCILIATION',version=version+1
    WHERE state IN('starting','running','stop_requested','reconciling') RETURNING id`)).rows;
  await owner.query(`INSERT INTO cloud_runtime_commands(tenant_id,project_id,private_owner,session_id,node_id,generation,kind,body)
    SELECT tenant_id,project_id,private_owner,id,node_id,generation,'stop','{"reason":"RESTORED_COMPUTER_REQUIRES_RECONCILIATION"}'::jsonb
    FROM cloud_runtime_sessions WHERE state='reconciling' ON CONFLICT DO NOTHING`);
  await owner.query(`UPDATE cloud_runtime_holds SET state='reconciling' WHERE state='reserved'
    AND session_id IN(SELECT id FROM cloud_runtime_sessions WHERE state='reconciling')`);
  // Preserve the original credential only for an owned computer's stop protocol.
  // Idle restored nodes require a new administrator credential rotation. The
  // database marker and service CONNECT fence remain independently enforced.
  const nodes = await owner.query(`UPDATE cloud_runtime_nodes n SET
    state=CASE WHEN EXISTS(SELECT 1 FROM cloud_runtime_sessions s WHERE s.node_id=n.id AND s.state='reconciling') THEN 'draining' ELSE 'quarantined' END,
    instance_id=NULL,last_heartbeat_at=NULL,version=version+1 RETURNING id`);
  await owner.query("DELETE FROM cloud_runtime_frames");
  await owner.query("UPDATE cloud_runtime_task_bindings SET revoked=true WHERE NOT revoked");
  await owner.query(`UPDATE tasks SET cancel_requested=true,version=version+1
    WHERE id IN(SELECT task_id FROM cloud_runtime_task_bindings)
    AND status IN('queued','running','paused','awaiting_approval','reconciling','needs_input') AND NOT cancel_requested`);
  return { sessions: rows.length, nodes: nodes.rowCount ?? 0 };
}
