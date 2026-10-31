-- An explicit human request joins an existing cloud input checkpoint to one
-- customer-local Codex task. It never changes a task's execution location.
CREATE TABLE task_local_handoffs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,project_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),source_task_id uuid NOT NULL REFERENCES tasks(id),
 dependency_id uuid NOT NULL REFERENCES task_dependencies(id),dependency_version integer NOT NULL CHECK(dependency_version>0),
 parent_prompt_hash text NOT NULL CHECK(parent_prompt_hash ~ '^[a-f0-9]{64}$'),
 description_hash text NOT NULL CHECK(description_hash ~ '^[a-f0-9]{64}$'),
 native_prompt_hash text NOT NULL CHECK(native_prompt_hash ~ '^[a-f0-9]{64}$'),
 role_key text NOT NULL,role_hash text NOT NULL CHECK(role_hash ~ '^[a-f0-9]{64}$'),
 budget_micros bigint NOT NULL CHECK(budget_micros BETWEEN 10000 AND 10000000000),
 definition_hash text NOT NULL CHECK(definition_hash ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'waiting' CHECK(state IN('waiting','working','completed','cancelled')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 native_task_id uuid UNIQUE REFERENCES tasks(id) DEFERRABLE INITIALLY DEFERRED,
 native_binding jsonb,output_versions uuid[] NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 CHECK((state='waiting' AND native_task_id IS NULL AND native_binding IS NULL) OR
       (state IN('working','completed') AND native_task_id IS NOT NULL AND jsonb_typeof(native_binding)='object') OR state='cancelled'),
 CHECK((state='completed' AND cardinality(output_versions) BETWEEN 1 AND 20) OR
       (state<>'completed' AND cardinality(output_versions)=0))
);
CREATE UNIQUE INDEX one_live_local_handoff ON task_local_handoffs(dependency_id) WHERE state IN('waiting','working');
CREATE INDEX local_handoff_inbox ON task_local_handoffs(tenant_id,project_id,created_by,created_at DESC,id DESC);
ALTER TABLE task_local_handoffs ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_local_handoffs FORCE ROW LEVEL SECURITY;
CREATE POLICY handoff_control ON task_local_handoffs TO cp_control USING(true) WITH CHECK(true);
CREATE POLICY handoff_owner ON task_local_handoffs TO cp_app
 USING(created_by=nullif(current_setting('app.actor_id',true),'')::uuid AND agent_group_project_access(tenant_id,project_id))
 WITH CHECK(created_by=nullif(current_setting('app.actor_id',true),'')::uuid AND agent_group_project_access(tenant_id,project_id,true));
REVOKE ALL ON task_local_handoffs FROM PUBLIC,cp_app,cp_queue;
GRANT SELECT,INSERT,UPDATE ON task_local_handoffs TO cp_app,cp_control;

CREATE FUNCTION guard_local_handoff() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE parent tasks; input task_dependencies;
BEGIN
 IF TG_OP='INSERT' THEN
  SELECT * INTO parent FROM tasks WHERE id=NEW.source_task_id;
  SELECT * INTO input FROM task_dependencies WHERE id=NEW.dependency_id;
  IF parent.id IS NULL OR input.id IS NULL OR parent.tenant_id<>NEW.tenant_id OR parent.project_id<>NEW.project_id
   OR parent.created_by<>NEW.created_by OR parent.execution_location<>'cloud' OR parent.mode<>'execute'
   OR parent.status<>'needs_input' OR parent.cancel_requested OR parent.content_state<>'active'
   OR input.task_id<>parent.id OR input.kind<>'file' OR input.state<>'pending' OR input.version<>NEW.dependency_version
   OR encode(digest(parent.prompt,'sha256'),'hex')<>NEW.parent_prompt_hash
   OR encode(digest(input.description,'sha256'),'hex')<>NEW.description_hash
   OR NEW.state<>'waiting' OR NEW.revision<>1 THEN
   RAISE EXCEPTION 'Local step requires the original waiting cloud input' USING ERRCODE='23514'; END IF;
 ELSIF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['state','revision','native_task_id','native_binding','output_versions','updated_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','native_task_id','native_binding','output_versions','updated_at'])
   OR NEW.revision<>OLD.revision+1
   OR (OLD.state='waiting' AND NEW.state NOT IN('working','cancelled'))
   OR (OLD.state='working' AND NEW.state NOT IN('completed','cancelled'))
   OR OLD.state IN('completed','cancelled')
   OR (OLD.native_task_id IS NOT NULL AND ROW(NEW.native_task_id,NEW.native_binding) IS DISTINCT FROM ROW(OLD.native_task_id,OLD.native_binding)) THEN
   RAISE EXCEPTION 'Local handoff identity and admitted work are immutable' USING ERRCODE='23514'; END IF;
 ELSE RAISE EXCEPTION 'Local handoff receipts are retained' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_local_handoff() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_local_handoff() FROM PUBLIC;
CREATE TRIGGER local_handoff_guard BEFORE INSERT OR UPDATE OR DELETE ON task_local_handoffs FOR EACH ROW EXECUTE FUNCTION guard_local_handoff();

CREATE FUNCTION local_handoff_source_tasks(target tasks) RETURNS uuid[] LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE handoff task_local_handoffs; parent tasks; input task_dependencies;
BEGIN
 IF NOT(target.input_context ? 'local_handoff_id') THEN RETURN '{}'::uuid[]; END IF;
 IF coalesce(target.input_context->>'local_handoff_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN RETURN NULL; END IF;
 SELECT * INTO handoff FROM task_local_handoffs WHERE id=(target.input_context->>'local_handoff_id')::uuid;
 SELECT * INTO parent FROM tasks WHERE id=handoff.source_task_id;
 SELECT * INTO input FROM task_dependencies WHERE id=handoff.dependency_id;
 IF handoff.id IS NULL OR parent.id IS NULL OR input.id IS NULL OR handoff.native_task_id IS DISTINCT FROM target.id
  OR handoff.state NOT IN('working','completed') OR target.execution_location<>'desktop' OR target.private_owner IS DISTINCT FROM target.created_by
  OR handoff.tenant_id<>target.tenant_id OR handoff.project_id<>target.project_id OR handoff.created_by<>target.created_by
  OR parent.tenant_id<>target.tenant_id OR parent.project_id<>target.project_id OR parent.created_by<>target.created_by
  OR parent.content_state<>'active' OR parent.retention_expires_at<=clock_timestamp()
  OR input.task_id<>parent.id OR input.kind<>'file'
  OR encode(digest(parent.prompt,'sha256'),'hex')<>handoff.parent_prompt_hash
  OR encode(digest(input.description,'sha256'),'hex')<>handoff.description_hash
  OR encode(digest(target.prompt,'sha256'),'hex')<>handoff.native_prompt_hash
  OR target.role_key<>handoff.role_key OR target.role_hash<>handoff.role_hash OR target.budget_micros<>handoff.budget_micros
  OR (handoff.state='working' AND (parent.status<>'needs_input' OR parent.cancel_requested OR input.state<>'pending' OR input.version<>handoff.dependency_version)) THEN RETURN NULL; END IF;
 RETURN ARRAY[parent.id];
END $$;
ALTER FUNCTION local_handoff_source_tasks(tasks) OWNER TO cp_control;
REVOKE ALL ON FUNCTION local_handoff_source_tasks(tasks) FROM PUBLIC;

DO $$ DECLARE definition text; anchor text; BEGIN
 definition:=pg_get_functiondef('content_source_manifest_before_creative_feedback(uuid,uuid,uuid[],uuid[])'::regprocedure);
 anchor:='   IF source_task.input_context ? ''agent_id'' THEN';
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Missing local handoff source anchor'; END IF;
 EXECUTE replace(definition,anchor,$hook$   DECLARE local_sources uuid[]; BEGIN
    local_sources:=local_handoff_source_tasks(source_task);
    IF local_sources IS NULL THEN RETURN NULL; END IF;
    pending_tasks:=pending_tasks||local_sources;
    IF source_task.input_context ? 'local_handoff_id' THEN
     targets:=targets||jsonb_build_array(jsonb_build_object('kind','task_local_handoffs','id',source_task.input_context->>'local_handoff_id'));
    END IF;
   END;
$hook$||anchor);
 definition:=pg_get_functiondef('lock_task_content_sources(uuid)'::regprocedure);
 anchor:='FOREACH source_table IN ARRAY ARRAY[';
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Missing local handoff locking anchor'; END IF;
 EXECUTE replace(definition,anchor,anchor||'''task_local_handoffs'',');
 definition:=pg_get_functiondef('publication_input_sources(uuid,uuid)'::regprocedure);
 anchor:='   IF task_row.input_context ? ''plan_source_task_id'' THEN';
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Missing local handoff publication anchor'; END IF;
 EXECUTE replace(definition,anchor,'   pending_tasks:=pending_tasks||local_handoff_source_tasks(task_row);'||chr(10)||anchor);
END $$;

CREATE FUNCTION guard_handoff_task_binding() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE h task_local_handoffs; t tasks;
BEGIN
 IF TG_TABLE_NAME='tasks' THEN
  IF TG_OP='UPDATE' AND OLD.input_context->'local_handoff_id' IS DISTINCT FROM NEW.input_context->'local_handoff_id'
   AND NOT(NEW.content_state='deleted' AND coalesce(current_setting('app.erasing_content',true),'false')='true') THEN
   RAISE EXCEPTION 'Local source binding is immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND NEW.input_context ? 'local_handoff_id' AND local_handoff_source_tasks(NEW) IS NULL THEN
   RAISE EXCEPTION 'Invalid local handoff task' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO t FROM tasks WHERE id=NEW.task_id;
  IF t.input_context ? 'local_handoff_id' THEN
   SELECT * INTO h FROM task_local_handoffs WHERE native_task_id=t.id;
   IF h.id IS NULL OR h.state<>'working' OR h.native_binding->>'device_id' IS DISTINCT FROM NEW.device_id::text
    OR h.native_binding->>'local_session_id' IS DISTINCT FROM NEW.local_session_id::text
    OR h.native_binding->>'native_family_id' IS DISTINCT FROM NEW.native_family_id::text
    OR h.native_binding->>'workspace_hash' IS DISTINCT FROM NEW.workspace_hash
    OR h.native_binding->>'runtime_sha256' IS DISTINCT FROM NEW.runtime_sha256 THEN
    RAISE EXCEPTION 'Local handoff device binding changed' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_handoff_task_binding() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_handoff_task_binding() FROM PUBLIC;
CREATE TRIGGER handoff_task_binding BEFORE INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION guard_handoff_task_binding();
CREATE TRIGGER handoff_execution_binding BEFORE INSERT ON desktop_executions FOR EACH ROW EXECUTE FUNCTION guard_handoff_task_binding();

CREATE FUNCTION withdraw_task_handoffs() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
BEGIN
 IF NEW.content_state<>'active' OR NEW.cancel_requested OR NEW.status<>'needs_input' THEN
  UPDATE task_local_handoffs SET state='cancelled',revision=revision+1,updated_at=clock_timestamp()
   WHERE source_task_id=NEW.id AND state IN('waiting','working');
 END IF;
 IF NEW.content_state='deleted' THEN
  UPDATE tasks SET content_state='deleted',moderation_version=moderation_version+1
   WHERE id IN(SELECT native_task_id FROM task_local_handoffs WHERE source_task_id=NEW.id) AND content_state<>'deleted';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION withdraw_task_handoffs() OWNER TO cp_control;
REVOKE ALL ON FUNCTION withdraw_task_handoffs() FROM PUBLIC;
CREATE TRIGGER task_handoff_withdrawal AFTER UPDATE OF content_state,cancel_requested,status ON tasks FOR EACH ROW EXECUTE FUNCTION withdraw_task_handoffs();
INSERT INTO schema_migrations(version) VALUES(141);
