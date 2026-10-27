ALTER TABLE admin_principals ALTER COLUMN totp_secret DROP NOT NULL;
ALTER TABLE admin_principals ADD COLUMN version integer NOT NULL DEFAULT 1;
ALTER TABLE admin_principals ADD COLUMN enrollment_state text NOT NULL DEFAULT 'enrolled'
 CHECK(enrollment_state IN ('pending','enrolled'));
ALTER TABLE admin_principals ADD COLUMN enrolled_at timestamptz;
ALTER TABLE admin_principals ADD CONSTRAINT admin_mfa_state CHECK(
 (enrollment_state='pending' AND totp_secret IS NULL) OR
 (enrollment_state='enrolled' AND totp_secret IS NOT NULL));

CREATE TABLE admin_enrollments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 principal_id uuid NOT NULL REFERENCES admin_principals(id),
 purpose text NOT NULL CHECK(purpose IN ('initial','reset','self_rotate')),
 created_by uuid NOT NULL REFERENCES admin_principals(id),
 issued_auth_version integer NOT NULL,
 token_hash text NOT NULL UNIQUE, token_ciphertext text,
 setup_hash text UNIQUE, setup_secret text, setup_expires_at timestamptz,
 setup_attempts integer NOT NULL DEFAULT 0 CHECK(setup_attempts>=0),
 email_verified_at timestamptz,
 initiated_session_id uuid REFERENCES sessions(id),
 delivery_state text NOT NULL DEFAULT 'pending' CHECK(delivery_state IN ('pending','sent','failed','not_required')),
 delivery_error text, delivered_at timestamptz,
 expires_at timestamptz NOT NULL, consumed_at timestamptz, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX admin_enrollment_single_active ON admin_enrollments(principal_id)
 WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE INDEX ON admin_enrollments(principal_id,created_at DESC);
GRANT SELECT,INSERT,UPDATE,DELETE ON admin_enrollments TO cp_control;
INSERT INTO schema_migrations(version) VALUES(8);
