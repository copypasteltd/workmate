-- Additive native admission; existing cloud methods and review guards remain intact.
ALTER TABLE solution_trials ADD COLUMN execution_location text NOT NULL DEFAULT 'cloud'
 CHECK(execution_location IN ('cloud','desktop'));
ALTER TABLE solution_trials ADD COLUMN native_bindings jsonb;
ALTER TABLE solution_trials ADD CONSTRAINT native_solution_bindings CHECK(
 (execution_location='cloud' AND native_bindings IS NULL) OR
 (execution_location='desktop' AND native_bindings IS NOT NULL
  AND jsonb_typeof(native_bindings)='object' AND jsonb_typeof(native_bindings->'sessions')='array'
  AND jsonb_array_length(native_bindings->'sessions') BETWEEN 1 AND 6
  AND (native_bindings->>'family') ~ '^[a-f0-9-]{36}$'));
CREATE OR REPLACE FUNCTION guard_solution_task() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE trial solution_trials; item jsonb;
BEGIN
 IF TG_OP='UPDATE' AND OLD.input_context->'solution_trial' IS DISTINCT FROM NEW.input_context->'solution_trial' THEN
  IF current_setting('app.erasing_content',true)='true' AND pg_has_role(current_user,'cp_control','member') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Approved solution task inputs are immutable' USING ERRCODE='23514'; END IF;
 item:=NEW.input_context->'solution_trial';
 IF item IS NOT NULL THEN
  SELECT * INTO trial FROM solution_trials WHERE id=(item->>'trial_id')::uuid;
  IF trial.id IS NULL OR trial.tenant_id<>NEW.tenant_id OR trial.project_id<>NEW.project_id
   OR trial.private_owner<>NEW.created_by OR NEW.private_owner IS DISTINCT FROM NEW.created_by
   OR trial.solution_version_id IS DISTINCT FROM (item->>'solution_version_id')::uuid
   OR NEW.execution_location IS DISTINCT FROM trial.execution_location OR trial.definition_hash IS DISTINCT FROM item->>'definition_hash'
   OR trial.bindings IS DISTINCT FROM item->'bindings' OR trial.resolved_sources IS DISTINCT FROM item->'resolved_sources' THEN
   RAISE EXCEPTION 'Invalid approved solution task binding' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION check_solution_trial_task() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run solution_trials; task tasks; definition solution_versions;
BEGIN
 SELECT * INTO run FROM solution_trials WHERE id=NEW.trial_id;
 SELECT * INTO task FROM tasks WHERE id=NEW.task_id;
 SELECT * INTO definition FROM solution_versions WHERE id=run.solution_version_id;
 IF run.id IS NULL OR task.id IS NULL OR run.tenant_id<>NEW.tenant_id OR run.project_id<>task.project_id
  OR run.private_owner<>NEW.private_owner OR task.private_owner<>NEW.private_owner
  OR task.execution_location IS DISTINCT FROM run.execution_location
  OR task.input_context->'solution_trial'->>'trial_id' IS DISTINCT FROM run.id::text
  OR definition.frozen->NEW.position->>'template_version_id' IS DISTINCT FROM NEW.template_version_id::text
  OR definition.frozen->NEW.position->>'role_key' IS DISTINCT FROM task.role_key
  OR definition.frozen->NEW.position->>'role_hash' IS DISTINCT FROM task.role_hash THEN
  RAISE EXCEPTION 'Solution trial task scope or frozen template mismatch' USING ERRCODE='23514'; END IF;
 IF run.execution_location='desktop' AND NOT EXISTS(
  SELECT 1 FROM desktop_executions d WHERE d.task_id=task.id
   AND d.actor_id=run.private_owner AND d.tenant_id=run.tenant_id AND d.project_id=run.project_id
   AND d.native_family_id=(run.native_bindings->>'family')::uuid
   AND d.device_id=(run.native_bindings->'sessions'->NEW.position->>'device_id')::uuid
   AND d.local_session_id=(run.native_bindings->'sessions'->NEW.position->>'local_session_id')::uuid
   AND d.workspace_hash=run.native_bindings->'sessions'->NEW.position->>'workspace_hash'
   AND d.runtime_sha256=run.native_bindings->'sessions'->NEW.position->>'runtime_sha256'
   AND task.role_key=run.native_bindings->'sessions'->NEW.position->>'role_key'
 ) THEN RAISE EXCEPTION 'Native solution device/session binding mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

-- Preserve the company-tool binding of pre-upgrade native conversations.
ALTER TABLE desktop_executions ADD COLUMN method_tools_version smallint NOT NULL DEFAULT 0
 CHECK(method_tools_version IN (0,1));
ALTER TABLE desktop_executions ALTER COLUMN method_tools_version SET DEFAULT 1;
CREATE FUNCTION guard_desktop_method_tools() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE previous desktop_executions;
BEGIN
 IF TG_OP='UPDATE' AND OLD.method_tools_version IS DISTINCT FROM NEW.method_tools_version THEN
  RAISE EXCEPTION 'Native method tool version is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  SELECT * INTO previous FROM desktop_executions WHERE local_session_id=NEW.local_session_id ORDER BY created_at,task_id LIMIT 1;
  IF FOUND AND previous.method_tools_version IS DISTINCT FROM NEW.method_tools_version THEN
   RAISE EXCEPTION 'Native conversation method tools must retain their original version' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER desktop_method_tool_guard BEFORE INSERT OR UPDATE OF method_tools_version ON desktop_executions
 FOR EACH ROW EXECUTE FUNCTION guard_desktop_method_tools();
