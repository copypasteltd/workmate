ALTER TABLE deletion_items DROP CONSTRAINT deletion_items_kind_check;
ALTER TABLE deletion_items ADD CONSTRAINT deletion_items_kind_check CHECK(kind IN ('object','runtime','upload'));
CREATE FUNCTION journal_upload_erasure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.state='deleted' THEN
  INSERT INTO deletion_items(job_id,kind,locator)
   SELECT j.id,'upload',s.id::text FROM deletion_jobs j JOIN upload_sessions s ON s.result->>'id'=NEW.id::text
   WHERE j.target_type='assets' AND j.target_id=NEW.id ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION journal_upload_erasure() OWNER TO cp_control;
REVOKE ALL ON FUNCTION journal_upload_erasure() FROM PUBLIC;
-- Alphabetical trigger order journals the asset before attaching staging items.
CREATE TRIGGER content_upload_erasure AFTER UPDATE OF state ON assets FOR EACH ROW EXECUTE FUNCTION journal_upload_erasure();
INSERT INTO deletion_items(job_id,kind,locator)
 SELECT j.id,'upload',s.id::text FROM deletion_jobs j JOIN upload_sessions s ON s.result->>'id'=j.target_id::text
 WHERE j.target_type='assets' ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations(version) VALUES(18);
