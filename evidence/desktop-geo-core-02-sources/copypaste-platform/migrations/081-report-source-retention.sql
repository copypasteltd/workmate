-- Retained report bodies and historical model messages share the same current
-- source lifecycle. Expiry is authoritative before any cleanup worker runs.
-- Preserve SQL001-080 and all existing report/spec/evidence bytes.
CREATE OR REPLACE FUNCTION analysis_report_owned(report uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT EXISTS(SELECT 1 FROM analysis_reports r JOIN tasks t ON t.id=r.task_id
  WHERE r.id=report AND r.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND r.private_owner=nullif(current_setting('app.actor_id',true),'')::uuid
  AND r.project_id=t.project_id AND r.tenant_id=t.tenant_id AND r.private_owner=t.private_owner
  AND t.content_state='active' AND r.invalidated_at IS NULL
  AND (t.status NOT IN('succeeded','failed','cancelled') OR t.retention_expires_at>clock_timestamp()))
$$;
ALTER FUNCTION analysis_report_owned(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION analysis_report_owned(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analysis_report_owned(uuid) TO cp_app,cp_control;

CREATE OR REPLACE FUNCTION analysis_report_available(report uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT analysis_report_owned(report) AND connector_report_available(report) AND EXISTS(
  SELECT 1 FROM analysis_reports r WHERE r.id=report AND r.source_count=(
   SELECT count(*) FROM analysis_report_sources s JOIN analytics_datasets d ON d.id=s.dataset_id
   WHERE s.report_id=r.id AND d.tenant_id=r.tenant_id AND d.project_id=r.project_id
    AND d.content_state='active' AND d.source_state='active' AND d.retention_expires_at>clock_timestamp()
    AND (d.source_asset_version_id IS NULL OR EXISTS(
     SELECT 1 FROM asset_versions v JOIN assets a ON a.id=v.asset_id
     WHERE v.id=d.source_asset_version_id AND v.sha256=d.source_sha256 AND v.erased_at IS NULL
      AND a.tenant_id=d.tenant_id AND a.project_id=d.project_id AND a.private_owner IS NULL
      AND a.state='active' AND a.retention_expires_at>clock_timestamp())))
   AND (r.asset_version_id IS NULL OR EXISTS(
    SELECT 1 FROM asset_versions v JOIN assets a ON a.id=v.asset_id
    WHERE v.id=r.asset_version_id AND v.erased_at IS NULL AND a.state='active'
     AND a.tenant_id=r.tenant_id AND a.project_id=r.project_id AND a.private_owner=r.private_owner
     AND a.retention_expires_at>clock_timestamp())))
$$;
ALTER FUNCTION analysis_report_available(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION analysis_report_available(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analysis_report_available(uuid) TO cp_app,cp_control;

INSERT INTO schema_migrations(version) VALUES(81);
