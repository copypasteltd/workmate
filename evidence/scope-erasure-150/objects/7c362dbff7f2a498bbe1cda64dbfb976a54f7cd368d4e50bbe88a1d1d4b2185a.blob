-- Permanent workspace/project fences are separate from reversible suspension/archive.
ALTER TABLE tenants ADD COLUMN erasure_requested_at timestamptz;
ALTER TABLE projects ADD COLUMN erasure_requested_at timestamptz;
ALTER TABLE deletion_jobs ADD COLUMN retained jsonb NOT NULL DEFAULT '[]';
ALTER TABLE tenants ADD CONSTRAINT erased_tenant_unavailable CHECK(erasure_requested_at IS NULL OR status='suspended');
ALTER TABLE projects ADD CONSTRAINT erased_project_unavailable CHECK(erasure_requested_at IS NULL OR archived);

CREATE FUNCTION journal_scope_erasure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant uuid; project uuid;
BEGIN
 IF OLD.erasure_requested_at IS NULL AND NEW.erasure_requested_at IS NOT NULL AND session_user IN('cp_app','cp_queue') THEN
  RAISE EXCEPTION 'Scope erasure requires controlled authority' USING ERRCODE='42501';
 END IF;
 IF OLD.erasure_requested_at IS NOT NULL AND NEW.erasure_requested_at IS DISTINCT FROM OLD.erasure_requested_at THEN
  RAISE EXCEPTION 'Permanent scope deletion cannot be restored' USING ERRCODE='23514';
 END IF;
 IF NEW.erasure_requested_at IS NULL THEN RETURN NEW; END IF;
 tenant:=CASE WHEN TG_TABLE_NAME='tenants' THEN NEW.id ELSE (to_jsonb(NEW)->>'tenant_id')::uuid END;
 project:=CASE WHEN TG_TABLE_NAME='projects' THEN NEW.id ELSE NULL END;
 INSERT INTO deletion_jobs(tenant_id,project_id,target_type,target_id)
 VALUES(tenant,project,TG_TABLE_NAME,NEW.id) ON CONFLICT(target_type,target_id) DO NOTHING;
 RETURN NEW;
END $$;
ALTER FUNCTION journal_scope_erasure() OWNER TO cp_control;
REVOKE ALL ON FUNCTION journal_scope_erasure() FROM PUBLIC;
CREATE TRIGGER permanent_scope_erasure BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION journal_scope_erasure();
CREATE TRIGGER permanent_scope_erasure BEFORE UPDATE ON projects FOR EACH ROW EXECUTE FUNCTION journal_scope_erasure();

-- Private rows without their own scope are resolved through explicit parent keys.
-- This function grants no erasure authority to the application or queue role.
CREATE FUNCTION scope_erasure_authorized(tab text, body jsonb) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE job deletion_jobs; tenant uuid; project uuid; reference uuid; marker text;
BEGIN
 IF session_user IN('cp_app','cp_queue') OR current_setting('app.erasing_content',true) IS DISTINCT FROM 'true' THEN RETURN false; END IF;
 marker:=current_setting('app.scope_erasure_job',true);
 IF marker IS NULL OR marker !~ '^[a-f0-9-]{36}$' THEN RETURN false; END IF;
 SELECT * INTO job FROM deletion_jobs WHERE id=marker::uuid AND target_type IN('projects','tenants');
 IF job.id IS NULL THEN RETURN false; END IF;
 IF job.target_type='projects' AND NOT EXISTS(SELECT 1 FROM projects WHERE id=job.target_id AND tenant_id=job.tenant_id AND erasure_requested_at IS NOT NULL) THEN RETURN false; END IF;
 IF job.target_type='tenants' AND NOT EXISTS(SELECT 1 FROM tenants WHERE id=job.target_id AND erasure_requested_at IS NOT NULL) THEN RETURN false; END IF;
 tenant:=nullif(body->>'tenant_id','')::uuid; project:=nullif(body->>'project_id','')::uuid;
 IF tenant IS NOT NULL THEN RETURN tenant=job.tenant_id AND (job.target_type='tenants' OR project=job.target_id); END IF;
 RETURN false;
END $$;
ALTER FUNCTION scope_erasure_authorized(text,jsonb) OWNER TO cp_control;
REVOKE ALL ON FUNCTION scope_erasure_authorized(text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION scope_erasure_authorized(text,jsonb) TO cp_control;

-- New private roots cannot be admitted after a permanent fence, including
-- delayed transactions whose HTTP authorization ran before the deletion.
CREATE FUNCTION guard_scope_erasure_admission() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE body jsonb:=to_jsonb(NEW); tenant uuid; project uuid; tenant_erased boolean; project_erased boolean;
BEGIN
 tenant:=nullif(body->>'tenant_id','')::uuid; project:=nullif(body->>'project_id','')::uuid;
 -- Row locks serialize this check with the accepting root FOR UPDATE. Read
 -- the locked current row after any wait, rather than a stale pre-wait snapshot.
 SELECT erasure_requested_at IS NOT NULL INTO tenant_erased FROM tenants WHERE id=tenant FOR KEY SHARE;
 SELECT erasure_requested_at IS NOT NULL INTO project_erased FROM projects WHERE id=project FOR KEY SHARE;
 IF coalesce(tenant_erased,false) OR coalesce(project_erased,false) THEN
  RAISE EXCEPTION 'Permanently deleted scope cannot accept content' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_scope_erasure_admission() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_scope_erasure_admission() FROM PUBLIC;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['projects','assets','tasks','brand_profiles','analytics_datasets','workflows','workflow_runs','workflow_schedules','creative_projects','agents','conversations','memories','workspace_nodes','agent_groups','agent_group_runs','cloud_runtime_quotes','cloud_runtime_sessions','upload_sessions','connections','project_configurations','solution_versions','solution_installations','solution_trials','cloud_schedule_requests','cloud_schedules','cloud_event_requests','cloud_event_triggers','publication_previews','publication_operations'] LOOP
  EXECUTE format('CREATE TRIGGER scope_erasure_admission BEFORE INSERT ON %I FOR EACH ROW EXECUTE FUNCTION guard_scope_erasure_admission()',tab);
 END LOOP;
END $$;










-- Controlled immutable-record erasure exceptions. Identity, hashes and accounting facts remain immutable.

CREATE OR REPLACE FUNCTION guard_connector_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND scope_erasure_authorized(TG_TABLE_NAME,to_jsonb(OLD))
  AND (NEW.specification='{}' AND NEW.encrypted_cursor IS NULL AND NEW.cursor_hashes='{}' AND NEW.limitations='{}' AND NEW.lease_token IS NULL AND NEW.lease_until IS NULL AND NEW.state=CASE WHEN OLD.state IN('queued','running') THEN 'cancelled' ELSE OLD.state END AND NEW.revision=OLD.revision+1 AND NEW.finished_at IS NOT NULL) AND (to_jsonb(NEW)-ARRAY['specification','encrypted_cursor','cursor_hashes','limitations','lease_token','lease_until','state','finished_at','revision']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['specification','encrypted_cursor','cursor_hashes','limitations','lease_token','lease_until','state','finished_at','revision'])  THEN RETURN NEW; END IF;

 IF TG_OP='DELETE' OR OLD.state NOT IN('queued','running') THEN RAISE EXCEPTION 'Finished connector jobs are immutable' USING ERRCODE='23514'; END IF;
 IF NEW.revision<>OLD.revision+1 OR
  (to_jsonb(NEW)-ARRAY['state','segment','ordinal','encrypted_cursor','cursor_hashes','page_count','row_count','raw_bytes','attempts','revision','lease_token','lease_until','next_attempt_at','error_code','limitations','started_at','finished_at']) IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['state','segment','ordinal','encrypted_cursor','cursor_hashes','page_count','row_count','raw_bytes','attempts','revision','lease_token','lease_until','next_attempt_at','error_code','limitations','started_at','finished_at']) THEN
  RAISE EXCEPTION 'Connector query identity or revision changed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_solution_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND scope_erasure_authorized(TG_TABLE_NAME,to_jsonb(OLD))
  AND (NEW.definition=jsonb_build_object('project_id',OLD.project_id) AND NEW.frozen='[{}]' AND NEW.state='disabled' AND NEW.disabled_at IS NOT NULL AND NEW.disable_reason='SCOPE_ERASED') AND (to_jsonb(NEW)-ARRAY['definition','frozen','state','disabled_at','disable_reason']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['definition','frozen','state','disabled_at','disable_reason'])  THEN RETURN NEW; END IF;

 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['state','published_at','validation_task_id','disabled_at','disable_reason']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['state','published_at','validation_task_id','disabled_at','disable_reason'])
   OR OLD.state='disabled' OR NEW.state=OLD.state OR NEW.state='draft' THEN
  RAISE EXCEPTION 'Solution versions are immutable; revise or disable explicitly' USING ERRCODE='23514'; END IF;
 IF NEW.state='published' AND (NEW.published_at IS NULL OR NEW.validation_task_id IS NULL) THEN
  RAISE EXCEPTION 'A publication requires its completed reviewed trial' USING ERRCODE='23514'; END IF;
 IF NEW.state='disabled' AND (NEW.disabled_at IS NULL OR coalesce(NEW.disable_reason,'')='') THEN
  RAISE EXCEPTION 'A disabled solution requires a reason' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_solution_installation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND scope_erasure_authorized(TG_TABLE_NAME,to_jsonb(OLD))
  AND (NEW.name='[deleted]' AND NEW.bindings='{"assets":[],"connectors":[]}' AND NEW.revision=OLD.revision+1) AND (to_jsonb(NEW)-ARRAY['name','bindings','revision','updated_at']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['name','bindings','revision','updated_at'])  THEN RETURN NEW; END IF;

 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['bindings','revision','updated_at']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['bindings','revision','updated_at']) OR NEW.revision<>OLD.revision+1 THEN
  RAISE EXCEPTION 'Solution installation scope and method are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_solution_trial() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND scope_erasure_authorized(TG_TABLE_NAME,to_jsonb(OLD))
  AND (NEW.bindings='{}' AND NEW.resolved_sources='[]') AND (to_jsonb(NEW)-ARRAY['bindings','resolved_sources']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['bindings','resolved_sources'])  THEN RETURN NEW; END IF;

 IF TG_OP='DELETE' OR OLD.reviewed_at IS NOT NULL OR NEW.reviewed_at IS NULL OR NEW.review_hashes IS NULL OR
  (to_jsonb(NEW)-ARRAY['reviewed_at','review_hashes']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['reviewed_at','review_hashes']) THEN
  RAISE EXCEPTION 'Reviewed solution trial is immutable' USING ERRCODE='23514'; END IF;
 IF NOT solution_trial_content_complete(NEW.id) THEN
  RAISE EXCEPTION 'Required source content has not been read' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_project_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND scope_erasure_authorized(TG_TABLE_NAME,to_jsonb(OLD))
  AND (NEW.name='[deleted]' AND NEW.draft='{}' AND NEW.content_state='deleted' AND NEW.moderation_version=OLD.moderation_version+1) AND (to_jsonb(NEW)-ARRAY['name','draft','content_state','moderation_version']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['name','draft','content_state','moderation_version'])  THEN RETURN NEW; END IF;

 IF ROW(NEW.tenant_id,NEW.project_id,NEW.created_by,NEW.id) IS DISTINCT FROM ROW(OLD.tenant_id,OLD.project_id,OLD.created_by,OLD.id) THEN
  RAISE EXCEPTION 'Immutable shared project scope' USING ERRCODE='23514'; END IF;
 IF OLD.content_state='deleted' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Deleted shared configuration is permanent' USING ERRCODE='23514'; END IF;
 IF NEW.current_version IS DISTINCT FROM OLD.current_version AND NEW.current_version IS DISTINCT FROM coalesce(OLD.current_version,0)+1 THEN
  RAISE EXCEPTION 'Publish consecutive shared versions' USING ERRCODE='23514'; END IF;
 IF ROW(NEW.draft,NEW.current_version) IS DISTINCT FROM ROW(OLD.draft,OLD.current_version) AND NEW.content_state<>'deleted' AND NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'Shared configuration revision is required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_desktop_execution() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE t tasks; previous desktop_executions;
BEGIN
 IF TG_OP='UPDATE' AND scope_erasure_authorized(TG_TABLE_NAME,to_jsonb(OLD))
  AND (NEW.credential_cipher IS NULL AND NEW.credential_hash IS NULL AND NEW.credential_expires_at IS NULL AND NEW.state=CASE WHEN OLD.state='running' AND EXISTS(SELECT 1 FROM recovery_environment WHERE singleton AND state='quarantined') THEN 'reconciling' ELSE OLD.state END) AND (to_jsonb(NEW)-ARRAY['credential_cipher','credential_hash','credential_expires_at','state']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['credential_cipher','credential_hash','credential_expires_at','state']) AND (NOT EXISTS(SELECT 1 FROM tasks t WHERE t.id=OLD.task_id AND t.status IN('queued','running','paused','awaiting_approval','needs_input','reconciling')) OR EXISTS(SELECT 1 FROM recovery_environment WHERE singleton AND state='quarantined')) THEN RETURN NEW; END IF;

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
  OR t.private_owner IS DISTINCT FROM NEW.actor_id OR t.status<>'queued' OR t.attempt<>0
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

CREATE OR REPLACE FUNCTION guard_agent_adoption_preview() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' AND scope_erasure_authorized(TG_TABLE_NAME,to_jsonb(OLD)) THEN RETURN OLD; END IF;

 IF TG_OP='DELETE' THEN
  IF OLD.expires_at>clock_timestamp() THEN
   RAISE EXCEPTION 'A live adoption comparison cannot be removed' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
 END IF;
 IF (to_jsonb(NEW)-'consumed_at'-'result')<>(to_jsonb(OLD)-'consumed_at'-'result')
  OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL OR NEW.result IS NULL
  OR OLD.expires_at<=clock_timestamp() OR NEW.result->>'resource_id' IS DISTINCT FROM OLD.resource_id::text THEN
  RAISE EXCEPTION 'Immutable or already consumed adoption comparison' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_canonical_support_session() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND scope_erasure_authorized(TG_TABLE_NAME,to_jsonb(OLD))
  AND (NEW.revoked_at IS NOT NULL AND NOT NEW.body_granted AND (OLD.revoked_at IS NULL OR NEW.revoked_at=OLD.revoked_at)) AND (to_jsonb(NEW)-ARRAY['revoked_at','body_granted']) IS NOT DISTINCT FROM (to_jsonb(OLD)-ARRAY['revoked_at','body_granted'])  THEN RETURN NEW; END IF;

 IF EXISTS(SELECT 1 FROM support_session_contexts WHERE id=OLD.id) THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Canonical support history cannot be removed' USING ERRCODE='23514'; END IF;
  IF ROW(NEW.id,NEW.principal_id,NEW.tenant_id,NEW.reason,NEW.expires_at,NEW.body_granted)
    IS DISTINCT FROM ROW(OLD.id,OLD.principal_id,OLD.tenant_id,OLD.reason,OLD.expires_at,OLD.body_granted)
    OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS DISTINCT FROM OLD.revoked_at)
    OR (NEW.revoked_at IS NOT NULL AND NEW.revoked_at>clock_timestamp()) THEN
   RAISE EXCEPTION 'Canonical support identity, deadline and revocation are immutable' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN CASE WHEN TG_OP='DELETE' THEN OLD ELSE NEW END;
END $$;


-- Only minimal IDs and explicit redaction are allowed for immutable policy data.
CREATE OR REPLACE FUNCTION immutable_publication_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='publication_policies' AND TG_OP='UPDATE' THEN
  IF scope_erasure_authorized(TG_TABLE_NAME,to_jsonb(OLD)) AND NEW.body='{}'
   AND (to_jsonb(NEW)-'body') IS NOT DISTINCT FROM (to_jsonb(OLD)-'body') THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Immutable publication record' USING ERRCODE='23514';
END $$;

-- Resolve only explicit product parent keys, never user-provided relation names.
CREATE FUNCTION erasure_row_scope(tab text,body jsonb) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE tenant uuid:=nullif(body->>'tenant_id','')::uuid; project uuid:=nullif(body->>'project_id','')::uuid; reference uuid;
BEGIN
 IF tab='projects' THEN RETURN jsonb_build_object('tenant_id',tenant,'project_id',(body->>'id')::uuid); END IF;
 IF tab IN('federation_attempts','federated_identities') THEN
  SELECT tenant_id INTO tenant FROM sso_connections WHERE id=(body->>'connection_id')::uuid;
 ELSIF tab IN('publication_connections','publication_targets') THEN
  reference:=CASE WHEN tab='publication_connections' THEN (body->>'id')::uuid ELSE (body->>'connection_id')::uuid END;
  IF NOT EXISTS(SELECT 1 FROM publication_connection_projects p JOIN projects root ON root.id=p.project_id WHERE p.connection_id=reference AND root.erasure_requested_at IS NULL) THEN
   SELECT p.project_id INTO project FROM publication_connection_projects p WHERE p.connection_id=reference ORDER BY p.project_id LIMIT 1;
  END IF;
 ELSIF project IS NOT NULL THEN
  SELECT tenant_id INTO tenant FROM projects WHERE id=project;
 ELSIF nullif(body->>'task_id','') IS NOT NULL THEN
  SELECT tenant_id,project_id INTO tenant,project FROM tasks WHERE id=nullif(body->>'task_id','')::uuid;
 ELSIF nullif(body->>'asset_id','') IS NOT NULL THEN
  SELECT tenant_id,project_id INTO tenant,project FROM assets WHERE id=nullif(body->>'asset_id','')::uuid;
 ELSIF nullif(body->>'agent_id','') IS NOT NULL THEN
  SELECT tenant_id,project_id INTO tenant,project FROM agents WHERE id=nullif(body->>'agent_id','')::uuid;
 ELSIF nullif(body->>'conversation_id','') IS NOT NULL THEN
  SELECT tenant_id,project_id INTO tenant,project FROM conversations WHERE id=nullif(body->>'conversation_id','')::uuid;
 ELSIF nullif(body->>'memory_id','') IS NOT NULL THEN
  SELECT tenant_id,project_id INTO tenant,project FROM memories WHERE id=nullif(body->>'memory_id','')::uuid;
 ELSIF nullif(body->>'trigger_id','') IS NOT NULL THEN
  SELECT tenant_id,project_id INTO tenant,project FROM cloud_event_triggers WHERE id=(body->>'trigger_id')::uuid;
 ELSIF nullif(body->>'operation_id','') IS NOT NULL THEN
  SELECT tenant_id,project_id INTO tenant,project FROM publication_operations WHERE id=(body->>'operation_id')::uuid;
 ELSIF nullif(body->>'configuration_id','') IS NOT NULL THEN
  SELECT tenant_id,project_id INTO tenant,project FROM project_configurations WHERE id=(body->>'configuration_id')::uuid;
 ELSIF nullif(body->>'workflow_id','') IS NOT NULL THEN
  SELECT tenant_id,project_id INTO tenant,project FROM workflows WHERE id=(body->>'workflow_id')::uuid;
 ELSIF nullif(body->>'creative_id','') IS NOT NULL OR nullif(body->>'video_id','') IS NOT NULL THEN
  SELECT tenant_id,project_id INTO tenant,project FROM creative_projects WHERE id=coalesce(body->>'creative_id',body->>'video_id')::uuid;
 ELSIF nullif(body->>'unit_id','') IS NOT NULL THEN
  SELECT tenant_id,project_id INTO tenant,project FROM creative_matrix_units WHERE id=(body->>'unit_id')::uuid;
 ELSIF tab='cloud_runtime_frames' THEN
  SELECT tenant_id,project_id INTO tenant,project FROM cloud_runtime_sessions WHERE id=(body->>'session_id')::uuid;
 ELSIF nullif(body->>'connection_id','') IS NOT NULL THEN
  SELECT tenant_id,project_id INTO tenant,project FROM connections WHERE id=nullif(body->>'connection_id','')::uuid;
 END IF;
 RETURN jsonb_build_object('tenant_id',tenant,'project_id',project);
END $$;
ALTER FUNCTION erasure_row_scope(text,jsonb) OWNER TO cp_control;
REVOKE ALL ON FUNCTION erasure_row_scope(text,jsonb) FROM PUBLIC;

-- INSERT never bypasses a permanent root fence. UPDATE only fences private
-- fields, so in-flight settlement can still append minimal financial facts.
CREATE OR REPLACE FUNCTION guard_scope_erasure_admission() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE body jsonb:=to_jsonb(NEW); resolved jsonb; tenant uuid; project uuid; tenant_erased boolean; project_erased boolean; field text; changed boolean:=false; clearing boolean:=true;
BEGIN
 IF TG_OP='UPDATE' THEN
  FOREACH field IN ARRAY string_to_array(TG_ARGV[0],',') LOOP
   IF body->field IS DISTINCT FROM to_jsonb(OLD)->field THEN
    changed:=true;
    IF body->field IS NOT NULL AND body->field NOT IN('null'::jsonb,'{}'::jsonb,'[]'::jsonb,'""'::jsonb,'"[deleted]"'::jsonb,'"[Removed]"'::jsonb) THEN clearing:=false; END IF;
   END IF;
  END LOOP;
  IF NOT changed THEN RETURN NEW; END IF;
  IF clearing THEN RETURN NEW; END IF;
  -- Child erasers already verify a deleted resource and use the controlled
  -- identity. Application SQL cannot set this flag to regain content writes.
  IF session_user NOT IN('cp_app','cp_queue') AND current_setting('app.erasing_content',true)='true' THEN RETURN NEW; END IF;
 END IF;
 resolved:=erasure_row_scope(TG_TABLE_NAME,body);
 tenant:=(resolved->>'tenant_id')::uuid; project:=(resolved->>'project_id')::uuid;
 SELECT erasure_requested_at IS NOT NULL INTO tenant_erased FROM tenants WHERE id=tenant FOR KEY SHARE;
 SELECT erasure_requested_at IS NOT NULL INTO project_erased FROM projects WHERE id=project FOR KEY SHARE;
 IF coalesce(tenant_erased,false) OR coalesce(project_erased,false) THEN
  IF TG_TABLE_NAME='cloud_runtime_commands' AND session_user NOT IN('cp_app','cp_queue') THEN
   IF TG_OP='INSERT' AND body->>'kind'='stop'
    AND EXISTS(SELECT 1 FROM cloud_runtime_sessions s WHERE s.id=(body->>'session_id')::uuid AND s.tenant_id=tenant AND s.project_id=project
      AND s.node_id=(body->>'node_id')::uuid AND s.generation=(body->>'generation')::integer) THEN
    NEW:=jsonb_populate_record(NEW,body||'{"body":{"reason":"PRIVATE_CONTENT_REMOVED"}}'::jsonb); RETURN NEW;
   END IF;
   IF TG_OP='UPDATE' THEN
    NEW:=jsonb_populate_record(NEW,body||jsonb_build_object('result',NULL,'body',
      CASE WHEN body#>>'{body,receipt_hash}' ~ '^[a-f0-9]{64}$' THEN jsonb_build_object('receipt_hash',body#>>'{body,receipt_hash}')
       WHEN body->>'kind'='stop' AND body->'body'='{"reason":"PRIVATE_CONTENT_REMOVED"}'::jsonb THEN body->'body' ELSE '{}'::jsonb END));
    RETURN NEW;
   END IF;
  END IF;
  IF TG_TABLE_NAME='cloud_runtime_events' AND session_user NOT IN('cp_app','cp_queue') THEN NEW:=jsonb_populate_record(NEW,body||'{"body":{}}'::jsonb); RETURN NEW; END IF;
  -- Settlement may append immutable IDs, amounts and operation states after
  -- a scope fence. Drop their private payload while preserving accounting.
  IF TG_TABLE_NAME='tool_operations' THEN NEW:=jsonb_populate_record(NEW,body||'{"result":null}'::jsonb); RETURN NEW; END IF;
  IF TG_TABLE_NAME='task_events' THEN NEW:=jsonb_populate_record(NEW,body||'{"body":{}}'::jsonb); RETURN NEW; END IF;
  RAISE EXCEPTION 'Permanently deleted scope cannot accept private content' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;

-- Fixed private-field policy. Financial ledgers, receipts and audit evidence
-- intentionally do not appear here; no generic cascading DELETE is used.
DO $$ DECLARE tab text; fields text; field text; item jsonb; BEGIN
 FOR tab,item IN SELECT * FROM jsonb_each('{
  "projects":"name,description",
  "assets":"name", "asset_versions":"metadata,storage_key",
  "tasks":"title,prompt,input_context,output", "agents":"name", "agent_versions":"body",
  "task_events":"body", "tool_operations":"result", "task_plans":"body", "task_input_checkpoints":"requests", "task_tool_receipts":"result",
  "delivery_reviews":"comment,delivery_snapshot",
  "conversations":"name", "conversation_messages":"body", "memories":"name", "memory_versions":"content,definition",
  "brand_profiles":"name,body", "brand_profile_versions":"name,body",
  "analytics_datasets":"name,rows,raw_csv,source_filename,import_spec,import_metadata,metric_snapshot", "dataset_evidence":"body",
  "analysis_reports":"spec,calculation,narrative,validation", "analysis_snapshots":"body", "analysis_evidence":"body",
  "creative_mappings":"name,body", "creative_feedback_reports":"name,body",
  "geo_experiments":"name,body", "geo_runs":"name,body", "geo_samples":"name,body,analysis",
  "workflows":"name,definition", "workflow_versions":"definition,role_hashes,source_refs",
  "workflow_runs":"definition,results,input_values,input_files,named_outputs", "workflow_schedules":"name", "workflow_schedule_versions":"body",
  "creative_projects":"name,body", "poster_project_versions":"name,body", "editable_project_versions":"input,renderer_profile",
  "video_project_versions":"definition,renderer_profile", "video_renders":"probe", "creative_matrix_revisions":"input",
  "workspace_nodes":"name", "agent_groups":"name", "agent_group_runs":"name,definition",
  "agent_group_versions":"body", "agent_group_members":"role_description", "agent_group_nodes":"body",
  "seo_runs":"checkpoint", "seo_change_tasks":"spec",
  "cloud_runtime_quotes":"body", "cloud_runtime_sessions":"", "cloud_runtime_commands":"body,result", "cloud_runtime_events":"body", "cloud_runtime_frames":"body",
  "upload_sessions":"filename,result", "connections":"encrypted_secret,name,scopes",
  "oauth_states":"encrypted_verifier", "connector_oauth_states":"encrypted_verifier,encrypted_state",
  "connector_accounts":"body", "connector_profiles":"account_ids,project_ids", "connector_jobs":"specification,encrypted_cursor",
  "project_configurations":"name,draft", "project_configuration_versions":"body", "solution_versions":"definition,frozen", "solution_installations":"name,bindings", "solution_trials":"bindings,resolved_sources",
  "agent_template_preflights":"result", "agent_adoption_previews":"comparison,guards,result", "agent_group_preflights":"definition",
  "cloud_schedule_requests":"body", "cloud_schedule_versions":"body", "cloud_schedules":"name",
  "cloud_event_requests":"body", "cloud_event_triggers":"name", "cloud_event_versions":"body", "cloud_event_keys":"sealed_secret", "cloud_event_inbox":"data",
  "publication_previews":"specification", "publication_operations":"specification", "publication_oauth_states":"encrypted_state,encrypted_cookie",
  "publication_policies":"body", "publication_connection_projects":"",
  "publication_sources":"rendition_key", "publication_effects":"request_encrypted", "publication_media_grants":"encrypted_token",
  "publication_connections":"encrypted_secret,external_user_id,scopes", "publication_targets":"encrypted_secret,name,capabilities,enabled",
  "desktop_executions":"credential_cipher,credential_hash", "skill_installations":"enabled,state",
  "devices":"name,public_key,grants", "device_commands":"payload,result",
  "sso_connections":"name,client_secret,metadata,domains,enabled", "federation_attempts":"email,subject,secrets,next_path", "federated_identities":"subject,status",
  "invites":"email,project_ids", "invitation_deliveries":"token_cipher"
 }'::jsonb) LOOP
  fields:=item#>>'{}';
  FOREACH field IN ARRAY string_to_array(fields,',') LOOP
   IF NOT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_schema='public' AND table_name=tab AND column_name=field) THEN
    RAISE EXCEPTION 'Unknown private-content fence column %.%',tab,field;
   END IF;
  END LOOP;
  EXECUTE format('DROP TRIGGER IF EXISTS scope_erasure_admission ON %I',tab);
  EXECUTE format('CREATE TRIGGER scope_erasure_admission BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION guard_scope_erasure_admission(%L)',tab,fields);
 END LOOP;
END $$;

GRANT EXECUTE ON FUNCTION scope_erasure_authorized(text,jsonb) TO cp_app,cp_queue;
GRANT UPDATE(body) ON publication_policies TO cp_control;
GRANT UPDATE(result) ON agent_template_preflights TO cp_control;

-- A generated asset is an output of its original task. Always normalize that
-- exact pair to task -> asset, independent of insertion order or visibility of
-- a reverse edge. Input assets of a different task keep their original edges.
CREATE FUNCTION erasure_asset_owned_by_task(asset uuid,task uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM asset_versions v WHERE v.asset_id=asset AND (
  v.metadata->>'task_id'=task::text OR EXISTS(SELECT 1 FROM seo_runs r WHERE r.task_id=task AND v.metadata->>'seo_run_id'=r.id::text)
  OR EXISTS(SELECT 1 FROM seo_change_tasks c WHERE c.task_id=task AND v.metadata->>'seo_change_task_id'=c.id::text)
  OR EXISTS(SELECT 1 FROM seo_runs r WHERE r.task_id=task AND v.id IN(r.result_asset_version_id,r.report_asset_version_id))
  OR EXISTS(SELECT 1 FROM seo_change_tasks c WHERE c.task_id=task AND v.id IN(c.json_asset_version_id,c.html_asset_version_id))))
$$;
ALTER FUNCTION erasure_asset_owned_by_task(uuid,uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION erasure_asset_owned_by_task(uuid,uuid) FROM PUBLIC;
CREATE FUNCTION normalize_erasure_output_dependency() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE parent deletion_jobs; child deletion_jobs;
BEGIN
 SELECT * INTO parent FROM deletion_jobs WHERE id=NEW.job_id;
 SELECT * INTO child FROM deletion_jobs WHERE id=NEW.child_job_id;
 IF parent.tenant_id=child.tenant_id AND parent.project_id IS NOT DISTINCT FROM child.project_id
  AND parent.target_type='assets' AND child.target_type='tasks' AND erasure_asset_owned_by_task(parent.target_id,child.target_id) THEN
  INSERT INTO deletion_dependencies(job_id,child_job_id) VALUES(child.id,parent.id) ON CONFLICT DO NOTHING;
  RETURN NULL;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION normalize_erasure_output_dependency() OWNER TO cp_control;
REVOKE ALL ON FUNCTION normalize_erasure_output_dependency() FROM PUBLIC;
CREATE TRIGGER normalize_erasure_output BEFORE INSERT ON deletion_dependencies FOR EACH ROW EXECUTE FUNCTION normalize_erasure_output_dependency();
INSERT INTO deletion_dependencies(job_id,child_job_id)
 SELECT c.id,p.id FROM deletion_dependencies e JOIN deletion_jobs p ON p.id=e.job_id JOIN deletion_jobs c ON c.id=e.child_job_id
 WHERE p.target_type='assets' AND c.target_type='tasks' AND p.tenant_id=c.tenant_id AND p.project_id IS NOT DISTINCT FROM c.project_id
 AND erasure_asset_owned_by_task(p.target_id,c.target_id) ON CONFLICT DO NOTHING;
DELETE FROM deletion_dependencies e USING deletion_jobs p,deletion_jobs c WHERE e.job_id=p.id AND e.child_job_id=c.id
 AND p.target_type='assets' AND c.target_type='tasks' AND p.tenant_id=c.tenant_id AND p.project_id IS NOT DISTINCT FROM c.project_id
 AND erasure_asset_owned_by_task(p.target_id,c.target_id);
INSERT INTO schema_migrations(version) VALUES(146);
