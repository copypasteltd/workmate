-- Keep SQL001-092 byte-for-byte. Native video composition has a durable owner.
ALTER TABLE creative_projects ADD COLUMN private_owner uuid REFERENCES users(id);
ALTER TABLE creative_projects ADD COLUMN origin_task_id uuid REFERENCES tasks(id);
ALTER TABLE creative_projects ADD CONSTRAINT private_video_project CHECK(
 (private_owner IS NULL AND origin_task_id IS NULL) OR
 (kind='video' AND private_owner IS NOT NULL AND private_owner=created_by AND origin_task_id IS NOT NULL));
CREATE POLICY private_video_project_scope ON creative_projects AS RESTRICTIVE FOR ALL TO cp_app
 USING(private_owner IS NULL OR private_owner=nullif(current_setting('app.actor_id',true),'')::uuid)
 WITH CHECK(private_owner IS NULL OR private_owner=nullif(current_setting('app.actor_id',true),'')::uuid);

CREATE FUNCTION check_private_video_project() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.private_owner,NEW.origin_task_id) IS DISTINCT FROM ROW(OLD.private_owner,OLD.origin_task_id) THEN
   RAISE EXCEPTION 'Video privacy and origin are immutable' USING ERRCODE='23514'; END IF;
 ELSIF NEW.origin_task_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tasks t
  WHERE t.id=NEW.origin_task_id AND t.id=nullif(current_setting('app.task_id',true),'')::uuid
   AND t.tenant_id=NEW.tenant_id AND t.project_id=NEW.project_id AND t.created_by=NEW.private_owner
   AND t.private_owner=NEW.private_owner AND t.execution_location='desktop' AND t.role_key='video-motion'
   AND t.status='running' AND NOT t.cancel_requested AND t.content_state='active' AND t.lease_until>clock_timestamp()) THEN
  RAISE EXCEPTION 'Invalid private video task' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION check_private_video_project() OWNER TO cp_control;
REVOKE ALL ON FUNCTION check_private_video_project() FROM PUBLIC;
CREATE TRIGGER private_video_project_origin BEFORE INSERT OR UPDATE ON creative_projects FOR EACH ROW EXECUTE FUNCTION check_private_video_project();

CREATE FUNCTION private_video_visible(video uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM creative_projects p WHERE p.id=video AND
  (p.private_owner IS NULL OR p.private_owner=nullif(current_setting('app.actor_id',true),'')::uuid));
$$;
ALTER FUNCTION private_video_visible(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION private_video_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION private_video_visible(uuid) TO cp_app,cp_control;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['video_project_versions','video_project_sources','video_renders'] LOOP
  EXECUTE format('CREATE POLICY private_video_scope ON %I AS RESTRICTIVE FOR ALL TO cp_app USING(private_video_visible(video_id)) WITH CHECK(private_video_visible(video_id))',t);
 END LOOP;
END $$;

ALTER TABLE video_renders ADD COLUMN origin_task_id uuid REFERENCES tasks(id);
CREATE INDEX desktop_video_origin ON video_renders(origin_task_id) WHERE origin_task_id IS NOT NULL;

CREATE FUNCTION check_desktop_video_origin() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.origin_task_id IS NOT NULL AND (
  nullif(current_setting('app.task_id',true),'')::uuid IS DISTINCT FROM NEW.origin_task_id OR
  NOT EXISTS(SELECT 1 FROM tasks t JOIN desktop_executions d ON d.task_id=t.id
   JOIN creative_projects p ON p.id=NEW.video_id AND p.private_owner=t.private_owner
   WHERE t.id=NEW.origin_task_id AND t.tenant_id=NEW.tenant_id AND t.project_id=NEW.project_id
    AND t.created_by=NEW.actor_id AND t.actor_auth_version=NEW.actor_auth_version
    AND t.execution_location='desktop' AND t.role_key='video-motion' AND t.status='running'
    AND NOT t.cancel_requested AND t.content_state='active' AND t.lease_until>clock_timestamp()
    AND d.state='running' AND d.credential_expires_at>clock_timestamp())
 ) THEN RAISE EXCEPTION 'Invalid desktop video origin' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION check_desktop_video_origin() OWNER TO cp_control;
REVOKE ALL ON FUNCTION check_desktop_video_origin() FROM PUBLIC;
CREATE TRIGGER desktop_video_origin_scope BEFORE INSERT ON video_renders FOR EACH ROW EXECUTE FUNCTION check_desktop_video_origin();

CREATE FUNCTION stop_desktop_video_origin() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.execution_location='desktop' AND (NEW.cancel_requested OR NEW.status IN('failed','cancelled','reconciling') OR NEW.content_state<>'active') THEN
  UPDATE video_renders SET state='cancelled',revision=revision+1,error_code='DESKTOP_ORIGIN_STOPPED',finished_at=clock_timestamp()
   WHERE origin_task_id=NEW.id AND state IN('queued','rendering');
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION stop_desktop_video_origin() OWNER TO cp_control;
REVOKE ALL ON FUNCTION stop_desktop_video_origin() FROM PUBLIC;
CREATE TRIGGER desktop_video_origin_stopped AFTER UPDATE OF cancel_requested,status,content_state ON tasks FOR EACH ROW EXECUTE FUNCTION stop_desktop_video_origin();

ALTER TABLE task_tool_receipts DROP CONSTRAINT task_tool_receipts_tool_name_check;
ALTER TABLE task_tool_receipts ADD CONSTRAINT task_tool_receipts_tool_name_check CHECK(tool_name IN(
 'deliver_text','code_write','code_package','design_render','video_project_queue','video_project_edit','video_project_render','video_project_cancel'));

CREATE OR REPLACE FUNCTION check_video_source_scope() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=NEW.asset_version
  JOIN creative_projects p ON p.id=NEW.video_id AND p.kind='video' AND p.content_state='active' AND p.retention_expires_at>clock_timestamp()
  WHERE a.id=NEW.asset_id AND a.tenant_id=NEW.tenant_id AND a.project_id=NEW.project_id
   AND (a.private_owner IS NULL OR a.private_owner=p.private_owner) AND a.state='active'
   AND a.retention_expires_at>clock_timestamp() AND v.sha256=NEW.sha256 AND v.mime_type=NEW.mime_type AND v.bytes=NEW.bytes AND v.erased_at IS NULL) THEN
  RAISE EXCEPTION 'Video source scope or version mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION check_video_source_scope() OWNER TO cp_control;
REVOKE ALL ON FUNCTION check_video_source_scope() FROM PUBLIC;

CREATE OR REPLACE FUNCTION video_asset_available(asset uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT NOT EXISTS(SELECT 1 FROM video_renders r JOIN creative_projects p ON p.id=r.video_id
  WHERE asset IN(r.mp4_asset_id,r.project_asset_id,r.script_asset_id,r.storyboard_asset_id,r.subtitles_asset_id,r.probe_asset_id)
   AND (p.content_state<>'active' OR p.retention_expires_at<=clock_timestamp()
    OR NOT EXISTS(SELECT 1 FROM assets output WHERE output.id=asset AND output.retention_expires_at>clock_timestamp())
    OR EXISTS(SELECT 1 FROM video_project_sources s WHERE s.video_id=r.video_id AND s.version=r.version
     AND NOT EXISTS(SELECT 1 FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=s.asset_version
      WHERE a.id=s.asset_id AND a.tenant_id=r.tenant_id AND a.project_id=r.project_id AND a.state='active'
       AND (a.private_owner IS NULL OR a.private_owner=p.private_owner)
       AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL AND v.sha256=s.sha256
       AND v.mime_type=s.mime_type AND v.bytes=s.bytes
       AND analysis_asset_available(a.id) AND matrix_asset_available(a.id) AND video_asset_available(a.id))))
 );
$$;
ALTER FUNCTION video_asset_available(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION video_asset_available(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION video_asset_available(uuid) TO cp_app,cp_control;
INSERT INTO schema_migrations(version) VALUES(93);
