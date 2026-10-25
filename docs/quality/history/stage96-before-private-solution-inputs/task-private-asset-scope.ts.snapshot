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
