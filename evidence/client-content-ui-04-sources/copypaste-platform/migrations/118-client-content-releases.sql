-- Immutable public presentation documents. This cannot grant model, task,
-- Skill, tenant, file, billing or administrator execution permissions.
CREATE TABLE client_content_releases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), version integer NOT NULL UNIQUE CHECK(version>0),
 document jsonb NOT NULL CHECK(jsonb_typeof(document)='object'),
 audience jsonb NOT NULL CHECK(jsonb_typeof(audience)='object'),
 canonical_definition text NOT NULL,
 definition_hash text NOT NULL CHECK(definition_hash~'^[a-f0-9]{64}$'),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000),
 created_by uuid NOT NULL REFERENCES admin_principals(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 idempotency_key text NOT NULL, request_hash text NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'),
 UNIQUE(created_by,idempotency_key),
 CHECK(canonical_definition::jsonb=jsonb_build_object('document',document,'audience',audience)),
 CHECK(definition_hash=encode(sha256(convert_to(canonical_definition,'UTF8')),'hex'))
);
CREATE TABLE client_content_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), release_id uuid NOT NULL REFERENCES client_content_releases(id),
 action text NOT NULL CHECK(action IN('publish','rollback')), expected_revision integer NOT NULL CHECK(expected_revision>=0),
 previous_publication_id uuid, baseline_document jsonb NOT NULL CHECK(jsonb_typeof(baseline_document)='object'),
 baseline_release_id uuid REFERENCES client_content_releases(id),
 created_by uuid NOT NULL REFERENCES admin_principals(id), auth_version integer NOT NULL, session_id text NOT NULL,
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000),
 sample jsonb NOT NULL, comparison jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes'
);
CREATE TABLE client_content_publications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), preview_id uuid NOT NULL UNIQUE REFERENCES client_content_previews(id),
 release_id uuid NOT NULL REFERENCES client_content_releases(id), previous_publication_id uuid REFERENCES client_content_publications(id),
 revision integer NOT NULL UNIQUE CHECK(revision>0), action text NOT NULL CHECK(action IN('publish','rollback')),
 baseline_document jsonb NOT NULL CHECK(jsonb_typeof(baseline_document)='object'), baseline_release_id uuid REFERENCES client_content_releases(id),
 created_by uuid NOT NULL REFERENCES admin_principals(id), reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE client_content_previews ADD FOREIGN KEY(previous_publication_id) REFERENCES client_content_publications(id);
CREATE TABLE client_content_head (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0), publication_id uuid REFERENCES client_content_publications(id),
 CHECK((revision=0)=(publication_id IS NULL))
);
INSERT INTO client_content_head(singleton) VALUES(true);
CREATE FUNCTION guard_client_content_fact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Client content documents, previews and publications are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable_client_content_release BEFORE UPDATE OR DELETE ON client_content_releases FOR EACH ROW EXECUTE FUNCTION guard_client_content_fact();
CREATE TRIGGER immutable_client_content_preview BEFORE UPDATE OR DELETE ON client_content_previews FOR EACH ROW EXECUTE FUNCTION guard_client_content_fact();
CREATE TRIGGER immutable_client_content_publication BEFORE UPDATE OR DELETE ON client_content_publications FOR EACH ROW EXECUTE FUNCTION guard_client_content_fact();
CREATE FUNCTION guard_client_content_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'UPDATE' OR NEW.revision<>OLD.revision+1 OR NEW.singleton IS DISTINCT FROM OLD.singleton OR
  NOT EXISTS(SELECT 1 FROM client_content_publications p JOIN client_content_previews v ON v.id=p.preview_id
    WHERE p.id=NEW.publication_id AND p.revision=NEW.revision AND p.previous_publication_id IS NOT DISTINCT FROM OLD.publication_id
    AND v.expected_revision=OLD.revision AND v.previous_publication_id IS NOT DISTINCT FROM OLD.publication_id
    AND v.release_id=p.release_id AND v.action=p.action AND v.created_by=p.created_by
    AND v.baseline_document=p.baseline_document AND v.baseline_release_id IS NOT DISTINCT FROM p.baseline_release_id
    AND v.reason=p.reason AND p.created_at>=v.created_at AND p.created_at<v.expires_at) THEN
  RAISE EXCEPTION 'A new matching reviewed publication is required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reviewed_client_content_head BEFORE INSERT OR UPDATE OR DELETE ON client_content_head FOR EACH ROW EXECUTE FUNCTION guard_client_content_head();
DO $$ DECLARE t text; BEGIN FOREACH t IN ARRAY ARRAY['client_content_releases','client_content_previews','client_content_publications','client_content_head'] LOOP
 EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
 EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
 EXECUTE format('CREATE POLICY control_only ON %I FOR ALL TO cp_control USING(true) WITH CHECK(true)',t);
 EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO cp_control',t);
 EXECUTE format('REVOKE ALL ON %I FROM cp_app,cp_queue,PUBLIC',t);
END LOOP; END $$;
