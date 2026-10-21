-- Additive native video projects. Previously applied SQL001-069 are unchanged.
CREATE TABLE video_project_versions (
 video_id uuid NOT NULL, tenant_id uuid NOT NULL, project_id uuid NOT NULL, version integer NOT NULL CHECK(version BETWEEN 1 AND 50),
 definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'), input_hash text NOT NULL CHECK(input_hash~'^[a-f0-9]{64}$'),
 renderer_profile jsonb NOT NULL CHECK(jsonb_typeof(renderer_profile)='object'), actor_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(video_id,version),
 UNIQUE(video_id,version,tenant_id,project_id),
 FOREIGN KEY(video_id,tenant_id,project_id) REFERENCES creative_projects(id,tenant_id,project_id)
);
CREATE TABLE video_project_sources (
 video_id uuid NOT NULL, version integer NOT NULL, tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 asset_id uuid NOT NULL, asset_version integer NOT NULL, sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),
 mime_type text NOT NULL CHECK(mime_type IN('image/png','audio/wav','audio/mpeg')), bytes bigint NOT NULL CHECK(bytes BETWEEN 1 AND 30000000),
 PRIMARY KEY(video_id,version,asset_id,asset_version),
 FOREIGN KEY(video_id,version,tenant_id,project_id) REFERENCES video_project_versions(video_id,version,tenant_id,project_id),
 FOREIGN KEY(tenant_id,asset_id) REFERENCES assets(tenant_id,id),
 FOREIGN KEY(asset_id,asset_version) REFERENCES asset_versions(asset_id,version)
);
CREATE TABLE video_renders (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), video_id uuid NOT NULL, version integer NOT NULL, tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id), actor_auth_version integer NOT NULL CHECK(actor_auth_version>0),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','rendering','succeeded','failed','cancelled')),
 input_hash text NOT NULL CHECK(input_hash~'^[a-f0-9]{64}$'), lease_token uuid UNIQUE, lease_until timestamptz,
 error_code text, mp4_asset_id uuid REFERENCES assets(id), project_asset_id uuid REFERENCES assets(id), script_asset_id uuid REFERENCES assets(id),
 storyboard_asset_id uuid REFERENCES assets(id), subtitles_asset_id uuid REFERENCES assets(id), probe_asset_id uuid REFERENCES assets(id),
 probe jsonb NOT NULL DEFAULT '{}', ai_cost_micros bigint NOT NULL DEFAULT 0 CHECK(ai_cost_micros=0),
 cost_source text NOT NULL DEFAULT 'local_composition_no_ai' CHECK(cost_source='local_composition_no_ai'),
 elapsed_ms integer CHECK(elapsed_ms>=0), output_bytes bigint CHECK(output_bytes>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), started_at timestamptz, finished_at timestamptz,
 FOREIGN KEY(video_id,version,tenant_id,project_id) REFERENCES video_project_versions(video_id,version,tenant_id,project_id),
 CHECK((state IN('queued','rendering'))=(finished_at IS NULL)),
 CHECK(state<>'rendering' OR (lease_token IS NOT NULL AND lease_until IS NOT NULL AND started_at IS NOT NULL)),
 CHECK((state='succeeded' AND num_nonnulls(mp4_asset_id,project_asset_id,script_asset_id,storyboard_asset_id,subtitles_asset_id,probe_asset_id)=6)
    OR (state<>'succeeded' AND num_nonnulls(mp4_asset_id,project_asset_id,script_asset_id,storyboard_asset_id,subtitles_asset_id,probe_asset_id)=0))
);
CREATE UNIQUE INDEX video_one_active_render ON video_renders(video_id) WHERE state IN('queued','rendering');
CREATE INDEX video_render_queue ON video_renders(created_at,id) WHERE state='queued';
CREATE INDEX video_render_expiry ON video_renders(lease_until) WHERE state='rendering';
CREATE INDEX video_source_asset ON video_project_sources(asset_id);
CREATE FUNCTION guard_video_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='video_project_versions' THEN
  IF current_user='cp_control' AND current_setting('app.erasing_content',true)='true'
   AND EXISTS(SELECT 1 FROM creative_projects WHERE id=OLD.video_id AND content_state='deleted')
   AND TG_OP='UPDATE' AND NEW.definition='{}'::jsonb AND (to_jsonb(NEW)-'definition')=(to_jsonb(OLD)-'definition') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Video project versions are immutable' USING ERRCODE='23514';
 ELSIF TG_TABLE_NAME='video_project_sources' THEN
  RAISE EXCEPTION 'Fixed video source references are immutable' USING ERRCODE='23514';
 END IF;
 IF current_user='cp_control' AND current_setting('app.erasing_content',true)='true'
  AND EXISTS(SELECT 1 FROM creative_projects WHERE id=OLD.video_id AND content_state='deleted')
  AND TG_OP='UPDATE' AND NEW.probe='{}'::jsonb AND (to_jsonb(NEW)-'probe')=(to_jsonb(OLD)-'probe') THEN RETURN NEW; END IF;
 IF TG_OP='DELETE' OR OLD.state NOT IN('queued','rendering') THEN RAISE EXCEPTION 'Finished video renders are immutable' USING ERRCODE='23514'; END IF;
 IF NEW.revision<>OLD.revision+1 OR (OLD.state='queued' AND NEW.state NOT IN('rendering','failed','cancelled'))
   OR (OLD.state='rendering' AND NEW.state NOT IN('succeeded','failed','cancelled')) THEN RAISE EXCEPTION 'Invalid video state transition' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW)-ARRAY['revision','state','lease_token','lease_until','error_code','mp4_asset_id','project_asset_id','script_asset_id','storyboard_asset_id','subtitles_asset_id','probe_asset_id','probe','elapsed_ms','output_bytes','started_at','finished_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['revision','state','lease_token','lease_until','error_code','mp4_asset_id','project_asset_id','script_asset_id','storyboard_asset_id','subtitles_asset_id','probe_asset_id','probe','elapsed_ms','output_bytes','started_at','finished_at'])
  OR (OLD.state='rendering' AND (NEW.lease_token,NEW.lease_until,NEW.started_at) IS DISTINCT FROM (OLD.lease_token,OLD.lease_until,OLD.started_at)) THEN
  RAISE EXCEPTION 'Video render identity is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER video_version_history BEFORE UPDATE OR DELETE ON video_project_versions FOR EACH ROW EXECUTE FUNCTION guard_video_history();
CREATE TRIGGER video_source_history BEFORE UPDATE OR DELETE ON video_project_sources FOR EACH ROW EXECUTE FUNCTION guard_video_history();
CREATE TRIGGER video_render_history BEFORE UPDATE OR DELETE ON video_renders FOR EACH ROW EXECUTE FUNCTION guard_video_history();
CREATE FUNCTION check_video_source_scope() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=NEW.asset_version
  JOIN creative_projects p ON p.id=NEW.video_id AND p.kind='video' AND p.content_state='active'
  WHERE a.id=NEW.asset_id AND a.tenant_id=NEW.tenant_id AND a.project_id=NEW.project_id AND a.private_owner IS NULL AND a.state='active'
   AND v.sha256=NEW.sha256 AND v.mime_type=NEW.mime_type AND v.bytes=NEW.bytes AND v.erased_at IS NULL) THEN
  RAISE EXCEPTION 'Video source scope or version mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION check_video_source_scope() OWNER TO cp_control;
REVOKE ALL ON FUNCTION check_video_source_scope() FROM PUBLIC;
CREATE TRIGGER video_source_scope BEFORE INSERT ON video_project_sources FOR EACH ROW EXECUTE FUNCTION check_video_source_scope();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['video_project_versions','video_project_sources','video_renders'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY video_tenant_scope ON %I USING(current_user=''cp_control'' OR tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(current_user=''cp_control'' OR tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT ON video_project_versions,video_project_sources,video_renders TO cp_app;
GRANT UPDATE(revision,state,error_code,finished_at) ON video_renders TO cp_app;
GRANT SELECT,INSERT,UPDATE ON video_project_versions,video_project_sources,video_renders TO cp_control;

CREATE FUNCTION video_asset_available(asset uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT NOT EXISTS(SELECT 1 FROM video_renders r JOIN creative_projects p ON p.id=r.video_id
  WHERE asset IN(r.mp4_asset_id,r.project_asset_id,r.script_asset_id,r.storyboard_asset_id,r.subtitles_asset_id,r.probe_asset_id)
   AND (p.content_state<>'active' OR EXISTS(SELECT 1 FROM video_project_sources s WHERE s.video_id=r.video_id AND s.version=r.version
    AND NOT EXISTS(SELECT 1 FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=s.asset_version
     WHERE a.id=s.asset_id AND a.tenant_id=r.tenant_id AND a.project_id=r.project_id AND a.state='active' AND a.private_owner IS NULL
      AND v.erased_at IS NULL AND v.sha256=s.sha256 AND analysis_asset_available(a.id) AND matrix_asset_available(a.id) AND video_asset_available(a.id)))))
 );
$$;
ALTER FUNCTION video_asset_available(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION video_asset_available(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION video_asset_available(uuid) TO cp_app,cp_control;
CREATE POLICY video_output_scope ON assets AS RESTRICTIVE FOR SELECT TO cp_app USING(video_asset_available(id));
CREATE FUNCTION stop_removed_video() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.kind='video' AND NEW.content_state<>'active' AND NEW.content_state IS DISTINCT FROM OLD.content_state THEN
  UPDATE video_renders SET state='cancelled',revision=revision+1,error_code='VIDEO_UNAVAILABLE',finished_at=clock_timestamp()
   WHERE video_id=NEW.id AND state IN('queued','rendering');
 END IF; RETURN NEW;
END $$;
ALTER FUNCTION stop_removed_video() OWNER TO cp_control;
REVOKE ALL ON FUNCTION stop_removed_video() FROM PUBLIC;
CREATE TRIGGER stop_removed_video AFTER UPDATE OF content_state ON creative_projects FOR EACH ROW EXECUTE FUNCTION stop_removed_video();
CREATE FUNCTION erase_video_source_copies() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE outputs uuid[];
BEGIN
 IF NEW.state<>'deleted' OR OLD.state='deleted' THEN RETURN NEW; END IF;
 SELECT array_agg(DISTINCT output.id) INTO outputs FROM video_project_sources s JOIN video_renders r ON r.video_id=s.video_id AND r.version=s.version
  CROSS JOIN LATERAL unnest(ARRAY[r.mp4_asset_id,r.project_asset_id,r.script_asset_id,r.storyboard_asset_id,r.subtitles_asset_id,r.probe_asset_id]) AS output(id)
  WHERE s.asset_id=NEW.id AND output.id IS NOT NULL;
 IF outputs IS NOT NULL THEN
  UPDATE assets SET state='deleted',moderation_version=moderation_version+1 WHERE id=ANY(outputs) AND state<>'deleted';
  INSERT INTO deletion_dependencies(job_id,child_job_id) SELECT parent.id,child.id FROM deletion_jobs parent JOIN deletion_jobs child
   ON child.target_type='assets' AND child.target_id=ANY(outputs) WHERE parent.target_type='assets' AND parent.target_id=NEW.id ON CONFLICT DO NOTHING;
 END IF; RETURN NEW;
END $$;
ALTER FUNCTION erase_video_source_copies() OWNER TO cp_control;
REVOKE ALL ON FUNCTION erase_video_source_copies() FROM PUBLIC;
CREATE TRIGGER z_erase_video_source_copies AFTER UPDATE OF state ON assets FOR EACH ROW EXECUTE FUNCTION erase_video_source_copies();
INSERT INTO schema_migrations(version) VALUES(70);
