-- SQL074/075 retain their first successful apply in connector core-03.
-- Existing central lifecycle functions deliberately set row_security=off under
-- the migration owner. A nested non-owner cp_control definer must restore RLS
-- so its explicit control policy can run without granting BYPASSRLS.
ALTER FUNCTION connector_asset_available(uuid) SET row_security=on;
ALTER FUNCTION connector_report_available(uuid) SET row_security=on;
INSERT INTO schema_migrations(version) VALUES(76);
