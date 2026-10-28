-- Raw file bindings and explicit correction lineage are immutable; historical
-- snapshots and calculations are never relabelled or recomputed.
ALTER TABLE analytics_datasets
 ADD COLUMN source_asset_version_id uuid REFERENCES asset_versions(id),
 ADD COLUMN source_state text NOT NULL DEFAULT 'active' CHECK(source_state IN('active','quarantined','deleted')),
 ADD COLUMN supersedes_id uuid,
 ADD COLUMN correction_ancestors uuid[] NOT NULL DEFAULT '{}',
 ADD CONSTRAINT dataset_correction_scope FOREIGN KEY(tenant_id,project_id,supersedes_id) REFERENCES analytics_datasets(tenant_id,project_id,id);
CREATE UNIQUE INDEX dataset_one_correction ON analytics_datasets(supersedes_id) WHERE supersedes_id IS NOT NULL;
CREATE INDEX dataset_source_file ON analytics_datasets(source_asset_version_id) WHERE source_asset_version_id IS NOT NULL;
CREATE POLICY dataset_source_active ON analytics_datasets AS RESTRICTIVE FOR ALL TO cp_app
 USING(source_state='active') WITH CHECK(source_state='active');

CREATE FUNCTION guard_campaign_file_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE a record; ancestors uuid[];
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.source_asset_version_id,NEW.supersedes_id,NEW.correction_ancestors) IS DISTINCT FROM ROW(OLD.source_asset_version_id,OLD.supersedes_id,OLD.correction_ancestors) THEN
   IF NOT(current_user='cp_control' AND NEW.content_state='deleted' AND current_setting('app.erasing_content',true)='true' AND NEW.source_asset_version_id IS NULL AND NEW.supersedes_id IS NULL AND cardinality(NEW.correction_ancestors)=0) THEN
    RAISE EXCEPTION 'Campaign source and correction bindings are immutable' USING ERRCODE='23514';
   END IF;
  END IF;
  IF NEW.source_state IS DISTINCT FROM OLD.source_state AND pg_trigger_depth()<2 THEN
   RAISE EXCEPTION 'Source state follows the original asset lifecycle' USING ERRCODE='23514';
  END IF;
 ELSE
  IF NEW.source_state<>'active' THEN RAISE EXCEPTION 'Invalid initial campaign source state' USING ERRCODE='23514'; END IF;
  NEW.correction_ancestors:='{}';
  IF NEW.supersedes_id IS NOT NULL THEN
   SELECT d.correction_ancestors||d.id INTO ancestors FROM analytics_datasets d WHERE d.id=NEW.supersedes_id AND d.tenant_id=NEW.tenant_id AND d.project_id=NEW.project_id;
   IF ancestors IS NULL OR cardinality(ancestors)>1000 THEN RAISE EXCEPTION 'Invalid or excessive correction lineage' USING ERRCODE='23514'; END IF;
   NEW.correction_ancestors:=ancestors;
  END IF;
  IF NEW.source_asset_version_id IS NOT NULL THEN
   SELECT f.tenant_id,f.project_id,f.private_owner,f.state,v.sha256 INTO a FROM asset_versions v JOIN assets f ON f.id=v.asset_id WHERE v.id=NEW.source_asset_version_id;
   IF a IS NULL OR a.tenant_id<>NEW.tenant_id OR a.project_id<>NEW.project_id OR a.private_owner IS NOT NULL OR a.state<>'active' OR a.sha256<>NEW.source_sha256 THEN
    RAISE EXCEPTION 'Campaign imports require an available shared project source version' USING ERRCODE='23514';
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_campaign_file_binding BEFORE INSERT OR UPDATE ON analytics_datasets FOR EACH ROW EXECUTE FUNCTION guard_campaign_file_binding();

-- Lock dependent rows in the same transaction as source moderation. Workers
-- hold shared locks on these rows through use/publication, avoiding a TOCTOU.
CREATE FUNCTION follow_campaign_source_lifecycle() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.state IS NOT DISTINCT FROM OLD.state THEN RETURN NEW; END IF;
 UPDATE analytics_datasets d SET source_state=NEW.state,
  content_state=CASE WHEN NEW.state='deleted' THEN 'deleted' ELSE d.content_state END,
  moderation_version=d.moderation_version+CASE WHEN NEW.state='deleted' AND d.content_state<>'deleted' THEN 1 ELSE 0 END
 FROM asset_versions v WHERE v.asset_id=NEW.id AND d.source_asset_version_id=v.id AND d.content_state<>'deleted';
 IF NEW.state='deleted' THEN
  INSERT INTO deletion_dependencies(job_id,child_job_id)
   SELECT parent.id,child.id FROM deletion_jobs parent JOIN asset_versions v ON v.asset_id=NEW.id
   JOIN analytics_datasets d ON d.source_asset_version_id=v.id
   JOIN deletion_jobs child ON child.target_type='analytics_datasets' AND child.target_id=d.id
   WHERE parent.target_type='assets' AND parent.target_id=NEW.id ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_campaign_source_lifecycle AFTER UPDATE OF state ON assets FOR EACH ROW EXECUTE FUNCTION follow_campaign_source_lifecycle();
CREATE OR REPLACE FUNCTION analysis_report_available(report uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
 SELECT analysis_report_owned(report) AND EXISTS(
  SELECT 1 FROM analysis_reports r WHERE r.id=report AND r.source_count=(
   SELECT count(*) FROM analysis_report_sources s JOIN analytics_datasets d ON d.id=s.dataset_id
   WHERE s.report_id=r.id AND d.content_state='active' AND d.source_state='active'))
$$;
INSERT INTO schema_migrations(version) VALUES(35);
