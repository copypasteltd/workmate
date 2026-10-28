-- Forward-only repair: an expired source/project/output is unavailable even
-- before the asynchronous retention eraser physically removes its objects.
CREATE OR REPLACE FUNCTION check_video_source_scope() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=NEW.asset_version
  JOIN creative_projects p ON p.id=NEW.video_id AND p.kind='video' AND p.content_state='active' AND p.retention_expires_at>clock_timestamp()
  WHERE a.id=NEW.asset_id AND a.tenant_id=NEW.tenant_id AND a.project_id=NEW.project_id AND a.private_owner IS NULL AND a.state='active'
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
      WHERE a.id=s.asset_id AND a.tenant_id=r.tenant_id AND a.project_id=r.project_id AND a.state='active' AND a.private_owner IS NULL
       AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL AND v.sha256=s.sha256
       AND v.mime_type=s.mime_type AND v.bytes=s.bytes
       AND analysis_asset_available(a.id) AND matrix_asset_available(a.id) AND video_asset_available(a.id))))
 );
$$;
ALTER FUNCTION video_asset_available(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION video_asset_available(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION video_asset_available(uuid) TO cp_app,cp_control;
