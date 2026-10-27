-- Select the table branch before compiling an expression against NEW/OLD.
CREATE OR REPLACE FUNCTION renew_content_retention() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_TABLE_NAME='asset_versions' THEN
  UPDATE assets SET retention_expires_at=greatest(retention_expires_at,now()+interval '90 days') WHERE id=NEW.asset_id AND state='active';
 ELSIF TG_TABLE_NAME='creative_projects' THEN
  IF NEW.content_state='active' AND NEW.body IS DISTINCT FROM OLD.body THEN NEW.retention_expires_at=now()+interval '90 days'; END IF;
 ELSIF TG_TABLE_NAME='tasks' THEN
  IF NEW.status IN ('succeeded','failed','cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN NEW.retention_expires_at=now()+interval '90 days'; END IF;
 END IF;
 RETURN NEW;
END $$;
INSERT INTO schema_migrations(version) VALUES(21);
