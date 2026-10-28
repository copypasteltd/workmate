ALTER TABLE entitlements ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE entitlements ADD COLUMN plan_version integer NOT NULL DEFAULT 1;
ALTER TABLE entitlements ADD COLUMN plan_body jsonb NOT NULL DEFAULT '{}';
ALTER TABLE tasks ADD COLUMN plan_snapshot jsonb NOT NULL DEFAULT '{}';
CREATE TABLE entitlement_events(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),entitlement_id uuid NOT NULL REFERENCES entitlements(id),principal_id uuid NOT NULL REFERENCES admin_principals(id),operation_id uuid NOT NULL,action text NOT NULL,before_value jsonb,after_value jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT now());
GRANT SELECT,INSERT ON entitlement_events TO cp_control;
INSERT INTO schema_migrations(version) VALUES(3);
