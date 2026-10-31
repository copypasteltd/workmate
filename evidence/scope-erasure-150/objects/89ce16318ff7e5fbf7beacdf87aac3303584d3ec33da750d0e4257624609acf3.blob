"""Prepare a forward migration; never rewrites any previously applied migration."""
from pathlib import Path
import re

root = Path(__file__).resolve().parents[1]
target = root / 'migrations/146-scope-erasure.sql'
base = target.read_text(encoding='utf-8').split('-- Controlled immutable-record erasure exceptions.')[0]
base = base.replace('INSERT INTO schema_migrations(version) VALUES(146);', '')
parts = [base, '-- Controlled immutable-record erasure exceptions. Identity, hashes and accounting facts remain immutable.\n']


def wrap(name, prelude):
    definitions = []
    for file in sorted((root / 'migrations').glob('*.sql')):
        if int(file.name.split('-')[0]) >= 146:
            continue
        definitions += re.findall(r'CREATE(?: OR REPLACE)? FUNCTION ' + name + r'\(\).*?\$\$;', file.read_text(encoding='utf-8'), re.S)
    assert definitions, name
    sql = re.sub(r'^CREATE(?: OR REPLACE)? FUNCTION', 'CREATE OR REPLACE FUNCTION', definitions[-1])
    sql = sql.replace('BEGIN', 'BEGIN\n' + prelude, 1)
    parts.append(sql + '\n')


def redact(name, columns, condition, more=''):
    omitted = "ARRAY[" + ','.join("'" + c + "'" for c in columns) + "]"
    wrap(name, f""" IF TG_OP='UPDATE' AND scope_erasure_authorized(TG_TABLE_NAME,to_jsonb(OLD))
  AND ({condition}) AND (to_jsonb(NEW)-{omitted}) IS NOT DISTINCT FROM (to_jsonb(OLD)-{omitted}) {more} THEN RETURN NEW; END IF;
""")


redact('guard_connector_job', ['specification', 'encrypted_cursor', 'cursor_hashes', 'limitations', 'lease_token', 'lease_until', 'state', 'finished_at', 'revision'],
    "NEW.specification='{}' AND NEW.encrypted_cursor IS NULL AND NEW.cursor_hashes='{}' AND NEW.limitations='{}' AND NEW.lease_token IS NULL AND NEW.lease_until IS NULL AND NEW.state=CASE WHEN OLD.state IN('queued','running') THEN 'cancelled' ELSE OLD.state END AND NEW.revision=OLD.revision+1 AND NEW.finished_at IS NOT NULL")
redact('guard_solution_version', ['definition', 'frozen', 'state', 'disabled_at', 'disable_reason'],
    "NEW.definition=jsonb_build_object('project_id',OLD.project_id) AND NEW.frozen='[{}]' AND NEW.state='disabled' AND NEW.disabled_at IS NOT NULL AND NEW.disable_reason='SCOPE_ERASED'")
redact('guard_solution_installation', ['name', 'bindings', 'revision', 'updated_at'],
    "NEW.name='[deleted]' AND NEW.bindings='{" + '"assets":[],"connectors":[]' + "}' AND NEW.revision=OLD.revision+1")
redact('guard_solution_trial', ['bindings', 'resolved_sources'], "NEW.bindings='{}' AND NEW.resolved_sources='[]'")
redact('guard_project_configuration', ['name', 'draft', 'content_state', 'moderation_version'],
    "NEW.name='[deleted]' AND NEW.draft='{}' AND NEW.content_state='deleted' AND NEW.moderation_version=OLD.moderation_version+1")
redact('guard_desktop_execution', ['credential_cipher', 'credential_hash', 'credential_expires_at', 'state'],
    "NEW.credential_cipher IS NULL AND NEW.credential_hash IS NULL AND NEW.credential_expires_at IS NULL AND NEW.state=CASE WHEN OLD.state='running' AND EXISTS(SELECT 1 FROM recovery_environment WHERE singleton AND state='quarantined') THEN 'reconciling' ELSE OLD.state END",
    "AND (NOT EXISTS(SELECT 1 FROM tasks t WHERE t.id=OLD.task_id AND t.status IN('queued','running','paused','awaiting_approval','needs_input','reconciling')) OR EXISTS(SELECT 1 FROM recovery_environment WHERE singleton AND state='quarantined'))")
wrap('guard_agent_adoption_preview', " IF TG_OP='DELETE' AND scope_erasure_authorized(TG_TABLE_NAME,to_jsonb(OLD)) THEN RETURN OLD; END IF;\n")
redact('guard_canonical_support_session', ['revoked_at', 'body_granted'],
    "NEW.revoked_at IS NOT NULL AND NOT NEW.body_granted AND (OLD.revoked_at IS NULL OR NEW.revoked_at=OLD.revoked_at)")

parts.append(r'''
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
''')
target.write_text('\n'.join(parts), encoding='utf-8', newline='\n')
print('Prepared forward scope-erasure migration 146')
