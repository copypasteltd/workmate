CREATE TABLE workflow_schedules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 workflow_id uuid NOT NULL REFERENCES workflows(id), name text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id), version integer NOT NULL DEFAULT 1,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','paused','blocked','ended','retired')),
 next_due_at timestamptz, last_error text,
 content_state text NOT NULL DEFAULT 'active' CHECK(content_state IN ('active','quarantined','deleted')),
 moderation_version integer NOT NULL DEFAULT 1,
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 UNIQUE(tenant_id,project_id,id)
);
CREATE INDEX schedule_due ON workflow_schedules(next_due_at) WHERE state='active';
CREATE TABLE workflow_schedule_versions (
 schedule_id uuid NOT NULL, revision integer NOT NULL, tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 body jsonb NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(schedule_id,revision),
 FOREIGN KEY(tenant_id,project_id,schedule_id) REFERENCES workflow_schedules(tenant_id,project_id,id)
);
CREATE TABLE workflow_schedule_occurrences (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 schedule_id uuid NOT NULL, revision integer NOT NULL, workflow_version integer NOT NULL,
 scheduled_local text NOT NULL, scheduled_at timestamptz,
 state text NOT NULL CHECK(state IN ('launched','skipped_overlap','skipped_missed','skipped_dst','blocked','expired')),
 run_id uuid UNIQUE REFERENCES workflow_runs(id) DEFERRABLE INITIALLY DEFERRED, code text,
 missed_count integer NOT NULL DEFAULT 0 CHECK(missed_count>=0), through_local text,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id,schedule_id) REFERENCES workflow_schedules(tenant_id,project_id,id),
 FOREIGN KEY(schedule_id,revision) REFERENCES workflow_schedule_versions(schedule_id,revision),
 CHECK((state='launched')=(run_id IS NOT NULL)),
 UNIQUE(schedule_id,revision,scheduled_local)
);
CREATE UNIQUE INDEX schedule_instant_once ON workflow_schedule_occurrences(schedule_id,scheduled_at,workflow_version) WHERE scheduled_at IS NOT NULL;
ALTER TABLE workflow_runs ADD COLUMN schedule_id uuid REFERENCES workflow_schedules(id);
ALTER TABLE workflow_runs ADD COLUMN schedule_revision integer;
ALTER TABLE workflow_runs ADD COLUMN scheduled_at timestamptz;
ALTER TABLE workflow_runs ADD COLUMN workflow_version integer;
ALTER TABLE workflow_runs ADD COLUMN role_hashes jsonb NOT NULL DEFAULT '{}';
CREATE UNIQUE INDEX one_schedule_run ON workflow_runs(schedule_id) WHERE state IN ('running','awaiting_approval') AND schedule_id IS NOT NULL;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['workflow_schedules','workflow_schedule_versions','workflow_schedule_occurrences'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(current_user=''cp_control'' OR tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(current_user=''cp_control'' OR tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
 END LOOP;
END $$;
CREATE POLICY schedule_visibility ON workflow_schedules AS RESTRICTIVE FOR ALL TO cp_app USING(content_state='active') WITH CHECK(content_state='active');
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['workflow_schedule_versions','workflow_schedule_occurrences'] LOOP
  EXECUTE format('CREATE POLICY schedule_visibility ON %I AS RESTRICTIVE FOR ALL TO cp_app USING(EXISTS(SELECT 1 FROM workflow_schedules s WHERE s.id=schedule_id AND s.content_state=''active'')) WITH CHECK(EXISTS(SELECT 1 FROM workflow_schedules s WHERE s.id=schedule_id AND s.content_state=''active''))',t);
 END LOOP;
END $$;
CREATE FUNCTION immutable_schedule_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF current_user='cp_control' AND current_setting('app.erasing_content',true)='true' AND TG_TABLE_NAME='workflow_schedule_versions' THEN
  IF NEW.schedule_id=OLD.schedule_id AND NEW.revision=OLD.revision AND NEW.body='{}'::jsonb THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Schedule history is immutable' USING ERRCODE='42501';
END $$;
CREATE TRIGGER schedule_version_immutable BEFORE UPDATE OR DELETE ON workflow_schedule_versions FOR EACH ROW EXECUTE FUNCTION immutable_schedule_history();
CREATE TRIGGER schedule_occurrence_immutable BEFORE UPDATE OR DELETE ON workflow_schedule_occurrences FOR EACH ROW EXECUTE FUNCTION immutable_schedule_history();
GRANT SELECT,INSERT,UPDATE ON workflow_schedules TO cp_app,cp_control;
GRANT SELECT,INSERT ON workflow_schedule_versions,workflow_schedule_occurrences TO cp_app,cp_control;
GRANT UPDATE ON workflow_schedule_versions TO cp_control;
