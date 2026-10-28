-- Source text is the exact UTF-8 input accepted by the CSV API, not a claim
-- about an earlier spreadsheet or the encoding of an external export file.
ALTER TABLE analytics_datasets
 ADD COLUMN raw_csv text,
 ADD COLUMN source_filename text,
 ADD COLUMN source_sha256 text CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 ADD COLUMN import_key text CHECK(import_key ~ '^[a-f0-9]{64}$'),
 ADD COLUMN spec_hash text CHECK(spec_hash ~ '^[a-f0-9]{64}$'),
 ADD COLUMN import_spec jsonb,
 ADD COLUMN import_metadata jsonb;
CREATE UNIQUE INDEX analytics_import_identity ON analytics_datasets(tenant_id,project_id,import_key)
 WHERE import_key IS NOT NULL AND content_state <> 'deleted';
CREATE FUNCTION guard_analytics_snapshot() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
   RAISE EXCEPTION 'Analytics snapshots use content erasure, not physical deletion' USING ERRCODE='23514';
 END IF;
 IF ROW(NEW.tenant_id,NEW.project_id,NEW.currency,NEW.timezone,NEW.rows,NEW.source,
        NEW.raw_csv,NEW.source_filename,NEW.source_sha256,NEW.import_key,NEW.spec_hash,
        NEW.import_spec,NEW.import_metadata,NEW.created_at,NEW.created_by)
 IS DISTINCT FROM
    ROW(OLD.tenant_id,OLD.project_id,OLD.currency,OLD.timezone,OLD.rows,OLD.source,
        OLD.raw_csv,OLD.source_filename,OLD.source_sha256,OLD.import_key,OLD.spec_hash,
        OLD.import_spec,OLD.import_metadata,OLD.created_at,OLD.created_by) THEN
   IF NOT (current_user='cp_control' AND NEW.content_state='deleted'
           AND current_setting('app.erasing_content',true)='true') THEN
     RAISE EXCEPTION 'Analytics snapshots are immutable; import a new snapshot' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_analytics_snapshot BEFORE UPDATE OR DELETE ON analytics_datasets
 FOR EACH ROW EXECUTE FUNCTION guard_analytics_snapshot();
INSERT INTO schema_migrations(version) VALUES(32);
