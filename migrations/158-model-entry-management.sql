-- Mutable model management identities point at immutable configuration facts.
CREATE TABLE capability_model_entries (
 id uuid PRIMARY KEY REFERENCES capability_releases(id),
 current_release_id uuid NOT NULL UNIQUE REFERENCES capability_releases(id),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 deleted_at timestamptz,
 updated_by uuid NOT NULL REFERENCES admin_principals(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000),
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE capability_model_revisions (
 release_id uuid PRIMARY KEY REFERENCES capability_releases(id),
 model_id uuid NOT NULL REFERENCES capability_model_entries(id)
);
CREATE INDEX capability_model_revisions_model ON capability_model_revisions(model_id);
INSERT INTO capability_model_entries(id,current_release_id,updated_by,reason)
 SELECT id,id,created_by,'Existing model configuration' FROM capability_releases;
INSERT INTO capability_model_revisions(release_id,model_id) SELECT id,id FROM capability_releases;
CREATE FUNCTION guard_model_entry_management() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR NEW.id<>OLD.id OR OLD.deleted_at IS NOT NULL OR NEW.revision<>OLD.revision+1
  OR NOT EXISTS(SELECT 1 FROM capability_model_revisions x JOIN capability_releases r ON r.id=x.release_id
    JOIN capability_releases original ON original.id=NEW.id
    WHERE x.model_id=NEW.id AND x.release_id=NEW.current_release_id
      AND r.profile_key=original.profile_key AND r.data_mode=original.data_mode) THEN
  RAISE EXCEPTION 'Invalid model management revision' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER controlled_model_entry BEFORE UPDATE OR DELETE ON capability_model_entries
 FOR EACH ROW EXECUTE FUNCTION guard_model_entry_management();
CREATE TRIGGER immutable_model_revision BEFORE UPDATE OR DELETE ON capability_model_revisions
 FOR EACH ROW EXECUTE FUNCTION immutable_capability_release_fact();
ALTER TABLE capability_model_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE capability_model_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY model_entry_control ON capability_model_entries USING(current_user='cp_control') WITH CHECK(current_user='cp_control');
ALTER TABLE capability_model_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE capability_model_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY model_revision_control ON capability_model_revisions USING(current_user='cp_control') WITH CHECK(current_user='cp_control');
REVOKE ALL ON capability_model_entries,capability_model_revisions FROM PUBLIC,cp_app,cp_queue;
GRANT SELECT,INSERT,UPDATE ON capability_model_entries TO cp_control;
GRANT SELECT,INSERT ON capability_model_revisions TO cp_control;

-- Existing, already-bound task versions stay readable and usable. New selection
-- is blocked through separate views and the transaction's capability-head lock.
CREATE VIEW deleted_model_capability_versions WITH(security_barrier=true) AS
 SELECT c.id,c.data_mode FROM internal_capability_versions c WHERE
 EXISTS(SELECT 1 FROM capability_model_revisions x JOIN capability_model_entries e ON e.id=x.model_id
   WHERE x.release_id::text=c.body->>'model_connection_id' AND e.deleted_at IS NOT NULL)
 OR (NOT(c.body ? 'model_connection_id')
   AND EXISTS(SELECT 1 FROM capability_validations v JOIN capability_model_revisions x ON x.release_id=v.release_id
     JOIN capability_model_entries e ON e.id=x.model_id WHERE v.capability_version_id=c.id AND e.deleted_at IS NOT NULL)
   AND NOT EXISTS(SELECT 1 FROM capability_validations v JOIN capability_model_revisions x ON x.release_id=v.release_id
     JOIN capability_model_entries e ON e.id=x.model_id WHERE v.capability_version_id=c.id AND e.deleted_at IS NULL));
CREATE VIEW deleted_model_capability_profiles WITH(security_barrier=true) AS
 SELECT h.profile_key,h.data_mode FROM capability_heads h JOIN capability_publications p ON p.id=h.publication_id
 JOIN capability_model_revisions x ON x.release_id=p.release_id JOIN capability_model_entries e ON e.id=x.model_id
 WHERE e.deleted_at IS NOT NULL;
GRANT SELECT ON deleted_model_capability_versions,deleted_model_capability_profiles TO cp_app,cp_control;
CREATE OR REPLACE VIEW current_internal_capabilities WITH(security_barrier=true) AS
 SELECT c.*,h.publication_id,h.revision AS head_revision,p.release_id,r.runtime_profile_id,
  v.id AS validation_id,v.finished_at AS verified_at
 FROM capability_heads h JOIN capability_publications p ON p.id=h.publication_id
 JOIN capability_releases r ON r.id=p.release_id JOIN capability_validations v ON v.id=p.validation_id
 JOIN internal_capability_versions c ON c.id=v.capability_version_id
 WHERE NOT EXISTS(SELECT 1 FROM capability_model_revisions x JOIN capability_model_entries e ON e.id=x.model_id
  WHERE x.release_id=r.id AND e.deleted_at IS NOT NULL);
