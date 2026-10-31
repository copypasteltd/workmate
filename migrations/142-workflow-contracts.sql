ALTER TABLE workflow_runs ADD COLUMN input_values jsonb NOT NULL DEFAULT '{}';
ALTER TABLE workflow_runs ADD COLUMN input_files jsonb NOT NULL DEFAULT '[]';
ALTER TABLE workflow_runs ADD COLUMN input_hash text;
ALTER TABLE workflow_runs ADD COLUMN named_outputs jsonb NOT NULL DEFAULT '{}';
ALTER TABLE workflow_runs ADD CONSTRAINT workflow_contract_values CHECK(jsonb_typeof(input_values)='object' AND jsonb_typeof(input_files)='array'
 AND jsonb_typeof(named_outputs)='object' AND (input_hash IS NULL OR input_hash ~ '^[a-f0-9]{64}$'));

CREATE FUNCTION guard_workflow_contract() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE approved_body jsonb;
BEGIN
 IF TG_OP='INSERT' AND ((NEW.definition ? 'input_schema') IS DISTINCT FROM (NEW.input_hash IS NOT NULL)) THEN
  RAISE EXCEPTION 'Workflow contract requires fixed per-run inputs' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND (NEW.cloud_schedule_id IS NOT NULL OR NEW.cloud_event_trigger_id IS NOT NULL) THEN
  IF NEW.cloud_schedule_id IS NOT NULL THEN
   SELECT body INTO approved_body FROM cloud_schedule_versions WHERE schedule_id=NEW.cloud_schedule_id AND revision=NEW.cloud_schedule_revision;
  ELSE SELECT body INTO approved_body FROM cloud_event_versions WHERE trigger_id=NEW.cloud_event_trigger_id AND revision=NEW.cloud_event_revision; END IF;
  IF approved_body IS NULL OR NEW.input_values IS DISTINCT FROM coalesce(approved_body->'input_binding'->'values','{}'::jsonb)
   OR NEW.input_files IS DISTINCT FROM coalesce(approved_body->'input_binding'->'files','[]'::jsonb)
   OR NEW.input_hash IS DISTINCT FROM approved_body->'input_binding'->>'input_hash' THEN
   RAISE EXCEPTION 'Recurring workflow inputs differ from customer approval' USING ERRCODE='23514'; END IF;
 END IF;
 IF TG_OP='UPDATE' AND ROW(NEW.input_values,NEW.input_files,NEW.input_hash)
  IS DISTINCT FROM ROW(OLD.input_values,OLD.input_files,OLD.input_hash)
  AND NOT(NEW.content_state='deleted' AND coalesce(current_setting('app.erasing_content',true),'false')='true'
   AND NEW.input_values='{}'::jsonb AND NEW.input_files='[]'::jsonb AND NEW.input_hash IS NULL) THEN
  RAISE EXCEPTION 'Workflow run inputs are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_workflow_contract() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_workflow_contract() FROM PUBLIC;
CREATE TRIGGER workflow_contract_guard BEFORE INSERT OR UPDATE ON workflow_runs FOR EACH ROW EXECUTE FUNCTION guard_workflow_contract();

CREATE FUNCTION guard_workflow_task_values() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE run workflow_runs; binding jsonb;
BEGIN
 IF TG_OP='UPDATE' AND OLD.input_context->'workflow_binding' IS DISTINCT FROM NEW.input_context->'workflow_binding'
  AND NOT(NEW.content_state='deleted' AND coalesce(current_setting('app.erasing_content',true),'false')='true') THEN
  RAISE EXCEPTION 'Named workflow input binding is immutable' USING ERRCODE='23514'; END IF;
 IF NOT(NEW.input_context ? 'workflow_binding') OR TG_OP='UPDATE' THEN RETURN NEW; END IF;
 binding:=NEW.input_context->'workflow_binding';
 IF coalesce(binding->>'run_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' THEN
  RAISE EXCEPTION 'Invalid workflow input run' USING ERRCODE='23514'; END IF;
 SELECT * INTO run FROM workflow_runs WHERE id=(binding->>'run_id')::uuid;
 IF run.id IS NULL OR run.tenant_id<>NEW.tenant_id OR run.project_id<>NEW.project_id OR run.private_owner IS DISTINCT FROM NEW.created_by
  OR NEW.private_owner IS DISTINCT FROM NEW.created_by OR run.execution_location<>NEW.execution_location
  OR run.input_hash IS NULL OR binding->>'input_hash' IS DISTINCT FROM run.input_hash
  OR binding->'values' IS DISTINCT FROM run.input_values OR binding->'files' IS DISTINCT FROM run.input_files
  OR run.state<>'running' OR run.authorized_at IS NULL OR run.content_state<>'active'
  OR run.definition->'steps'->run.cursor->>'role_key' IS DISTINCT FROM NEW.role_key
  OR run.role_hashes->>NEW.role_key IS DISTINCT FROM NEW.role_hash
  OR (run.definition->'steps'->run.cursor->>'budget_micros')::bigint IS DISTINCT FROM NEW.budget_micros THEN
  RAISE EXCEPTION 'Invalid named workflow child binding' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_workflow_task_values() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_workflow_task_values() FROM PUBLIC;
CREATE TRIGGER workflow_task_values_guard BEFORE INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION guard_workflow_task_values();

DO $$ DECLARE definition text; anchor text; BEGIN
 definition:=pg_get_functiondef('content_source_manifest_before_creative_feedback(uuid,uuid,uuid[],uuid[])'::regprocedure);
 anchor:='   IF source_task.input_context ? ''workflow_inputs'' THEN';
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Missing named workflow input source anchor'; END IF;
 EXECUTE replace(definition,anchor,$hook$   DECLARE contract_run workflow_runs; contract_file record; binding jsonb; BEGIN
    binding:=source_task.input_context->'workflow_binding';
    IF binding IS NOT NULL AND NOT EXISTS(SELECT 1 FROM workflow_runs wr
     WHERE wr.id=coalesce(source_task.cloud_workflow_run_id,source_task.desktop_workflow_run_id)
      AND wr.id::text=binding->>'run_id' AND wr.input_hash=binding->>'input_hash'
      AND wr.input_values=binding->'values' AND wr.input_files=binding->'files'
      AND wr.private_owner=source_task.created_by AND wr.tenant_id=source_task.tenant_id AND wr.project_id=source_task.project_id) THEN RETURN NULL; END IF;
     FOR contract_file IN SELECT f.* FROM workflow_runs wr,jsonb_to_recordset(wr.input_files) AS f(asset_id uuid,asset_version_id uuid,sha256 text)
       WHERE wr.private_owner IS NOT NULL AND (wr.origin_task_id=source_task.id OR wr.id=source_task.cloud_workflow_run_id OR wr.id=source_task.desktop_workflow_run_id)
       UNION ALL SELECT f.* FROM (
        SELECT body FROM cloud_schedule_requests WHERE origin_task_id=source_task.id AND content_state='active'
        UNION ALL SELECT body FROM cloud_event_requests WHERE origin_task_id=source_task.id AND content_state='active'
       ) q,jsonb_to_recordset(coalesce(q.body->'input_binding'->'files','[]'::jsonb)) AS f(asset_id uuid,asset_version_id uuid,sha256 text) LOOP
       IF NOT EXISTS(SELECT 1 FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=contract_file.asset_version_id
        AND v.asset_id=contract_file.asset_id AND v.sha256=contract_file.sha256 AND a.tenant_id=source_task.tenant_id
        AND a.project_id=source_task.project_id AND (a.private_owner IS NULL OR a.private_owner=source_task.created_by)) THEN RETURN NULL; END IF;
       pending_versions:=array_append(pending_versions,contract_file.asset_version_id);
     END LOOP;
   END;
$hook$||anchor);
 definition:=pg_get_functiondef('publication_input_sources(uuid,uuid)'::regprocedure);
 anchor:='   IF task_row.input_context ? ''plan_source_task_id'' THEN';
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Missing named workflow publication anchor'; END IF;
 EXECUTE replace(definition,anchor,$hook$   DECLARE contract_file record; BEGIN
    FOR contract_file IN SELECT f.* FROM workflow_runs wr,jsonb_to_recordset(wr.input_files) AS f(asset_version_id uuid)
     WHERE wr.private_owner IS NOT NULL AND (wr.origin_task_id=task_row.id OR wr.id=task_row.cloud_workflow_run_id OR wr.id=task_row.desktop_workflow_run_id) LOOP
     pending_versions:=array_append(pending_versions,contract_file.asset_version_id);
    END LOOP;
     FOR contract_file IN SELECT f.* FROM (
       SELECT body FROM cloud_schedule_requests WHERE origin_task_id=task_row.id AND content_state='active'
       UNION ALL SELECT body FROM cloud_event_requests WHERE origin_task_id=task_row.id AND content_state='active'
      ) q,jsonb_to_recordset(coalesce(q.body->'input_binding'->'files','[]'::jsonb)) AS f(asset_version_id uuid) LOOP
       pending_versions:=array_append(pending_versions,contract_file.asset_version_id);
     END LOOP;
   END;
$hook$||anchor);
END $$;
INSERT INTO schema_migrations(version) VALUES(142);
