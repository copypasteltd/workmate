-- Distinct administrator provenance; old user-created histories remain intact.
CREATE TABLE admin_content_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN('agent_groups','project_configurations','solutions')),
 source_id uuid NOT NULL,target_id uuid NOT NULL,tenant_id uuid NOT NULL,project_id uuid NOT NULL,
 source_version integer NOT NULL CHECK(source_version>0),
 source_moderation_version integer NOT NULL CHECK(source_moderation_version>=0),
 target_version integer NOT NULL CHECK(target_version>0),
 before_sha256 text NOT NULL CHECK(before_sha256 ~ '^[a-f0-9]{64}$'),
 after_sha256 text NOT NULL CHECK(after_sha256 ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL REFERENCES admin_principals(id),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 2000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 UNIQUE(id,actor_id),UNIQUE(kind,target_id,target_version)
);
ALTER TABLE admin_content_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_content_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY admin_revision_control ON admin_content_revisions TO cp_control USING(true) WITH CHECK(true);
REVOKE ALL ON admin_content_revisions FROM PUBLIC,cp_app,cp_queue;
GRANT SELECT,INSERT ON admin_content_revisions TO cp_control;
CREATE INDEX admin_revision_history ON admin_content_revisions(kind,source_id,created_at DESC,id DESC);

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['agent_group_versions','project_configuration_versions','solution_versions'] LOOP
  EXECUTE format('ALTER TABLE %I ALTER COLUMN created_by DROP NOT NULL',tab);
  EXECUTE format('ALTER TABLE %I ADD COLUMN created_by_admin uuid REFERENCES admin_principals(id), ADD COLUMN admin_revision_id uuid',tab);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT exact_revision_creator CHECK((created_by IS NOT NULL AND created_by_admin IS NULL AND admin_revision_id IS NULL) OR (created_by IS NULL AND created_by_admin IS NOT NULL AND admin_revision_id IS NOT NULL))',tab);
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT admin_revision_actor FOREIGN KEY(admin_revision_id,created_by_admin) REFERENCES admin_content_revisions(id,actor_id)',tab);
 END LOOP;
END $$;

CREATE FUNCTION guard_admin_revision_provenance() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fact admin_content_revisions; actual_kind text; actual_id uuid; actual_hash text;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.created_by,NEW.created_by_admin,NEW.admin_revision_id) IS DISTINCT FROM ROW(OLD.created_by,OLD.created_by_admin,OLD.admin_revision_id) THEN
   RAISE EXCEPTION 'Revision provenance is immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF NEW.created_by_admin IS NULL THEN RETURN NEW; END IF;
 IF current_user<>'cp_control' THEN RAISE EXCEPTION 'Only the admin control plane creates admin revisions' USING ERRCODE='42501'; END IF;
 SELECT * INTO fact FROM admin_content_revisions WHERE id=NEW.admin_revision_id AND actor_id=NEW.created_by_admin;
 actual_kind:=CASE TG_TABLE_NAME WHEN 'agent_group_versions' THEN 'agent_groups' WHEN 'project_configuration_versions' THEN 'project_configurations' ELSE 'solutions' END;
 actual_id:=CASE TG_TABLE_NAME WHEN 'agent_group_versions' THEN (to_jsonb(NEW)->>'group_id')::uuid WHEN 'project_configuration_versions' THEN (to_jsonb(NEW)->>'configuration_id')::uuid ELSE (to_jsonb(NEW)->>'id')::uuid END;
 actual_hash:=coalesce(to_jsonb(NEW)->>'sha256',to_jsonb(NEW)->>'definition_hash');
 IF fact.id IS NULL OR ROW(fact.kind,fact.target_id,fact.target_version,fact.tenant_id,fact.project_id,fact.after_sha256)
  IS DISTINCT FROM ROW(actual_kind,actual_id,NEW.version,NEW.tenant_id,NEW.project_id,actual_hash) THEN
  RAISE EXCEPTION 'An exact administrator revision fact is required' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['agent_group_versions','project_configuration_versions','solution_versions'] LOOP
  EXECUTE format('CREATE TRIGGER admin_revision_provenance BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION guard_admin_revision_provenance()',tab);
 END LOOP;
END $$;

CREATE FUNCTION immutable_admin_content_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Administrator revision facts are immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER admin_revision_immutable BEFORE UPDATE OR DELETE ON admin_content_revisions FOR EACH ROW EXECUTE FUNCTION immutable_admin_content_revision();

CREATE FUNCTION verify_admin_content_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE found boolean;
BEGIN
 IF NEW.kind='agent_groups' THEN
  SELECT EXISTS(SELECT 1 FROM agent_group_versions v WHERE v.group_id=NEW.target_id AND v.version=NEW.target_version AND v.admin_revision_id=NEW.id AND v.created_by_admin=NEW.actor_id AND v.sha256=NEW.after_sha256) INTO found;
 ELSIF NEW.kind='project_configurations' THEN
  SELECT EXISTS(SELECT 1 FROM project_configuration_versions v WHERE v.configuration_id=NEW.target_id AND v.version=NEW.target_version AND v.admin_revision_id=NEW.id AND v.created_by_admin=NEW.actor_id AND v.sha256=NEW.after_sha256) INTO found;
 ELSE
  SELECT EXISTS(SELECT 1 FROM solution_versions v WHERE v.id=NEW.target_id AND v.version=NEW.target_version AND v.admin_revision_id=NEW.id AND v.created_by_admin=NEW.actor_id AND v.definition_hash=NEW.after_sha256 AND v.state='draft') INTO found;
 END IF;
 IF NOT found OR NOT EXISTS(SELECT 1 FROM audit_log a WHERE a.actor_kind='admin' AND a.principal_id=NEW.actor_id AND a.action='admin.content.revision.create' AND a.target=NEW.id::text AND a.outcome='succeeded') THEN
  RAISE EXCEPTION 'A committed version and matching audit are required' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER admin_revision_requires_version AFTER INSERT ON admin_content_revisions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_admin_content_revision();

INSERT INTO schema_migrations(version) VALUES(130);
