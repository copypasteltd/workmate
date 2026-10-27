-- SQL001-093 are published and immutable. Cloud workflows keep their defaults.
ALTER TABLE workflows ADD COLUMN execution_location text NOT NULL DEFAULT 'cloud' CHECK(execution_location IN('cloud','desktop'));
ALTER TABLE workflows ADD COLUMN private_owner uuid REFERENCES users(id);
ALTER TABLE workflows ADD COLUMN origin_task_id uuid REFERENCES tasks(id);
ALTER TABLE workflows ADD CONSTRAINT native_workflow_scope CHECK(
 (execution_location='cloud' AND private_owner IS NULL AND origin_task_id IS NULL) OR
 (execution_location='desktop' AND private_owner=created_by AND private_owner IS NOT NULL AND origin_task_id IS NOT NULL));
ALTER TABLE workflow_runs ADD COLUMN execution_location text NOT NULL DEFAULT 'cloud' CHECK(execution_location IN('cloud','desktop'));
ALTER TABLE workflow_runs ADD COLUMN private_owner uuid REFERENCES users(id);
ALTER TABLE workflow_runs ADD COLUMN origin_task_id uuid REFERENCES tasks(id);
ALTER TABLE workflow_runs ADD COLUMN revision integer NOT NULL DEFAULT 1 CHECK(revision>0);
ALTER TABLE workflow_runs ADD COLUMN authorized_at timestamptz;
ALTER TABLE workflow_runs ADD CONSTRAINT native_workflow_run_scope CHECK(
 (execution_location='cloud' AND private_owner IS NULL AND origin_task_id IS NULL) OR
 (execution_location='desktop' AND private_owner=created_by AND private_owner IS NOT NULL AND origin_task_id IS NOT NULL AND workflow_version IS NOT NULL));
CREATE INDEX desktop_workflow_origin ON workflow_runs(origin_task_id) WHERE execution_location='desktop';
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['workflows','workflow_runs'] LOOP
  EXECUTE format('CREATE POLICY native_owner_scope ON %I AS RESTRICTIVE FOR ALL TO cp_app USING(private_owner IS NULL OR private_owner=nullif(current_setting(''app.actor_id'',true),'''')::uuid) WITH CHECK(private_owner IS NULL OR private_owner=nullif(current_setting(''app.actor_id'',true),'''')::uuid)',t);
 END LOOP;
END $$;

CREATE TABLE workflow_versions (
 workflow_id uuid NOT NULL REFERENCES workflows(id),version integer NOT NULL CHECK(version>0),
 tenant_id uuid NOT NULL,project_id uuid NOT NULL,private_owner uuid NOT NULL REFERENCES users(id),
 definition jsonb NOT NULL,definition_hash text NOT NULL CHECK(definition_hash ~ '^[a-f0-9]{64}$'),
 role_hashes jsonb NOT NULL,source_refs jsonb NOT NULL CHECK(jsonb_typeof(source_refs)='object'),published_at timestamptz,created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(workflow_id,version),FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
ALTER TABLE workflow_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY native_version_scope ON workflow_versions USING(current_user='cp_control' OR
 (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND private_owner=nullif(current_setting('app.actor_id',true),'')::uuid
  AND EXISTS(SELECT 1 FROM workflows w WHERE w.id=workflow_id AND w.content_state='active')))
 WITH CHECK(current_user='cp_control' OR (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND private_owner=nullif(current_setting('app.actor_id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM workflows w WHERE w.id=workflow_id AND w.execution_location='desktop' AND w.private_owner=workflow_versions.private_owner
 AND w.tenant_id=workflow_versions.tenant_id AND w.project_id=workflow_versions.project_id)));
GRANT SELECT,INSERT ON workflow_versions TO cp_app,cp_control;
GRANT UPDATE(published_at) ON workflow_versions TO cp_app;
GRANT UPDATE ON workflow_versions TO cp_control;

CREATE FUNCTION immutable_workflow_version() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND OLD.published_at IS NULL AND NEW.published_at IS NOT NULL
 AND (to_jsonb(OLD)-'published_at')=(to_jsonb(NEW)-'published_at') THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND current_user='cp_control' AND current_setting('app.erasing_content',true)='true'
 AND ROW(NEW.workflow_id,NEW.version,NEW.tenant_id,NEW.project_id,NEW.private_owner,NEW.definition_hash,NEW.created_at)
 IS NOT DISTINCT FROM ROW(OLD.workflow_id,OLD.version,OLD.tenant_id,OLD.project_id,OLD.private_owner,OLD.definition_hash,OLD.created_at)
 AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at AND NEW.definition='{}'::jsonb AND NEW.role_hashes='{}'::jsonb AND NEW.source_refs='{}'::jsonb THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Workflow version is immutable' USING ERRCODE='42501';
END $$;
CREATE TRIGGER workflow_version_immutable BEFORE UPDATE OR DELETE ON workflow_versions FOR EACH ROW EXECUTE FUNCTION immutable_workflow_version();

CREATE TABLE native_workflow_reads (
 task_id uuid NOT NULL REFERENCES tasks(id),workflow_id uuid NOT NULL,version integer NOT NULL,
 tenant_id uuid NOT NULL,project_id uuid NOT NULL,private_owner uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(task_id,workflow_id,version),
 FOREIGN KEY(workflow_id,version) REFERENCES workflow_versions(workflow_id,version),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
ALTER TABLE native_workflow_reads ENABLE ROW LEVEL SECURITY;
ALTER TABLE native_workflow_reads FORCE ROW LEVEL SECURITY;
CREATE POLICY native_read_scope ON native_workflow_reads USING(current_user='cp_control' OR
 (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND private_owner=nullif(current_setting('app.actor_id',true),'')::uuid))
 WITH CHECK(current_user='cp_control' OR (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND private_owner=nullif(current_setting('app.actor_id',true),'')::uuid));
GRANT SELECT,INSERT ON native_workflow_reads TO cp_app,cp_control;
CREATE FUNCTION check_native_workflow_read() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Native workflow reads are immutable' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM tasks t JOIN workflow_versions v ON v.workflow_id=NEW.workflow_id AND v.version=NEW.version
 JOIN workflows w ON w.id=v.workflow_id WHERE t.id=NEW.task_id AND t.id=nullif(current_setting('app.task_id',true),'')::uuid
 AND t.execution_location='desktop' AND t.status='running' AND NOT t.cancel_requested AND t.content_state='active'
 AND t.private_owner=NEW.private_owner AND t.tenant_id=NEW.tenant_id AND t.project_id=NEW.project_id
 AND w.content_state='active' AND w.private_owner=t.private_owner AND w.tenant_id=t.tenant_id AND w.project_id=t.project_id
 AND v.private_owner=w.private_owner AND v.tenant_id=w.tenant_id AND v.project_id=w.project_id) THEN
  RAISE EXCEPTION 'Invalid native workflow read' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION check_native_workflow_read() OWNER TO cp_control;
REVOKE ALL ON FUNCTION check_native_workflow_read() FROM PUBLIC;
CREATE TRIGGER native_workflow_read_scope BEFORE INSERT OR UPDATE OR DELETE ON native_workflow_reads FOR EACH ROW EXECUTE FUNCTION check_native_workflow_read();

ALTER TABLE tasks ADD COLUMN desktop_workflow_run_id uuid REFERENCES workflow_runs(id);
ALTER TABLE tasks ADD COLUMN desktop_workflow_cursor integer;
ALTER TABLE tasks ADD CONSTRAINT desktop_workflow_step CHECK(
 (desktop_workflow_run_id IS NULL AND desktop_workflow_cursor IS NULL) OR
 (desktop_workflow_run_id IS NOT NULL AND desktop_workflow_cursor BETWEEN 0 AND 7 AND execution_location='desktop' AND private_owner=created_by));
CREATE UNIQUE INDEX one_native_workflow_step ON tasks(desktop_workflow_run_id,desktop_workflow_cursor) WHERE desktop_workflow_run_id IS NOT NULL;

CREATE FUNCTION check_native_workflow_scope() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.execution_location,NEW.private_owner,NEW.origin_task_id)
 IS DISTINCT FROM ROW(OLD.execution_location,OLD.private_owner,OLD.origin_task_id) THEN
  RAISE EXCEPTION 'Workflow origin and privacy are immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND NEW.execution_location='desktop' AND NOT EXISTS(
  SELECT 1 FROM tasks t JOIN desktop_executions d ON d.task_id=t.id
  WHERE t.id=NEW.origin_task_id AND t.id=nullif(current_setting('app.task_id',true),'')::uuid
  AND t.created_by=NEW.private_owner AND t.tenant_id=NEW.tenant_id AND t.project_id=NEW.project_id
  AND t.role_key='workflow-consultant' AND t.execution_location='desktop' AND t.desktop_workflow_run_id IS NULL
  AND t.status='running' AND NOT t.cancel_requested AND t.content_state='active' AND t.lease_until>clock_timestamp()
  AND d.state='running' AND d.credential_expires_at>clock_timestamp()) THEN
  RAISE EXCEPTION 'Invalid native workflow origin' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='workflow_runs' THEN
 IF TG_OP='UPDATE' AND OLD.execution_location='desktop' AND ROW(NEW.definition,NEW.workflow_version,NEW.role_hashes,NEW.workflow_id)
 IS DISTINCT FROM ROW(OLD.definition,OLD.workflow_version,OLD.role_hashes,OLD.workflow_id)
 AND NOT(current_user='cp_control' AND coalesce(current_setting('app.erasing_content',true),'')='true' AND NEW.definition='{}'::jsonb AND NEW.results='[]'::jsonb) THEN
  RAISE EXCEPTION 'Native workflow run definition is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND NEW.execution_location='desktop' AND NOT EXISTS(
  SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workflow_id=w.id AND v.version=NEW.workflow_version AND v.published_at IS NOT NULL
  WHERE w.id=NEW.workflow_id AND w.execution_location='desktop' AND w.private_owner=NEW.private_owner
   AND w.tenant_id=NEW.tenant_id AND w.project_id=NEW.project_id AND w.content_state='active'
   AND v.definition=NEW.definition AND v.role_hashes=NEW.role_hashes) THEN
  RAISE EXCEPTION 'Native workflow version mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_TABLE_NAME='workflows' AND TG_OP='UPDATE' THEN
 IF OLD.execution_location='desktop' AND NEW.definition IS DISTINCT FROM OLD.definition
 AND NOT(NEW.version=OLD.version+1 AND NEW.state='draft')
 AND NOT(coalesce(current_setting('app.erasing_content',true),'')='true' AND NEW.definition='{}'::jsonb) THEN
  RAISE EXCEPTION 'Native workflow edits require a new draft version' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION check_native_workflow_scope() OWNER TO cp_control;
REVOKE ALL ON FUNCTION check_native_workflow_scope() FROM PUBLIC;
CREATE TRIGGER native_workflow_origin BEFORE INSERT OR UPDATE ON workflows FOR EACH ROW EXECUTE FUNCTION check_native_workflow_scope();
CREATE TRIGGER native_workflow_run_origin BEFORE INSERT OR UPDATE ON workflow_runs FOR EACH ROW EXECUTE FUNCTION check_native_workflow_scope();

CREATE FUNCTION check_native_workflow_step() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF TG_OP='UPDATE' AND OLD.desktop_workflow_run_id IS NOT NULL AND ROW(NEW.desktop_workflow_run_id,NEW.desktop_workflow_cursor)
 IS DISTINCT FROM ROW(OLD.desktop_workflow_run_id,OLD.desktop_workflow_cursor) THEN
  RAISE EXCEPTION 'Native workflow step binding is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.desktop_workflow_run_id IS NOT NULL AND (TG_OP='INSERT' OR OLD.desktop_workflow_run_id IS NULL) AND NOT EXISTS(
  SELECT 1 FROM workflow_runs r JOIN tasks root ON root.id=r.origin_task_id
  WHERE r.id=NEW.desktop_workflow_run_id AND r.execution_location='desktop' AND r.private_owner=NEW.created_by
   AND r.tenant_id=NEW.tenant_id AND r.project_id=NEW.project_id AND r.cursor=NEW.desktop_workflow_cursor
   AND r.state='running' AND r.authorized_at IS NOT NULL AND r.content_state='active'
   AND (r.definition->'steps'->r.cursor->>'kind')='codex'
   AND (r.definition->'steps'->r.cursor->>'role_key')=NEW.role_key
   AND (r.definition->'steps'->r.cursor->>'budget_micros')::bigint=NEW.budget_micros
   AND NEW.role_key<>'workflow-consultant' AND root.status='running' AND NOT root.cancel_requested AND root.content_state='active'
   AND root.lease_until>clock_timestamp() AND root.id=nullif(current_setting('app.task_id',true),'')::uuid) THEN
  RAISE EXCEPTION 'Invalid native workflow step' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION check_native_workflow_step() OWNER TO cp_control;
REVOKE ALL ON FUNCTION check_native_workflow_step() FROM PUBLIC;
CREATE TRIGGER native_workflow_step_scope BEFORE INSERT OR UPDATE OF desktop_workflow_run_id,desktop_workflow_cursor ON tasks FOR EACH ROW EXECUTE FUNCTION check_native_workflow_step();

CREATE FUNCTION stop_native_workflow_run() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF NEW.execution_location='desktop' AND (NEW.state IN('cancelled','failed') OR NEW.content_state<>'active') THEN
  UPDATE tasks SET cancel_requested=true,version=version+1 WHERE desktop_workflow_run_id=NEW.id AND NOT cancel_requested;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION stop_native_workflow_run() OWNER TO cp_control;
REVOKE ALL ON FUNCTION stop_native_workflow_run() FROM PUBLIC;
CREATE TRIGGER native_workflow_run_stopped AFTER UPDATE OF state,content_state ON workflow_runs FOR EACH ROW EXECUTE FUNCTION stop_native_workflow_run();
CREATE FUNCTION stop_native_workflow_origin() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF NEW.execution_location='desktop' AND (NEW.cancel_requested OR NEW.status IN('succeeded','failed','cancelled','reconciling') OR NEW.content_state<>'active') THEN
  UPDATE workflow_runs SET state='cancelled',revision=revision+1,error_code='DESKTOP_ORIGIN_CLOSED'
   WHERE origin_task_id=NEW.id AND state IN('running','awaiting_approval');
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION stop_native_workflow_origin() OWNER TO cp_control;
REVOKE ALL ON FUNCTION stop_native_workflow_origin() FROM PUBLIC;
CREATE TRIGGER native_workflow_origin_stopped AFTER UPDATE OF cancel_requested,status,content_state ON tasks FOR EACH ROW EXECUTE FUNCTION stop_native_workflow_origin();
-- Extend SQL085 source traversal with native immutable workflow reads.
CREATE OR REPLACE FUNCTION content_source_manifest(scope_tenant uuid,scope_project uuid,task_ids uuid[],version_ids uuid[]) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE pending_tasks uuid[]:=task_ids; pending_versions uuid[]:=version_ids; seen_tasks uuid[]:='{}'; seen_versions uuid[]:='{}';
 pending_sources jsonb[]:='{}'; seen_workflows text[]:='{}';
 tid uuid; vid uuid; source_task tasks; source_asset assets; source_version asset_versions; d record; r record; m record; av jsonb; targets jsonb:='[]'; more uuid[]; publication jsonb; bucket text;
BEGIN
 WHILE cardinality(pending_tasks)>0 OR cardinality(pending_versions)>0 OR cardinality(pending_sources)>0 LOOP
  IF cardinality(seen_tasks)+cardinality(seen_versions)+cardinality(seen_workflows)>4096 THEN RETURN NULL; END IF;
  IF cardinality(pending_tasks)>0 THEN
   tid:=pending_tasks[1]; pending_tasks:=pending_tasks[2:];
   IF tid=ANY(seen_tasks) THEN CONTINUE; END IF;
   seen_tasks:=array_append(seen_tasks,tid);
   SELECT * INTO source_task FROM tasks WHERE id=tid AND tenant_id=scope_tenant AND project_id=scope_project;
   IF source_task.id IS NULL OR source_task.content_state<>'active' OR (source_task.status IN('succeeded','failed','cancelled') AND source_task.retention_expires_at<=clock_timestamp()) THEN RETURN NULL; END IF;
   FOR r IN SELECT x.*,v.source_refs FROM native_workflow_reads x JOIN workflow_versions v ON v.workflow_id=x.workflow_id AND v.version=x.version WHERE x.task_id=source_task.id LOOP
    IF NOT EXISTS(SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workflow_id=w.id AND v.version=r.version
     WHERE w.id=r.workflow_id AND w.tenant_id=scope_tenant AND w.project_id=scope_project
      AND w.private_owner=source_task.private_owner AND w.content_state='active') THEN RETURN NULL; END IF;
    targets:=targets||jsonb_build_array(jsonb_build_object('kind','workflows','id',r.workflow_id));
    IF NOT (r.workflow_id::text||':'||r.version::text)=ANY(seen_workflows) THEN
     seen_workflows:=array_append(seen_workflows,r.workflow_id::text||':'||r.version::text);
     pending_sources:=array_append(pending_sources,r.source_refs);
    END IF;
   END LOOP;
   FOR r IN SELECT * FROM workflow_runs WHERE execution_location='desktop'
    AND (origin_task_id=source_task.id OR id=source_task.desktop_workflow_run_id) LOOP
    IF r.tenant_id<>scope_tenant OR r.project_id<>scope_project OR r.private_owner IS DISTINCT FROM source_task.private_owner
     OR r.content_state<>'active' OR NOT EXISTS(SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workflow_id=w.id AND v.version=r.workflow_version
       WHERE w.id=r.workflow_id AND w.content_state='active' AND w.private_owner=r.private_owner AND v.published_at IS NOT NULL
        AND v.definition=r.definition AND v.role_hashes=r.role_hashes) THEN RETURN NULL; END IF;
    targets:=targets||jsonb_build_array(jsonb_build_object('kind','workflows','id',r.workflow_id),jsonb_build_object('kind','workflow_runs','id',r.id));
    IF NOT (r.workflow_id::text||':'||r.workflow_version::text)=ANY(seen_workflows) THEN
     seen_workflows:=array_append(seen_workflows,r.workflow_id::text||':'||r.workflow_version::text);
     SELECT v.source_refs INTO publication FROM workflow_versions v WHERE v.workflow_id=r.workflow_id AND v.version=r.workflow_version;
     pending_sources:=array_append(pending_sources,publication);
    END IF;
    SELECT coalesce(array_agg(x.id),'{}') INTO more FROM tasks x WHERE x.desktop_workflow_run_id=r.id;
    pending_tasks:=pending_tasks||more||ARRAY[r.origin_task_id];
   END LOOP;
   IF NOT EXISTS(SELECT 1 FROM memberships x JOIN users u ON u.id=x.user_id JOIN tenants z ON z.id=x.tenant_id JOIN projects p ON p.id=source_task.project_id
    WHERE x.tenant_id=source_task.tenant_id AND x.user_id=source_task.created_by AND x.status='active' AND u.status='active' AND z.status='active' AND NOT p.archived
    AND (x.role IN('owner','admin') OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=x.user_id))) THEN RETURN NULL; END IF;
   IF source_task.conversation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversations c WHERE c.id=source_task.conversation_id AND c.content_state='active' AND c.created_by=source_task.created_by) THEN RETURN NULL; END IF;
   IF source_task.input_context ? 'agent_id' THEN
    SELECT v.body INTO av FROM agents x JOIN agent_versions v ON v.agent_id=x.id AND v.version=(source_task.input_context->>'agent_version')::int
     WHERE x.id=(source_task.input_context->>'agent_id')::uuid AND x.tenant_id=source_task.tenant_id AND x.project_id=source_task.project_id AND x.content_state='active';
    IF av IS NULL THEN RETURN NULL; END IF;
    targets:=targets||jsonb_build_array(jsonb_build_object('kind','agents','id',source_task.input_context->>'agent_id'));
    IF av->'brand'->>'id' IS NOT NULL THEN
     IF NOT EXISTS(SELECT 1 FROM brand_profiles b WHERE b.id=(av->'brand'->>'id')::uuid AND b.tenant_id=source_task.tenant_id AND b.project_id=source_task.project_id AND b.content_state='active') THEN RETURN NULL; END IF;
     targets:=targets||jsonb_build_array(jsonb_build_object('kind','brand_profiles','id',av->'brand'->>'id'));
    END IF;
    FOR r IN SELECT * FROM jsonb_to_recordset(coalesce(source_task.input_context->'memories','[]')) AS x(id uuid,version int) LOOP
     SELECT x.*,v.content INTO m FROM memories x JOIN memory_versions v ON v.memory_id=x.id AND v.version=r.version
      WHERE x.id=r.id AND x.tenant_id=source_task.tenant_id AND x.content_state='active' AND (x.expires_at IS NULL OR x.expires_at>clock_timestamp());
     IF m.id IS NULL OR m.content IS NULL OR (m.scope='tenant' OR (m.scope='personal' AND m.private_owner=source_task.created_by)
      OR (m.scope='project' AND m.project_id=source_task.project_id) OR (m.scope='brand' AND m.project_id=source_task.project_id AND m.brand_id=(av->'brand'->>'id')::uuid)
      OR (m.scope='conversation' AND m.project_id=source_task.project_id AND m.conversation_id=source_task.conversation_id AND m.private_owner=source_task.created_by)) IS NOT TRUE THEN RETURN NULL; END IF;
     targets:=targets||jsonb_build_array(jsonb_build_object('kind','memories','id',r.id));
    END LOOP;
   END IF;
   FOR r IN SELECT * FROM jsonb_to_recordset(coalesce(source_task.input_context->'history','[]')) AS x(id uuid) LOOP
    SELECT x.* INTO m FROM conversation_messages x WHERE x.id=r.id AND x.conversation_id=source_task.conversation_id;
    IF m.id IS NULL THEN RETURN NULL; END IF;
    IF m.role='assistant' AND m.task_id IS NOT NULL THEN pending_tasks:=array_append(pending_tasks,m.task_id); END IF;
   END LOOP;
   SELECT coalesce(array_agg(p.task_id),'{}') INTO more FROM task_plans p WHERE p.approved_task_id=source_task.id;
   pending_tasks:=pending_tasks||more;
   IF source_task.input_context ? 'plan_source_task_id' THEN
    IF NOT(source_task.input_context->>'plan_source_task_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN RETURN NULL; END IF;
    pending_tasks:=array_append(pending_tasks,(source_task.input_context->>'plan_source_task_id')::uuid);
   END IF;
   -- Only consumed inputs constrain a retained result. The initial input
   -- checkpoint must remain usable for a fresh authorized selection.
   IF source_task.attempt>0 THEN
    FOR d IN SELECT * FROM task_dependencies WHERE task_id=source_task.id AND state='resolved' LOOP
     IF d.kind='file' THEN
      IF EXISTS(SELECT 1 FROM unnest(d.resource_ids) x(id) LEFT JOIN asset_versions v ON v.id=x.id LEFT JOIN assets a ON a.id=v.asset_id
       WHERE a.id IS NULL OR a.tenant_id<>source_task.tenant_id OR a.project_id<>source_task.project_id OR (a.private_owner IS NOT NULL AND (a.private_owner IS DISTINCT FROM source_task.created_by OR a.private_owner IS DISTINCT FROM source_task.private_owner))) THEN RETURN NULL; END IF;
      pending_versions:=pending_versions||d.resource_ids;
     ELSE
      IF cardinality(d.resource_ids)<>1 OR NOT EXISTS(SELECT 1 FROM connections c WHERE c.id=d.resource_ids[1] AND c.tenant_id=source_task.tenant_id AND c.project_id=source_task.project_id AND c.state='connected' AND c.provider=d.provider) THEN RETURN NULL; END IF;
      targets:=targets||jsonb_build_array(jsonb_build_object('kind','connections','id',d.resource_ids[1]));
     END IF;
    END LOOP;
   END IF;
   FOR r IN SELECT * FROM task_source_reads WHERE task_id=source_task.id LOOP
    IF r.kind='dataset' THEN
     SELECT * INTO d FROM analytics_datasets x WHERE x.id=r.resource_id AND x.tenant_id=source_task.tenant_id AND x.project_id=source_task.project_id
      AND x.content_state='active' AND x.source_state='active' AND x.retention_expires_at>clock_timestamp();
     IF d.id IS NULL THEN RETURN NULL; END IF;
     targets:=targets||jsonb_build_array(jsonb_build_object('kind','analytics_datasets','id',d.id));
     IF d.source_asset_version_id IS NOT NULL THEN pending_versions:=array_append(pending_versions,d.source_asset_version_id); END IF;
    ELSE
     IF NOT EXISTS(SELECT 1 FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=r.asset_version_id AND v.sha256=r.sha256
      AND a.tenant_id=source_task.tenant_id AND a.project_id=source_task.project_id AND (a.private_owner IS NULL OR (a.private_owner=source_task.created_by AND a.private_owner=source_task.private_owner))) THEN RETURN NULL; END IF;
     IF r.kind='cloud_reference' THEN
      SELECT n.id,n.workspace_id INTO m FROM workspace_nodes n JOIN cloud_workspaces w ON w.id=n.workspace_id WHERE n.id=r.resource_id
       AND n.asset_version_id=r.asset_version_id AND n.content_state='active' AND n.reference_state='ready' AND w.content_state='active'
       AND w.tenant_id=source_task.tenant_id AND w.project_id=source_task.project_id AND (w.private_owner IS NULL OR (w.private_owner=source_task.created_by AND w.conversation_id=source_task.conversation_id));
      IF m.id IS NULL THEN RETURN NULL; END IF;
      targets:=targets||jsonb_build_array(jsonb_build_object('kind','workspace_nodes','id',m.id),jsonb_build_object('kind','cloud_workspaces','id',m.workspace_id));
     END IF;
     pending_versions:=array_append(pending_versions,r.asset_version_id);
    END IF;
   END LOOP;
   IF source_task.conversation_id IS NOT NULL THEN targets:=targets||jsonb_build_array(jsonb_build_object('kind','conversations','id',source_task.conversation_id)); END IF;
  ELSIF cardinality(pending_versions)>0 THEN
   vid:=pending_versions[1]; pending_versions:=pending_versions[2:];
   IF vid=ANY(seen_versions) THEN CONTINUE; END IF;
   seen_versions:=array_append(seen_versions,vid);
   SELECT * INTO source_version FROM asset_versions WHERE id=vid;
   SELECT * INTO source_asset FROM assets WHERE id=source_version.asset_id;
   IF source_asset.id IS NULL OR source_asset.tenant_id<>scope_tenant OR source_asset.project_id<>scope_project OR source_asset.state<>'active' OR source_asset.retention_expires_at<=clock_timestamp()
    OR source_version.erased_at IS NOT NULL OR NOT analysis_asset_available(source_asset.id) OR NOT matrix_asset_available(source_asset.id) OR NOT video_asset_available(source_asset.id) THEN RETURN NULL; END IF;
   targets:=targets||jsonb_build_array(jsonb_build_object('kind','assets','id',source_asset.id));
   IF source_version.metadata ? 'publication_sources' THEN
    pending_sources:=array_append(pending_sources,source_version.metadata->'publication_sources');
   END IF;
   IF source_version.metadata ? 'task_id' THEN
    IF NOT(source_version.metadata->>'task_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN RETURN NULL; END IF;
    pending_tasks:=array_append(pending_tasks,(source_version.metadata->>'task_id')::uuid);
   END IF;
   IF source_version.metadata ? 'publication_source_version_id' THEN
    IF NOT(source_version.metadata->>'publication_source_version_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN RETURN NULL; END IF;
    pending_versions:=array_append(pending_versions,(source_version.metadata->>'publication_source_version_id')::uuid);
   END IF;
  ELSE
   publication:=pending_sources[1]; pending_sources:=pending_sources[2:];
    IF publication->>'schema' IS DISTINCT FROM '1' THEN RETURN NULL; END IF;
    FOREACH bucket IN ARRAY ARRAY['versions','datasets','memories','brands','connections','cloud_references'] LOOP
     IF jsonb_typeof(publication->bucket) IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
    END LOOP;
    SELECT coalesce(array_agg(value::uuid),'{}') INTO more FROM jsonb_array_elements_text(publication->'versions'); pending_versions:=pending_versions||more;
    FOR r IN SELECT value::uuid AS id FROM jsonb_array_elements_text(publication->'datasets') LOOP
     SELECT * INTO d FROM analytics_datasets x WHERE x.id=r.id AND x.tenant_id=scope_tenant AND x.project_id=scope_project
      AND x.content_state='active' AND x.source_state='active' AND x.retention_expires_at>clock_timestamp();
     IF d.id IS NULL THEN RETURN NULL; END IF;
     targets:=targets||jsonb_build_array(jsonb_build_object('kind','analytics_datasets','id',d.id));
     IF d.source_asset_version_id IS NOT NULL THEN pending_versions:=array_append(pending_versions,d.source_asset_version_id); END IF;
    END LOOP;
    FOR r IN SELECT * FROM jsonb_to_recordset(publication->'memories') AS x(id uuid,version int,scope text,project_id uuid,brand_id uuid,conversation_id uuid,private_owner uuid) LOOP
     SELECT x.*,v.content INTO m FROM memories x JOIN memory_versions v ON v.memory_id=x.id AND v.version=r.version WHERE x.id=r.id AND x.tenant_id=scope_tenant;
     IF m.id IS NULL OR m.content IS NULL OR m.content_state<>'active' OR (m.expires_at IS NOT NULL AND m.expires_at<=clock_timestamp())
      OR ROW(m.scope,m.project_id,m.brand_id,m.conversation_id,m.private_owner) IS DISTINCT FROM ROW(r.scope,r.project_id,r.brand_id,r.conversation_id,r.private_owner) THEN RETURN NULL; END IF;
     targets:=targets||jsonb_build_array(jsonb_build_object('kind','memories','id',m.id));
    END LOOP;
    FOR r IN SELECT value::uuid AS id FROM jsonb_array_elements_text(publication->'brands') LOOP
     IF NOT EXISTS(SELECT 1 FROM brand_profiles x WHERE x.id=r.id AND x.tenant_id=scope_tenant AND x.project_id=scope_project AND x.content_state='active') THEN RETURN NULL; END IF;
     targets:=targets||jsonb_build_array(jsonb_build_object('kind','brand_profiles','id',r.id));
    END LOOP;
    FOR r IN SELECT * FROM jsonb_to_recordset(publication->'connections') AS x(id uuid,provider text) LOOP
     IF NOT EXISTS(SELECT 1 FROM connections x WHERE x.id=r.id AND x.tenant_id=scope_tenant AND x.project_id=scope_project AND x.provider=r.provider AND x.state='connected') THEN RETURN NULL; END IF;
     targets:=targets||jsonb_build_array(jsonb_build_object('kind','connections','id',r.id));
    END LOOP;
    FOR r IN SELECT * FROM jsonb_to_recordset(publication->'cloud_references') AS x(id uuid,asset_version_id uuid,workspace_id uuid,private_owner uuid,conversation_id uuid) LOOP
     SELECT n.id,n.workspace_id INTO m FROM workspace_nodes n JOIN cloud_workspaces w ON w.id=n.workspace_id WHERE n.id=r.id
      AND n.asset_version_id=r.asset_version_id AND n.content_state='active' AND n.reference_state='ready' AND w.content_state='active'
      AND w.tenant_id=scope_tenant AND w.project_id=scope_project AND w.id=r.workspace_id
      AND w.private_owner IS NOT DISTINCT FROM r.private_owner AND w.conversation_id IS NOT DISTINCT FROM r.conversation_id;
     IF m.id IS NULL THEN RETURN NULL; END IF;
     targets:=targets||jsonb_build_array(jsonb_build_object('kind','workspace_nodes','id',m.id),jsonb_build_object('kind','cloud_workspaces','id',m.workspace_id));
    END LOOP;
   FOR r IN SELECT * FROM jsonb_to_recordset(coalesce(publication->'workflows','[]'))
    AS ref(workflow_id uuid,version int,private_owner uuid,definition_hash text,run_id uuid) LOOP
    IF NOT EXISTS(SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workflow_id=w.id AND v.version=r.version
      JOIN users u ON u.id=w.private_owner AND u.status='active' JOIN memberships mm ON mm.user_id=u.id AND mm.tenant_id=w.tenant_id AND mm.status='active'
      WHERE w.id=r.workflow_id AND w.tenant_id=scope_tenant AND w.project_id=scope_project AND w.content_state='active'
       AND w.private_owner=r.private_owner AND v.definition_hash=r.definition_hash
       AND (mm.role IN('owner','admin') OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.user_id=u.id AND pm.project_id=w.project_id))) THEN RETURN NULL; END IF;
    IF r.run_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM workflow_runs wr WHERE wr.id=r.run_id AND wr.workflow_id=r.workflow_id
     AND wr.workflow_version=r.version AND wr.private_owner=r.private_owner AND wr.content_state='active') THEN RETURN NULL; END IF;
    targets:=targets||jsonb_build_array(jsonb_build_object('kind','workflows','id',r.workflow_id));
    IF NOT (r.workflow_id::text||':'||r.version::text)=ANY(seen_workflows) THEN
     seen_workflows:=array_append(seen_workflows,r.workflow_id::text||':'||r.version::text);
     pending_sources:=array_append(pending_sources,(SELECT v.source_refs FROM workflow_versions v WHERE v.workflow_id=r.workflow_id AND v.version=r.version));
    END IF;
    IF r.run_id IS NOT NULL THEN targets:=targets||jsonb_build_array(jsonb_build_object('kind','workflow_runs','id',r.run_id)); END IF;
   END LOOP;
  END IF;
 END LOOP;
 RETURN targets;
END $$;

CREATE OR REPLACE FUNCTION lock_task_content_sources(task uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE refs jsonb; source_table text; ids uuid[];
BEGIN
 refs:=task_content_source_manifest(task); IF refs IS NULL THEN RETURN false; END IF;
 FOREACH source_table IN ARRAY ARRAY['workflows','workflow_runs','assets','connections','analytics_datasets','cloud_workspaces','workspace_nodes','agents','brand_profiles','memories','conversations'] LOOP
  SELECT array_agg(x.id ORDER BY x.id) INTO ids FROM (SELECT DISTINCT r.id FROM jsonb_to_recordset(refs) AS r(kind text,id uuid) WHERE r.kind=source_table) x;
  IF cardinality(ids)>0 THEN EXECUTE format('SELECT id FROM %I WHERE id=ANY($1) ORDER BY id FOR SHARE%s',source_table,CASE WHEN source_table='conversations' THEN '' ELSE ' NOWAIT' END) USING ids; END IF;
 END LOOP;
 RETURN task_content_sources_available(task);
END $$;

-- Retain native workflow provenance across explicit and nested publication.
CREATE OR REPLACE FUNCTION publication_input_sources(source_id uuid,source_task_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE scope_tenant uuid; scope_project uuid; file_row asset_versions; task_row tasks; agent_body jsonb; item record;
 pending_versions uuid[]:='{}'; pending_tasks uuid[]:='{}'; seen_versions uuid[]:='{}'; seen_tasks uuid[]:='{}'; next_id uuid; extra uuid[];
 refs jsonb:=jsonb_build_object('schema',1,'versions','[]'::jsonb,'datasets','[]'::jsonb,'memories','[]'::jsonb,'brands','[]'::jsonb,'connections','[]'::jsonb,'cloud_references','[]'::jsonb,'workflows','[]'::jsonb); bucket text;
BEGIN
 IF num_nonnulls(source_id,source_task_id)<>1 THEN RETURN NULL; END IF;
 IF source_id IS NOT NULL THEN
  SELECT a.tenant_id,a.project_id INTO scope_tenant,scope_project FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=source_id
   AND a.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND a.private_owner=nullif(current_setting('app.actor_id',true),'')::uuid;
  IF scope_tenant IS NULL OR content_source_manifest(scope_tenant,scope_project,'{}',ARRAY[source_id]) IS NULL THEN RETURN NULL; END IF;
  pending_versions:=ARRAY[source_id];
 ELSE
  SELECT t.tenant_id,t.project_id INTO scope_tenant,scope_project FROM tasks t WHERE t.id=source_task_id
   AND t.id=nullif(current_setting('app.task_id',true),'')::uuid AND t.execution_location='desktop' AND t.role_key='workflow-consultant'
   AND t.desktop_workflow_run_id IS NULL AND t.status='running' AND NOT t.cancel_requested AND t.content_state='active'
   AND t.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND t.private_owner=nullif(current_setting('app.actor_id',true),'')::uuid;
  IF scope_tenant IS NULL OR content_source_manifest(scope_tenant,scope_project,ARRAY[source_task_id],'{}') IS NULL THEN RETURN NULL; END IF;
  pending_tasks:=ARRAY[source_task_id];
 END IF;
 WHILE cardinality(pending_tasks)>0 OR cardinality(pending_versions)>0 LOOP
  IF cardinality(seen_tasks)+cardinality(seen_versions)>4096 THEN RETURN NULL; END IF;
  IF cardinality(pending_tasks)>0 THEN
   next_id:=pending_tasks[1]; pending_tasks:=pending_tasks[2:];
   IF next_id=ANY(seen_tasks) THEN CONTINUE; END IF; seen_tasks:=array_append(seen_tasks,next_id);
   SELECT * INTO task_row FROM tasks WHERE id=next_id AND tenant_id=scope_tenant AND project_id=scope_project;
   IF task_row.id IS NULL THEN RETURN NULL; END IF;
   FOR item IN SELECT m.id,v.version,m.scope,m.project_id,m.brand_id,m.conversation_id,m.private_owner FROM jsonb_to_recordset(coalesce(task_row.input_context->'memories','[]')) AS r(id uuid,version int)
    JOIN memories m ON m.id=r.id JOIN memory_versions v ON v.memory_id=m.id AND v.version=r.version LOOP
    refs:=jsonb_set(refs,'{memories}',refs->'memories'||jsonb_build_array(to_jsonb(item)));
   END LOOP;
   IF task_row.input_context ? 'agent_id' THEN
    SELECT v.body INTO agent_body FROM agent_versions v WHERE v.agent_id=(task_row.input_context->>'agent_id')::uuid AND v.version=(task_row.input_context->>'agent_version')::int;
    IF agent_body->'brand'->>'id' IS NOT NULL THEN refs:=jsonb_set(refs,'{brands}',refs->'brands'||jsonb_build_array(agent_body->'brand'->>'id')); END IF;
   END IF;
   SELECT coalesce(array_agg(m.task_id),'{}') INTO extra FROM jsonb_to_recordset(coalesce(task_row.input_context->'history','[]')) AS r(id uuid)
    JOIN conversation_messages m ON m.id=r.id WHERE m.role='assistant' AND m.task_id IS NOT NULL AND m.conversation_id=task_row.conversation_id;
   pending_tasks:=pending_tasks||extra;
   SELECT coalesce(array_agg(p.task_id),'{}') INTO extra FROM task_plans p WHERE p.approved_task_id=task_row.id;
   pending_tasks:=pending_tasks||extra;
   IF task_row.input_context ? 'plan_source_task_id' THEN pending_tasks:=array_append(pending_tasks,(task_row.input_context->>'plan_source_task_id')::uuid); END IF;
   IF task_row.attempt>0 THEN
    FOR item IN SELECT * FROM task_dependencies WHERE task_id=task_row.id AND state='resolved' LOOP
     IF item.kind='file' THEN pending_versions:=pending_versions||item.resource_ids;
     ELSE refs:=jsonb_set(refs,'{connections}',refs->'connections'||jsonb_build_array(jsonb_build_object('id',item.resource_ids[1],'provider',item.provider))); END IF;
    END LOOP;
   END IF;
   FOR item IN SELECT x.workflow_id,x.version,w.private_owner,v.definition_hash,v.source_refs FROM native_workflow_reads x
    JOIN workflows w ON w.id=x.workflow_id JOIN workflow_versions v ON v.workflow_id=x.workflow_id AND v.version=x.version
    WHERE x.task_id=task_row.id LOOP
    refs:=jsonb_set(refs,'{workflows}',refs->'workflows'||jsonb_build_array(to_jsonb(item)-'source_refs'));
    FOREACH bucket IN ARRAY ARRAY['versions','datasets','memories','brands','connections','cloud_references','workflows'] LOOP
     refs:=jsonb_set(refs,ARRAY[bucket],refs->bucket||coalesce(item.source_refs->bucket,'[]'::jsonb));
    END LOOP;
   END LOOP;
   FOR item IN SELECT r.workflow_id,r.workflow_version AS version,r.private_owner,v.definition_hash,r.id AS run_id,r.origin_task_id,v.source_refs FROM workflow_runs r
    JOIN workflow_versions v ON v.workflow_id=r.workflow_id AND v.version=r.workflow_version
    WHERE r.execution_location='desktop' AND (r.origin_task_id=task_row.id OR r.id=task_row.desktop_workflow_run_id) LOOP
    refs:=jsonb_set(refs,'{workflows}',refs->'workflows'||jsonb_build_array(to_jsonb(item)-'origin_task_id'-'source_refs'));
    FOREACH bucket IN ARRAY ARRAY['versions','datasets','memories','brands','connections','cloud_references','workflows'] LOOP
     refs:=jsonb_set(refs,ARRAY[bucket],refs->bucket||coalesce(item.source_refs->bucket,'[]'::jsonb));
    END LOOP;
    SELECT coalesce(array_agg(x.id),'{}') INTO extra FROM tasks x WHERE x.desktop_workflow_run_id=item.run_id;
    pending_tasks:=pending_tasks||extra||ARRAY[item.origin_task_id];
   END LOOP;
   FOR item IN SELECT * FROM task_source_reads WHERE task_id=task_row.id LOOP
    IF item.kind='dataset' THEN refs:=jsonb_set(refs,'{datasets}',refs->'datasets'||jsonb_build_array(item.resource_id));
    ELSE
     pending_versions:=array_append(pending_versions,item.asset_version_id);
     IF item.kind='cloud_reference' THEN refs:=jsonb_set(refs,'{cloud_references}',refs->'cloud_references'||jsonb_build_array((SELECT jsonb_build_object('id',n.id,'asset_version_id',item.asset_version_id,'workspace_id',w.id,'private_owner',w.private_owner,'conversation_id',w.conversation_id) FROM workspace_nodes n JOIN cloud_workspaces w ON w.id=n.workspace_id WHERE n.id=item.resource_id))); END IF;
    END IF;
   END LOOP;
  ELSE
   next_id:=pending_versions[1]; pending_versions:=pending_versions[2:];
   IF next_id=ANY(seen_versions) THEN CONTINUE; END IF; seen_versions:=array_append(seen_versions,next_id);
   SELECT * INTO file_row FROM asset_versions WHERE id=next_id;
   IF file_row.id IS NULL THEN RETURN NULL; END IF;
   IF file_row.metadata ? 'publication_sources' THEN
    FOREACH bucket IN ARRAY ARRAY['versions','datasets','memories','brands','connections','cloud_references','workflows'] LOOP
     refs:=jsonb_set(refs,ARRAY[bucket],(refs->bucket) || coalesce(file_row.metadata->'publication_sources'->bucket,'[]'::jsonb));
    END LOOP;
   ELSIF file_row.metadata ? 'publication_source_version_id' THEN pending_versions:=array_append(pending_versions,(file_row.metadata->>'publication_source_version_id')::uuid);
   ELSIF file_row.metadata ? 'task_id' THEN pending_tasks:=array_append(pending_tasks,(file_row.metadata->>'task_id')::uuid);
   ELSE refs:=jsonb_set(refs,'{versions}',refs->'versions'||jsonb_build_array(file_row.id)); END IF;
  END IF;
 END LOOP;
 FOREACH bucket IN ARRAY ARRAY['versions','datasets','memories','brands','connections','cloud_references','workflows'] LOOP
  SELECT coalesce(jsonb_agg(x.value ORDER BY x.value::text),'[]') INTO agent_body FROM (SELECT DISTINCT value FROM jsonb_array_elements(refs->bucket)) x;
  refs:=jsonb_set(refs,ARRAY[bucket],agent_body);
 END LOOP;
 IF jsonb_array_length(refs->'workflows')=0 THEN refs:=refs-'workflows'; END IF;
 RETURN refs;
END $$;

ALTER FUNCTION publication_input_sources(uuid,uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION publication_input_sources(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION publication_input_sources(uuid,uuid) TO cp_app,cp_control;
CREATE OR REPLACE FUNCTION publication_input_sources(source_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$ SELECT publication_input_sources(source_id,NULL); $$;

-- The application supplies no arbitrary provenance: compute it from the live
-- task's immutable read ledgers, including previously reused workflow versions.
CREATE FUNCTION guard_native_workflow_sources() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE expected jsonb;
BEGIN
 expected:=publication_input_sources(NULL,nullif(current_setting('app.task_id',true),'')::uuid);
 IF expected IS NULL OR NEW.source_refs IS DISTINCT FROM expected OR NOT EXISTS(
  SELECT 1 FROM workflows w WHERE w.id=NEW.workflow_id AND w.execution_location='desktop'
   AND w.tenant_id=NEW.tenant_id AND w.project_id=NEW.project_id AND w.private_owner=NEW.private_owner
   AND w.private_owner=nullif(current_setting('app.actor_id',true),'')::uuid) THEN
  RAISE EXCEPTION 'Invalid native workflow source snapshot' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_native_workflow_sources() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_native_workflow_sources() FROM PUBLIC;
CREATE TRIGGER native_workflow_sources BEFORE INSERT ON workflow_versions FOR EACH ROW EXECUTE FUNCTION guard_native_workflow_sources();

INSERT INTO schema_migrations(version) VALUES(94);
