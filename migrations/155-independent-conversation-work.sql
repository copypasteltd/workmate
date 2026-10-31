-- Ordinary cloud work owns independent admission, budget, task state and result.
-- Per-user plan quotas and shared file optimistic version checks remain enforced.
DROP INDEX conversation_one_active_task;
CREATE INDEX conversation_active_work ON tasks(conversation_id,created_at,id)
 WHERE conversation_id IS NOT NULL AND agent_group_run_id IS NULL
 AND status IN ('queued','running','paused','awaiting_approval','reconciling','needs_input');
