-- Additive configuration documents and actual verification/publication facts.
-- No original capability, queued task or historical price is rewritten.
CREATE TABLE capability_releases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 profile_key text NOT NULL CHECK(profile_key IN ('internal-text-v1','internal-image2-v1')),
 data_mode text NOT NULL CHECK(data_mode IN ('simulated','configured_services')),
 version integer NOT NULL CHECK(version>0),
 definition jsonb NOT NULL,
 definition_hash text NOT NULL CHECK(definition_hash ~ '^[a-f0-9]{64}$'),
 runtime_profile_id uuid NOT NULL REFERENCES codex_runtime_profiles(id),
 gateway_fingerprint text NOT NULL CHECK(gateway_fingerprint ~ '^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES admin_principals(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(profile_key,data_mode,version),
 CHECK(definition->>'kernel'='codex' AND definition->>'gateway_policy'='company_internal_only')
);
CREATE TABLE capability_validations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 release_id uuid NOT NULL REFERENCES capability_releases(id),
 principal_id uuid NOT NULL REFERENCES admin_principals(id),
 session_id uuid NOT NULL,
 idempotency_hash text NOT NULL,
 payload_hash text NOT NULL,
 execution_nonce uuid NOT NULL,
 state text NOT NULL DEFAULT 'running' CHECK(state IN ('running','passed','failed','reconciling','cancelled')),
 capability_version_id uuid REFERENCES internal_capability_versions(id),
 result jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT now(),
 lease_until timestamptz NOT NULL DEFAULT now()+interval '4 minutes',
 finished_at timestamptz,
 expires_at timestamptz,
 UNIQUE(principal_id,release_id,idempotency_hash),
 CHECK((state='running' AND finished_at IS NULL AND capability_version_id IS NULL)
   OR (state<>'running' AND finished_at IS NOT NULL)),
 CHECK(state<>'passed' OR (capability_version_id IS NOT NULL AND expires_at IS NOT NULL))
);
CREATE TABLE capability_publications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 profile_key text NOT NULL,
 data_mode text NOT NULL CHECK(data_mode IN ('simulated','configured_services')),
 release_id uuid NOT NULL REFERENCES capability_releases(id),
 validation_id uuid NOT NULL REFERENCES capability_validations(id),
 previous_publication_id uuid REFERENCES capability_publications(id),
 operation_id uuid NOT NULL UNIQUE REFERENCES admin_operations(id),
 actor_id uuid NOT NULL REFERENCES admin_principals(id),
 rollback boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE capability_validation_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 validation_id uuid NOT NULL REFERENCES capability_validations(id),
 body jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE capability_heads (
 profile_key text NOT NULL,
 data_mode text NOT NULL CHECK(data_mode IN ('simulated','configured_services')),
 publication_id uuid NOT NULL UNIQUE REFERENCES capability_publications(id),
 revision integer NOT NULL CHECK(revision>0),
 PRIMARY KEY(profile_key,data_mode)
);
-- Operational reclamation is separate from immutable model/usage evidence.
CREATE TABLE capability_workspace_purges (
 validation_id uuid PRIMARY KEY REFERENCES capability_validations(id),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','completed','failed')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 8),
 next_attempt_at timestamptz NOT NULL DEFAULT now()+interval '30 seconds',
 completed_at timestamptz,
 error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((state='completed' AND completed_at IS NOT NULL AND error_code IS NULL)
   OR (state<>'completed' AND completed_at IS NULL)),
 CHECK(state<>'queued' OR attempts<8)
);
CREATE FUNCTION immutable_capability_release_fact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Immutable capability document or publication' USING ERRCODE='23514';
END $$;
CREATE TRIGGER immutable_capability_release BEFORE UPDATE OR DELETE ON capability_releases
 FOR EACH ROW EXECUTE FUNCTION immutable_capability_release_fact();
CREATE TRIGGER immutable_capability_publication BEFORE UPDATE OR DELETE ON capability_publications
 FOR EACH ROW EXECUTE FUNCTION immutable_capability_release_fact();
CREATE TRIGGER immutable_capability_validation_event BEFORE UPDATE OR DELETE ON capability_validation_events
 FOR EACH ROW EXECUTE FUNCTION immutable_capability_release_fact();
CREATE FUNCTION guard_capability_validation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.state<>'running' OR NEW.state='running'
  OR (to_jsonb(NEW)-ARRAY['state','capability_version_id','result','finished_at','expires_at'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','capability_version_id','result','finished_at','expires_at']) THEN
  RAISE EXCEPTION 'Immutable completed capability verification' USING ERRCODE='23514';
 END IF;
 IF NEW.state='passed' AND NOT EXISTS(
  SELECT 1 FROM capability_releases r JOIN internal_capability_versions c ON c.id=NEW.capability_version_id
   WHERE r.id=NEW.release_id AND c.profile_key=r.profile_key AND c.data_mode=r.data_mode AND c.ready AND NOT c.revoked
    AND c.body->>'gateway_fingerprint'=r.gateway_fingerprint AND c.body->>'schema_version'='2'
 ) THEN RAISE EXCEPTION 'Verification does not match its configuration' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_completed_capability_validation BEFORE UPDATE OR DELETE ON capability_validations
 FOR EACH ROW EXECUTE FUNCTION guard_capability_validation();
CREATE FUNCTION guard_capability_publication() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(
  SELECT 1 FROM capability_validations v JOIN capability_releases r ON r.id=v.release_id
   JOIN internal_capability_versions c ON c.id=v.capability_version_id
   JOIN codex_runtime_profiles p ON p.id=r.runtime_profile_id
   WHERE v.id=NEW.validation_id AND r.id=NEW.release_id AND r.profile_key=NEW.profile_key AND r.data_mode=NEW.data_mode
    AND v.state='passed' AND v.expires_at>now() AND c.ready AND NOT c.revoked AND p.state='enabled'
    AND p.kernel='codex' AND p.gateway_policy='company_internal_only' AND NOT p.automatic_fallback
 ) THEN RAISE EXCEPTION 'Only a currently verified capability can be published' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER verified_capability_publication BEFORE INSERT ON capability_publications
 FOR EACH ROW EXECUTE FUNCTION guard_capability_publication();
CREATE FUNCTION guard_capability_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Capability heads require an appended publication' USING ERRCODE='23514'; END IF;
 IF NOT EXISTS(SELECT 1 FROM capability_publications p WHERE p.id=NEW.publication_id
  AND p.profile_key=NEW.profile_key AND p.data_mode=NEW.data_mode
  AND ((TG_OP='INSERT' AND p.previous_publication_id IS NULL AND NEW.revision=1)
    OR (TG_OP='UPDATE' AND NEW.profile_key=OLD.profile_key AND NEW.data_mode=OLD.data_mode
       AND p.previous_publication_id=OLD.publication_id AND NEW.revision=OLD.revision+1))) THEN
  RAISE EXCEPTION 'Capability head must advance its exact publication chain' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER controlled_capability_head BEFORE INSERT OR UPDATE OR DELETE ON capability_heads
 FOR EACH ROW EXECUTE FUNCTION guard_capability_head();
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['capability_releases','capability_validations','capability_publications','capability_heads','capability_validation_events','capability_workspace_purges'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('CREATE POLICY capability_control ON %I USING(current_user=''cp_control'') WITH CHECK(current_user=''cp_control'')',n);
 END LOOP;
END $$;
GRANT SELECT,INSERT ON capability_releases,capability_publications,capability_validation_events TO cp_control;
GRANT SELECT,INSERT,UPDATE ON capability_validations,capability_heads,capability_workspace_purges TO cp_control;
CREATE VIEW current_internal_capabilities WITH(security_barrier=true) AS
 SELECT c.*,h.publication_id,h.revision AS head_revision,p.release_id,r.runtime_profile_id,
  v.id AS validation_id,v.finished_at AS verified_at
 FROM capability_heads h JOIN capability_publications p ON p.id=h.publication_id
 JOIN capability_releases r ON r.id=p.release_id JOIN capability_validations v ON v.id=p.validation_id
 JOIN internal_capability_versions c ON c.id=v.capability_version_id;
GRANT SELECT ON current_internal_capabilities TO cp_app,cp_control;
CREATE VIEW published_capability_versions WITH(security_barrier=true) AS
 SELECT DISTINCT v.capability_version_id AS id,r.data_mode
 FROM capability_publications p JOIN capability_validations v ON v.id=p.validation_id
 JOIN capability_releases r ON r.id=p.release_id WHERE v.state='passed';
GRANT SELECT ON published_capability_versions TO cp_app,cp_control;
INSERT INTO schema_migrations(version) VALUES(64);
