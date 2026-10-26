/** Extra source scope inside an already owner/project-authorized asset query.
 * Alias v always denotes asset_versions. Parameter numbers are static code,
 * never model input. Native tasks may share files only within one actual,
 * authenticated device/session/workspace binding; a web conversation cannot
 * inherit that access simply by supplying an asset or task identifier.
 */
export function taskPrivateAssetScopeSQL(
  conversationParameter: number,
  taskParameter: number,
) {
  for (const value of [conversationParameter, taskParameter])
    if (!Number.isInteger(value) || value < 1 || value > 16)
      throw new Error("Invalid static SQL parameter");
  return `(
    v.metadata->>'conversation_id'=$${conversationParameter}::text
    OR EXISTS (
      SELECT 1 FROM tasks approved_task JOIN solution_trials approved_trial
        ON approved_trial.id::text=approved_task.input_context->'solution_trial'->>'trial_id'
       AND approved_trial.tenant_id=approved_task.tenant_id AND approved_trial.project_id=approved_task.project_id
       AND approved_trial.private_owner=approved_task.created_by AND approved_task.private_owner=approved_task.created_by
      JOIN assets approved_asset ON approved_asset.id=v.asset_id
       AND approved_asset.tenant_id=approved_task.tenant_id AND approved_asset.project_id=approved_task.project_id
       AND approved_asset.private_owner=approved_task.created_by
      WHERE approved_task.id=$${taskParameter}::uuid
       AND EXISTS(SELECT 1 FROM jsonb_to_recordset(approved_trial.bindings->'assets') AS approved_input(asset_version_id uuid,sha256 text)
         WHERE approved_input.asset_version_id=v.id AND approved_input.sha256=v.sha256)
    )
    OR EXISTS (
      SELECT 1 FROM desktop_executions current_execution
      JOIN desktop_executions source_execution
        ON source_execution.task_id::text=v.metadata->>'task_id'
       AND source_execution.tenant_id=current_execution.tenant_id
       AND source_execution.project_id=current_execution.project_id
       AND source_execution.actor_id=current_execution.actor_id
       AND source_execution.native_family_id=current_execution.native_family_id
       AND source_execution.device_id=current_execution.device_id
       AND source_execution.local_session_id=current_execution.local_session_id
       AND source_execution.workspace_hash=current_execution.workspace_hash
       AND source_execution.runtime_sha256=current_execution.runtime_sha256
      WHERE current_execution.task_id=$${taskParameter}::uuid
    )
  )`;
}
