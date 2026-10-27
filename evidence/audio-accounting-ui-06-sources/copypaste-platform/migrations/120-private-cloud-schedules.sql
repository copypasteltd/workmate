-- Additive: SQL001-119 and their original execution paths remain immutable.
CREATE TABLE cloud_schedule_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),project_id uuid NOT NULL,
 private_owner uuid NOT NULL REFERENCES users(id),origin_task_id uuid NOT NULL REFERENCES tasks(id),
 body jsonb NOT NULL,specification_hash text NOT NULL CHECK(specification_hash ~ '^[a-f0-9]{64}$'),
 request_input_hash text NOT NULL CHECK(request_input_hash ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','activated','declined')),
 content_state text NOT NULL DEFAULT 'active' CHECK(content_state IN('active','deleted')),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '7 days',created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 UNIQUE(tenant_id,project_id,id),UNIQUE(origin_task_id,request_input_hash)
);
CREATE TABLE cloud_schedules (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,project_id uuid NOT NULL,
 private_owner uuid NOT NULL REFERENCES users(id),request_id uuid NOT NULL UNIQUE REFERENCES cloud_schedule_requests(id),
 name text NOT NULL,revision integer NOT NULL DEFAULT 1 CHECK(revision>0),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 state text NOT NULL DEFAULT 'active' CHECK(state IN('active','paused','blocked','retired','ended')),
 content_state text NOT NULL DEFAULT 'active' CHECK(content_state IN('active','deleted')),
 next_due_at timestamptz,last_error text,created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id,request_id) REFERENCES cloud_schedule_requests(tenant_id,project_id,id),
 UNIQUE(tenant_id,project_id,id),CHECK((state='active')=(next_due_at IS NOT NULL))
);
CREATE INDEX cloud_schedule_due ON cloud_schedules(next_due_at) WHERE state='active';
CREATE TABLE cloud_schedule_versions (
 schedule_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),tenant_id uuid NOT NULL,project_id uuid NOT NULL,
 private_owner uuid NOT NULL REFERENCES users(id),request_id uuid NOT NULL REFERENCES cloud_schedule_requests(id),
 body jsonb NOT NULL,specification_hash text NOT NULL CHECK(specification_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(schedule_id,revision),
 FOREIGN KEY(tenant_id,project_id,schedule_id) REFERENCES cloud_schedules(tenant_id,project_id,id)
);
CREATE TABLE cloud_schedule_occurrences (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),schedule_id uuid NOT NULL,revision integer NOT NULL,
 tenant_id uuid NOT NULL,project_id uuid NOT NULL,private_owner uuid NOT NULL REFERENCES users(id),
 scheduled_local text NOT NULL,scheduled_at timestamptz,
 state text NOT NULL CHECK(state IN('launched','skipped_missed','skipped_dst','skipped_overlap','blocked')),
 run_id uuid REFERENCES workflow_runs(id) DEFERRABLE INITIALLY DEFERRED,code text,
 missed_count integer NOT NULL DEFAULT 0 CHECK(missed_count>=0),through_local text,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id,schedule_id) REFERENCES cloud_schedules(tenant_id,project_id,id),
 FOREIGN KEY(schedule_id,revision) REFERENCES cloud_schedule_versions(schedule_id,revision),
 UNIQUE(schedule_id,revision,scheduled_local),CHECK((state='launched')=(run_id IS NOT NULL))
);
CREATE UNIQUE INDEX cloud_schedule_instant_once ON cloud_schedule_occurrences(schedule_id,scheduled_at) WHERE scheduled_at IS NOT NULL;
ALTER TABLE workflow_runs ADD COLUMN cloud_schedule_id uuid REFERENCES cloud_schedules(id);
ALTER TABLE workflow_runs ADD COLUMN cloud_schedule_revision integer;
ALTER TABLE workflow_runs ADD COLUMN cloud_schedule_occurrence_id uuid UNIQUE REFERENCES cloud_schedule_occurrences(id);
ALTER TABLE workflow_runs ADD CONSTRAINT private_cloud_schedule_scope CHECK(
 (cloud_schedule_id IS NULL AND cloud_schedule_revision IS NULL AND cloud_schedule_occurrence_id IS NULL) OR
 (cloud_schedule_id IS NOT NULL AND cloud_schedule_revision>0 AND cloud_schedule_occurrence_id IS NOT NULL
  AND execution_location='cloud' AND private_owner=created_by AND schedule_id IS NULL));
DROP INDEX one_private_cloud_workflow_request;
CREATE UNIQUE INDEX one_private_cloud_workflow_request ON workflow_runs(origin_task_id,workflow_id,workflow_version)
 WHERE execution_location='cloud' AND private_owner IS NOT NULL AND cloud_schedule_id IS NULL;
CREATE UNIQUE INDEX one_private_cloud_schedule_active_run ON workflow_runs(cloud_schedule_id)
 WHERE cloud_schedule_id IS NOT NULL AND state IN('running','awaiting_approval');

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['cloud_schedule_requests','cloud_schedules','cloud_schedule_versions','cloud_schedule_occurrences'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY cloud_schedule_owner ON %I USING(current_user=''cp_control'' OR (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND private_owner=nullif(current_setting(''app.actor_id'',true),'''')::uuid)) WITH CHECK(current_user=''cp_control'' OR (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND private_owner=nullif(current_setting(''app.actor_id'',true),'''')::uuid))',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,cp_queue',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO cp_app,cp_control',t);
 END LOOP;
END $$;

CREATE FUNCTION guard_cloud_schedule_records() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r cloud_schedule_requests; s cloud_schedules;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Cloud schedule facts are immutable' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND current_user='cp_control' AND coalesce(current_setting('app.erasing_content',true),'')='true' THEN
  IF TG_TABLE_NAME IN('cloud_schedule_requests','cloud_schedule_versions') THEN
   IF NEW.body='{}'::jsonb THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='cloud_schedules' THEN
   IF NEW.content_state='deleted' AND NEW.state='retired' AND NEW.next_due_at IS NULL THEN RETURN NEW; END IF;
  END IF;
 END IF;
 IF TG_TABLE_NAME='cloud_schedule_requests' THEN
  IF TG_OP='INSERT' THEN
   IF NOT EXISTS(SELECT 1 FROM tasks t JOIN workflows w ON w.id=(NEW.body->>'workflow_id')::uuid
    JOIN workflow_versions v ON v.workflow_id=w.id AND v.version=(NEW.body->>'workflow_version')::int
    WHERE t.id=NEW.origin_task_id AND t.private_owner=NEW.private_owner AND t.created_by=NEW.private_owner
     AND t.execution_location='cloud' AND t.tenant_id=NEW.tenant_id AND t.project_id=NEW.project_id
     AND t.content_state='active' AND NOT t.cancel_requested AND t.retention_expires_at>clock_timestamp()
     AND t.status IN('running','succeeded') AND t.cloud_workflow_run_id IS NULL
     AND w.private_owner=NEW.private_owner AND w.execution_location='cloud' AND w.content_state='active'
     AND w.tenant_id=NEW.tenant_id AND w.project_id=NEW.project_id
     AND v.published_at IS NOT NULL AND v.definition_hash=NEW.body->>'workflow_definition_hash'
     AND v.role_hashes=NEW.body->'role_hashes' AND v.source_refs=NEW.body->'source_refs' AND (NEW.body->>'origin_task_id')::uuid=t.id
     AND (NEW.body->>'max_budget_micros')::bigint=(SELECT coalesce(sum((step->>'budget_micros')::bigint),0)
       FROM jsonb_array_elements(v.definition->'steps') step WHERE step->>'kind'='codex')) THEN
    RAISE EXCEPTION 'Invalid fixed private cloud schedule request' USING ERRCODE='23514'; END IF;
  ELSIF ROW(NEW.id,NEW.tenant_id,NEW.project_id,NEW.private_owner,NEW.origin_task_id,NEW.body,NEW.specification_hash,NEW.request_input_hash,NEW.expires_at,NEW.created_at,NEW.content_state)
   IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.project_id,OLD.private_owner,OLD.origin_task_id,OLD.body,OLD.specification_hash,OLD.request_input_hash,OLD.expires_at,OLD.created_at,OLD.content_state)
   OR (NEW.state<>OLD.state AND (OLD.state<>'pending' OR NEW.state NOT IN('activated','declined'))) THEN
   RAISE EXCEPTION 'Cloud schedule request cannot be rewritten' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='cloud_schedule_occurrences' THEN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Cloud schedule occurrence is immutable' USING ERRCODE='42501'; END IF;
  SELECT * INTO s FROM cloud_schedules WHERE id=NEW.schedule_id;
  IF s.private_owner IS DISTINCT FROM NEW.private_owner OR s.tenant_id<>NEW.tenant_id OR s.project_id<>NEW.project_id OR s.revision<>NEW.revision OR s.state<>'active' THEN
   RAISE EXCEPTION 'Invalid cloud schedule occurrence' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='cloud_schedule_versions' THEN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Cloud schedule version is immutable' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM cloud_schedule_requests WHERE id=NEW.request_id;
  SELECT * INTO s FROM cloud_schedules WHERE id=NEW.schedule_id;
  IF ROW(NEW.tenant_id,NEW.project_id,NEW.private_owner,NEW.body,NEW.specification_hash)
   IS DISTINCT FROM ROW(r.tenant_id,r.project_id,r.private_owner,r.body,r.specification_hash)
   OR s.private_owner<>NEW.private_owner OR NEW.revision NOT IN(s.revision,s.revision+1) THEN
   RAISE EXCEPTION 'Cloud schedule version differs from its reviewed request' USING ERRCODE='23514'; END IF;
 ELSE
  IF TG_OP='INSERT' THEN
   SELECT * INTO r FROM cloud_schedule_requests WHERE id=NEW.request_id;
   IF r.state<>'pending' OR r.expires_at<=clock_timestamp() OR r.content_state<>'active' OR
    ROW(r.tenant_id,r.project_id,r.private_owner) IS DISTINCT FROM ROW(NEW.tenant_id,NEW.project_id,NEW.private_owner) THEN
    RAISE EXCEPTION 'Cloud schedule needs an available owner request' USING ERRCODE='23514'; END IF;
  ELSIF ROW(NEW.id,NEW.tenant_id,NEW.project_id,NEW.private_owner,NEW.request_id,NEW.created_at,NEW.content_state)
   IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.project_id,OLD.private_owner,OLD.request_id,OLD.created_at,OLD.content_state)
   OR NEW.version<>OLD.version+1 OR (OLD.state IN('retired','ended') AND NEW.state<>OLD.state) THEN
   RAISE EXCEPTION 'Invalid cloud schedule transition' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_cloud_schedule_records() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_cloud_schedule_records() FROM PUBLIC;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['cloud_schedule_requests','cloud_schedules','cloud_schedule_versions','cloud_schedule_occurrences'] LOOP
  EXECUTE format('CREATE TRIGGER cloud_schedule_record_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_cloud_schedule_records()',t);
 END LOOP;
END $$;

-- Only the run trigger is extended. The original workflow creation guard is retained.
CREATE FUNCTION check_private_cloud_run_120() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.cloud_schedule_id,NEW.cloud_schedule_revision,NEW.cloud_schedule_occurrence_id)
  IS DISTINCT FROM ROW(OLD.cloud_schedule_id,OLD.cloud_schedule_revision,OLD.cloud_schedule_occurrence_id) THEN
  RAISE EXCEPTION 'Cloud schedule run binding is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.execution_location<>'cloud' OR NEW.private_owner IS NULL THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.cloud_schedule_occurrence_id IS NOT NULL THEN
   IF NOT EXISTS(SELECT 1 FROM cloud_schedule_occurrences o JOIN cloud_schedules s ON s.id=o.schedule_id
    JOIN cloud_schedule_versions sv ON sv.schedule_id=s.id AND sv.revision=o.revision
    JOIN cloud_schedule_requests q ON q.id=sv.request_id JOIN tasks t ON t.id=(sv.body->>'origin_task_id')::uuid
    JOIN workflow_versions v ON v.workflow_id=(sv.body->>'workflow_id')::uuid AND v.version=(sv.body->>'workflow_version')::int
    WHERE o.id=NEW.cloud_schedule_occurrence_id AND o.run_id=NEW.id AND o.state='launched'
     AND s.id=NEW.cloud_schedule_id AND s.revision=NEW.cloud_schedule_revision AND o.revision=s.revision AND s.state='active'
     AND s.private_owner=NEW.private_owner AND s.tenant_id=NEW.tenant_id AND s.project_id=NEW.project_id
     AND q.state='activated' AND sv.body->>'workflow_definition_hash'=v.definition_hash
     AND NEW.workflow_id=v.workflow_id AND NEW.workflow_version=v.version AND NEW.definition=v.definition AND NEW.role_hashes=v.role_hashes
     AND NEW.actor_auth_version=(sv.body->>'actor_auth_version')::int AND NEW.origin_task_id=t.id
     AND t.status='succeeded' AND NOT t.cancel_requested AND t.content_state='active' AND t.retention_expires_at>clock_timestamp()
     AND NEW.authorized_at IS NOT NULL AND NEW.state='running' AND NEW.cursor=0) THEN
    RAISE EXCEPTION 'Scheduled cloud run lacks an exact customer authorization' USING ERRCODE='23514'; END IF;
  ELSE
   IF NOT EXISTS(SELECT 1 FROM tasks t WHERE t.id=NEW.origin_task_id
    AND t.id=nullif(current_setting('app.task_id',true),'')::uuid AND t.role_key='workflow-consultant'
    AND t.execution_location='cloud' AND t.private_owner=NEW.private_owner AND t.created_by=NEW.private_owner
    AND t.tenant_id=NEW.tenant_id AND t.project_id=NEW.project_id AND t.cloud_workflow_run_id IS NULL
    AND t.status='running' AND NOT t.cancel_requested AND t.content_state='active' AND t.lease_until>clock_timestamp())
    OR NEW.authorized_at IS NOT NULL OR NEW.state<>'awaiting_approval' OR NEW.cursor<>0 THEN
    RAISE EXCEPTION 'Private cloud run requires its live consultant and customer approval' USING ERRCODE='23514'; END IF;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workflow_id=w.id
   WHERE w.id=NEW.workflow_id AND w.execution_location='cloud' AND w.private_owner=NEW.private_owner
    AND w.tenant_id=NEW.tenant_id AND w.project_id=NEW.project_id AND w.content_state='active'
    AND v.version=NEW.workflow_version AND v.published_at IS NOT NULL AND v.definition=NEW.definition AND v.role_hashes=NEW.role_hashes) THEN
   RAISE EXCEPTION 'Private cloud run needs an exact published version' USING ERRCODE='23514'; END IF;
 ELSIF ROW(NEW.definition,NEW.workflow_version,NEW.role_hashes,NEW.workflow_id)
  IS DISTINCT FROM ROW(OLD.definition,OLD.workflow_version,OLD.role_hashes,OLD.workflow_id)
  AND NOT(current_user='cp_control' AND coalesce(current_setting('app.erasing_content',true),'')='true' AND NEW.definition='{}'::jsonb AND NEW.results='[]'::jsonb) THEN
  RAISE EXCEPTION 'Cloud workflow run definition is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION check_private_cloud_run_120() OWNER TO cp_control;
REVOKE ALL ON FUNCTION check_private_cloud_run_120() FROM PUBLIC;
DROP TRIGGER private_cloud_run_origin ON workflow_runs;
CREATE TRIGGER private_cloud_run_origin BEFORE INSERT OR UPDATE ON workflow_runs FOR EACH ROW EXECUTE FUNCTION check_private_cloud_run_120();
