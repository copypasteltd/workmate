-- Additive migration. SQL001-099 and their published bytes remain unchanged.
CREATE TABLE geo_experiments (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,project_id uuid NOT NULL,name text NOT NULL,
 series_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),previous_id uuid REFERENCES geo_experiments(id),
 body jsonb NOT NULL,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES users(id),private_owner uuid NOT NULL REFERENCES users(id),
 content_state text NOT NULL DEFAULT 'active' CHECK(content_state IN('active','quarantined','deleted')),
 moderation_version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 retention_expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '90 days',
 UNIQUE(series_id,version),UNIQUE(id,tenant_id,project_id,private_owner),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),CHECK(created_by=private_owner)
);
CREATE TABLE geo_runs (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,project_id uuid NOT NULL,name text NOT NULL,
 experiment_id uuid NOT NULL,surface text NOT NULL CHECK(surface IN('internal_api','consumer_manual')),
 body jsonb NOT NULL,config_hash text NOT NULL CHECK(config_hash ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES users(id),private_owner uuid NOT NULL REFERENCES users(id),
 content_state text NOT NULL DEFAULT 'active' CHECK(content_state IN('active','quarantined','deleted')),
 moderation_version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 retention_expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '90 days',
 UNIQUE(id,tenant_id,project_id,private_owner),FOREIGN KEY(experiment_id,tenant_id,project_id,private_owner) REFERENCES geo_experiments(id,tenant_id,project_id,private_owner),
 CHECK(created_by=private_owner)
);
CREATE TABLE geo_samples (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL,project_id uuid NOT NULL,name text NOT NULL,
 run_id uuid NOT NULL,question_key text NOT NULL,body jsonb NOT NULL,
 task_id uuid UNIQUE REFERENCES tasks(id),asset_version_id uuid UNIQUE REFERENCES asset_versions(id),
 answer_sha256 text CHECK(answer_sha256 ~ '^[a-f0-9]{64}$'),analysis jsonb,observed_at timestamptz,captured_at timestamptz,
 created_by uuid NOT NULL REFERENCES users(id),private_owner uuid NOT NULL REFERENCES users(id),
 content_state text NOT NULL DEFAULT 'active' CHECK(content_state IN('active','quarantined','deleted')),
 moderation_version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 retention_expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '90 days',
 UNIQUE(run_id,question_key),FOREIGN KEY(run_id,tenant_id,project_id,private_owner) REFERENCES geo_runs(id,tenant_id,project_id,private_owner),
 CHECK(created_by=private_owner),CHECK((asset_version_id IS NULL)=(answer_sha256 IS NULL)),CHECK((asset_version_id IS NULL)=(captured_at IS NULL))
);
CREATE INDEX geo_experiment_scope ON geo_experiments(project_id,private_owner,created_at DESC,id);
CREATE INDEX geo_run_scope ON geo_runs(project_id,private_owner,created_at DESC,id);
CREATE INDEX geo_sample_run ON geo_samples(run_id,id);

CREATE FUNCTION geo_sample_source_manifest(sample uuid,scope_tenant uuid,scope_project uuid) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE s geo_samples; r geo_runs; e geo_experiments;
BEGIN
 SELECT * INTO s FROM geo_samples WHERE id=sample;
 SELECT * INTO r FROM geo_runs WHERE id=s.run_id;
 SELECT * INTO e FROM geo_experiments WHERE id=r.experiment_id;
 IF s.id IS NULL OR r.id IS NULL OR e.id IS NULL OR s.tenant_id<>scope_tenant OR s.project_id<>scope_project
  OR s.content_state<>'active' OR r.content_state<>'active' OR e.content_state<>'active'
  OR least(s.retention_expires_at,r.retention_expires_at,e.retention_expires_at)<=clock_timestamp()
  OR NOT EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id JOIN tenants t ON t.id=m.tenant_id JOIN projects p ON p.id=s.project_id AND p.tenant_id=t.id
   WHERE m.tenant_id=s.tenant_id AND m.user_id=s.private_owner AND m.status='active' AND u.status='active' AND t.status='active' AND NOT p.archived
   AND (m.role IN('owner','admin') OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=m.user_id))) THEN RETURN NULL; END IF;
 IF s.task_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.id=s.task_id AND t.tenant_id=s.tenant_id AND t.project_id=s.project_id
  AND t.private_owner=s.private_owner AND t.content_state='active' AND (t.status NOT IN('succeeded','failed','cancelled') OR t.retention_expires_at>clock_timestamp())) THEN RETURN NULL; END IF;
 IF s.asset_version_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=s.asset_version_id
  AND a.tenant_id=s.tenant_id AND a.project_id=s.project_id AND a.private_owner=s.private_owner AND a.state='active'
  AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL AND v.sha256=s.answer_sha256) THEN RETURN NULL; END IF;
 RETURN jsonb_build_array(jsonb_build_object('kind','geo_experiments','id',e.id),jsonb_build_object('kind','geo_runs','id',r.id),jsonb_build_object('kind','geo_samples','id',s.id));
END $$;
ALTER FUNCTION geo_sample_source_manifest(uuid,uuid,uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION geo_sample_source_manifest(uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION geo_sample_source_manifest(uuid,uuid,uuid) TO cp_app,cp_control;

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['geo_experiments','geo_runs','geo_samples'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY geo_control ON %I TO cp_control USING(true) WITH CHECK(true)',tab);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,cp_app,cp_queue',tab);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO cp_control',tab);
  EXECUTE format('CREATE POLICY geo_owner_read ON %I FOR SELECT TO cp_app USING(private_owner=nullif(current_setting(''app.actor_id'',true),'''')::uuid AND content_state=''active'' AND retention_expires_at>clock_timestamp() AND creative_feedback_project_access(tenant_id,project_id))',tab);
  EXECUTE format('GRANT SELECT ON %I TO cp_app',tab);
  EXECUTE format('CREATE INDEX %I ON %I(retention_expires_at) WHERE content_state<>''deleted''',tab||'_retention',tab);
  EXECUTE format('CREATE TRIGGER geo_erasure BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION journal_content_erasure(''content_state'')',tab);
 END LOOP;
END $$;
CREATE POLICY geo_run_parent ON geo_runs AS RESTRICTIVE FOR SELECT TO cp_app USING(EXISTS(SELECT 1 FROM geo_experiments e WHERE e.id=experiment_id));
CREATE POLICY geo_sample_parent ON geo_samples AS RESTRICTIVE FOR SELECT TO cp_app USING(geo_sample_source_manifest(id,tenant_id,project_id) IS NOT NULL);

CREATE FUNCTION guard_geo_history() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE allowed text[]:=ARRAY['name','body','content_state','moderation_version','retention_expires_at'];
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'GEO history is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.content_state='deleted' THEN NEW.body:='{}'; END IF;
 IF TG_TABLE_NAME='geo_samples' THEN
  allowed:=allowed||ARRAY['task_id','asset_version_id','answer_sha256','analysis','observed_at','captured_at'];
  IF OLD.task_id IS NOT NULL AND NEW.task_id IS DISTINCT FROM OLD.task_id THEN RAISE EXCEPTION 'GEO task binding is immutable' USING ERRCODE='23514'; END IF;
  IF OLD.asset_version_id IS NOT NULL AND (ROW(NEW.asset_version_id,NEW.answer_sha256,NEW.observed_at,NEW.captured_at)
   IS DISTINCT FROM ROW(OLD.asset_version_id,OLD.answer_sha256,OLD.observed_at,OLD.captured_at)
   OR (NEW.analysis IS DISTINCT FROM OLD.analysis AND NOT(NEW.content_state='deleted' AND current_setting('app.erasing_content',true)='true' AND NEW.analysis IS NULL))) THEN
   RAISE EXCEPTION 'Captured GEO answer is immutable' USING ERRCODE='23514'; END IF;
 END IF;
 IF (to_jsonb(NEW)-allowed) IS DISTINCT FROM (to_jsonb(OLD)-allowed)
  OR (NEW.body IS DISTINCT FROM OLD.body AND NOT(NEW.content_state='deleted' AND NEW.body='{}'::jsonb)) THEN
  RAISE EXCEPTION 'GEO configuration must use a new version' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['geo_experiments','geo_runs','geo_samples'] LOOP
  EXECUTE format('CREATE TRIGGER geo_history BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_geo_history()',tab);
 END LOOP;
END $$;
CREATE FUNCTION cascade_geo_deletion() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
BEGIN
 IF NEW.content_state='deleted' THEN
  IF TG_TABLE_NAME='geo_experiments' THEN UPDATE geo_runs SET content_state='deleted',moderation_version=moderation_version+1 WHERE experiment_id=NEW.id AND content_state<>'deleted';
  ELSIF TG_TABLE_NAME='geo_runs' THEN UPDATE geo_samples SET content_state='deleted',moderation_version=moderation_version+1 WHERE run_id=NEW.id AND content_state<>'deleted'; END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION cascade_geo_deletion() OWNER TO cp_control;
REVOKE ALL ON FUNCTION cascade_geo_deletion() FROM PUBLIC;
CREATE TRIGGER geo_experiment_cascade AFTER UPDATE ON geo_experiments FOR EACH ROW EXECUTE FUNCTION cascade_geo_deletion();
CREATE TRIGGER geo_run_cascade AFTER UPDATE ON geo_runs FOR EACH ROW EXECUTE FUNCTION cascade_geo_deletion();

CREATE FUNCTION guard_geo_binding() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE s geo_samples; r geo_runs; e geo_experiments; t tasks; v asset_versions; a assets;
BEGIN
 IF TG_TABLE_NAME='tasks' THEN
  SELECT * INTO t FROM tasks WHERE id=NEW.id;
  IF NOT t.input_context ? 'geo_sample_id' THEN RETURN NULL; END IF;
  SELECT * INTO s FROM geo_samples WHERE id=(t.input_context->>'geo_sample_id')::uuid AND task_id=t.id;
 ELSIF TG_TABLE_NAME='asset_versions' THEN
  SELECT * INTO v FROM asset_versions WHERE id=NEW.id;
  IF NOT v.metadata ? 'geo_sample_id' THEN RETURN NULL; END IF;
  SELECT * INTO s FROM geo_samples WHERE id=(v.metadata->>'geo_sample_id')::uuid AND asset_version_id=v.id;
 ELSE
  SELECT * INTO s FROM geo_samples WHERE id=NEW.id;
 END IF;
 IF s.content_state='deleted' THEN RETURN NULL; END IF;
 SELECT * INTO r FROM geo_runs WHERE id=s.run_id;
 SELECT * INTO e FROM geo_experiments WHERE id=r.experiment_id;
 IF s.id IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e.body->'spec'->'questions') q WHERE q->>'key'=s.question_key AND q->>'text'=s.body->>'question') THEN
  RAISE EXCEPTION 'GEO sample question mismatch' USING ERRCODE='23514'; END IF;
 IF r.surface='internal_api' THEN
  SELECT * INTO t FROM tasks WHERE id=s.task_id;
  IF t.id IS NULL OR t.tenant_id<>s.tenant_id OR t.project_id<>s.project_id OR t.private_owner IS DISTINCT FROM s.private_owner
   OR t.created_by<>s.created_by OR t.execution_location<>'cloud' OR t.mode<>'ask' OR t.conversation_id IS NOT NULL OR t.parent_id IS NOT NULL
   OR t.input_context->>'geo_sample_id' IS DISTINCT FROM s.id::text
   OR t.input_context->>'agent_id' IS DISTINCT FROM e.body->'context'->>'agent_id'
   OR t.input_context->>'agent_version' IS DISTINCT FROM e.body->'context'->>'agent_version'
   OR t.input_context->>'role_hash' IS DISTINCT FROM e.body->'context'->>'role_hash'
   OR t.input_context->'memories' IS DISTINCT FROM '[]'::jsonb OR t.input_context->'history' IS DISTINCT FROM '[]'::jsonb THEN
   RAISE EXCEPTION 'GEO task scope mismatch' USING ERRCODE='23514'; END IF;
 ELSIF s.task_id IS NOT NULL THEN RAISE EXCEPTION 'Manual GEO sample cannot bill an API task' USING ERRCODE='23514'; END IF;
 IF s.asset_version_id IS NOT NULL THEN
  SELECT * INTO v FROM asset_versions WHERE id=s.asset_version_id;
  SELECT * INTO a FROM assets WHERE id=v.asset_id;
  IF v.id IS NULL OR a.tenant_id<>s.tenant_id OR a.project_id<>s.project_id OR a.private_owner IS DISTINCT FROM s.private_owner
   OR a.created_by<>s.created_by OR v.mime_type<>'text/plain' OR v.sha256<>s.answer_sha256 OR v.metadata->>'geo_sample_id' IS DISTINCT FROM s.id::text
   OR (r.surface='internal_api' AND v.metadata->>'task_id' IS DISTINCT FROM s.task_id::text) THEN
   RAISE EXCEPTION 'GEO answer scope mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;
ALTER FUNCTION guard_geo_binding() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_geo_binding() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER geo_task_binding AFTER INSERT ON tasks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_geo_binding();
CREATE CONSTRAINT TRIGGER geo_file_binding AFTER INSERT ON asset_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_geo_binding();
CREATE CONSTRAINT TRIGGER geo_sample_binding AFTER INSERT OR UPDATE ON geo_samples DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION guard_geo_binding();
CREATE FUNCTION guard_geo_locator() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE before_id jsonb; after_id jsonb;
BEGIN
 IF TG_TABLE_NAME='tasks' THEN before_id:=OLD.input_context->'geo_sample_id'; after_id:=NEW.input_context->'geo_sample_id';
 ELSE before_id:=OLD.metadata->'geo_sample_id'; after_id:=NEW.metadata->'geo_sample_id'; END IF;
 IF before_id IS DISTINCT FROM after_id
  AND NOT(current_setting('app.erasing_content',true)='true' AND (to_jsonb(NEW)->>'content_state'='deleted' OR to_jsonb(NEW)->>'erased_at' IS NOT NULL)) THEN
  RAISE EXCEPTION 'GEO source locator is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER geo_task_locator BEFORE UPDATE OF input_context ON tasks FOR EACH ROW EXECUTE FUNCTION guard_geo_locator();
CREATE TRIGGER geo_file_locator BEFORE UPDATE OF metadata ON asset_versions FOR EACH ROW EXECUTE FUNCTION guard_geo_locator();

-- Extend the existing traversal at the actual task/version visits, including
-- indirect reads, approved plans and publications. Do not replace old branches
-- or return only direct task_ids. Both existing function OIDs are retained.
DO $$ DECLARE definition text; anchor text; hook text; BEGIN
 definition:=pg_get_functiondef('content_source_manifest_before_creative_feedback(uuid,uuid,uuid[],uuid[])'::regprocedure);
 IF position('DECLARE pending_tasks' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected lineage declaration'; END IF;
 definition:=replace(definition,'DECLARE pending_tasks','DECLARE geo_refs jsonb; pending_tasks');
 anchor:='   IF source_task.conversation_id IS NOT NULL AND NOT EXISTS';
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Missing lineage task anchor'; END IF;
 hook:=$hook$   IF source_task.input_context ? 'geo_sample_id' THEN
    geo_refs:=geo_sample_source_manifest((source_task.input_context->>'geo_sample_id')::uuid,scope_tenant,scope_project);
    IF geo_refs IS NULL THEN RETURN NULL; END IF; targets:=targets||geo_refs;
   END IF;
$hook$;
 definition:=replace(definition,anchor,hook||anchor);
 anchor:='   targets:=targets||jsonb_build_array(jsonb_build_object(''kind'',''assets'',''id'',source_asset.id));';
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Missing lineage asset anchor'; END IF;
 hook:=$hook$
   IF source_version.metadata ? 'geo_sample_id' THEN
    geo_refs:=geo_sample_source_manifest((source_version.metadata->>'geo_sample_id')::uuid,scope_tenant,scope_project);
    IF geo_refs IS NULL THEN RETURN NULL; END IF; targets:=targets||geo_refs;
   END IF;
$hook$;
 definition:=replace(definition,anchor,anchor||hook);
 hook:=$hook$
    IF publication ? 'geo_samples' THEN
     IF jsonb_typeof(publication->'geo_samples')<>'array' THEN RETURN NULL; END IF;
     FOR r IN SELECT value::uuid AS id FROM jsonb_array_elements_text(publication->'geo_samples') LOOP
      geo_refs:=geo_sample_source_manifest(r.id,scope_tenant,scope_project);
      IF geo_refs IS NULL THEN RETURN NULL; END IF; targets:=targets||geo_refs;
     END LOOP;
    END IF;
$hook$;
 -- Asset publication snapshots are already queued into pending_sources by
 -- the Stage79 traversal; process both assets and workflows at that one visit.
 anchor:='publication:=pending_sources[1]; pending_sources:=pending_sources[2:];';
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Missing publication workflow anchor'; END IF;
 definition:=replace(definition,anchor,anchor||hook);
 EXECUTE definition;
END $$;
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('publication_input_sources(uuid)'::regprocedure);
 EXECUTE replace(definition,'FUNCTION public.publication_input_sources(','FUNCTION public.publication_input_sources_before_geo(');
END $$;
ALTER FUNCTION publication_input_sources_before_geo(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION publication_input_sources_before_geo(uuid) FROM PUBLIC,cp_app,cp_queue;
CREATE OR REPLACE FUNCTION publication_input_sources(source_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE refs jsonb; manifest jsonb; a assets; samples jsonb;
BEGIN
 refs:=publication_input_sources_before_geo(source_id); IF refs IS NULL THEN RETURN NULL; END IF;
 SELECT x.* INTO a FROM asset_versions v JOIN assets x ON x.id=v.asset_id WHERE v.id=source_id;
 manifest:=content_source_manifest(a.tenant_id,a.project_id,'{}',ARRAY[source_id]); IF manifest IS NULL THEN RETURN NULL; END IF;
 SELECT jsonb_agg(id ORDER BY id) INTO samples FROM (SELECT DISTINCT x.id FROM jsonb_to_recordset(manifest) AS x(kind text,id uuid) WHERE kind='geo_samples') s;
 IF samples IS NOT NULL THEN refs:=refs||jsonb_build_object('geo_samples',samples); END IF;
 RETURN refs;
END $$;
CREATE OR REPLACE FUNCTION task_asset_sources_available(asset uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT NOT EXISTS(SELECT 1 FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version WHERE a.id=asset
  AND (v.metadata ? 'task_id' OR v.metadata ? 'publication_source_version_id' OR v.metadata ? 'publication_sources' OR v.metadata ? 'brand_reference' OR v.metadata ? 'creative_feedback_id' OR v.metadata ? 'geo_sample_id')
  AND content_source_manifest(a.tenant_id,a.project_id,'{}',ARRAY[v.id]) IS NULL)
$$;
CREATE OR REPLACE FUNCTION task_asset_version_sources_available(p_version uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT NOT EXISTS(SELECT 1 FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=p_version
  AND (v.metadata ? 'task_id' OR v.metadata ? 'publication_source_version_id' OR v.metadata ? 'publication_sources' OR v.metadata ? 'brand_reference' OR v.metadata ? 'creative_feedback_id' OR v.metadata ? 'geo_sample_id')
  AND content_source_manifest(a.tenant_id,a.project_id,'{}',ARRAY[v.id]) IS NULL)
$$;
CREATE OR REPLACE FUNCTION lock_task_content_sources(task uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE refs jsonb; source_table text; ids uuid[];
BEGIN
 refs:=task_content_source_manifest(task); IF refs IS NULL THEN RETURN false; END IF;
 FOREACH source_table IN ARRAY ARRAY['workflows','workflow_runs','assets','connections','analytics_datasets','cloud_workspaces','workspace_nodes','agents','brand_profiles','memories','conversations','creative_mappings','creative_feedback_reports','geo_experiments','geo_runs','geo_samples'] LOOP
  SELECT array_agg(x.id ORDER BY x.id) INTO ids FROM (SELECT DISTINCT r.id FROM jsonb_to_recordset(refs) AS r(kind text,id uuid) WHERE r.kind=source_table) x;
  IF cardinality(ids)>0 THEN EXECUTE format('SELECT id FROM %I WHERE id=ANY($1) ORDER BY id FOR SHARE%s',source_table,CASE WHEN source_table='conversations' THEN '' ELSE ' NOWAIT' END) USING ids; END IF;
 END LOOP;
 RETURN task_content_sources_available(task);
END $$;
INSERT INTO schema_migrations(version) VALUES(100);
