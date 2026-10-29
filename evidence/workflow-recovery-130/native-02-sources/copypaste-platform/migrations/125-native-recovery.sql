-- The source identity survives restores; quarantine is an independent fence.
CREATE TABLE recovery_environment (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 source_id uuid NOT NULL DEFAULT gen_random_uuid(),
 state text NOT NULL DEFAULT 'live' CHECK(state IN('live','quarantined')),
 restore_id uuid, quarantined_at timestamptz,
 CHECK((state='live')=(restore_id IS NULL)),
 CHECK((state='live')=(quarantined_at IS NULL))
);
INSERT INTO recovery_environment(singleton) VALUES(true);
REVOKE ALL ON recovery_environment FROM PUBLIC,cp_app,cp_control,cp_queue;
GRANT SELECT ON recovery_environment TO cp_app,cp_control,cp_queue;

CREATE TABLE recovery_runs (
 id uuid PRIMARY KEY, source_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('backup','ledger','restore')),
 outcome text NOT NULL CHECK(outcome IN('verified','failed','quarantined','incomplete')),
 started_at timestamptz NOT NULL, finished_at timestamptz NOT NULL,
 snapshot_at timestamptz, ledger_at timestamptz, incident_at timestamptz,
 file_count integer NOT NULL CHECK(file_count>=0),
 plaintext_bytes bigint NOT NULL CHECK(plaintext_bytes>=0),
 manifest_sha256 text CHECK(manifest_sha256~'^[a-f0-9]{64}$'),
 detail jsonb NOT NULL DEFAULT '{}',
 CHECK(finished_at>=started_at)
);
CREATE INDEX recovery_runs_recent ON recovery_runs(finished_at DESC,id DESC);
REVOKE ALL ON recovery_runs FROM PUBLIC,cp_app,cp_control,cp_queue;
GRANT SELECT ON recovery_runs TO cp_control;
CREATE FUNCTION recovery_receipt_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Recovery receipts are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER recovery_receipt_immutable BEFORE UPDATE OR DELETE ON recovery_runs
 FOR EACH ROW EXECUTE FUNCTION recovery_receipt_immutable();

INSERT INTO schema_migrations(version) VALUES(125);
