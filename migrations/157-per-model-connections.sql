-- A credential belongs to one immutable model configuration, never a global default.
CREATE TABLE capability_model_connections (
 release_id uuid PRIMARY KEY REFERENCES capability_releases(id),
 base_url text NOT NULL,
 encrypted_api_key text NOT NULL,
 allow_private_network boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON capability_model_connections FROM PUBLIC,cp_app,cp_queue;
GRANT SELECT,INSERT ON capability_model_connections TO cp_control;

CREATE TABLE capability_connection_checks (
 id uuid PRIMARY KEY,
 release_id uuid NOT NULL REFERENCES capability_releases(id),
 principal_id uuid NOT NULL REFERENCES admin_principals(id),
 result jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON capability_connection_checks FROM PUBLIC,cp_app,cp_queue;
GRANT SELECT,INSERT ON capability_connection_checks TO cp_control;
