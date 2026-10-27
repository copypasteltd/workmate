-- SQL072 first applied in marketing-connectors-core-01 and remains immutable.
-- A normalized CSV has its own original bytes/hash; it cannot pretend to be the JSON source file.
CREATE TABLE connector_analysis_sources (
 tenant_id uuid NOT NULL, project_id uuid NOT NULL, snapshot_asset_id uuid NOT NULL, csv_asset_id uuid NOT NULL UNIQUE,
 PRIMARY KEY(snapshot_asset_id,csv_asset_id), FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY(tenant_id,snapshot_asset_id) REFERENCES assets(tenant_id,id), FOREIGN KEY(tenant_id,csv_asset_id) REFERENCES assets(tenant_id,id),
 CHECK(snapshot_asset_id<>csv_asset_id)
);
ALTER TABLE connector_analysis_sources ENABLE ROW LEVEL SECURITY;
ALTER TABLE connector_analysis_sources FORCE ROW LEVEL SECURITY;
CREATE POLICY connector_analysis_source_scope ON connector_analysis_sources USING(current_user='cp_control' OR tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(current_user='cp_control' OR tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT ON connector_analysis_sources TO cp_app;
GRANT SELECT,INSERT ON connector_analysis_sources TO cp_control;
CREATE TRIGGER connector_analysis_source_history BEFORE UPDATE OR DELETE ON connector_analysis_sources FOR EACH ROW EXECUTE FUNCTION guard_connector_history();
CREATE FUNCTION check_connector_analysis_source() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM assets a JOIN assets b ON b.id=NEW.csv_asset_id JOIN asset_versions v ON v.asset_id=b.id AND v.version=1
  WHERE a.id=NEW.snapshot_asset_id AND a.tenant_id=NEW.tenant_id AND b.tenant_id=NEW.tenant_id AND a.project_id=NEW.project_id AND b.project_id=NEW.project_id
   AND a.private_owner IS NULL AND b.private_owner IS NULL AND a.state='active' AND b.state='active' AND a.kind='connector_snapshot' AND b.kind='connector_analysis_source'
   AND v.mime_type='text/csv' AND v.erased_at IS NULL) THEN RAISE EXCEPTION 'Connector CSV source scope mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER connector_analysis_source_binding BEFORE INSERT ON connector_analysis_sources FOR EACH ROW EXECUTE FUNCTION check_connector_analysis_source();
CREATE OR REPLACE FUNCTION connector_asset_available(asset uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT NOT EXISTS(SELECT 1 FROM connector_snapshots s JOIN assets own ON own.id=s.asset_id
  WHERE (s.asset_id=asset OR EXISTS(SELECT 1 FROM connector_analysis_sources x WHERE x.snapshot_asset_id=s.asset_id AND x.csv_asset_id=asset))
   AND (own.state<>'active' OR own.retention_expires_at<=clock_timestamp() OR EXISTS(SELECT 1 FROM connector_pages p JOIN assets a ON a.id=p.asset_id
    JOIN asset_versions v ON v.asset_id=a.id AND v.version=p.asset_version
    WHERE p.job_id=s.job_id AND (a.state<>'active' OR a.retention_expires_at<=clock_timestamp() OR v.erased_at IS NOT NULL OR v.sha256<>p.sha256))))
$$;
CREATE OR REPLACE FUNCTION erase_connector_dependants() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE dependants uuid[];
BEGIN
 IF NEW.state='active' OR NEW.state IS NOT DISTINCT FROM OLD.state THEN RETURN NEW; END IF;
 UPDATE connector_jobs j SET state='cancelled',finished_at=clock_timestamp(),lease_token=NULL,lease_until=NULL,revision=revision+1,error_code='CONNECTOR_SOURCE_REMOVED',encrypted_cursor=NULL
  WHERE j.state IN('queued','running') AND EXISTS(SELECT 1 FROM connector_pages p WHERE p.job_id=j.id AND p.asset_id=NEW.id);
 SELECT array_agg(DISTINCT id) INTO dependants FROM (
  SELECT s.asset_id AS id FROM connector_snapshots s JOIN connector_pages p ON p.job_id=s.job_id WHERE p.asset_id=NEW.id
  UNION SELECT x.csv_asset_id FROM connector_analysis_sources x WHERE x.snapshot_asset_id=NEW.id
 ) d WHERE id<>NEW.id;
 IF dependants IS NOT NULL THEN
  UPDATE assets SET state=NEW.state,moderation_version=moderation_version+1 WHERE id=ANY(dependants) AND state<>'deleted' AND state IS DISTINCT FROM NEW.state;
  IF NEW.state='deleted' THEN
   INSERT INTO deletion_dependencies(job_id,child_job_id) SELECT p.id,c.id FROM deletion_jobs p JOIN deletion_jobs c ON c.target_type='assets' AND c.target_id=ANY(dependants)
    WHERE p.target_type='assets' AND p.target_id=NEW.id ON CONFLICT DO NOTHING;
  END IF;
 END IF; RETURN NEW;
END $$;
-- Expired retained pages/JSON/CSV cannot be used by analysis before the eraser runs.
CREATE POLICY connector_dataset_source_available ON analytics_datasets AS RESTRICTIVE FOR SELECT TO cp_app USING(
 source_asset_version_id IS NULL OR NOT EXISTS(SELECT 1 FROM connector_analysis_sources x JOIN asset_versions v ON v.asset_id=x.csv_asset_id
  WHERE v.id=source_asset_version_id AND NOT connector_asset_available(x.csv_asset_id))
);
CREATE FUNCTION connector_report_available(report uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT NOT EXISTS(SELECT 1 FROM analysis_report_sources s JOIN analytics_datasets d ON d.id=s.dataset_id
  JOIN asset_versions v ON v.id=d.source_asset_version_id JOIN connector_analysis_sources x ON x.csv_asset_id=v.asset_id
  WHERE s.report_id=report AND NOT connector_asset_available(x.csv_asset_id))
$$;
ALTER FUNCTION connector_report_available(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION connector_report_available(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connector_report_available(uuid) TO cp_app,cp_control;
CREATE OR REPLACE FUNCTION analysis_report_available(report uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
 SELECT analysis_report_owned(report) AND connector_report_available(report) AND EXISTS(
  SELECT 1 FROM analysis_reports r WHERE r.id=report AND r.source_count=(
   SELECT count(*) FROM analysis_report_sources s JOIN analytics_datasets d ON d.id=s.dataset_id
   WHERE s.report_id=r.id AND d.content_state='active' AND d.source_state='active'))
$$;
INSERT INTO schema_migrations(version) VALUES(73);
