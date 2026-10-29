CREATE TABLE skill_versions (
 id uuid PRIMARY KEY, skill_key text NOT NULL, package_version text NOT NULL, version integer NOT NULL,
 name text NOT NULL, source text NOT NULL, content_hash text NOT NULL CHECK(content_hash ~ '^[a-f0-9]{64}$'),
 body jsonb NOT NULL, state text NOT NULL DEFAULT 'verified' CHECK(state IN ('draft','verified','disabled')),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(skill_key,package_version,content_hash)
);
CREATE TABLE skill_installations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 skill_version_id uuid NOT NULL REFERENCES skill_versions(id), enabled boolean NOT NULL DEFAULT true,
 version integer NOT NULL DEFAULT 1, state text NOT NULL DEFAULT 'installed' CHECK(state IN ('installed','uninstalled','revoked')),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id), UNIQUE(tenant_id,project_id,id)
);
CREATE UNIQUE INDEX current_skill_installation ON skill_installations(project_id,skill_version_id) WHERE state IN ('installed','revoked');
ALTER TABLE agents ADD UNIQUE(tenant_id,project_id,id);
ALTER TABLE agent_versions ADD UNIQUE(tenant_id,agent_id,version);
CREATE TABLE agent_skill_bindings (
 tenant_id uuid NOT NULL, project_id uuid NOT NULL, agent_id uuid NOT NULL, agent_version integer NOT NULL,
 installation_id uuid NOT NULL, skill_version_id uuid NOT NULL REFERENCES skill_versions(id), required boolean NOT NULL,
 PRIMARY KEY(agent_id,agent_version,installation_id),
 FOREIGN KEY(tenant_id,project_id,agent_id) REFERENCES agents(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,agent_id,agent_version) REFERENCES agent_versions(tenant_id,agent_id,version),
 FOREIGN KEY(tenant_id,project_id,installation_id) REFERENCES skill_installations(tenant_id,project_id,id)
);
CREATE TABLE task_skill_bindings (
 tenant_id uuid NOT NULL, project_id uuid NOT NULL, task_id uuid NOT NULL, installation_id uuid NOT NULL,
 skill_version_id uuid NOT NULL REFERENCES skill_versions(id), content_hash text NOT NULL,
 PRIMARY KEY(task_id,installation_id), FOREIGN KEY(tenant_id,task_id) REFERENCES tasks(tenant_id,id),
 FOREIGN KEY(tenant_id,project_id,installation_id) REFERENCES skill_installations(tenant_id,project_id,id)
);
CREATE FUNCTION guard_skill_installation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.tenant_id<>OLD.tenant_id OR NEW.project_id<>OLD.project_id OR NEW.skill_version_id<>OLD.skill_version_id OR NEW.created_by<>OLD.created_by THEN RAISE EXCEPTION 'Immutable skill installation scope' USING ERRCODE='23514'; END IF;
 IF OLD.state='revoked' AND NEW.state<>'revoked' THEN RAISE EXCEPTION 'A security revocation is permanent for this package' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_skill_installation BEFORE UPDATE ON skill_installations FOR EACH ROW EXECUTE FUNCTION guard_skill_installation();
CREATE FUNCTION guard_skill_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM skill_installations i WHERE i.id=NEW.installation_id AND i.skill_version_id=NEW.skill_version_id AND i.project_id=NEW.project_id AND i.tenant_id=NEW.tenant_id) THEN RAISE EXCEPTION 'Skill binding scope mismatch' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='task_skill_bindings' THEN
  IF NOT EXISTS(SELECT 1 FROM tasks t WHERE t.id=NEW.task_id AND t.project_id=NEW.project_id) THEN RAISE EXCEPTION 'Task skill scope mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_agent_skill_binding BEFORE INSERT ON agent_skill_bindings FOR EACH ROW EXECUTE FUNCTION guard_skill_binding();
CREATE TRIGGER guard_task_skill_binding BEFORE INSERT ON task_skill_bindings FOR EACH ROW EXECUTE FUNCTION guard_skill_binding();
ALTER TABLE skill_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE skill_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY skill_version_read ON skill_versions FOR SELECT USING(true);
CREATE POLICY skill_version_control ON skill_versions FOR ALL TO cp_control USING(true) WITH CHECK(true);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['skill_installations','agent_skill_bindings','task_skill_bindings'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY skill_tenant_scope ON %I USING(current_user=''cp_control'' OR tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(current_user=''cp_control'' OR tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
 END LOOP;
END $$;
CREATE POLICY skill_task_visibility ON task_skill_bindings AS RESTRICTIVE FOR ALL TO cp_app USING(EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id)) WITH CHECK(EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id));
GRANT SELECT ON skill_versions TO cp_app;
GRANT SELECT,INSERT,UPDATE ON skill_installations TO cp_app;
GRANT SELECT,INSERT ON agent_skill_bindings,task_skill_bindings TO cp_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON skill_versions,skill_installations,agent_skill_bindings,task_skill_bindings TO cp_control;
INSERT INTO schema_migrations(version) VALUES(25);
