-- Forward repair only. Applied migrations146/147 and all previous history are immutable.
CREATE OR REPLACE FUNCTION guard_desktop_execution() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE t tasks; previous desktop_executions;
BEGIN
 IF TG_OP='UPDATE' AND scope_erasure_authorized(TG_TABLE_NAME,to_jsonb(OLD))
  AND (NEW.credential_cipher IS NULL AND NEW.credential_hash IS NULL AND NEW.credential_expires_at IS NULL AND NEW.state=CASE WHEN OLD.state='running' AND EXISTS(SELECT 1 FROM recovery_environment WHERE singleton AND state='quarantined') THEN 'reconciling' ELSE OLD.state END) AND (to_jsonb(NEW)-ARRAY['credential_cipher','credential_hash','credential_expires_at','state']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['credential_cipher','credential_hash','credential_expires_at','state']) AND (NOT EXISTS(SELECT 1 FROM tasks execution_task WHERE execution_task.id=OLD.task_id AND execution_task.status IN('queued','running','paused','awaiting_approval','needs_input','reconciling')) OR EXISTS(SELECT 1 FROM recovery_environment WHERE singleton AND state='quarantined')) THEN RETURN NEW; END IF;

 IF TG_OP<>'INSERT' THEN
  IF TG_OP='DELETE' OR ROW(OLD.task_id,OLD.tenant_id,OLD.project_id,OLD.actor_id,OLD.device_id,
   OLD.local_session_id,OLD.native_family_id,OLD.workspace_hash,OLD.runtime_sha256,OLD.created_at)
   IS DISTINCT FROM ROW(NEW.task_id,NEW.tenant_id,NEW.project_id,NEW.actor_id,NEW.device_id,
   NEW.local_session_id,NEW.native_family_id,NEW.workspace_hash,NEW.runtime_sha256,NEW.created_at)
   OR (OLD.state IN ('finished','reconciling') AND OLD IS DISTINCT FROM NEW) THEN
   RAISE EXCEPTION 'Immutable desktop execution ownership' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO t FROM tasks WHERE id=NEW.task_id;
 IF t.execution_location IS DISTINCT FROM 'desktop' OR t.tenant_id IS DISTINCT FROM NEW.tenant_id
  OR t.project_id IS DISTINCT FROM NEW.project_id OR t.created_by IS DISTINCT FROM NEW.actor_id
  OR t.private_owner IS DISTINCT FROM NEW.actor_id OR (t.status<>'queued' AND NOT (t.status='paused' AND t.agent_group_node_key='coordinator' AND EXISTS(SELECT 1 FROM agent_group_runs approved WHERE approved.id=t.agent_group_run_id AND approved.coordinator_task_id=t.id AND approved.execution_location='desktop' AND approved.state='running' AND approved.content_state='active'))) OR t.attempt<>0
  OR NEW.state<>'prepared' OR NEW.credential_hash IS NOT NULL OR NEW.client_report IS NOT NULL THEN
  RAISE EXCEPTION 'Invalid local task owner' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('desktop-session:'||NEW.local_session_id::text,0));
 SELECT * INTO previous FROM desktop_executions WHERE local_session_id=NEW.local_session_id LIMIT 1;
 IF FOUND AND ROW(previous.tenant_id,previous.project_id,previous.actor_id,previous.device_id,
  previous.workspace_hash,previous.runtime_sha256,previous.native_family_id)
  IS DISTINCT FROM ROW(NEW.tenant_id,NEW.project_id,NEW.actor_id,NEW.device_id,
  NEW.workspace_hash,NEW.runtime_sha256,NEW.native_family_id) THEN
  RAISE EXCEPTION 'Local session binding is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION check_agent_group_scope() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r agent_group_runs; g agent_groups; v jsonb;
BEGIN
 -- Scope cleanup may have removed the coordinator or cloud workspace first.
 -- Only deletion marking / erasing the name is admitted, never rebinding.
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='agent_groups' THEN
 IF session_user NOT IN('cp_app','cp_queue')
  AND current_setting('app.erasing_content',true)='true' AND NEW.content_state='deleted'
  AND (NEW.name=OLD.name OR NEW.name='[deleted]')
  AND NEW.version IN(OLD.version,OLD.version+1) AND NEW.moderation_version IN(OLD.moderation_version,OLD.moderation_version+1)
  AND (to_jsonb(NEW)-ARRAY['content_state','name','version','moderation_version']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['content_state','name','version','moderation_version'])
  AND EXISTS(SELECT 1 FROM projects p JOIN tenants w ON w.id=p.tenant_id WHERE p.id=OLD.project_id AND p.tenant_id=OLD.tenant_id
   AND (p.erasure_requested_at IS NOT NULL OR w.erasure_requested_at IS NOT NULL)) THEN RETURN NEW; END IF;
 END IF;
 IF TG_TABLE_NAME='agent_groups' THEN
  IF NOT EXISTS(SELECT 1 FROM cloud_workspaces w JOIN agents a ON a.id=NEW.coordinator_agent_id
    WHERE w.id=NEW.workspace_id AND w.tenant_id=NEW.tenant_id AND w.project_id=NEW.project_id AND w.kind='project' AND w.content_state='active'
    AND a.tenant_id=NEW.tenant_id AND a.project_id=NEW.project_id AND a.content_state='active') THEN
   RAISE EXCEPTION 'Invalid team project scope' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='agent_group_members' THEN
  IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM agents a JOIN agent_versions av ON av.agent_id=a.id AND av.version=NEW.agent_version
   JOIN agent_group_versions gv ON gv.group_id=NEW.group_id AND gv.version=NEW.group_version
   WHERE a.id=NEW.agent_id AND a.tenant_id=NEW.tenant_id AND a.project_id=NEW.project_id AND a.content_state='active'
   AND gv.tenant_id=NEW.tenant_id AND gv.project_id=NEW.project_id
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(gv.body->'bindings') b WHERE b->>'agent_id'=NEW.agent_id::text
    AND (b->>'agent_version')::int=NEW.agent_version AND (b->>'is_coordinator')::boolean=NEW.is_coordinator)
   AND av.body->>'kernel'='codex') THEN RAISE EXCEPTION 'Invalid team member version' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND (SELECT count(*) FROM agent_group_members WHERE group_id=NEW.group_id AND group_version=NEW.group_version)>=8 THEN
   RAISE EXCEPTION 'Team member limit' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='agent_group_runs' AND TG_OP='INSERT' THEN
  SELECT * INTO g FROM agent_groups WHERE id=NEW.group_id;
  IF NEW.state<>'running' OR NEW.coordinator_task_id IS NOT NULL OR NEW.created_by IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'')::uuid
   OR g.state<>'active' OR g.content_state<>'active' OR g.version<>NEW.group_version
   OR NOT EXISTS(SELECT 1 FROM agent_group_preflights p JOIN conversations c ON c.id=NEW.conversation_id
    WHERE p.id=NEW.preflight_id AND p.created_by=NEW.created_by AND p.tenant_id=NEW.tenant_id AND p.project_id=NEW.project_id
    AND p.group_id=NEW.group_id AND p.group_version=NEW.group_version AND p.erased_at IS NULL AND p.expires_at>clock_timestamp()
    AND p.execution_location=NEW.execution_location AND p.native_binding IS NOT DISTINCT FROM NEW.native_binding AND p.definition=NEW.definition AND p.definition_hash=NEW.definition_hash AND p.approved_budget_micros=NEW.approved_budget_micros
    AND NEW.max_parallelism=(p.definition->>'max_parallelism')::integer
    AND c.created_by=NEW.created_by AND c.tenant_id=NEW.tenant_id AND c.project_id=NEW.project_id AND c.agent_id=g.coordinator_agent_id
    AND c.content_state='active') THEN RAISE EXCEPTION 'An exact current team review and customer approval are required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;

INSERT INTO schema_migrations(version) VALUES(148);
