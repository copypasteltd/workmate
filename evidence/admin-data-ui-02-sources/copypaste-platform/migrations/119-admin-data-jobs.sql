-- Additive control-plane jobs. Public application/queue roles cannot access
-- frozen directory data. The encrypted snapshot can only be erased at expiry.
CREATE TABLE admin_data_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), principal_id uuid NOT NULL REFERENCES admin_principals(id),
 session_id text NOT NULL, auth_version integer NOT NULL, access_hash text NOT NULL,
 command jsonb NOT NULL, definition_hash text NOT NULL CHECK(definition_hash~'^[a-f0-9]{64}$'),
 retry_of uuid,
 manifest jsonb NOT NULL, payload_ciphertext text, payload_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes'
);
CREATE TABLE admin_data_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), preview_id uuid NOT NULL UNIQUE REFERENCES admin_data_previews(id),
 principal_id uuid NOT NULL REFERENCES admin_principals(id), command jsonb NOT NULL, definition_hash text NOT NULL,
 access_hash text NOT NULL, policy_version_id uuid REFERENCES admin_operation_policy_versions(id), auth_version integer NOT NULL, session_id text NOT NULL,
 retry_of uuid REFERENCES admin_data_jobs(id),
 state text NOT NULL CHECK(state IN('queued','running','needs_authorization','succeeded','partially_succeeded','failed','cancelled','expired')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), total integer NOT NULL CHECK(total BETWEEN 1 AND 10000),
 manifest jsonb NOT NULL, error_code text, idempotency_key text NOT NULL, request_hash text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '15 minutes', UNIQUE(principal_id,idempotency_key)
);
CREATE TABLE admin_data_items (
 job_id uuid NOT NULL REFERENCES admin_data_jobs(id), ordinal integer NOT NULL CHECK(ordinal>=0),
 target_id text NOT NULL, target_version integer, fingerprint text NOT NULL CHECK(fingerprint~'^[a-f0-9]{64}$'),
 payload_ciphertext text, payload_hash text NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','succeeded','failed','cancelled')),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 3), retryable boolean NOT NULL DEFAULT false,
 error_code text, next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 completed_at timestamptz, PRIMARY KEY(job_id,ordinal), UNIQUE(job_id,target_id)
);
CREATE TABLE admin_data_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, job_id uuid NOT NULL REFERENCES admin_data_jobs(id),
 item_ordinal integer, action text NOT NULL, actor_id uuid REFERENCES admin_principals(id),
 detail jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX admin_data_work ON admin_data_jobs(updated_at,id) WHERE state IN('queued','running');
CREATE UNIQUE INDEX admin_data_one_retry ON admin_data_jobs(retry_of) WHERE retry_of IS NOT NULL;
CREATE INDEX admin_data_due_item ON admin_data_items(job_id,next_attempt_at,ordinal) WHERE state='pending';
CREATE FUNCTION guard_admin_data_preview() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Data previews are immutable' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW)-'payload_ciphertext') IS DISTINCT FROM (to_jsonb(OLD)-'payload_ciphertext') OR
   OLD.expires_at>clock_timestamp() OR NEW.payload_ciphertext IS NOT NULL THEN
  RAISE EXCEPTION 'Only expired encrypted preview payloads can be erased' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guarded_admin_data_preview BEFORE UPDATE OR DELETE ON admin_data_previews FOR EACH ROW EXECUTE FUNCTION guard_admin_data_preview();
CREATE FUNCTION guard_admin_data_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['state','revision','session_id','auth_version','error_code','updated_at']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['state','revision','session_id','auth_version','error_code','updated_at']) OR NEW.revision<>OLD.revision+1 THEN
  RAISE EXCEPTION 'Frozen data job definitions are immutable and revisions advance once' USING ERRCODE='23514'; END IF;
 IF OLD.state IN('succeeded','partially_succeeded','failed','cancelled','expired') AND NEW.state<>OLD.state AND
   NOT(NEW.state='expired' AND OLD.expires_at<=clock_timestamp()) THEN
  RAISE EXCEPTION 'Completed data jobs cannot execute again' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guarded_admin_data_job BEFORE UPDATE OR DELETE ON admin_data_jobs FOR EACH ROW EXECUTE FUNCTION guard_admin_data_job();
ALTER TABLE admin_data_previews ADD FOREIGN KEY(retry_of) REFERENCES admin_data_jobs(id);
CREATE FUNCTION guard_admin_data_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['state','attempts','retryable','error_code','next_attempt_at','completed_at','payload_ciphertext']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['state','attempts','retryable','error_code','next_attempt_at','completed_at','payload_ciphertext']) THEN
  RAISE EXCEPTION 'Frozen data job targets are immutable' USING ERRCODE='23514'; END IF;
 IF NEW.payload_ciphertext IS DISTINCT FROM OLD.payload_ciphertext AND
  (NEW.payload_ciphertext IS NOT NULL OR NOT EXISTS(SELECT 1 FROM admin_data_jobs j WHERE j.id=OLD.job_id AND j.expires_at<=clock_timestamp())) THEN
  RAISE EXCEPTION 'Only expired encrypted job payloads can be erased' USING ERRCODE='23514'; END IF;
 IF OLD.state IN('succeeded','cancelled') AND NEW.state<>OLD.state THEN
  RAISE EXCEPTION 'Completed items cannot execute again' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guarded_admin_data_item BEFORE UPDATE OR DELETE ON admin_data_items FOR EACH ROW EXECUTE FUNCTION guard_admin_data_item();
CREATE FUNCTION guard_admin_data_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Data job events are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable_admin_data_event BEFORE UPDATE OR DELETE ON admin_data_events FOR EACH ROW EXECUTE FUNCTION guard_admin_data_event();
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['admin_data_previews','admin_data_jobs','admin_data_items','admin_data_events'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY control_only ON %I FOR ALL TO cp_control USING(true) WITH CHECK(true)',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO cp_control',t);
 EXECUTE format('REVOKE ALL ON %I FROM cp_app,cp_queue,PUBLIC',t);
END LOOP; END $$;
GRANT USAGE,SELECT ON SEQUENCE admin_data_events_id_seq TO cp_control;
