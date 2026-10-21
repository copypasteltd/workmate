CREATE FUNCTION enforce_upload_quota() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE n bigint; b bigint;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('upload-quota:'||NEW.tenant_id::text,0));
 SELECT count(*),coalesce(sum(size_bytes),0) INTO n,b FROM upload_sessions WHERE tenant_id=NEW.tenant_id AND state='pending' AND expires_at>now();
 IF n>=10 OR b+NEW.size_bytes>10737418240 THEN
  RAISE EXCEPTION 'UPLOAD_QUOTA' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION enforce_upload_quota() OWNER TO cp_control;
REVOKE ALL ON FUNCTION enforce_upload_quota() FROM PUBLIC;
CREATE TRIGGER upload_quota_guard BEFORE INSERT ON upload_sessions FOR EACH ROW EXECUTE FUNCTION enforce_upload_quota();
INSERT INTO schema_migrations(version) VALUES(17);
