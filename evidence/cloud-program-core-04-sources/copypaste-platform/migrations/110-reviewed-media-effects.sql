-- Bind sources at customer approval, before a model has read them. Model-read
-- provenance remains truthful; reviewed input is not fabricated as an AI read.
CREATE FUNCTION guard_reviewed_media_effect() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.input_context->'media_effect' IS DISTINCT FROM NEW.input_context->'media_effect' THEN
  IF current_setting('app.erasing_content',true)='true' AND pg_has_role(current_user,'cp_control','member') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Reviewed media effect inputs are immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.input_context ? 'media_effect' AND (NEW.role_key<>'video-motion' OR NEW.execution_location<>'cloud'
  OR NEW.private_owner IS DISTINCT FROM NEW.created_by
  OR NEW.input_context->'media_effect'->'request'->>'schema' IS DISTINCT FROM 'copypaste-media-effect-1'
  OR NEW.input_context->'media_effect'->'request'->>'version' IS DISTINCT FROM '1.0.0'
  OR jsonb_typeof(NEW.input_context->'media_effect'->'request'->'sources') IS DISTINCT FROM 'array'
  OR jsonb_array_length(NEW.input_context->'media_effect'->'request'->'sources') NOT BETWEEN 1 AND 2
  OR coalesce(NEW.input_context->'media_effect'->>'request_sha256','') !~ '^[0-9a-f]{64}$'
  OR coalesce(NEW.input_context->'media_effect'->>'catalog_sha256','') !~ '^[0-9a-f]{64}$') THEN
  RAISE EXCEPTION 'Invalid reviewed media effect binding' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reviewed_media_effect_guard BEFORE INSERT OR UPDATE OF input_context,role_key,private_owner,created_by,execution_location ON tasks
 FOR EACH ROW EXECUTE FUNCTION guard_reviewed_media_effect();

-- Extend the current reviewed traversal in place. Existing brand, native/cloud
-- workflow, team, feedback and GEO hooks stay installed. Fail on anchor drift.
DO $$ DECLARE definition text; anchor text; BEGIN
 definition:=pg_get_functiondef('content_source_manifest_before_creative_feedback(uuid,uuid,uuid[],uuid[])'::regprocedure);
 anchor:='FOR r IN SELECT * FROM task_source_reads WHERE task_id=source_task.id LOOP';
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Missing unique effect source traversal anchor'; END IF;
 definition:=replace(definition,anchor,$hook$
   FOR r IN SELECT * FROM jsonb_to_recordset(coalesce(source_task.input_context->'media_effect'->'request'->'sources','[]'::jsonb)) AS x(asset_version_id uuid,sha256 text) LOOP
    IF NOT EXISTS(SELECT 1 FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=r.asset_version_id
     AND v.sha256=r.sha256 AND v.erased_at IS NULL AND a.tenant_id=source_task.tenant_id AND a.project_id=source_task.project_id
     AND a.private_owner IS NULL AND a.state='active' AND a.retention_expires_at>clock_timestamp()) THEN RETURN NULL; END IF;
    pending_versions:=array_append(pending_versions,r.asset_version_id);
   END LOOP;
   FOR r IN SELECT * FROM task_source_reads WHERE task_id=source_task.id LOOP$hook$);
 EXECUTE definition;
 definition:=pg_get_functiondef('publication_input_sources(uuid,uuid)'::regprocedure);
 anchor:='FOR item IN SELECT * FROM task_source_reads WHERE task_id=task_row.id LOOP';
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Missing unique effect publication source anchor'; END IF;
 definition:=replace(definition,anchor,$hook$
   FOR item IN SELECT * FROM jsonb_to_recordset(coalesce(task_row.input_context->'media_effect'->'request'->'sources','[]'::jsonb)) AS x(asset_version_id uuid) LOOP
    pending_versions:=array_append(pending_versions,item.asset_version_id);
   END LOOP;
   FOR item IN SELECT * FROM task_source_reads WHERE task_id=task_row.id LOOP$hook$);
 EXECUTE definition;
END $$;
INSERT INTO schema_migrations(version) VALUES(110);
