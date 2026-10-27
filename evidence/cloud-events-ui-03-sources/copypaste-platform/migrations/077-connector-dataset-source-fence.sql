-- SQL076 is immutable after connector core-04. The app must not evaluate
-- NOT EXISTS over asset_versions already hidden by another source RLS policy.
CREATE FUNCTION connector_dataset_available(source_version uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT NOT EXISTS(SELECT 1 FROM connector_analysis_sources x JOIN asset_versions v ON v.asset_id=x.csv_asset_id
  JOIN assets a ON a.id=v.asset_id WHERE v.id=source_version
  AND (a.state<>'active' OR a.retention_expires_at<=clock_timestamp() OR v.erased_at IS NOT NULL OR NOT connector_asset_available(x.csv_asset_id)))
$$;
ALTER FUNCTION connector_dataset_available(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION connector_dataset_available(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connector_dataset_available(uuid) TO cp_app,cp_control;
DROP POLICY connector_dataset_source_available ON analytics_datasets;
CREATE POLICY connector_dataset_source_available ON analytics_datasets AS RESTRICTIVE FOR SELECT TO cp_app
 USING(source_asset_version_id IS NULL OR connector_dataset_available(source_asset_version_id));
CREATE OR REPLACE FUNCTION connector_report_available(report uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT NOT EXISTS(SELECT 1 FROM analysis_report_sources s JOIN analytics_datasets d ON d.id=s.dataset_id
  WHERE s.report_id=report AND NOT connector_dataset_available(d.source_asset_version_id))
$$;
INSERT INTO schema_migrations(version) VALUES(77);
