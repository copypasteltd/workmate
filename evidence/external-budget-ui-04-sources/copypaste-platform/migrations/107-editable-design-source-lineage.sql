-- Private design derivation is independent of explicitly published snapshots.
-- Extend the installed traversals in place, preserving every older branch/OID.
DO $$ DECLARE definition text; anchor text; hook text; BEGIN
 definition:=pg_get_functiondef('content_source_manifest_before_creative_feedback(uuid,uuid,uuid[],uuid[])'::regprocedure);
 anchor:='   IF source_version.metadata ? ''brand_reference'' THEN';
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Unexpected design source traversal'; END IF;
 hook:=$hook$   IF source_version.metadata ? 'editable_design_source_versions' THEN
    IF jsonb_typeof(source_version.metadata->'editable_design_source_versions') IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
    pending_versions:=pending_versions||ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(source_version.metadata->'editable_design_source_versions'));
   END IF;
$hook$;
 EXECUTE replace(definition,anchor,hook||anchor);
 definition:=pg_get_functiondef('publication_input_sources(uuid,uuid)'::regprocedure);
 anchor:='   IF file_row.metadata ? ''brand_reference'' THEN';
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Unexpected design publication traversal'; END IF;
 hook:=$hook$   IF file_row.metadata ? 'editable_design_source_versions' THEN
    pending_versions:=pending_versions||ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(file_row.metadata->'editable_design_source_versions'));
   END IF;
$hook$;
 EXECUTE replace(definition,anchor,hook||anchor);
END $$;

CREATE FUNCTION guard_editable_design_source_binding() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE scope_task tasks; target assets; source_version asset_versions; source_asset assets; source_id text;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(OLD.metadata->'editable_design_source_versions',OLD.metadata->'brand_reference')
    IS DISTINCT FROM ROW(NEW.metadata->'editable_design_source_versions',NEW.metadata->'brand_reference')
    AND (OLD.metadata ? 'editable_design_source_versions' OR NEW.metadata ? 'editable_design_source_versions')
    AND NOT(NEW.erased_at IS NOT NULL AND coalesce(current_setting('app.erasing_content',true),'false')='true') THEN
   RAISE EXCEPTION 'Editable design source binding is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NOT NEW.metadata ? 'editable_design_source_versions' THEN RETURN NEW; END IF;
 SELECT * INTO scope_task FROM tasks WHERE id=nullif(current_setting('app.task_id',true),'')::uuid
  AND id::text=NEW.metadata->>'task_id' AND tenant_id=NEW.tenant_id
  AND created_by=nullif(current_setting('app.actor_id',true),'')::uuid AND status='running' AND NOT cancel_requested AND content_state='active';
 SELECT * INTO target FROM assets WHERE id=NEW.asset_id;
 IF scope_task.id IS NULL OR target.id IS NULL OR target.tenant_id<>scope_task.tenant_id OR target.project_id<>scope_task.project_id
  OR target.created_by<>scope_task.created_by OR target.private_owner IS DISTINCT FROM scope_task.private_owner
  OR target.kind<>'deliverable' OR NEW.metadata->>'editable_design_schema' IS DISTINCT FROM 'copypaste-editable-design-1'
  OR jsonb_typeof(NEW.metadata->'editable_design_source_versions') IS DISTINCT FROM 'array' THEN
  RAISE EXCEPTION 'Editable design source scope mismatch' USING ERRCODE='23514'; END IF;
 IF jsonb_array_length(NEW.metadata->'editable_design_source_versions')>1602 THEN
  RAISE EXCEPTION 'Too many editable design sources' USING ERRCODE='23514'; END IF;
 FOR source_id IN SELECT value FROM jsonb_array_elements_text(NEW.metadata->'editable_design_source_versions') LOOP
  IF source_id !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' OR source_id=NEW.id::text THEN
   RAISE EXCEPTION 'Invalid editable design source' USING ERRCODE='23514'; END IF;
  SELECT * INTO source_version FROM asset_versions WHERE id=source_id::uuid AND erased_at IS NULL;
  SELECT * INTO source_asset FROM assets WHERE id=source_version.asset_id AND tenant_id=scope_task.tenant_id
   AND project_id=scope_task.project_id AND state='active' AND retention_expires_at>clock_timestamp() FOR SHARE NOWAIT;
  IF source_asset.id IS NULL OR NOT task_asset_version_sources_available(source_version.id) OR (
    source_asset.private_owner IS NULL OR (
      source_asset.private_owner=scope_task.created_by AND source_asset.private_owner=scope_task.private_owner AND (
        source_version.metadata->>'conversation_id'=scope_task.conversation_id::text OR EXISTS(
          SELECT 1 FROM desktop_executions current_execution JOIN desktop_executions source_execution
           ON source_execution.task_id::text=source_version.metadata->>'task_id'
           AND source_execution.tenant_id=current_execution.tenant_id AND source_execution.project_id=current_execution.project_id
           AND source_execution.actor_id=current_execution.actor_id AND source_execution.native_family_id=current_execution.native_family_id
           AND source_execution.device_id=current_execution.device_id AND source_execution.local_session_id=current_execution.local_session_id
           AND source_execution.workspace_hash=current_execution.workspace_hash AND source_execution.runtime_sha256=current_execution.runtime_sha256
          WHERE current_execution.task_id=scope_task.id)
      )
    )
  ) IS NOT TRUE THEN RAISE EXCEPTION 'Editable design source scope mismatch' USING ERRCODE='23514'; END IF;
 END LOOP;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_editable_design_source_binding() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_editable_design_source_binding() FROM PUBLIC;
CREATE TRIGGER editable_design_source_binding BEFORE INSERT OR UPDATE OF metadata ON asset_versions
 FOR EACH ROW EXECUTE FUNCTION guard_editable_design_source_binding();
INSERT INTO schema_migrations(version) VALUES(107);
