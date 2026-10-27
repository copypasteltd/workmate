-- Additive SEO crawl checkpoints and immutable, task-private source containers.
-- SQL001-077 retain their successful apply bytes.
CREATE TABLE seo_runs (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL, task_id uuid NOT NULL UNIQUE,
 created_by uuid NOT NULL REFERENCES users(id), private_owner uuid NOT NULL REFERENCES users(id),
 spec_hash text NOT NULL CHECK(spec_hash~'^[a-f0-9]{64}$'), checkpoint jsonb NOT NULL CHECK(jsonb_typeof(checkpoint)='object'),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','running','complete','partial','cancelled')),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0), lease_token uuid, lease_until timestamptz,
 result_asset_version_id uuid REFERENCES asset_versions(id), report_asset_version_id uuid REFERENCES asset_versions(id),
 previous_run_id uuid, invalidated_at timestamptz, error_code text,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), finished_at timestamptz,
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY(tenant_id,task_id) REFERENCES tasks(tenant_id,id),
 UNIQUE(tenant_id,project_id,id), UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,project_id,previous_run_id) REFERENCES seo_runs(tenant_id,project_id,id),
 CHECK(created_by=private_owner), CHECK(previous_run_id IS DISTINCT FROM id),
 CHECK((lease_token IS NULL)=(lease_until IS NULL)),
 CHECK((state IN('queued','running'))=(finished_at IS NULL))
);
CREATE INDEX seo_run_due ON seo_runs(created_at,id) WHERE state IN('queued','running') AND invalidated_at IS NULL;
CREATE INDEX seo_run_project ON seo_runs(project_id,created_at DESC,id);
CREATE INDEX seo_run_previous ON seo_runs(previous_run_id);
CREATE TABLE seo_documents (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL, run_id uuid NOT NULL,
 asset_id uuid NOT NULL, asset_version integer NOT NULL,
 container_sha256 text NOT NULL CHECK(container_sha256~'^[a-f0-9]{64}$'),
 url_sha256 text NOT NULL CHECK(url_sha256~'^[a-f0-9]{64}$'),
 kind text NOT NULL CHECK(kind IN('robots','page')), cache_source_id uuid,
 captured_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,project_id,run_id) REFERENCES seo_runs(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,asset_id) REFERENCES assets(tenant_id,id),
 FOREIGN KEY(asset_id,asset_version) REFERENCES asset_versions(asset_id,version),
 UNIQUE(tenant_id,project_id,id), UNIQUE(tenant_id,id),
 FOREIGN KEY(tenant_id,project_id,cache_source_id) REFERENCES seo_documents(tenant_id,project_id,id),
 CHECK(cache_source_id IS DISTINCT FROM id)
);
CREATE INDEX seo_document_run ON seo_documents(run_id,id);
CREATE INDEX seo_document_asset ON seo_documents(asset_id);
CREATE INDEX seo_document_cache ON seo_documents(cache_source_id);
CREATE INDEX seo_document_lookup ON seo_documents(project_id,url_sha256,captured_at DESC);
CREATE TABLE seo_origin_slots (
 origin text NOT NULL, data_mode text NOT NULL CHECK(data_mode IN('simulated','configured_services')),
 next_at timestamptz NOT NULL, touched_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(origin,data_mode)
);

CREATE FUNCTION seo_run_owned(run uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT EXISTS(SELECT 1 FROM seo_runs r JOIN tasks t ON t.id=r.task_id WHERE r.id=run
  AND r.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND r.private_owner=nullif(current_setting('app.actor_id',true),'')::uuid
  AND t.tenant_id=r.tenant_id AND t.project_id=r.project_id AND t.private_owner=r.private_owner
  AND t.content_state='active' AND r.invalidated_at IS NULL)
$$;
CREATE FUNCTION seo_run_sources_available(run uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
 WITH RECURSIVE runs AS (
  SELECT r.* FROM seo_runs r WHERE r.id=run
  UNION SELECT p.* FROM seo_runs p JOIN runs c ON p.id=c.previous_run_id
 ), documents AS (
  SELECT d.* FROM seo_documents d WHERE d.run_id IN(SELECT id FROM runs)
  UNION SELECT p.* FROM seo_documents p JOIN documents c ON p.id=c.cache_source_id
 )
 SELECT EXISTS(SELECT 1 FROM runs) AND NOT EXISTS(
  SELECT 1 FROM runs r JOIN tasks t ON t.id=r.task_id WHERE r.invalidated_at IS NOT NULL OR t.content_state<>'active'
   OR t.private_owner IS DISTINCT FROM r.private_owner OR t.project_id<>r.project_id OR t.tenant_id<>r.tenant_id
 ) AND NOT EXISTS(
  SELECT 1 FROM documents d JOIN seo_runs r ON r.id=d.run_id
  LEFT JOIN assets a ON a.id=d.asset_id LEFT JOIN asset_versions v ON v.asset_id=d.asset_id AND v.version=d.asset_version
  LEFT JOIN tasks t ON t.id=r.task_id
  WHERE r.invalidated_at IS NOT NULL OR t.content_state<>'active' OR a.id IS NULL OR a.state<>'active'
   OR a.retention_expires_at<=clock_timestamp() OR a.private_owner IS DISTINCT FROM r.private_owner
   OR a.project_id<>d.project_id OR a.tenant_id<>d.tenant_id OR v.id IS NULL OR v.erased_at IS NOT NULL OR v.sha256<>d.container_sha256
 ) AND NOT EXISTS(
  SELECT 1 FROM runs r JOIN asset_versions v ON v.id=r.result_asset_version_id OR v.id=r.report_asset_version_id
  JOIN assets a ON a.id=v.asset_id WHERE a.state<>'active' OR a.retention_expires_at<=clock_timestamp() OR v.erased_at IS NOT NULL
 )
$$;
CREATE FUNCTION seo_asset_available(asset uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT NOT EXISTS(SELECT 1 FROM seo_runs r JOIN assets a ON a.id=asset
  WHERE (EXISTS(SELECT 1 FROM asset_versions av WHERE av.asset_id=a.id AND (av.metadata->>'task_id'=r.task_id::text OR av.metadata->>'seo_run_id'=r.id::text))
    OR EXISTS(SELECT 1 FROM seo_documents d WHERE d.run_id=r.id AND d.asset_id=asset)
    OR EXISTS(SELECT 1 FROM asset_versions v WHERE v.asset_id=asset AND (v.id=r.result_asset_version_id OR v.id=r.report_asset_version_id)))
   AND NOT seo_run_sources_available(r.id))
$$;
ALTER FUNCTION seo_run_owned(uuid) OWNER TO cp_control;
ALTER FUNCTION seo_run_sources_available(uuid) OWNER TO cp_control;
ALTER FUNCTION seo_asset_available(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION seo_run_owned(uuid),seo_run_sources_available(uuid),seo_asset_available(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION seo_run_owned(uuid),seo_run_sources_available(uuid),seo_asset_available(uuid) TO cp_app,cp_control;

ALTER TABLE seo_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_runs FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_control ON seo_runs TO cp_control USING(true) WITH CHECK(true);
CREATE POLICY seo_app_read ON seo_runs FOR SELECT TO cp_app USING(seo_run_owned(id) AND seo_run_sources_available(id));
CREATE POLICY seo_app_insert ON seo_runs FOR INSERT TO cp_app WITH CHECK(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND private_owner=nullif(current_setting('app.actor_id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id AND t.project_id=seo_runs.project_id AND t.private_owner=seo_runs.private_owner
  AND t.input_context->>'seo_audit_id'=seo_runs.id::text));
CREATE POLICY seo_app_update ON seo_runs FOR UPDATE TO cp_app USING(seo_run_owned(id) AND seo_run_sources_available(id))
 WITH CHECK(seo_run_owned(id) AND seo_run_sources_available(id));
ALTER TABLE seo_documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_documents FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_control ON seo_documents TO cp_control USING(true) WITH CHECK(true);
CREATE POLICY seo_app_read ON seo_documents FOR SELECT TO cp_app USING(seo_run_owned(run_id) AND seo_run_sources_available(run_id));
CREATE POLICY seo_app_insert ON seo_documents FOR INSERT TO cp_app WITH CHECK(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND seo_run_owned(run_id) AND seo_run_sources_available(run_id));
ALTER TABLE seo_origin_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_origin_slots FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_control ON seo_origin_slots TO cp_control USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON seo_runs TO cp_app,cp_control;
GRANT SELECT,INSERT ON seo_documents TO cp_app,cp_control;
GRANT SELECT,INSERT,UPDATE,DELETE ON seo_origin_slots TO cp_control;

CREATE FUNCTION guard_seo_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'SEO provenance cannot be physically deleted' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='seo_documents' THEN RAISE EXCEPTION 'SEO source history is immutable' USING ERRCODE='23514'; END IF;
 IF current_user='cp_control' AND OLD.invalidated_at IS NULL AND NEW.invalidated_at IS NOT NULL
  AND NEW.checkpoint='{}'::jsonb AND NEW.state='cancelled' AND NEW.lease_token IS NULL AND NEW.lease_until IS NULL
  AND (to_jsonb(NEW)-ARRAY['invalidated_at','checkpoint','state','revision','finished_at','lease_token','lease_until','error_code'])=
      (to_jsonb(OLD)-ARRAY['invalidated_at','checkpoint','state','revision','finished_at','lease_token','lease_until','error_code']) THEN RETURN NEW; END IF;
 IF NEW.revision<>OLD.revision+1 OR OLD.invalidated_at IS NOT NULL OR
  (to_jsonb(NEW)-ARRAY['checkpoint','state','revision','lease_token','lease_until','result_asset_version_id','report_asset_version_id','finished_at','error_code']) IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['checkpoint','state','revision','lease_token','lease_until','result_asset_version_id','report_asset_version_id','finished_at','error_code']) OR
  (OLD.state NOT IN('queued','running') AND (NEW.checkpoint IS DISTINCT FROM OLD.checkpoint OR NEW.state<>OLD.state)) OR
  (OLD.result_asset_version_id IS NOT NULL AND NEW.result_asset_version_id IS DISTINCT FROM OLD.result_asset_version_id) OR
  (OLD.report_asset_version_id IS NOT NULL AND NEW.report_asset_version_id IS DISTINCT FROM OLD.report_asset_version_id) OR
  NEW.checkpoint->>'spec_hash' IS DISTINCT FROM NEW.spec_hash THEN
  RAISE EXCEPTION 'SEO identity or finished history cannot be rewritten' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER seo_run_history BEFORE UPDATE OR DELETE ON seo_runs FOR EACH ROW EXECUTE FUNCTION guard_seo_history();
CREATE TRIGGER seo_document_history BEFORE UPDATE OR DELETE ON seo_documents FOR EACH ROW EXECUTE FUNCTION guard_seo_history();
CREATE FUNCTION guard_seo_binding() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE r seo_runs; a assets; v asset_versions; source_run seo_runs; task tasks; output uuid;
BEGIN
 IF TG_TABLE_NAME='seo_runs' THEN
  SELECT * INTO task FROM tasks WHERE id=NEW.task_id;
  IF task.id IS NULL OR task.tenant_id<>NEW.tenant_id OR task.project_id<>NEW.project_id OR task.private_owner IS DISTINCT FROM NEW.private_owner
   OR task.created_by<>NEW.created_by OR task.input_context->>'seo_audit_id' IS DISTINCT FROM NEW.id::text THEN
   RAISE EXCEPTION 'SEO task identity is invalid' USING ERRCODE='23514'; END IF;
  IF NEW.previous_run_id IS NOT NULL THEN
   SELECT * INTO source_run FROM seo_runs WHERE id=NEW.previous_run_id;
   IF source_run.private_owner IS DISTINCT FROM NEW.private_owner OR source_run.project_id IS DISTINCT FROM NEW.project_id
    OR source_run.tenant_id IS DISTINCT FROM NEW.tenant_id OR source_run.state NOT IN('complete','partial') OR NOT seo_run_sources_available(source_run.id) THEN
    RAISE EXCEPTION 'SEO comparison source is invalid' USING ERRCODE='23514'; END IF;
  END IF;
  FOREACH output IN ARRAY ARRAY[NEW.result_asset_version_id,NEW.report_asset_version_id] LOOP
   IF output IS NULL THEN CONTINUE; END IF;
   SELECT * INTO v FROM asset_versions WHERE id=output;
   SELECT * INTO a FROM assets WHERE id=v.asset_id;
   IF a.id IS NULL OR a.state<>'active' OR a.private_owner IS DISTINCT FROM NEW.private_owner OR a.project_id<>NEW.project_id OR a.tenant_id<>NEW.tenant_id
    OR v.erased_at IS NOT NULL OR v.metadata->>'task_id' IS DISTINCT FROM NEW.task_id::text OR v.metadata->>'seo_run_id' IS DISTINCT FROM NEW.id::text THEN
    RAISE EXCEPTION 'SEO output identity is invalid' USING ERRCODE='23514'; END IF;
  END LOOP;
 ELSIF TG_TABLE_NAME='seo_documents' THEN
  SELECT * INTO r FROM seo_runs WHERE id=NEW.run_id;
  SELECT * INTO a FROM assets WHERE id=NEW.asset_id;
  SELECT * INTO v FROM asset_versions WHERE asset_id=NEW.asset_id AND version=NEW.asset_version;
  IF r.id IS NULL OR r.invalidated_at IS NOT NULL OR r.state NOT IN('queued','running') OR r.tenant_id<>NEW.tenant_id OR r.project_id<>NEW.project_id
   OR a.id IS NULL OR a.state<>'active' OR a.private_owner IS DISTINCT FROM r.private_owner OR a.project_id<>r.project_id OR a.tenant_id<>r.tenant_id
   OR v.metadata->>'task_id' IS DISTINCT FROM r.task_id::text OR v.metadata->>'seo_run_id' IS DISTINCT FROM r.id::text
   OR v.id IS NULL OR v.erased_at IS NOT NULL OR v.sha256<>NEW.container_sha256 OR v.mime_type<>'application/json' THEN
    RAISE EXCEPTION 'SEO source binding is invalid' USING ERRCODE='23514'; END IF;
  IF NEW.cache_source_id IS NOT NULL THEN
   SELECT sr.* INTO source_run FROM seo_runs sr JOIN seo_documents sd ON sd.run_id=sr.id WHERE sd.id=NEW.cache_source_id;
   IF source_run.id IS NULL OR source_run.private_owner<>r.private_owner OR source_run.project_id<>r.project_id OR source_run.tenant_id<>r.tenant_id
    OR NOT seo_run_sources_available(source_run.id) THEN RAISE EXCEPTION 'SEO cache source binding is invalid' USING ERRCODE='23514'; END IF;
  END IF;
 ELSE
  IF NEW.content_state<>'deleted' AND EXISTS(SELECT 1 FROM seo_runs r WHERE r.task_id=NEW.id AND
    (NEW.input_context->>'seo_audit_id' IS DISTINCT FROM r.id::text OR NEW.private_owner IS DISTINCT FROM r.private_owner)) THEN
    RAISE EXCEPTION 'SEO task binding cannot be removed' USING ERRCODE='23514'; END IF;
 END IF; RETURN NEW;
END $$;
ALTER FUNCTION guard_seo_binding() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_seo_binding() FROM PUBLIC;
CREATE TRIGGER seo_document_binding BEFORE INSERT ON seo_documents FOR EACH ROW EXECUTE FUNCTION guard_seo_binding();
CREATE TRIGGER seo_run_binding BEFORE INSERT OR UPDATE OF result_asset_version_id,report_asset_version_id ON seo_runs FOR EACH ROW EXECUTE FUNCTION guard_seo_binding();
CREATE TRIGGER seo_task_binding BEFORE UPDATE OF input_context,private_owner ON tasks FOR EACH ROW EXECUTE FUNCTION guard_seo_binding();

-- Existing central gate also protects public shares and control-identity download paths.
CREATE OR REPLACE FUNCTION analysis_asset_available(asset uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
 SELECT seo_asset_available(asset) AND connector_asset_available(asset) AND NOT EXISTS(
  SELECT 1 FROM analysis_reports r JOIN asset_versions v ON v.id=r.asset_version_id
   WHERE v.asset_id=asset AND NOT analysis_report_available(r.id))
$$;

CREATE FUNCTION erase_seo_dependants() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE ids uuid[];
BEGIN
 IF TG_TABLE_NAME='tasks' THEN
  IF NEW.content_state<>'deleted' OR OLD.content_state='deleted' THEN RETURN NEW; END IF;
  SELECT array_agg(id) INTO ids FROM seo_runs WHERE task_id=NEW.id AND invalidated_at IS NULL;
 ELSE
  IF NEW.state<>'deleted' OR OLD.state='deleted' THEN RETURN NEW; END IF;
  WITH RECURSIVE docs AS (
   SELECT d.id,d.run_id FROM seo_documents d WHERE d.asset_id=NEW.id
   UNION SELECT d.id,d.run_id FROM seo_documents d JOIN docs p ON d.cache_source_id=p.id
  ), affected AS (
   SELECT r.id FROM seo_runs r WHERE r.id IN(SELECT run_id FROM docs)
    OR EXISTS(SELECT 1 FROM asset_versions v WHERE v.asset_id=NEW.id AND (v.id=r.result_asset_version_id OR v.id=r.report_asset_version_id))
   UNION SELECT r.id FROM seo_runs r JOIN affected p ON r.previous_run_id=p.id
  ) SELECT array_agg(r.id) INTO ids FROM seo_runs r JOIN affected a ON a.id=r.id WHERE r.invalidated_at IS NULL;
 END IF;
 IF ids IS NULL THEN RETURN NEW; END IF;
 UPDATE seo_runs SET invalidated_at=clock_timestamp(),checkpoint='{}',state='cancelled',revision=revision+1,
  finished_at=coalesce(finished_at,clock_timestamp()),lease_token=NULL,lease_until=NULL,error_code='SEO_SOURCE_REMOVED' WHERE id=ANY(ids);
 UPDATE tasks SET content_state='deleted',cancel_requested=true,output=NULL,moderation_version=moderation_version+1
  WHERE id IN(SELECT task_id FROM seo_runs WHERE id=ANY(ids)) AND content_state<>'deleted';
 UPDATE assets SET state='deleted',moderation_version=moderation_version+1 WHERE state<>'deleted' AND (
  id IN(SELECT asset_id FROM asset_versions WHERE metadata->>'seo_run_id'=ANY(SELECT id::text FROM seo_runs WHERE id=ANY(ids))) OR
  id IN(SELECT asset_id FROM seo_documents WHERE run_id=ANY(ids)) OR
  id IN(SELECT v.asset_id FROM asset_versions v JOIN seo_runs r ON v.id=r.result_asset_version_id OR v.id=r.report_asset_version_id WHERE r.id=ANY(ids)));
 INSERT INTO deletion_dependencies(job_id,child_job_id)
  SELECT p.id,c.id FROM deletion_jobs p JOIN seo_runs r ON r.id=ANY(ids) JOIN deletion_jobs c ON c.target_type='tasks' AND c.target_id=r.task_id
   WHERE p.target_type=TG_TABLE_NAME AND p.target_id=NEW.id AND p.id<>c.id ON CONFLICT DO NOTHING;
 INSERT INTO deletion_dependencies(job_id,child_job_id)
  SELECT p.id,c.id FROM deletion_jobs p JOIN seo_runs r ON r.id=ANY(ids)
   JOIN asset_versions v ON v.metadata->>'seo_run_id'=r.id::text JOIN deletion_jobs c ON c.target_type='assets' AND c.target_id=v.asset_id
   WHERE p.target_type='tasks' AND p.target_id=r.task_id AND p.id<>c.id ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
ALTER FUNCTION erase_seo_dependants() OWNER TO cp_control;
REVOKE ALL ON FUNCTION erase_seo_dependants() FROM PUBLIC;
CREATE TRIGGER zz_seo_source_erasure AFTER UPDATE OF state ON assets FOR EACH ROW EXECUTE FUNCTION erase_seo_dependants();
CREATE TRIGGER zz_seo_task_erasure AFTER UPDATE OF content_state ON tasks FOR EACH ROW EXECUTE FUNCTION erase_seo_dependants();
INSERT INTO schema_migrations(version) VALUES(78);
