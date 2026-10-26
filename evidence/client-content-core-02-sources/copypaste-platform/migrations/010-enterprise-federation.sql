CREATE TABLE sso_connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL UNIQUE REFERENCES tenants(id),
 login_key text NOT NULL UNIQUE, name text NOT NULL, issuer text NOT NULL, client_id text NOT NULL,
 client_secret text NOT NULL, domains jsonb NOT NULL CHECK(jsonb_typeof(domains)='array'),
 token_auth_method text NOT NULL CHECK(token_auth_method IN ('client_secret_post','client_secret_basic')),
 signing_alg text NOT NULL CHECK(signing_alg IN ('RS256','ES256')),
 email_mode text NOT NULL DEFAULT 'verified_email' CHECK(email_mode IN ('verified_email','subject_with_proof')),
 enabled boolean NOT NULL DEFAULT false, version integer NOT NULL DEFAULT 1,
 revision integer NOT NULL DEFAULT 1, verified_revision integer, metadata jsonb,
 last_probed_at timestamptz, created_by uuid NOT NULL REFERENCES admin_principals(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 CHECK(NOT enabled OR (verified_revision IS NOT NULL AND verified_revision=revision AND metadata IS NOT NULL))
);
CREATE TABLE federated_identities (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), connection_id uuid NOT NULL REFERENCES sso_connections(id),
 user_id uuid NOT NULL REFERENCES users(id), subject text NOT NULL,
 revision integer NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','revoked')),
 version integer NOT NULL DEFAULT 1, linked_at timestamptz NOT NULL DEFAULT now(), last_login_at timestamptz,
 UNIQUE(connection_id,subject), UNIQUE(connection_id,user_id)
);
CREATE TABLE federation_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), connection_id uuid NOT NULL REFERENCES sso_connections(id),
 revision integer NOT NULL, state_hash text NOT NULL UNIQUE, browser_hash text NOT NULL UNIQUE,
 email text NOT NULL, next_path text NOT NULL, secrets text, subject text,
 phase text NOT NULL DEFAULT 'initiated' CHECK(phase IN ('initiated','exchanging','awaiting_link','complete','failed')),
 proof_challenge_id uuid REFERENCES auth_challenges(id), expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 CHECK(phase NOT IN ('complete','failed') OR secrets IS NULL)
);
CREATE INDEX federation_attempt_expiry ON federation_attempts(expires_at);
ALTER TABLE auth_challenges ADD COLUMN purpose text NOT NULL DEFAULT 'login' CHECK(purpose IN ('login','sso_link'));
ALTER TABLE sessions ADD COLUMN federation_identity_id uuid REFERENCES federated_identities(id);
ALTER TABLE sessions ADD COLUMN federation_revision integer;
ALTER TABLE sessions ADD CONSTRAINT session_federation_pair CHECK((federation_identity_id IS NULL)=(federation_revision IS NULL));
ALTER TABLE sessions ADD CONSTRAINT admin_not_federated CHECK(federation_identity_id IS NULL OR admin_id IS NULL);
CREATE INDEX ON sessions(federation_identity_id) WHERE federation_identity_id IS NOT NULL;
ALTER TABLE native_auth_codes ADD COLUMN source_session_id uuid REFERENCES sessions(id);
ALTER TABLE native_auth_codes ADD COLUMN issued_auth_version integer;
-- Existing 60-second grants lack a source identity and must be re-authorized.
UPDATE native_auth_codes SET consumed_at=now() WHERE consumed_at IS NULL;
ALTER TABLE native_auth_codes ADD CONSTRAINT native_code_source CHECK(consumed_at IS NOT NULL OR (source_session_id IS NOT NULL AND issued_auth_version IS NOT NULL));

-- The public application pool receives only a boolean validity function, never
-- connection secrets, federation subjects or transient PKCE material.
CREATE FUNCTION federated_identity_valid(identity_id uuid, person_id uuid, config_revision integer)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.federated_identities i
 JOIN public.sso_connections c ON c.id=i.connection_id
 JOIN public.tenants t ON t.id=c.tenant_id
 JOIN public.memberships m ON m.tenant_id=c.tenant_id AND m.user_id=i.user_id
 WHERE i.id=identity_id AND i.user_id=person_id AND i.status='active'
 AND i.revision=config_revision AND c.revision=config_revision AND c.verified_revision=c.revision
 AND c.enabled AND t.status='active' AND m.status='active')
$$;
REVOKE ALL ON FUNCTION federated_identity_valid(uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION federated_identity_valid(uuid,uuid,integer) TO cp_app,cp_control;
GRANT SELECT,INSERT,UPDATE ON sso_connections,federated_identities,federation_attempts TO cp_control;
-- This new global permission is intentionally excluded from user operations.
UPDATE admin_roles SET permissions=permissions || '["admin.tenants.sso.write"]'::jsonb
 WHERE builtin AND key IN ('super_admin','security_admin') AND NOT permissions ? 'admin.tenants.sso.write';
INSERT INTO schema_migrations(version) VALUES(10);
