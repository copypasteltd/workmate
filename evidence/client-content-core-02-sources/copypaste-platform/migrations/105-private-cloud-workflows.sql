-- Published SQL001-104 stay immutable. Extend the existing versioned workflow
-- model to private CLOUD work; native execution and legacy shared flows retain
-- their separate paths and defaults.
ALTER TABLE workflows DROP CONSTRAINT native_workflow_scope;
ALTER TABLE workflows ADD CONSTRAINT native_workflow_scope CHECK(
 (execution_location='cloud' AND private_owner IS NULL AND origin_task_id IS NULL) OR
 (private_owner=created_by AND private_owner IS NOT NULL AND origin_task_id IS NOT NULL));
ALTER TABLE workflow_runs DROP CONSTRAINT native_workflow_run_scope;
ALTER TABLE workflow_runs ADD CONSTRAINT native_workflow_run_scope CHECK(
 (execution_location='cloud' AND private_owner IS NULL AND origin_task_id IS NULL) OR
 (private_owner=created_by AND private_owner IS NOT NULL AND origin_task_id IS NOT NULL AND workflow_version IS NOT NULL));
CREATE UNIQUE INDEX one_private_cloud_workflow_request ON workflow_runs(origin_task_id,workflow_id,workflow_version)
 WHERE execution_location='cloud' AND private_owner IS NOT NULL;
CREATE INDEX cloud_workflow_origin ON workflow_runs(origin_task_id) WHERE execution_location='cloud' AND private_owner IS NOT NULL;
ALTER TABLE task_tool_receipts DROP CONSTRAINT task_tool_receipts_tool_name_check;
ALTER TABLE task_tool_receipts ADD CONSTRAINT task_tool_receipts_tool_name_check CHECK(tool_name IN(
 'deliver_text','code_write','code_package','design_render','video_project_queue',
 'video_project_edit','video_project_render','video_project_cancel','chart_render',
 'workflow_save','workflow_publish','workflow_run','workflow_cancel'));
ALTER POLICY native_version_scope ON workflow_versions WITH CHECK(current_user='cp_control' OR
 (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND private_owner=nullif(current_setting('app.actor_id',true),'')::uuid
  AND EXISTS(SELECT 1 FROM workflows w WHERE w.id=workflow_id AND w.private_owner=workflow_versions.private_owner
   AND w.tenant_id=workflow_versions.tenant_id AND w.project_id=workflow_versions.project_id AND w.content_state='active')));

ALTER TABLE tasks ADD COLUMN cloud_workflow_run_id uuid REFERENCES workflow_runs(id);
ALTER TABLE tasks ADD COLUMN cloud_workflow_cursor integer;
ALTER TABLE tasks ADD CONSTRAINT cloud_workflow_step CHECK(
 (cloud_workflow_run_id IS NULL AND cloud_workflow_cursor IS NULL) OR
 (cloud_workflow_run_id IS NOT NULL AND cloud_workflow_cursor BETWEEN 0 AND 7 AND execution_location='cloud' AND private_owner=created_by));
CREATE UNIQUE INDEX one_cloud_workflow_step ON tasks(cloud_workflow_run_id,cloud_workflow_cursor) WHERE cloud_workflow_run_id IS NOT NULL;

CREATE OR REPLACE FUNCTION check_native_workflow_read() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Workflow reads are immutable' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM tasks t JOIN workflow_versions v ON v.workflow_id=NEW.workflow_id AND v.version=NEW.version
 JOIN workflows w ON w.id=v.workflow_id JOIN tasks origin ON origin.id=w.origin_task_id
 WHERE t.id=NEW.task_id AND t.id=nullif(current_setting('app.task_id',true),'')::uuid
 AND t.status='running' AND NOT t.cancel_requested AND t.content_state='active'
 AND t.private_owner=NEW.private_owner AND t.tenant_id=NEW.tenant_id AND t.project_id=NEW.project_id
 AND w.execution_location=t.execution_location AND w.content_state='active' AND w.private_owner=t.private_owner
 AND w.tenant_id=t.tenant_id AND w.project_id=t.project_id
 AND (t.execution_location='desktop' OR origin.conversation_id IS NOT DISTINCT FROM t.conversation_id)
 AND v.private_owner=w.private_owner AND v.tenant_id=w.tenant_id AND v.project_id=w.project_id) THEN
 RAISE EXCEPTION 'Invalid workflow read' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION guard_native_workflow_sources() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE expected jsonb;
BEGIN
 expected:=publication_input_sources(NULL,nullif(current_setting('app.task_id',true),'')::uuid);
 IF expected IS NULL THEN RAISE EXCEPTION 'Workflow source snapshot is unavailable' USING ERRCODE='23514'; END IF;
 IF NEW.source_refs IS DISTINCT FROM expected THEN RAISE EXCEPTION 'Workflow source snapshot differs from the authorized reads' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(
  SELECT 1 FROM workflows w JOIN tasks t ON t.id=nullif(current_setting('app.task_id',true),'')::uuid
  WHERE w.id=NEW.workflow_id AND w.execution_location=t.execution_location
   AND w.tenant_id=NEW.tenant_id AND w.project_id=NEW.project_id AND w.private_owner=NEW.private_owner
   AND w.private_owner=t.private_owner AND w.private_owner=nullif(current_setting('app.actor_id',true),'')::uuid) THEN
  RAISE EXCEPTION 'Workflow source snapshot has an invalid owner or execution location' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION cloud_workflow_version_available(target uuid,revision integer) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT EXISTS(SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workflow_id=w.id AND v.version=revision
  JOIN native_workflow_reads r ON r.workflow_id=v.workflow_id AND r.version=v.version JOIN tasks t ON t.id=r.task_id
  WHERE w.id=target AND w.execution_location='cloud' AND w.private_owner=nullif(current_setting('app.actor_id',true),'')::uuid
   AND w.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND w.content_state='active'
   AND t.private_owner=w.private_owner AND task_content_sources_available(t.id))
$$;
ALTER FUNCTION cloud_workflow_version_available(uuid,integer) OWNER TO cp_control;
REVOKE ALL ON FUNCTION cloud_workflow_version_available(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cloud_workflow_version_available(uuid,integer) TO cp_app;

CREATE FUNCTION check_private_cloud_workflow() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF NEW.execution_location<>'cloud' OR NEW.private_owner IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.id=NEW.origin_task_id
  AND t.id=nullif(current_setting('app.task_id',true),'')::uuid AND t.role_key='workflow-consultant'
  AND t.execution_location='cloud' AND t.private_owner=NEW.private_owner AND t.created_by=NEW.private_owner
  AND t.tenant_id=NEW.tenant_id AND t.project_id=NEW.project_id AND t.cloud_workflow_run_id IS NULL
  AND t.status='running' AND NOT t.cancel_requested AND t.content_state='active' AND t.lease_until>clock_timestamp()) THEN
  RAISE EXCEPTION 'Invalid private cloud workflow origin' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='workflow_runs' THEN
  IF TG_OP='INSERT' AND (NEW.authorized_at IS NOT NULL OR NEW.state<>'awaiting_approval' OR NEW.cursor<>0
   OR NOT EXISTS(SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workflow_id=w.id
    WHERE w.id=NEW.workflow_id AND w.execution_location='cloud' AND w.private_owner=NEW.private_owner
    AND w.tenant_id=NEW.tenant_id AND w.project_id=NEW.project_id AND w.content_state='active'
    AND v.version=NEW.workflow_version AND v.published_at IS NOT NULL AND v.definition=NEW.definition AND v.role_hashes=NEW.role_hashes)) THEN
   RAISE EXCEPTION 'Private cloud run needs a fixed version and customer approval' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND ROW(NEW.definition,NEW.workflow_version,NEW.role_hashes,NEW.workflow_id)
   IS DISTINCT FROM ROW(OLD.definition,OLD.workflow_version,OLD.role_hashes,OLD.workflow_id)
   AND NOT(current_user='cp_control' AND coalesce(current_setting('app.erasing_content',true),'')='true'
    AND NEW.definition='{}'::jsonb AND NEW.results='[]'::jsonb) THEN
   RAISE EXCEPTION 'Cloud workflow run definition is immutable' USING ERRCODE='23514'; END IF;
 ELSE
  IF TG_OP='UPDATE' AND NEW.definition IS DISTINCT FROM OLD.definition
   AND NOT(NEW.version=OLD.version+1 AND NEW.state='draft')
   AND NOT(current_user='cp_control' AND coalesce(current_setting('app.erasing_content',true),'')='true' AND NEW.definition='{}'::jsonb) THEN
   RAISE EXCEPTION 'Cloud workflow edits require a new version' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION check_private_cloud_workflow() OWNER TO cp_control;
REVOKE ALL ON FUNCTION check_private_cloud_workflow() FROM PUBLIC;
CREATE TRIGGER private_cloud_workflow_origin BEFORE INSERT OR UPDATE ON workflows FOR EACH ROW EXECUTE FUNCTION check_private_cloud_workflow();
CREATE TRIGGER private_cloud_run_origin BEFORE INSERT OR UPDATE ON workflow_runs FOR EACH ROW EXECUTE FUNCTION check_private_cloud_workflow();

CREATE FUNCTION check_cloud_workflow_child() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF TG_OP='UPDATE' AND OLD.cloud_workflow_run_id IS NOT NULL AND ROW(NEW.cloud_workflow_run_id,NEW.cloud_workflow_cursor)
  IS DISTINCT FROM ROW(OLD.cloud_workflow_run_id,OLD.cloud_workflow_cursor) THEN
  RAISE EXCEPTION 'Cloud workflow child binding is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.cloud_workflow_run_id IS NOT NULL AND (TG_OP='INSERT' OR OLD.cloud_workflow_run_id IS NULL) AND NOT EXISTS(
  SELECT 1 FROM workflow_runs r JOIN tasks origin ON origin.id=r.origin_task_id WHERE r.id=NEW.cloud_workflow_run_id
  AND r.execution_location='cloud' AND r.private_owner=NEW.created_by AND r.private_owner=NEW.private_owner
  AND r.tenant_id=NEW.tenant_id AND r.project_id=NEW.project_id AND r.cursor=NEW.cloud_workflow_cursor
  AND r.state='running' AND r.authorized_at IS NOT NULL AND r.content_state='active'
  AND origin.status='succeeded' AND NOT origin.cancel_requested AND origin.content_state='active'
  AND origin.retention_expires_at>clock_timestamp() AND origin.conversation_id IS NOT DISTINCT FROM NEW.conversation_id
  AND (r.definition->'steps'->r.cursor->>'kind')='codex'
  AND (r.definition->'steps'->r.cursor->>'role_key')=NEW.role_key AND NEW.role_key<>'workflow-consultant'
  AND r.role_hashes->>NEW.role_key=NEW.role_hash
  AND (r.definition->'steps'->r.cursor->>'budget_micros')::bigint=NEW.budget_micros) THEN
  RAISE EXCEPTION 'Invalid cloud workflow child' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION check_cloud_workflow_child() OWNER TO cp_control;
REVOKE ALL ON FUNCTION check_cloud_workflow_child() FROM PUBLIC;
CREATE TRIGGER cloud_workflow_child_scope BEFORE INSERT OR UPDATE OF cloud_workflow_run_id,cloud_workflow_cursor ON tasks FOR EACH ROW EXECUTE FUNCTION check_cloud_workflow_child();

CREATE FUNCTION stop_private_cloud_workflow() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF NEW.execution_location='cloud' AND NEW.private_owner IS NOT NULL AND (NEW.state IN('cancelled','failed') OR NEW.content_state<>'active') THEN
  UPDATE tasks SET cancel_requested=true,version=version+1 WHERE cloud_workflow_run_id=NEW.id AND NOT cancel_requested;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION stop_private_cloud_workflow() OWNER TO cp_control;
REVOKE ALL ON FUNCTION stop_private_cloud_workflow() FROM PUBLIC;
CREATE TRIGGER private_cloud_workflow_stopped AFTER UPDATE OF state,content_state ON workflow_runs FOR EACH ROW EXECUTE FUNCTION stop_private_cloud_workflow();

-- Keep the live traversal's brand, feedback, GEO and project configuration
-- hooks. Fail migration if a reviewed anchor has drifted; never replace it
-- with an old copy of the whole function.
DO $$ DECLARE definition text; anchor text; BEGIN
 definition:=pg_get_functiondef('content_source_manifest_before_creative_feedback(uuid,uuid,uuid[],uuid[])'::regprocedure);
 anchor:=$anchor$FOR r IN SELECT * FROM workflow_runs WHERE execution_location='desktop'
    AND (origin_task_id=source_task.id OR id=source_task.desktop_workflow_run_id) LOOP$anchor$;
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Missing workflow traversal anchor'; END IF;
 definition:=replace(definition,anchor,$hook$FOR r IN SELECT * FROM workflow_runs WHERE private_owner IS NOT NULL
    AND (origin_task_id=source_task.id OR id=source_task.desktop_workflow_run_id OR id=source_task.cloud_workflow_run_id) LOOP$hook$);
 anchor:='WHERE x.desktop_workflow_run_id=r.id;';
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Missing workflow child traversal anchor'; END IF;
 definition:=replace(definition,anchor,'WHERE x.desktop_workflow_run_id=r.id OR x.cloud_workflow_run_id=r.id;');
 EXECUTE definition;
 definition:=pg_get_functiondef('publication_input_sources(uuid,uuid)'::regprocedure);
 anchor:=$anchor$t.execution_location='desktop' AND t.role_key='workflow-consultant'
   AND t.desktop_workflow_run_id IS NULL$anchor$;
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Missing consultant publication authority anchor'; END IF;
 definition:=replace(definition,anchor,$hook$t.execution_location IN('desktop','cloud') AND t.role_key='workflow-consultant'
   AND t.desktop_workflow_run_id IS NULL AND t.cloud_workflow_run_id IS NULL$hook$);
 anchor:=$anchor$WHERE r.execution_location='desktop' AND (r.origin_task_id=task_row.id OR r.id=task_row.desktop_workflow_run_id)$anchor$;
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Missing workflow publication anchor'; END IF;
 definition:=replace(definition,anchor,$hook$WHERE r.private_owner IS NOT NULL AND (r.origin_task_id=task_row.id OR r.id=task_row.desktop_workflow_run_id OR r.id=task_row.cloud_workflow_run_id)$hook$);
 anchor:='WHERE x.desktop_workflow_run_id=item.run_id;';
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Missing workflow publication child anchor'; END IF;
 definition:=replace(definition,anchor,'WHERE x.desktop_workflow_run_id=item.run_id OR x.cloud_workflow_run_id=item.run_id;');
 EXECUTE definition;
END $$;
INSERT INTO schema_migrations(version) VALUES(105);
