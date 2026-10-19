-- Freeze the computed layer alongside immutable normalized facts. Existing
-- legacy rows stay explicitly unverified and are never given invented history.
ALTER TABLE analytics_datasets ADD COLUMN metric_snapshot jsonb;
CREATE OR REPLACE FUNCTION guard_analytics_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   RAISE EXCEPTION 'Analytics snapshots use content erasure, not physical deletion' USING ERRCODE='23514';
 END IF;
 IF ROW(NEW.tenant_id,NEW.project_id,NEW.currency,NEW.timezone,NEW.rows,NEW.source,
        NEW.raw_csv,NEW.source_filename,NEW.source_sha256,NEW.import_key,NEW.spec_hash,
        NEW.import_spec,NEW.import_metadata,NEW.metric_snapshot,NEW.created_at,NEW.created_by)
 IS DISTINCT FROM
    ROW(OLD.tenant_id,OLD.project_id,OLD.currency,OLD.timezone,OLD.rows,OLD.source,
        OLD.raw_csv,OLD.source_filename,OLD.source_sha256,OLD.import_key,OLD.spec_hash,
        OLD.import_spec,OLD.import_metadata,OLD.metric_snapshot,OLD.created_at,OLD.created_by) THEN
   IF NOT (current_user='cp_control' AND NEW.content_state='deleted'
           AND current_setting('app.erasing_content',true)='true') THEN
     RAISE EXCEPTION 'Analytics snapshots are immutable; import a new snapshot' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;
INSERT INTO schema_migrations(version) VALUES(33);
