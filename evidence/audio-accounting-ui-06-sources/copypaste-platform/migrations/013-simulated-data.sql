ALTER TABLE tenants ADD COLUMN data_mode text NOT NULL DEFAULT 'configured_services' CHECK(data_mode IN ('configured_services','simulated'));
ALTER TABLE tasks ADD COLUMN data_mode text NOT NULL DEFAULT 'configured_services' CHECK(data_mode IN ('configured_services','simulated'));
ALTER TABLE ledger ADD COLUMN data_mode text NOT NULL DEFAULT 'configured_services' CHECK(data_mode IN ('configured_services','simulated'));
-- Recorded once, alongside the authoritative transaction. No UI setting can
-- relabel simulated costs as real charges after a restart/configuration change.
CREATE FUNCTION stamp_data_mode() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 SELECT data_mode INTO NEW.data_mode FROM tenants WHERE id=NEW.tenant_id;
 RETURN NEW;
END $$;
CREATE TRIGGER ledger_data_mode BEFORE INSERT ON ledger FOR EACH ROW EXECUTE FUNCTION stamp_data_mode();
CREATE TRIGGER task_data_mode BEFORE INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION stamp_data_mode();
INSERT INTO schema_migrations(version) VALUES(13);
