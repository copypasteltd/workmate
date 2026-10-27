-- SQL078 remains immutable. Qualify the task binding query independently of the PL/pgSQL record variable.
CREATE OR REPLACE FUNCTION guard_seo_binding() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
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
  IF NEW.content_state<>'deleted' AND EXISTS(SELECT 1 FROM seo_runs bound_run WHERE bound_run.task_id=NEW.id AND
    (NEW.input_context->>'seo_audit_id' IS DISTINCT FROM bound_run.id::text OR NEW.private_owner IS DISTINCT FROM bound_run.private_owner)) THEN
    RAISE EXCEPTION 'SEO task binding cannot be removed' USING ERRCODE='23514'; END IF;
 END IF; RETURN NEW;
END $$;
