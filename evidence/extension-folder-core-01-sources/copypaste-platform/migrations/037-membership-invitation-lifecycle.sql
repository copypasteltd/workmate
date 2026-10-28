-- Forward-only: preserve composite references and add the contract's stable member ID.
ALTER TABLE memberships ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE memberships ADD CONSTRAINT memberships_id_unique UNIQUE(id);
ALTER TABLE invites DROP CONSTRAINT invites_role_check;
ALTER TABLE invites ADD CONSTRAINT invites_role_check CHECK(role IN ('owner','admin','member','approver','viewer'));
ALTER TABLE invites ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE invites ADD COLUMN issuer_version integer;
UPDATE invites i SET issuer_version=m.version FROM memberships m
 WHERE m.tenant_id=i.tenant_id AND m.user_id=i.created_by;

-- Remove legacy plaintext delivery URLs without deleting the replay uniqueness marker.
UPDATE request_replays SET response=response-'invite_url'
 WHERE action LIKE 'invite:%' AND response ? 'invite_url';

CREATE TABLE invitation_deliveries (
 invite_id uuid PRIMARY KEY REFERENCES invites(id),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 version integer NOT NULL CHECK(version>0),
 token_cipher text,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','sending','delivered','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0),
 next_attempt_at timestamptz NOT NULL DEFAULT now(),
 lease_id uuid, lease_until timestamptz,
 last_error text CHECK(last_error IS NULL OR last_error='MAIL_UNAVAILABLE'),
 delivered_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(state NOT IN ('queued','sending','failed') OR token_cipher IS NOT NULL)
);
CREATE INDEX invitation_deliveries_due ON invitation_deliveries(next_attempt_at) WHERE state IN ('queued','sending','failed');
ALTER TABLE invitation_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE invitation_deliveries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON invitation_deliveries
 USING(current_user='cp_control' OR tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(current_user='cp_control' OR tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE,DELETE ON invitation_deliveries TO cp_app,cp_control;
