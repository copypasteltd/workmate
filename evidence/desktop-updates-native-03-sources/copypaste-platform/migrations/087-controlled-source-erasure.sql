-- A missing erasure flag never authorizes provenance changes. Preserve SQL001-086.
CREATE OR REPLACE FUNCTION guard_content_source_binding() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE a assets; source assets;
BEGIN
 IF TG_TABLE_NAME='tasks' THEN
  IF TG_OP='UPDATE' AND OLD.input_context->'plan_source_task_id' IS DISTINCT FROM NEW.input_context->'plan_source_task_id'
   AND NOT(NEW.content_state='deleted' AND coalesce(current_setting('app.erasing_content',true),'false')='true') THEN
   RAISE EXCEPTION 'Approved plan source is immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND NEW.input_context ? 'plan_source_task_id' THEN
   IF NOT EXISTS(SELECT 1 FROM tasks parent WHERE parent.id=NEW.parent_id AND parent.tenant_id=NEW.tenant_id AND parent.project_id=NEW.project_id AND parent.created_by=NEW.created_by AND (parent.id::text=NEW.input_context->>'plan_source_task_id' OR parent.input_context->>'plan_source_task_id'=NEW.input_context->>'plan_source_task_id')) OR NOT EXISTS(
    SELECT 1 FROM tasks t JOIN task_plans p ON p.task_id=t.id WHERE t.id=(NEW.input_context->>'plan_source_task_id')::uuid AND t.tenant_id=NEW.tenant_id AND t.project_id=NEW.project_id
     AND t.created_by=NEW.created_by AND t.mode='plan' AND t.status='succeeded') THEN
    RAISE EXCEPTION 'Approved plan source scope mismatch' USING ERRCODE='23514'; END IF;
  END IF;
 ELSE
  IF TG_OP='UPDATE' AND OLD.metadata->'publication_source_version_id' IS DISTINCT FROM NEW.metadata->'publication_source_version_id'
   AND NOT(NEW.erased_at IS NOT NULL AND coalesce(current_setting('app.erasing_content',true),'false')='true') THEN
   RAISE EXCEPTION 'Published source binding is immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND NEW.metadata ? 'publication_source_version_id' THEN
   SELECT * INTO a FROM assets WHERE id=NEW.asset_id;
   SELECT x.* INTO source FROM asset_versions v JOIN assets x ON x.id=v.asset_id WHERE v.id=(NEW.metadata->>'publication_source_version_id')::uuid;
   IF a.kind<>'published_deliverable' OR source.id IS NULL OR source.tenant_id IS DISTINCT FROM a.tenant_id OR source.project_id IS DISTINCT FROM a.project_id
    OR source.private_owner IS DISTINCT FROM a.created_by OR source.state<>'active' THEN
    RAISE EXCEPTION 'Published source scope mismatch' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_content_source_binding() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_content_source_binding() FROM PUBLIC;
CREATE OR REPLACE FUNCTION guard_publication_input_snapshot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE expected_sources jsonb;
BEGIN
 IF TG_OP='UPDATE' AND ROW(OLD.metadata->'publication_sources',OLD.metadata->'publication_origin_version_id')
  IS DISTINCT FROM ROW(NEW.metadata->'publication_sources',NEW.metadata->'publication_origin_version_id')
  AND NOT(NEW.erased_at IS NOT NULL AND coalesce(current_setting('app.erasing_content',true),'false')='true') THEN
  RAISE EXCEPTION 'Published input provenance is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND (NEW.metadata ? 'publication_sources' OR NEW.metadata ? 'publication_origin_version_id') THEN
  expected_sources:=publication_input_sources((NEW.metadata->>'publication_origin_version_id')::uuid);
  IF NOT EXISTS(SELECT 1 FROM assets a JOIN asset_versions origin ON origin.id=(NEW.metadata->>'publication_origin_version_id')::uuid
   JOIN assets source ON source.id=origin.asset_id WHERE a.id=NEW.asset_id AND a.kind='published_deliverable'
   AND a.tenant_id=source.tenant_id AND a.project_id=source.project_id AND a.created_by=source.private_owner AND source.state='active')
   OR NEW.metadata->'publication_sources' IS NULL OR expected_sources IS NULL
   OR NEW.metadata->'publication_sources' IS DISTINCT FROM expected_sources THEN
   RAISE EXCEPTION 'Published input provenance scope mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_publication_input_snapshot() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_publication_input_snapshot() FROM PUBLIC;


INSERT INTO schema_migrations(version) VALUES(87);
