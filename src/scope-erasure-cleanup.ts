import type { Tx } from "./db.js";
import { eraseReplayContent } from "./access.js";
import { requestTaskCancellation } from "./task-control.js";
import { eraseDedicatedQuote, eraseDedicatedSession } from "./dedicated-cloud-erasure.js";
import { erasePublicationContent } from "./publication-erasure.js";

export const contentErasureTargets = ["assets", "tasks", "agents", "conversations", "memories", "brand_profiles",
  "analytics_datasets", "creative_mappings", "creative_feedback_reports", "geo_experiments", "geo_runs", "geo_samples",
  "workflows", "workflow_runs", "workflow_schedules", "creative_projects", "workspace_nodes", "agent_groups", "agent_group_runs",
  "cloud_runtime_quotes", "cloud_runtime_sessions"] as const;

export const scopeRetentionExceptions = ["RETAINED_FINANCIAL_AUDIT_FACTS", "GLOBAL_USER_ACCOUNTS_OUTSIDE_SCOPE", "DIRECTORY_EXPORT_METADATA_UNTIL_SHORT_EXPIRY", "BACKUPS_REQUIRE_ERASURE_REPLAY", "CUSTOMER_LOCAL_FILES_OUTSIDE_SCOPE"];

type ScopeJob = { id: string; tenant_id: string; target_type: "projects" | "tenants"; target_id: string };
type ErasureTx = Pick<Tx, "query">;
const filter = (alias = "") => `${alias}tenant_id=$1 AND ($2::uuid IS NULL OR ${alias}project_id=$2)`;
const values = (j: ScopeJob) => [j.tenant_id, j.target_type === "projects" ? j.target_id : null];
async function authorizeErasure(tx: ErasureTx, j: ScopeJob) {
  await tx.query("SELECT set_config('app.erasing_content','true',true),set_config('app.scope_erasure_job',$1,true)", [j.id]);
  const ok = (await tx.query("SELECT scope_erasure_authorized($1,jsonb_build_object('tenant_id',$2::text,'project_id',$3::text)) AS ok",
    [j.target_type, j.tenant_id, j.target_type === "projects" ? j.target_id : null])).rows[0].ok;
  if (!ok) throw new Error("ERASURE_SCOPE_AUTHORITY_REQUIRED");
}

/** Rescan the permanent scope on every pass. No project/tenant row lock is held
 * while acquiring child locks; the irreversible fence prevents new admission. */
export async function prepareScopeErasure(tx: Tx, j: ScopeJob, quarantined = false) {
  await authorizeErasure(tx, j);
  const args = values(j);
  if (j.target_type === "tenants") {
    await tx.query("UPDATE projects SET archived=true,erasure_requested_at=coalesce(erasure_requested_at,clock_timestamp()) WHERE tenant_id=$1 AND erasure_requested_at IS NULL", [j.tenant_id]);
    await tx.query(`UPDATE memories SET content_state='deleted',moderation_version=moderation_version+1
      WHERE tenant_id=$1 AND project_id IS NULL AND content_state<>'deleted'`, [j.tenant_id]);
    await tx.query(`INSERT INTO deletion_dependencies(job_id,child_job_id) SELECT $1,d.id FROM deletion_jobs d
      WHERE d.tenant_id=$2 AND d.id<>$1 ON CONFLICT DO NOTHING`, [j.id, j.tenant_id]);
    return;
  }
  await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('dedicated-cloud-control',0))");
  const tasks = (await tx.query(`SELECT * FROM tasks WHERE ${filter()} ORDER BY id FOR UPDATE`, args)).rows;
  for (const task of tasks) {
    if (!quarantined) await requestTaskCancellation(tx, task);
    else if (!task.cancel_requested) await tx.query("UPDATE tasks SET cancel_requested=true,version=version+1 WHERE id=$1", [task.id]);
  }
  await expandScopeContent(tx, j);
  await eraseScopeIngress(tx, j);
  await tx.query(`INSERT INTO deletion_dependencies(job_id,child_job_id) SELECT $1,d.id FROM deletion_jobs d
    WHERE d.tenant_id=$2 AND d.project_id=$3 AND d.id<>$1 AND d.target_type<>'tenants' ON CONFLICT DO NOTHING`, [j.id, j.tenant_id, j.target_id]);
}

async function expandScopeContent(tx: ErasureTx, j: ScopeJob) {
  const args = values(j);
  for (const table of contentErasureTargets) {
    if (table === "cloud_runtime_sessions") {
      for (const row of (await tx.query(`SELECT id FROM cloud_runtime_sessions WHERE ${filter()} ORDER BY id`, args)).rows) await eraseDedicatedSession(tx, row.id);
      await authorizeErasure(tx, j);
      continue;
    }
    if (table === "cloud_runtime_quotes") {
      for (const row of (await tx.query(`SELECT id FROM cloud_runtime_quotes WHERE ${filter()} ORDER BY id`, args)).rows) await eraseDedicatedQuote(tx, row.id);
      await authorizeErasure(tx, j);
      continue;
    }
    const column = table === "assets" ? "state" : "content_state";
    const counters = (await tx.query(`SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1
      AND column_name IN('version','moderation_version') AND data_type IN('integer','bigint')`, [table])).rows;
    const bump = counters.map(r => `,"${r.column_name}"="${r.column_name}"+1`).join("");
    await tx.query(`UPDATE ${table} SET ${column}='deleted'${bump} WHERE ${filter()} AND ${column}<>'deleted'`, args);
  }
}

/** The isolated restore applies the complete root scope, including backup-only
 * rows, before materializing objects. It never settles or frees any funds. */
export async function replayScopeErasure(tx: ErasureTx, kind: "projects" | "tenants", id: string, tenant: string) {
  if (!(await tx.query("SELECT 1 FROM recovery_environment WHERE singleton AND state='quarantined'")).rowCount) throw new Error("ERASURE_RECOVERY_FENCE_REQUIRED");
  if (kind === "tenants") {
    await tx.query("UPDATE tenants SET status='suspended',erasure_requested_at=coalesce(erasure_requested_at,clock_timestamp()) WHERE id=$1", [id]);
    await tx.query("UPDATE projects SET archived=true,erasure_requested_at=coalesce(erasure_requested_at,clock_timestamp()) WHERE tenant_id=$1", [id]);
  } else await tx.query("UPDATE projects SET archived=true,erasure_requested_at=coalesce(erasure_requested_at,clock_timestamp()) WHERE id=$1 AND tenant_id=$2", [id, tenant]);
  const jobs = (await tx.query(`SELECT * FROM deletion_jobs WHERE tenant_id=$1 AND target_type='projects' AND ($2::uuid IS NULL OR target_id=$2) ORDER BY target_id`, [tenant, kind === "projects" ? id : null])).rows;
  for (const job of jobs) {
    await authorizeErasure(tx, job);
    await tx.query("UPDATE tasks SET cancel_requested=true,version=version+1 WHERE project_id=$1 AND NOT cancel_requested", [job.target_id]);
    await expandScopeContent(tx, job);
    await eraseScopeIngress(tx, job);
  }
  if (kind === "tenants") await tx.query("UPDATE memories SET content_state='deleted',moderation_version=moderation_version+1 WHERE tenant_id=$1 AND project_id IS NULL AND content_state<>'deleted'", [tenant]);
}

async function eraseScopeIngress(tx: ErasureTx, j: ScopeJob) {
  await authorizeErasure(tx, j);
  const args = values(j), f = filter();
  await tx.query(`UPDATE connections SET state='revoked',encrypted_secret=NULL,name='[deleted]',scopes='{}' WHERE ${f}`, args);
  await tx.query(`UPDATE oauth_states SET encrypted_verifier='',consumed_at=coalesce(consumed_at,clock_timestamp()) WHERE ${f}`, args);
  await tx.query(`UPDATE connector_oauth_states SET encrypted_verifier='',encrypted_state='',consumed_at=coalesce(consumed_at,clock_timestamp())
    WHERE connection_id IN(SELECT id FROM connections WHERE ${f})`, args);
  await tx.query(`UPDATE connector_accounts SET body='{}' WHERE connection_id IN(SELECT id FROM connections WHERE ${f})`, args);
  await tx.query(`UPDATE connector_profiles SET account_ids='{}',project_ids='{}' WHERE ${f}`, args);
  await tx.query(`UPDATE connector_jobs SET specification='{}',encrypted_cursor=NULL,cursor_hashes='{}',limitations='{}',lease_token=NULL,lease_until=NULL,
    state=CASE WHEN state IN('queued','running') THEN 'cancelled' ELSE state END,finished_at=coalesce(finished_at,clock_timestamp()),revision=revision+1 WHERE ${f}`, args);
  await tx.query(`UPDATE cloud_schedule_versions SET body='{}' WHERE ${f}`, args);
  await tx.query(`UPDATE cloud_schedules SET name='[Removed]',state='retired',content_state='deleted',next_due_at=NULL,version=version+1 WHERE ${f} AND content_state<>'deleted'`, args);
  await tx.query(`UPDATE cloud_schedule_requests SET body='{}',content_state='deleted' WHERE ${f} AND content_state<>'deleted'`, args);
  for (const event of (await tx.query(`SELECT id FROM cloud_event_triggers WHERE ${f} ORDER BY id`, args)).rows)
    await tx.query("SELECT erase_cloud_event_content($1)", [event.id]);
  await tx.query(`UPDATE cloud_event_requests SET body='{}',content_state='deleted' WHERE ${f} AND content_state<>'deleted'`, args);
  for (const publication of (await tx.query(`SELECT id FROM publication_operations WHERE ${f} AND erased_at IS NULL ORDER BY id`, args)).rows)
    await erasePublicationContent(tx, publication.id, j.id);
  await tx.query(`UPDATE publication_oauth_states SET encrypted_state='',encrypted_cookie='',consumed_at=coalesce(consumed_at,clock_timestamp()) WHERE ${f}`, args);
  await tx.query(`UPDATE publication_policies SET body='{}' WHERE ${f} AND body<>'{}'::jsonb`, args);
  const orphanedConnections = (await tx.query(`SELECT c.id FROM publication_connections c WHERE c.tenant_id=$1
    AND ($2::uuid IS NULL OR (EXISTS(SELECT 1 FROM publication_connection_projects p WHERE p.connection_id=c.id AND p.project_id=$2)
      AND NOT EXISTS(SELECT 1 FROM publication_connection_projects p JOIN projects root ON root.id=p.project_id WHERE p.connection_id=c.id AND root.erasure_requested_at IS NULL AND p.project_id<>$2))) ORDER BY c.id`, args)).rows.map(r => r.id);
  // Retain only grant IDs as provenance. Deleted roots make them unusable; they
  // also fence a delayed OAuth callback from repopulating an orphan's secret.
  if (orphanedConnections.length) {
    await tx.query(`UPDATE publication_connections SET state='disconnected',encrypted_secret=NULL,external_user_id=NULL,scopes='{}',auth_version=auth_version+1,version=version+1,updated_at=clock_timestamp() WHERE id=ANY($1::uuid[])`, [orphanedConnections]);
    await tx.query(`UPDATE publication_targets SET enabled=false,encrypted_secret=NULL,name='[deleted]',capabilities='{}',auth_version=auth_version+1 WHERE connection_id=ANY($1::uuid[])`, [orphanedConnections]);
  }
  await tx.query(`UPDATE shares SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE tenant_id=$1 AND asset_id IN(SELECT id FROM assets WHERE ${f})`, args);
  const previews = (await tx.query(`SELECT id,specification FROM publication_previews WHERE ${f} AND erased_at IS NULL FOR UPDATE`, args)).rows;
  for (const row of previews) {
    for (const source of row.specification.sources ?? []) await tx.query("INSERT INTO deletion_items(job_id,kind,locator) VALUES($1,'object',$2) ON CONFLICT DO NOTHING", [j.id, source.storage_key]);
    await tx.query("UPDATE publication_previews SET specification='{}',erased_at=clock_timestamp() WHERE id=$1", [row.id]);
  }
  // Completed and unfinished uploads both own transient bytes. Original asset
  // versions are cleaned separately; cancellation does not delete shared keys.
  await tx.query(`INSERT INTO deletion_items(job_id,kind,locator) SELECT $3,'upload',id::text FROM upload_sessions WHERE ${f} ON CONFLICT DO NOTHING`, [...args, j.id]);
  await tx.query(`UPDATE upload_sessions SET state=CASE WHEN state='pending' OR conversation_id IS NOT NULL OR source_task_id IS NOT NULL THEN 'cancelled' ELSE state END,filename='[deleted]',result=NULL WHERE ${f}`, args);
  await tx.query(`UPDATE device_commands SET payload='{}',result=NULL,state=CASE WHEN state IN('pending','claimed') THEN 'cancelled' ELSE state END
    WHERE tenant_id=$1 AND ($2::uuid IS NULL OR task_id IN(SELECT id FROM tasks WHERE project_id=$2))`, args);
  await tx.query(`UPDATE skill_installations SET enabled=false,state=CASE WHEN state='revoked' THEN state ELSE 'uninstalled' END,version=version+1,updated_at=clock_timestamp() WHERE ${f} AND (enabled OR state='installed')`, args);
  await tx.query(`UPDATE support_grants SET revoked_at=coalesce(revoked_at,clock_timestamp()) WHERE tenant_id=$1 AND ($2::uuid IS NULL OR $2=ANY(project_ids))`, args);
  await tx.query(`UPDATE support_sessions SET revoked_at=coalesce(revoked_at,clock_timestamp()),body_granted=CASE WHEN $2::uuid IS NULL THEN false ELSE body_granted END WHERE tenant_id=$1 AND
    ($2::uuid IS NULL OR id IN(SELECT id FROM support_session_contexts WHERE $2=ANY(project_ids)))`, args);
}

/** Called only after child executions, objects and runtime cleanup have closed. */
export async function finishScopeErasure(tx: Tx, j: ScopeJob) {
  await authorizeErasure(tx, j);
  const args = values(j), f = filter();
  await eraseScopeIngress(tx, j);
  await tx.query(`UPDATE project_configurations SET name='[deleted]',draft='{}',content_state='deleted',moderation_version=moderation_version+1
    WHERE ${f} AND (content_state<>'deleted' OR name<>'[deleted]' OR draft<>'{}'::jsonb)`, args);
  await tx.query(`UPDATE solution_versions SET definition=jsonb_build_object('project_id',project_id),frozen='[{}]',state='disabled',
    disabled_at=coalesce(disabled_at,clock_timestamp()),disable_reason='SCOPE_ERASED' WHERE ${f}`, args);
  await tx.query(`UPDATE solution_installations SET name='[deleted]',bindings='{"assets":[],"connectors":[]}',revision=revision+1,updated_at=clock_timestamp() WHERE ${f}`, args);
  await tx.query(`UPDATE solution_trials SET bindings='{}',resolved_sources='[]' WHERE ${f}`, args);
  await tx.query(`UPDATE agent_template_preflights SET result='{}' WHERE ${f}`, args);
  await tx.query(`DELETE FROM agent_adoption_previews WHERE ${f}`, args);
  await tx.query(`UPDATE agent_group_preflights SET definition='{}',erased_at=clock_timestamp() WHERE ${f} AND erased_at IS NULL`, args);
  await tx.query(`UPDATE desktop_executions SET credential_cipher=NULL,credential_hash=NULL,credential_expires_at=NULL,
    state=CASE WHEN state='running' AND EXISTS(SELECT 1 FROM recovery_environment WHERE singleton AND state='quarantined') THEN 'reconciling' ELSE state END WHERE ${f}
    AND (NOT EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id AND t.status IN('queued','running','paused','awaiting_approval','needs_input','reconciling'))
      OR EXISTS(SELECT 1 FROM recovery_environment WHERE singleton AND state='quarantined'))`, args);
  const ids = [j.target_id, ...(await tx.query(`SELECT id FROM deletion_jobs WHERE tenant_id=$1 AND ($2::uuid IS NULL OR project_id=$2)`, args)).rows.map(r => r.id)];
  for (const table of contentErasureTargets) ids.push(...(await tx.query(`SELECT id FROM ${table} WHERE ${f}`, args)).rows.map(r => r.id));
  const side = ["project_configurations", "solution_versions", "solution_installations", "solution_trials", "cloud_schedule_requests", "cloud_schedules", "cloud_event_requests", "cloud_event_triggers", "publication_previews", "publication_operations", "connections", "upload_sessions"];
  for (const table of side) ids.push(...(await tx.query(`SELECT id FROM ${table} WHERE ${f}`, args)).rows.map(r => r.id));
  for (let i = 0; i < ids.length; i += 100) await eraseReplayContent(tx, ids.slice(i, i + 100));
  if (j.target_type === "tenants") {
    await tx.query("UPDATE devices SET state='revoked',grants='[]',name='[deleted]' WHERE tenant_id=$1", [j.tenant_id]);
    await tx.query("UPDATE desktop_pairings SET state='retired',updated_at=clock_timestamp() WHERE tenant_id=$1 AND state<>'retired'", [j.tenant_id]);
    await tx.query("UPDATE support_sessions SET revoked_at=coalesce(revoked_at,clock_timestamp()),body_granted=false WHERE tenant_id=$1", [j.tenant_id]);
    await tx.query("UPDATE invites SET email='[deleted]@invalid.example',project_ids='{}',revoked_at=coalesce(revoked_at,clock_timestamp()),version=version+1 WHERE tenant_id=$1", [j.tenant_id]);
    await tx.query(`UPDATE invitation_deliveries SET state='cancelled',token_cipher=NULL,lease_id=NULL,lease_until=NULL WHERE invite_id IN(SELECT id FROM invites WHERE tenant_id=$1)`, [j.tenant_id]);
    await tx.query("UPDATE sso_connections SET enabled=false,name='[deleted]',client_secret='',metadata=NULL,domains='[]',version=version+1 WHERE tenant_id=$1", [j.tenant_id]);
    await tx.query(`UPDATE federation_attempts SET secrets=NULL,subject=NULL,email='[deleted]@invalid.example',next_path='/',phase='failed',completed_at=coalesce(completed_at,clock_timestamp())
      WHERE connection_id IN(SELECT id FROM sso_connections WHERE tenant_id=$1)`, [j.tenant_id]);
    await tx.query(`UPDATE federated_identities SET status='revoked',subject='erased:'||id::text,version=version+1 WHERE connection_id IN(SELECT id FROM sso_connections WHERE tenant_id=$1)`, [j.tenant_id]);
    await tx.query("UPDATE tenants SET name='[deleted]' WHERE id=$1", [j.target_id]);
  } else await tx.query("UPDATE projects SET name='[deleted]',description='' WHERE id=$1", [j.target_id]);
}
