-- A suspension is an inactive membership with an explicit administrative hold.
-- Keep the original public Member state contract (active/removed) unchanged.
ALTER TABLE memberships ADD COLUMN admin_suspended boolean NOT NULL DEFAULT false;
ALTER TABLE memberships ADD CONSTRAINT memberships_admin_suspension_inactive CHECK(NOT admin_suspended OR status='removed');

-- Real, immutable snapshots of the rules actually used by each new operation.
-- Historical operations deliberately remain unpinned: their policy was not recorded.
CREATE TABLE admin_operation_policy_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 payload_hash text NOT NULL UNIQUE CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 body jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT,INSERT ON admin_operation_policy_versions TO cp_control;
CREATE FUNCTION reject_admin_policy_snapshot_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Administrative policy snapshots are immutable';
END;
$$;
CREATE TRIGGER admin_policy_snapshot_immutable BEFORE UPDATE OR DELETE ON admin_operation_policy_versions
 FOR EACH ROW EXECUTE FUNCTION reject_admin_policy_snapshot_mutation();
ALTER TABLE admin_operations ADD COLUMN policy_version_id uuid REFERENCES admin_operation_policy_versions(id);
ALTER TABLE admin_operations ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE admin_operations ADD COLUMN target_ids uuid[] NOT NULL DEFAULT '{}';
ALTER TABLE admin_operations ADD COLUMN result_ids uuid[] NOT NULL DEFAULT '{}';
