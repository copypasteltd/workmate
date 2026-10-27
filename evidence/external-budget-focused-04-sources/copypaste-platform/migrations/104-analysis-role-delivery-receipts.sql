-- The deterministic analysis renderer uses the same immutable, task-scoped
-- completion receipts as other company tools. Existing names remain valid.
ALTER TABLE task_tool_receipts DROP CONSTRAINT task_tool_receipts_tool_name_check;
ALTER TABLE task_tool_receipts ADD CONSTRAINT task_tool_receipts_tool_name_check CHECK(tool_name IN(
 'deliver_text','code_write','code_package','design_render','video_project_queue',
 'video_project_edit','video_project_render','video_project_cancel','chart_render'));
INSERT INTO schema_migrations(version) VALUES(104);
