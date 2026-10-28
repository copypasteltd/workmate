ALTER TABLE auth_challenges ADD COLUMN client_flow_hash text;

CREATE TABLE auth_request_receipts (
 operation text NOT NULL CHECK (operation IN ('challenge','session','code','refresh')),
 key_hash text NOT NULL CHECK (key_hash ~ '^[a-f0-9]{64}$'),
 request_hash text NOT NULL CHECK (request_hash ~ '^[a-f0-9]{64}$'),
 flow_hash text,
 response_cipher text NOT NULL,
 session_id uuid REFERENCES sessions(id),
 expires_at timestamptz NOT NULL DEFAULT (now()+interval '24 hours'),
 delivered_at timestamptz,
 delivery_owner uuid,
 delivery_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(operation,key_hash)
);
CREATE INDEX ON auth_request_receipts(expires_at);
GRANT SELECT,INSERT,UPDATE,DELETE ON auth_request_receipts TO cp_app,cp_control;
INSERT INTO schema_migrations(version) VALUES(36);
