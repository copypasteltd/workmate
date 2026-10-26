-- Preserve UUID cursors while ordering private run history by actual creation time.
-- The ID tie-breaker and timestamp comparison stay in PostgreSQL so microseconds
-- are not lost by converting an anchor through JavaScript Date.
CREATE INDEX agent_group_run_history
 ON agent_group_runs(group_id,created_by,created_at DESC,id DESC)
 WHERE content_state='active';
