-- Saved website change drafts retain the exact original audit and source lineage.
CREATE TABLE seo_change_tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id), project_id uuid NOT NULL REFERENCES projects(id),
 run_id uuid NOT NULL, task_id uuid NOT NULL UNIQUE REFERENCES tasks(id),
 private_owner uuid NOT NULL REFERENCES users(id),
 result_asset_version_id uuid NOT NULL REFERENCES asset_versions(id),
 spec_hash text NOT NULL CHECK(spec_hash ~ '^[a-f0-9]{64}$'), spec jsonb NOT NULL,
 json_asset_version_id uuid REFERENCES asset_versions(id), html_asset_version_id uuid REFERENCES asset_versions(id),
 created_at timestamptz NOT NULL DEFAULT now(), invalidated_at timestamptz,
 FOREIGN KEY(tenant_id,project_id,run_id) REFERENCES seo_runs(tenant_id,project_id,id),
 UNIQUE(tenant_id,project_id,id), CHECK((json_asset_version_id IS NULL)=(html_asset_version_id IS NULL))
);
CREATE INDEX seo_changes_run ON seo_change_tasks(run_id,created_at DESC,id);
ALTER TABLE seo_change_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE seo_change_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY seo_changes_control ON seo_change_tasks TO cp_control USING(true) WITH CHECK(true);

CREATE FUNCTION seo_change_available(change_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT EXISTS(SELECT 1 FROM seo_change_tasks c JOIN tasks t ON t.id=c.task_id JOIN seo_runs r ON r.id=c.run_id
  WHERE c.id=change_id AND c.invalidated_at IS NULL AND t.content_state='active'
   AND t.private_owner=c.private_owner AND t.created_by=c.private_owner
   AND t.tenant_id=c.tenant_id AND t.project_id=c.project_id
   AND t.input_context->>'seo_change_task_id'=c.id::text
   AND r.result_asset_version_id=c.result_asset_version_id AND r.private_owner=c.private_owner
   AND seo_run_sources_available(c.run_id)
   AND NOT EXISTS(SELECT 1 FROM asset_versions v JOIN assets a ON a.id=v.asset_id
    WHERE v.id IN(c.json_asset_version_id,c.html_asset_version_id)
     AND (a.state<>'active' OR a.retention_expires_at<=clock_timestamp() OR v.erased_at IS NOT NULL)))
$$;
ALTER FUNCTION seo_change_available(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION seo_change_available(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION seo_change_available(uuid) TO cp_app,cp_control;
CREATE POLICY seo_changes_read ON seo_change_tasks FOR SELECT TO cp_app
 USING(private_owner=nullif(current_setting('app.actor_id',true),'')::uuid AND seo_run_owned(run_id) AND seo_change_available(id));
CREATE POLICY seo_changes_insert ON seo_change_tasks FOR INSERT TO cp_app
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND private_owner=nullif(current_setting('app.actor_id',true),'')::uuid AND seo_run_owned(run_id) AND seo_run_sources_available(run_id));
CREATE POLICY seo_changes_update ON seo_change_tasks FOR UPDATE TO cp_app
 USING(seo_run_owned(run_id) AND seo_change_available(id)) WITH CHECK(seo_run_owned(run_id) AND seo_change_available(id));
GRANT SELECT,INSERT,UPDATE ON seo_change_tasks TO cp_app,cp_control;

CREATE FUNCTION guard_seo_change_binding() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE r seo_runs; t tasks; v asset_versions; a assets; output uuid;
BEGIN
 IF TG_TABLE_NAME='tasks' THEN
  IF NEW.content_state<>'deleted' AND EXISTS(SELECT 1 FROM seo_change_tasks c WHERE c.task_id=NEW.id) AND
   (NEW.title IS DISTINCT FROM OLD.title OR NEW.prompt IS DISTINCT FROM OLD.prompt OR NEW.mode IS DISTINCT FROM OLD.mode
    OR NEW.private_owner IS DISTINCT FROM OLD.private_owner OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
    OR NEW.input_context->>'seo_change_task_id' IS DISTINCT FROM OLD.input_context->>'seo_change_task_id') THEN
   RAISE EXCEPTION 'Saved website change task binding is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' THEN
  IF (to_jsonb(NEW)-ARRAY['json_asset_version_id','html_asset_version_id','invalidated_at','spec']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['json_asset_version_id','html_asset_version_id','invalidated_at','spec'])
   OR (OLD.invalidated_at IS NOT NULL AND NEW IS DISTINCT FROM OLD)
   OR (NEW.spec IS DISTINCT FROM OLD.spec AND NOT(NEW.invalidated_at IS NOT NULL AND NEW.spec='{}'::jsonb))
   OR (OLD.json_asset_version_id IS NOT NULL AND NEW.json_asset_version_id IS DISTINCT FROM OLD.json_asset_version_id)
   OR (OLD.html_asset_version_id IS NOT NULL AND NEW.html_asset_version_id IS DISTINCT FROM OLD.html_asset_version_id) THEN
   RAISE EXCEPTION 'Website change history is immutable' USING ERRCODE='23514'; END IF;
  IF NEW.invalidated_at IS NOT NULL THEN RETURN NEW; END IF;
 END IF;
 SELECT * INTO r FROM seo_runs WHERE id=NEW.run_id;
 SELECT * INTO t FROM tasks WHERE id=NEW.task_id;
 IF r.id IS NULL OR t.id IS NULL OR r.tenant_id<>NEW.tenant_id OR r.project_id<>NEW.project_id
  OR r.private_owner<>NEW.private_owner OR r.result_asset_version_id IS DISTINCT FROM NEW.result_asset_version_id
  OR t.tenant_id<>NEW.tenant_id OR t.project_id<>NEW.project_id OR t.created_by<>NEW.private_owner
  OR t.private_owner IS DISTINCT FROM NEW.private_owner OR t.mode<>'execute' OR t.parent_id IS NOT NULL
  OR t.input_context->>'seo_change_task_id' IS DISTINCT FROM NEW.id::text
  OR NOT seo_run_sources_available(NEW.run_id) THEN
  RAISE EXCEPTION 'Website change source binding is invalid' USING ERRCODE='23514'; END IF;
 FOREACH output IN ARRAY ARRAY[NEW.json_asset_version_id,NEW.html_asset_version_id] LOOP
  IF output IS NULL THEN CONTINUE; END IF;
  SELECT * INTO v FROM asset_versions WHERE id=output;
  SELECT * INTO a FROM assets WHERE id=v.asset_id;
  IF v.id IS NULL OR a.project_id<>NEW.project_id OR a.tenant_id<>NEW.tenant_id
   OR a.private_owner IS DISTINCT FROM NEW.private_owner OR a.state<>'active' OR v.erased_at IS NOT NULL
   OR v.metadata->>'task_id' IS DISTINCT FROM NEW.task_id::text
   OR v.metadata->>'seo_run_id' IS DISTINCT FROM NEW.run_id::text
   OR v.metadata->>'seo_change_task_id' IS DISTINCT FROM NEW.id::text
   OR v.metadata->>'change_spec_hash' IS DISTINCT FROM NEW.spec_hash
   OR v.mime_type IS DISTINCT FROM (CASE WHEN output=NEW.json_asset_version_id THEN 'application/json' ELSE 'text/html' END) THEN
   RAISE EXCEPTION 'Website change output binding is invalid' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_seo_change_binding() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_seo_change_binding() FROM PUBLIC;
CREATE TRIGGER seo_change_binding BEFORE INSERT OR UPDATE ON seo_change_tasks FOR EACH ROW EXECUTE FUNCTION guard_seo_change_binding();
CREATE TRIGGER seo_change_task_binding BEFORE UPDATE OF title,prompt,mode,private_owner,parent_id,input_context ON tasks
 FOR EACH ROW EXECUTE FUNCTION guard_seo_change_binding();

-- Preserve the prior crawl fence and add private draft/publication lineage.
CREATE OR REPLACE FUNCTION seo_asset_available(asset uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT NOT EXISTS(SELECT 1 FROM seo_runs r JOIN assets a ON a.id=asset
  WHERE (EXISTS(SELECT 1 FROM asset_versions av WHERE av.asset_id=a.id AND (av.metadata->>'task_id'=r.task_id::text OR av.metadata->>'seo_run_id'=r.id::text))
    OR EXISTS(SELECT 1 FROM seo_documents d WHERE d.run_id=r.id AND d.asset_id=asset)
    OR EXISTS(SELECT 1 FROM asset_versions v WHERE v.asset_id=asset AND (v.id=r.result_asset_version_id OR v.id=r.report_asset_version_id)))
   AND NOT seo_run_sources_available(r.id))
 AND NOT EXISTS(SELECT 1 FROM asset_versions v JOIN seo_change_tasks c ON v.metadata->>'seo_change_task_id'=c.id::text
  WHERE v.asset_id=asset AND NOT seo_change_available(c.id))
$$;

CREATE FUNCTION erase_seo_changes() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE ids uuid[]; parent_type text; parent_target uuid;
BEGIN
 IF TG_TABLE_NAME='seo_runs' THEN
  IF NEW.invalidated_at IS NULL OR OLD.invalidated_at IS NOT NULL THEN RETURN NEW; END IF;
  SELECT array_agg(id) INTO ids FROM seo_change_tasks WHERE run_id=NEW.id AND invalidated_at IS NULL;
  parent_type:='tasks'; parent_target:=NEW.task_id;
 ELSIF TG_TABLE_NAME='tasks' THEN
  IF NEW.content_state<>'deleted' OR OLD.content_state='deleted' THEN RETURN NEW; END IF;
  SELECT array_agg(id) INTO ids FROM seo_change_tasks WHERE task_id=NEW.id AND invalidated_at IS NULL;
  parent_type:='tasks'; parent_target:=NEW.id;
 ELSE
  IF NEW.state<>'deleted' OR OLD.state='deleted' THEN RETURN NEW; END IF;
  SELECT array_agg(c.id) INTO ids FROM seo_change_tasks c JOIN asset_versions v
   ON v.id=c.json_asset_version_id OR v.id=c.html_asset_version_id WHERE v.asset_id=NEW.id AND c.invalidated_at IS NULL;
  parent_type:='assets'; parent_target:=NEW.id;
 END IF;
 IF ids IS NULL THEN RETURN NEW; END IF;
 UPDATE seo_change_tasks SET invalidated_at=clock_timestamp(),spec='{}' WHERE id=ANY(ids);
 UPDATE tasks SET content_state='deleted',cancel_requested=true,output=NULL,moderation_version=moderation_version+1
  WHERE id IN(SELECT task_id FROM seo_change_tasks WHERE id=ANY(ids)) AND content_state<>'deleted';
 UPDATE assets SET state='deleted',moderation_version=moderation_version+1 WHERE state<>'deleted'
  AND id IN(SELECT asset_id FROM asset_versions WHERE metadata->>'seo_change_task_id'=ANY(SELECT id::text FROM seo_change_tasks WHERE id=ANY(ids)));
 INSERT INTO deletion_dependencies(job_id,child_job_id)
  SELECT p.id,j.id FROM deletion_jobs p JOIN seo_change_tasks c ON c.id=ANY(ids)
   JOIN deletion_jobs j ON j.target_type='tasks' AND j.target_id=c.task_id
  WHERE p.target_type=parent_type AND p.target_id=parent_target AND p.id<>j.id ON CONFLICT DO NOTHING;
 INSERT INTO deletion_dependencies(job_id,child_job_id)
  SELECT p.id,j.id FROM deletion_jobs p JOIN seo_change_tasks c ON c.id=ANY(ids)
   JOIN asset_versions v ON v.metadata->>'seo_change_task_id'=c.id::text
   JOIN deletion_jobs j ON j.target_type='assets' AND j.target_id=v.asset_id
  WHERE p.target_type='tasks' AND p.target_id=c.task_id AND p.id<>j.id ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
ALTER FUNCTION erase_seo_changes() OWNER TO cp_control;
REVOKE ALL ON FUNCTION erase_seo_changes() FROM PUBLIC;
CREATE TRIGGER zz_seo_changes_origin_erasure AFTER UPDATE OF invalidated_at ON seo_runs FOR EACH ROW EXECUTE FUNCTION erase_seo_changes();
CREATE TRIGGER zz_seo_changes_task_erasure AFTER UPDATE OF content_state ON tasks FOR EACH ROW EXECUTE FUNCTION erase_seo_changes();
CREATE TRIGGER zz_seo_changes_asset_erasure AFTER UPDATE OF state ON assets FOR EACH ROW EXECUTE FUNCTION erase_seo_changes();
INSERT INTO schema_migrations(version) VALUES(80);
