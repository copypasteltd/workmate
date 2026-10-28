ALTER TABLE tasks DROP CONSTRAINT tasks_status_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_status_check CHECK(status IN ('queued','running','awaiting_approval','succeeded','failed','cancelled','paused','reconciling','needs_input'));
ALTER TABLE tasks ADD CONSTRAINT tasks_dependency_scope UNIQUE(tenant_id,project_id,id);
CREATE TABLE task_dependencies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL, task_id uuid NOT NULL,
 step_key text NOT NULL CHECK(length(step_key) BETWEEN 1 AND 80), kind text NOT NULL CHECK(kind IN ('file','connection')),
 description text NOT NULL CHECK(length(description) BETWEEN 1 AND 2000), required_scope text NOT NULL,
 provider text CHECK(provider IN ('google_ads','ga4','search_console','meta')),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','resolved','dismissed')),
 resource_ids uuid[] NOT NULL DEFAULT '{}', version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT now(), resolved_at timestamptz,
 FOREIGN KEY(tenant_id,project_id,task_id) REFERENCES tasks(tenant_id,project_id,id),
 UNIQUE(task_id,step_key), CHECK((kind='connection')=(provider IS NOT NULL)),
 CHECK((state='resolved')=(cardinality(resource_ids)>0)), CHECK(cardinality(resource_ids)<=20)
);
CREATE INDEX task_dependencies_pending ON task_dependencies(task_id,state,id);
ALTER TABLE task_dependencies ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_dependencies FORCE ROW LEVEL SECURITY;
CREATE POLICY dependency_tenant ON task_dependencies
 USING(current_user='cp_control' OR tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(current_user='cp_control' OR tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY dependency_task_visibility ON task_dependencies AS RESTRICTIVE FOR ALL TO cp_app
 USING(EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_dependencies.task_id AND t.project_id=task_dependencies.project_id AND t.content_state='active'))
 WITH CHECK(EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_dependencies.task_id AND t.project_id=task_dependencies.project_id AND t.content_state='active'));
GRANT SELECT,INSERT,UPDATE ON task_dependencies TO cp_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON task_dependencies TO cp_control;
CREATE FUNCTION retire_task_dependencies() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.content_state='deleted' THEN
   DELETE FROM task_dependencies WHERE task_id=NEW.id;
 ELSIF NEW.status IN ('cancelled','failed') THEN
   UPDATE task_dependencies SET state='dismissed',resource_ids='{}',version=version+1 WHERE task_id=NEW.id AND state='pending';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION retire_task_dependencies() OWNER TO cp_control;
REVOKE ALL ON FUNCTION retire_task_dependencies() FROM PUBLIC;
CREATE TRIGGER retire_task_dependencies AFTER UPDATE OF status,content_state ON tasks FOR EACH ROW EXECUTE FUNCTION retire_task_dependencies();
INSERT INTO schema_migrations(version) VALUES(28);
