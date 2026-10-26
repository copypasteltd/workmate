-- Source policies also run on INSERT ... RETURNING before the new row can
-- be found by a helper query. Absence supplies no content and must not deny
-- legitimate creation. Existing rows still fail closed on an invalid lineage.
CREATE OR REPLACE FUNCTION task_asset_sources_available(asset uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT NOT EXISTS(SELECT 1 FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version WHERE a.id=asset
  AND (v.metadata ? 'task_id' OR v.metadata ? 'publication_source_version_id')
  AND content_source_manifest(a.tenant_id,a.project_id,'{}',ARRAY[v.id]) IS NULL)
$$;
CREATE OR REPLACE FUNCTION task_asset_version_sources_available(p_version uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT NOT EXISTS(SELECT 1 FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=p_version
  AND (v.metadata ? 'task_id' OR v.metadata ? 'publication_source_version_id')
  AND content_source_manifest(a.tenant_id,a.project_id,'{}',ARRAY[v.id]) IS NULL)
$$;
CREATE OR REPLACE FUNCTION guard_content_source_binding() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE a assets; source assets;
BEGIN
 IF TG_TABLE_NAME='tasks' THEN
  IF TG_OP='UPDATE' AND OLD.input_context->'plan_source_task_id' IS DISTINCT FROM NEW.input_context->'plan_source_task_id'
   AND NOT(NEW.content_state='deleted' AND current_setting('app.erasing_content',true)='true') THEN
   RAISE EXCEPTION 'Approved plan source is immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND NEW.input_context ? 'plan_source_task_id' THEN
   IF NOT EXISTS(SELECT 1 FROM tasks parent WHERE parent.id=NEW.parent_id AND parent.tenant_id=NEW.tenant_id AND parent.project_id=NEW.project_id AND parent.created_by=NEW.created_by AND (parent.id::text=NEW.input_context->>'plan_source_task_id' OR parent.input_context->>'plan_source_task_id'=NEW.input_context->>'plan_source_task_id')) OR NOT EXISTS(
    SELECT 1 FROM tasks t JOIN task_plans p ON p.task_id=t.id WHERE t.id=(NEW.input_context->>'plan_source_task_id')::uuid AND t.tenant_id=NEW.tenant_id AND t.project_id=NEW.project_id
     AND t.created_by=NEW.created_by AND t.mode='plan' AND t.status='succeeded') THEN
    RAISE EXCEPTION 'Approved plan source scope mismatch' USING ERRCODE='23514'; END IF;
  END IF;
 ELSE
  IF TG_OP='UPDATE' AND OLD.metadata->'publication_source_version_id' IS DISTINCT FROM NEW.metadata->'publication_source_version_id'
   AND NOT(NEW.erased_at IS NOT NULL AND current_setting('app.erasing_content',true)='true') THEN
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
INSERT INTO schema_migrations(version) VALUES(83);
