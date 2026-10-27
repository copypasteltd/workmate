-- Actual native vector/PPTX writes use existing immutable completion receipts.
-- Keep every already-published tool name and SQL001-105 unchanged.
ALTER TABLE task_tool_receipts DROP CONSTRAINT task_tool_receipts_tool_name_check;
ALTER TABLE task_tool_receipts ADD CONSTRAINT task_tool_receipts_tool_name_check CHECK(tool_name IN(
 'deliver_text','code_write','code_package','design_render','video_project_queue',
 'video_project_edit','video_project_render','video_project_cancel','chart_render',
 'workflow_save','workflow_publish','workflow_run','workflow_cancel',
 'vector_render','slides_build','slides_render'));
INSERT INTO schema_migrations(version) VALUES(106);
