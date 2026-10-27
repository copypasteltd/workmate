-- Retain historical connections in the complete directory. Their old raw-report
-- credentials do not establish discovered account scope and cannot authorize a sync.
INSERT INTO connector_profiles(connection_id,tenant_id,project_id,data_mode,api_version,configuration_hash,catalog_state,catalog_limits)
 SELECT c.id,c.tenant_id,c.project_id,t.data_mode,'legacy-unverified',repeat('0',64),'failed',ARRAY['LEGACY_RECONNECT_REQUIRED']
 FROM connections c JOIN tenants t ON t.id=c.tenant_id WHERE c.provider IN('google_ads','meta','ga4','search_console')
 ON CONFLICT(connection_id) DO NOTHING;
INSERT INTO schema_migrations(version) VALUES(75);
