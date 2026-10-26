CREATE TABLE upload_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), filename text NOT NULL, mime_type text NOT NULL,
 size_bytes bigint NOT NULL CHECK(size_bytes>0 AND size_bytes<=1073741824), sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 part_size integer NOT NULL DEFAULT 4194304, asset_id uuid, expected_version integer,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','completed','expired','cancelled')),
 result jsonb, expires_at timestamptz NOT NULL DEFAULT now()+interval '24 hours', created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id), UNIQUE(tenant_id,id)
);
CREATE INDEX upload_sessions_expiry ON upload_sessions(expires_at) WHERE state='pending';
CREATE TABLE upload_parts (
 tenant_id uuid NOT NULL, upload_id uuid NOT NULL, part_index integer NOT NULL CHECK(part_index>=0),
 size_bytes integer NOT NULL CHECK(size_bytes>0 AND size_bytes<=4194304), sha256 text NOT NULL,
 PRIMARY KEY(upload_id,part_index), FOREIGN KEY(tenant_id,upload_id) REFERENCES upload_sessions(tenant_id,id)
);
ALTER TABLE upload_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE upload_sessions FORCE ROW LEVEL SECURITY;
CREATE POLICY upload_scope ON upload_sessions USING(current_user='cp_control' OR (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND created_by=nullif(current_setting('app.actor_id',true),'')::uuid)) WITH CHECK(current_user='cp_control' OR (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND created_by=nullif(current_setting('app.actor_id',true),'')::uuid));
ALTER TABLE upload_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE upload_parts FORCE ROW LEVEL SECURITY;
CREATE POLICY upload_part_scope ON upload_parts USING(current_user='cp_control' OR EXISTS(SELECT 1 FROM upload_sessions s WHERE s.id=upload_id)) WITH CHECK(current_user='cp_control' OR EXISTS(SELECT 1 FROM upload_sessions s WHERE s.id=upload_id));
GRANT SELECT,INSERT,UPDATE ON upload_sessions,upload_parts TO cp_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON upload_sessions,upload_parts TO cp_control;
INSERT INTO schema_migrations(version) VALUES(16);
