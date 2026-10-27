-- Published composite brand revisions retain their bodies, hashes and lineage.
-- A stable opaque version ID connects the original template override to them.
ALTER TABLE brand_profile_versions ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX brand_profile_versions_id ON brand_profile_versions(id);
CREATE INDEX brand_profile_versions_project_id ON brand_profile_versions(project_id,id);

CREATE FUNCTION guard_native_specialist_context() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE a agents; v agent_versions;
BEGIN
 IF NEW.execution_location<>'desktop' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' THEN
  IF (OLD.input_context ? 'agent_id' OR NEW.input_context ? 'agent_id' OR OLD.input_context ? 'agent_version' OR NEW.input_context ? 'agent_version') AND NEW.input_context IS DISTINCT FROM OLD.input_context
   AND NOT(NEW.content_state='deleted' AND coalesce(current_setting('app.erasing_content',true),'false')='true' AND NOT NEW.input_context ? 'agent_id') THEN
   RAISE EXCEPTION 'Native specialist context is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF NOT NEW.input_context ? 'agent_id' AND NOT NEW.input_context ? 'agent_version' THEN RETURN NEW; END IF;
 SELECT * INTO a FROM agents WHERE id=(NEW.input_context->>'agent_id')::uuid;
 SELECT * INTO v FROM agent_versions WHERE agent_id=a.id AND version=(NEW.input_context->>'agent_version')::integer;
 IF a.id IS NULL OR v.id IS NULL OR a.tenant_id IS DISTINCT FROM NEW.tenant_id OR a.project_id IS DISTINCT FROM NEW.project_id
  OR a.content_state<>'active' OR NOT a.enabled OR a.role_key IS DISTINCT FROM NEW.role_key OR v.body->>'role_hash' IS DISTINCT FROM NEW.role_hash THEN
  RAISE EXCEPTION 'Native specialist scope mismatch' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_native_specialist_context() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_native_specialist_context() FROM PUBLIC;
CREATE TRIGGER native_specialist_context_guard BEFORE INSERT OR UPDATE OF input_context ON tasks
 FOR EACH ROW EXECUTE FUNCTION guard_native_specialist_context();

CREATE FUNCTION check_native_session_specialist() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE current_task tasks; previous tasks;
BEGIN
 SELECT * INTO current_task FROM tasks WHERE id=NEW.task_id;
 SELECT t.* INTO previous FROM desktop_executions d JOIN tasks t ON t.id=d.task_id
  WHERE d.local_session_id=NEW.local_session_id AND d.task_id<>NEW.task_id ORDER BY d.created_at,d.task_id LIMIT 1;
 IF FOUND AND (previous.content_state<>'active' OR previous.role_key IS DISTINCT FROM current_task.role_key
  OR previous.role_hash IS DISTINCT FROM current_task.role_hash
  OR previous.input_context->'agent_id' IS DISTINCT FROM current_task.input_context->'agent_id'
  OR previous.input_context->'agent_version' IS DISTINCT FROM current_task.input_context->'agent_version') THEN
  RAISE EXCEPTION 'Native session specialist is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION check_native_session_specialist() OWNER TO cp_control;
REVOKE ALL ON FUNCTION check_native_session_specialist() FROM PUBLIC;
CREATE TRIGGER native_session_specialist_guard AFTER INSERT ON desktop_executions
 FOR EACH ROW EXECUTE FUNCTION check_native_session_specialist();
