ALTER TABLE request_replays ADD COLUMN revoked_at timestamptz;
GRANT UPDATE(response,revoked_at) ON request_replays TO cp_app;
INSERT INTO schema_migrations(version) VALUES(7);
