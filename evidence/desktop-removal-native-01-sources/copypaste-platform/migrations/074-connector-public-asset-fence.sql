-- SQL072/073 retain their first successful execution bytes. Extend the existing
-- central availability gate, including control-identity public share/download paths.
CREATE OR REPLACE FUNCTION analysis_asset_available(asset uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
 SELECT connector_asset_available(asset) AND NOT EXISTS(SELECT 1 FROM analysis_reports r JOIN asset_versions v ON v.id=r.asset_version_id
  WHERE v.asset_id=asset AND NOT analysis_report_available(r.id))
$$;
INSERT INTO schema_migrations(version) VALUES(74);
