-- Existing approved cloud teams retain their original definitions. A native
-- run is bound to one customer device, login family, folder and pinned runtime.
ALTER TABLE agent_group_preflights ADD COLUMN execution_location text NOT NULL DEFAULT 'cloud'
 CHECK(execution_location IN('cloud','desktop'));
ALTER TABLE agent_group_preflights ADD COLUMN native_binding jsonb;
ALTER TABLE agent_group_runs ADD COLUMN execution_location text NOT NULL DEFAULT 'cloud'
 CHECK(execution_location IN('cloud','desktop'));
ALTER TABLE agent_group_runs ADD COLUMN native_binding jsonb;
ALTER TABLE agent_group_nodes ADD COLUMN native_local_session_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE agent_group_preflights ADD CONSTRAINT native_group_preflight_binding CHECK(
 (execution_location='cloud' AND native_binding IS NULL) OR
 (execution_location='desktop' AND jsonb_typeof(native_binding)='object'
  AND native_binding ?& ARRAY['device_id','local_session_id','workspace_hash','runtime_version','runtime_sha256','native_family_id']
  AND native_binding->>'workspace_hash' ~ '^[a-f0-9]{64}$' AND native_binding->>'runtime_sha256' ~ '^[a-f0-9]{64}$'));
ALTER TABLE agent_group_runs ADD CONSTRAINT native_group_run_binding CHECK(
 (execution_location='cloud' AND native_binding IS NULL) OR
 (execution_location='desktop' AND jsonb_typeof(native_binding)='object'
  AND native_binding ?& ARRAY['device_id','local_session_id','workspace_hash','runtime_version','runtime_sha256','native_family_id']
  AND native_binding->>'workspace_hash' ~ '^[a-f0-9]{64}$' AND native_binding->>'runtime_sha256' ~ '^[a-f0-9]{64}$'));
CREATE UNIQUE INDEX one_native_team_session ON agent_group_runs((native_binding->>'local_session_id')) WHERE execution_location='desktop';
ALTER TABLE tasks DROP CONSTRAINT agent_group_task_binding;
ALTER TABLE tasks ADD CONSTRAINT agent_group_task_binding CHECK(
 (agent_group_run_id IS NULL AND agent_group_node_key IS NULL) OR
 (agent_group_run_id IS NOT NULL AND agent_group_node_key IS NOT NULL AND execution_location IN('cloud','desktop') AND private_owner=created_by));

-- Extend only the location comparison; all original version, actor, budget,
-- role, dependency, concurrency and coordinator-before-members guards remain.
DO $$ DECLARE body text; anchor text; BEGIN
 body:=pg_get_functiondef('check_agent_group_task()'::regprocedure);
 anchor:='OR NEW.execution_location<>''cloud'' OR NEW.mode';
 IF length(body)-length(replace(body,anchor,''))<>length(anchor) THEN RAISE EXCEPTION 'Native team task guard anchor changed'; END IF;
 EXECUTE replace(body,anchor,'OR NEW.execution_location IS DISTINCT FROM r.execution_location OR NEW.mode');
 body:=pg_get_functiondef('check_agent_group_scope()'::regprocedure);
 anchor:='AND p.definition=NEW.definition AND p.definition_hash=NEW.definition_hash';
 IF length(body)-length(replace(body,anchor,''))<>length(anchor) THEN RAISE EXCEPTION 'Native team review guard anchor changed'; END IF;
 EXECUTE replace(body,anchor,'AND p.execution_location=NEW.execution_location AND p.native_binding IS NOT DISTINCT FROM NEW.native_binding '||anchor);
 body:=pg_get_functiondef('agent_group_source_manifest(tasks)'::regprocedure);
 anchor:='IF r.id IS NULL OR r.content_state<>''active''';
 IF length(body)-length(replace(body,anchor,''))<>length(anchor) THEN RAISE EXCEPTION 'Native team source guard anchor changed'; END IF;
 EXECUTE replace(body,anchor,'IF r.id IS NULL OR r.execution_location IS DISTINCT FROM target.execution_location OR r.content_state<>''active''');
 -- A reviewed coordinator is registered while paused. The task/group guards
 -- still prevent it from starting until every approved member has succeeded.
 body:=pg_get_functiondef('guard_desktop_execution()'::regprocedure);
 anchor:='OR t.status<>''queued'' OR t.attempt<>0';
 IF length(body)-length(replace(body,anchor,''))<>length(anchor) THEN RAISE EXCEPTION 'Native coordinator admission guard anchor changed'; END IF;
 EXECUTE replace(body,anchor,'OR (t.status<>''queued'' AND NOT (t.status=''paused'' AND t.agent_group_node_key=''coordinator'' AND EXISTS(SELECT 1 FROM agent_group_runs approved WHERE approved.id=t.agent_group_run_id AND approved.coordinator_task_id=t.id AND approved.execution_location=''desktop'' AND approved.state=''running'' AND approved.content_state=''active''))) OR t.attempt<>0');
END $$;

CREATE FUNCTION check_native_group_execution() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public AS $$
DECLARE t tasks; r agent_group_runs; local_id uuid;
BEGIN
 SELECT * INTO t FROM tasks WHERE id=NEW.task_id;
 IF t.agent_group_run_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO r FROM agent_group_runs WHERE id=t.agent_group_run_id;
 IF t.agent_group_node_key='coordinator' THEN local_id:=(r.native_binding->>'local_session_id')::uuid;
 ELSE SELECT native_local_session_id INTO local_id FROM agent_group_nodes WHERE run_id=r.id AND step_key=t.agent_group_node_key AND task_id=t.id; END IF;
 IF r.execution_location IS DISTINCT FROM 'desktop' OR t.execution_location<>'desktop'
  OR ROW(NEW.tenant_id,NEW.project_id,NEW.actor_id) IS DISTINCT FROM ROW(r.tenant_id,r.project_id,r.created_by)
  OR NEW.device_id::text IS DISTINCT FROM r.native_binding->>'device_id'
  OR NEW.native_family_id::text IS DISTINCT FROM r.native_binding->>'native_family_id'
  OR NEW.workspace_hash IS DISTINCT FROM r.native_binding->>'workspace_hash'
  OR NEW.runtime_sha256 IS DISTINCT FROM r.native_binding->>'runtime_sha256'
  OR NEW.local_session_id IS DISTINCT FROM local_id THEN
  RAISE EXCEPTION 'Native team device, session, folder and runtime are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION check_native_group_execution() OWNER TO cp_control;
REVOKE ALL ON FUNCTION check_native_group_execution() FROM PUBLIC;
CREATE TRIGGER native_group_execution BEFORE INSERT OR UPDATE ON desktop_executions
 FOR EACH ROW EXECUTE FUNCTION check_native_group_execution();

-- The app role cannot read raw audio jobs. Expose only status for an owning
-- actor's active native-team task; provider credentials and media bodies stay private.
CREATE FUNCTION native_group_audio_states(target uuid) RETURNS TABLE(state text,delivery_state text)
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM tasks t JOIN agent_group_runs r ON r.id=t.agent_group_run_id
  WHERE t.id=target AND t.execution_location='desktop' AND r.execution_location='desktop'
  AND t.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND t.created_by=nullif(current_setting('app.actor_id',true),'')::uuid
  AND t.private_owner=t.created_by AND r.created_by=t.created_by
  AND t.content_state='active' AND r.content_state='active'
  AND agent_group_project_access(t.tenant_id,t.project_id,true)) THEN
  RAISE EXCEPTION 'Native team task status is private' USING ERRCODE='42501';
 END IF;
 RETURN QUERY SELECT j.state,j.delivery_state FROM ai_audio_jobs j WHERE j.task_id=target;
END $$;
ALTER FUNCTION native_group_audio_states(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION native_group_audio_states(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION native_group_audio_states(uuid) TO cp_app,cp_control;
