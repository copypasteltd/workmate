-- Append-only extension of SQL001-125: authenticated, privately approved event workflows.
CREATE TABLE cloud_event_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),project_id uuid NOT NULL,
 private_owner uuid NOT NULL REFERENCES users(id),origin_task_id uuid NOT NULL REFERENCES tasks(id),
 body jsonb NOT NULL,specification_hash text NOT NULL CHECK(specification_hash ~ '^[a-f0-9]{64}$'),
 request_input_hash text NOT NULL CHECK(request_input_hash ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','activated','declined')),
 content_state text NOT NULL DEFAULT 'active' CHECK(content_state IN('active','deleted')),
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),UNIQUE(tenant_id,project_id,id),
 UNIQUE(origin_task_id,request_input_hash)
);
CREATE TABLE cloud_event_triggers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,project_id uuid NOT NULL,
 private_owner uuid NOT NULL REFERENCES users(id),request_id uuid NOT NULL UNIQUE REFERENCES cloud_event_requests(id),
 name text NOT NULL,revision integer NOT NULL DEFAULT 1 CHECK(revision>0),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 key_version integer NOT NULL DEFAULT 1 CHECK(key_version>0),
 state text NOT NULL DEFAULT 'active' CHECK(state IN('active','paused','blocked','retired','ended')),
 content_state text NOT NULL DEFAULT 'active' CHECK(content_state IN('active','deleted')),
 last_error text,last_dispatched_at timestamptz,last_checked_at timestamptz NOT NULL DEFAULT '-infinity',created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id,request_id) REFERENCES cloud_event_requests(tenant_id,project_id,id),UNIQUE(tenant_id,project_id,id)
);
CREATE TABLE cloud_event_versions (
 trigger_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),tenant_id uuid NOT NULL,project_id uuid NOT NULL,
 private_owner uuid NOT NULL REFERENCES users(id),request_id uuid NOT NULL REFERENCES cloud_event_requests(id),
 body jsonb NOT NULL,specification_hash text NOT NULL CHECK(specification_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(trigger_id,revision),
 FOREIGN KEY(tenant_id,project_id,trigger_id) REFERENCES cloud_event_triggers(tenant_id,project_id,id)
);
CREATE TABLE cloud_event_keys (
 trigger_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),tenant_id uuid NOT NULL,project_id uuid NOT NULL,
 private_owner uuid NOT NULL REFERENCES users(id),sealed_secret text,created_at timestamptz NOT NULL DEFAULT now(),retired_at timestamptz,
 PRIMARY KEY(trigger_id,version),FOREIGN KEY(tenant_id,project_id,trigger_id) REFERENCES cloud_event_triggers(tenant_id,project_id,id),
 CHECK((retired_at IS NULL)=(sealed_secret IS NOT NULL))
);
CREATE TABLE cloud_event_inbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),trigger_id uuid NOT NULL,revision integer NOT NULL,key_version integer NOT NULL,
 tenant_id uuid NOT NULL,project_id uuid NOT NULL,private_owner uuid NOT NULL REFERENCES users(id),
 event_id text NOT NULL CHECK(length(event_id) BETWEEN 1 AND 128),event_type text NOT NULL,
 raw_sha256 text NOT NULL CHECK(raw_sha256 ~ '^[a-f0-9]{64}$'),data jsonb NOT NULL,
 occurred_at timestamptz NOT NULL,received_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','launched','ignored_type','ignored_inactive','expired','skipped_overlap','coalesced','skipped_limit','skipped_revision','blocked')),
 run_id uuid REFERENCES workflow_runs(id) DEFERRABLE INITIALLY DEFERRED,code text,launched_at timestamptz,
 content_state text NOT NULL DEFAULT 'active' CHECK(content_state IN('active','deleted')),
 FOREIGN KEY(tenant_id,project_id,trigger_id) REFERENCES cloud_event_triggers(tenant_id,project_id,id),
 FOREIGN KEY(trigger_id,revision) REFERENCES cloud_event_versions(trigger_id,revision),
 FOREIGN KEY(trigger_id,key_version) REFERENCES cloud_event_keys(trigger_id,version),UNIQUE(trigger_id,event_id),
 CHECK((state='launched')=(run_id IS NOT NULL)),CHECK((run_id IS NOT NULL)=(launched_at IS NOT NULL))
);
CREATE INDEX cloud_event_pending ON cloud_event_inbox(trigger_id,received_at,id) WHERE state='pending';
CREATE INDEX cloud_event_daily ON cloud_event_inbox(trigger_id,launched_at) WHERE state='launched';
ALTER TABLE workflow_runs ADD COLUMN cloud_event_trigger_id uuid REFERENCES cloud_event_triggers(id);
ALTER TABLE workflow_runs ADD COLUMN cloud_event_revision integer;
ALTER TABLE workflow_runs ADD COLUMN cloud_event_inbox_id uuid UNIQUE REFERENCES cloud_event_inbox(id);
ALTER TABLE workflow_runs ADD CONSTRAINT private_cloud_event_scope CHECK(
 (cloud_event_trigger_id IS NULL AND cloud_event_revision IS NULL AND cloud_event_inbox_id IS NULL) OR
 (cloud_event_trigger_id IS NOT NULL AND cloud_event_revision>0 AND cloud_event_inbox_id IS NOT NULL
  AND execution_location='cloud' AND private_owner=created_by AND schedule_id IS NULL AND cloud_schedule_id IS NULL));
DROP INDEX one_private_cloud_workflow_request;
CREATE UNIQUE INDEX one_private_cloud_workflow_request ON workflow_runs(origin_task_id,workflow_id,workflow_version)
 WHERE execution_location='cloud' AND private_owner IS NOT NULL AND cloud_schedule_id IS NULL AND cloud_event_trigger_id IS NULL;
CREATE UNIQUE INDEX one_private_cloud_event_active_run ON workflow_runs(cloud_event_trigger_id)
 WHERE cloud_event_trigger_id IS NOT NULL AND state IN('running','awaiting_approval');

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['cloud_event_requests','cloud_event_triggers','cloud_event_versions','cloud_event_keys','cloud_event_inbox'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY cloud_event_owner ON %I USING(current_user=''cp_control'' OR (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND private_owner=nullif(current_setting(''app.actor_id'',true),'''')::uuid)) WITH CHECK(current_user=''cp_control'' OR (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND private_owner=nullif(current_setting(''app.actor_id'',true),'''')::uuid))',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,cp_queue',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO cp_app,cp_control',t);
 END LOOP;
END $$;
-- The public ingress verifies signatures with the control identity. An app/tool cannot forge an inbox row.
REVOKE INSERT ON cloud_event_inbox FROM cp_app;

CREATE FUNCTION guard_cloud_event_records() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE q cloud_event_requests; s cloud_event_triggers;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Event authorization and receipt facts are immutable' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND coalesce(current_setting('app.erasing_content',true),'')='true' THEN
  IF TG_TABLE_NAME IN('cloud_event_requests','cloud_event_versions') THEN
   IF NEW.body='{}'::jsonb AND to_jsonb(NEW)-'body'-'content_state'=to_jsonb(OLD)-'body'-'content_state' THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='cloud_event_inbox' THEN
   IF NEW.data='{}'::jsonb AND NEW.content_state='deleted'
    AND to_jsonb(NEW)-'data'-'content_state'-'state'-'code'=to_jsonb(OLD)-'data'-'content_state'-'state'-'code'
    AND (NEW.state=OLD.state OR (OLD.state='pending' AND NEW.state='blocked' AND NEW.code='SOURCE_REMOVED')) THEN RETURN NEW; END IF;
  ELSIF TG_TABLE_NAME='cloud_event_triggers' THEN
   IF NEW.content_state='deleted' AND NEW.state='retired' AND NEW.version=OLD.version+1
    AND to_jsonb(NEW)-'name'-'state'-'content_state'-'last_error'-'version'=to_jsonb(OLD)-'name'-'state'-'content_state'-'last_error'-'version' THEN RETURN NEW; END IF;
  END IF;
 END IF;
 IF TG_TABLE_NAME='cloud_event_requests' THEN
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
     AND v.role_hashes=NEW.body->'role_hashes' AND v.source_refs=NEW.body->'source_refs'
     AND (NEW.body->>'origin_task_id')::uuid=t.id
     AND (NEW.body->>'max_budget_micros')::bigint=(SELECT coalesce(sum((step->>'budget_micros')::bigint),0)
       FROM jsonb_array_elements(v.definition->'steps') step WHERE step->>'kind'='codex')
     AND (NEW.body->>'max_daily_budget_micros')::bigint=(NEW.body->>'max_budget_micros')::bigint*(NEW.body->>'max_runs_per_day')::int) THEN
    RAISE EXCEPTION 'Invalid frozen event workflow request' USING ERRCODE='23514'; END IF;
  ELSIF ROW(NEW.id,NEW.tenant_id,NEW.project_id,NEW.private_owner,NEW.origin_task_id,NEW.body,NEW.specification_hash,NEW.request_input_hash,NEW.expires_at,NEW.created_at,NEW.content_state)
   IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.project_id,OLD.private_owner,OLD.origin_task_id,OLD.body,OLD.specification_hash,OLD.request_input_hash,OLD.expires_at,OLD.created_at,OLD.content_state)
   OR (NEW.state<>OLD.state AND (OLD.state<>'pending' OR NEW.state NOT IN('activated','declined'))) THEN
   RAISE EXCEPTION 'Event request cannot be rewritten' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='cloud_event_versions' THEN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Event version is immutable' USING ERRCODE='42501'; END IF;
  SELECT * INTO q FROM cloud_event_requests WHERE id=NEW.request_id;
  SELECT * INTO s FROM cloud_event_triggers WHERE id=NEW.trigger_id;
  IF ROW(NEW.tenant_id,NEW.project_id,NEW.private_owner,NEW.body,NEW.specification_hash)
   IS DISTINCT FROM ROW(q.tenant_id,q.project_id,q.private_owner,q.body,q.specification_hash)
   OR s.private_owner<>NEW.private_owner OR NEW.revision NOT IN(s.revision,s.revision+1) THEN
   RAISE EXCEPTION 'Event version differs from customer request' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='cloud_event_keys' THEN
  SELECT * INTO s FROM cloud_event_triggers WHERE id=NEW.trigger_id;
  IF TG_OP='INSERT' THEN
   IF ROW(NEW.tenant_id,NEW.project_id,NEW.private_owner) IS DISTINCT FROM ROW(s.tenant_id,s.project_id,s.private_owner)
    OR NEW.version NOT IN(s.key_version,s.key_version+1) OR NEW.retired_at IS NOT NULL THEN
    RAISE EXCEPTION 'Invalid event key scope' USING ERRCODE='23514'; END IF;
  ELSIF ROW(NEW.trigger_id,NEW.version,NEW.tenant_id,NEW.project_id,NEW.private_owner,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.trigger_id,OLD.version,OLD.tenant_id,OLD.project_id,OLD.private_owner,OLD.created_at)
   OR OLD.retired_at IS NOT NULL OR NEW.retired_at IS NULL OR NEW.sealed_secret IS NOT NULL THEN
   RAISE EXCEPTION 'Event keys can only be retired' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='cloud_event_inbox' THEN
  SELECT * INTO s FROM cloud_event_triggers WHERE id=NEW.trigger_id;
  IF TG_OP='INSERT' THEN
   IF ROW(NEW.tenant_id,NEW.project_id,NEW.private_owner) IS DISTINCT FROM ROW(s.tenant_id,s.project_id,s.private_owner)
    OR NEW.revision<>s.revision OR NEW.key_version<>s.key_version OR NEW.run_id IS NOT NULL OR NEW.content_state<>'active' THEN
    RAISE EXCEPTION 'Invalid authenticated inbox binding' USING ERRCODE='23514'; END IF;
  ELSIF ROW(NEW.id,NEW.trigger_id,NEW.revision,NEW.key_version,NEW.tenant_id,NEW.project_id,NEW.private_owner,NEW.event_id,NEW.event_type,NEW.raw_sha256,NEW.data,NEW.occurred_at,NEW.received_at,NEW.expires_at,NEW.content_state)
   IS DISTINCT FROM ROW(OLD.id,OLD.trigger_id,OLD.revision,OLD.key_version,OLD.tenant_id,OLD.project_id,OLD.private_owner,OLD.event_id,OLD.event_type,OLD.raw_sha256,OLD.data,OLD.occurred_at,OLD.received_at,OLD.expires_at,OLD.content_state)
   OR OLD.state<>'pending' OR NEW.state='pending' THEN
   RAISE EXCEPTION 'Terminal event receipts cannot be rewritten' USING ERRCODE='23514'; END IF;
 ELSE
  IF TG_OP='UPDATE' AND to_jsonb(NEW)-'last_checked_at'=to_jsonb(OLD)-'last_checked_at'
   AND NEW.last_checked_at>=OLD.last_checked_at THEN RETURN NEW; END IF;
  IF TG_OP='INSERT' THEN
   SELECT * INTO q FROM cloud_event_requests WHERE id=NEW.request_id;
   IF q.state<>'pending' OR q.expires_at<=clock_timestamp() OR q.content_state<>'active'
    OR ROW(q.tenant_id,q.project_id,q.private_owner) IS DISTINCT FROM ROW(NEW.tenant_id,NEW.project_id,NEW.private_owner) THEN
    RAISE EXCEPTION 'Event trigger needs a current private request' USING ERRCODE='23514'; END IF;
  ELSIF ROW(NEW.id,NEW.tenant_id,NEW.project_id,NEW.private_owner,NEW.request_id,NEW.created_at,NEW.content_state)
   IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.project_id,OLD.private_owner,OLD.request_id,OLD.created_at,OLD.content_state)
   OR NEW.version<>OLD.version+1 OR NEW.revision NOT IN(OLD.revision,OLD.revision+1)
   OR NEW.key_version NOT IN(OLD.key_version,OLD.key_version+1)
   OR (OLD.state IN('retired','ended') AND NEW.state<>OLD.state) THEN
   RAISE EXCEPTION 'Invalid event trigger transition' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_cloud_event_records() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_cloud_event_records() FROM PUBLIC;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['cloud_event_requests','cloud_event_triggers','cloud_event_versions','cloud_event_keys','cloud_event_inbox'] LOOP
  EXECUTE format('CREATE TRIGGER cloud_event_record_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_cloud_event_records()',t);
 END LOOP;
END $$;

-- Preserve the complete SQL120 guard, adding one independently bound ingress path.
DO $$ DECLARE definition text; anchor text; BEGIN
 definition:=pg_get_functiondef('check_private_cloud_run_120()'::regprocedure);
 definition:=replace(definition,'check_private_cloud_run_120()','check_private_cloud_run_126()');
 anchor:='IF NEW.cloud_schedule_occurrence_id IS NOT NULL THEN';
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Missing current cloud run insert guard'; END IF;
 definition:=replace(definition,anchor,$event$
 IF NEW.cloud_event_inbox_id IS NOT NULL THEN
  IF NOT EXISTS(SELECT 1 FROM cloud_event_inbox i JOIN cloud_event_triggers s ON s.id=i.trigger_id
   JOIN cloud_event_versions ev ON ev.trigger_id=s.id AND ev.revision=i.revision
   JOIN cloud_event_requests q ON q.id=ev.request_id JOIN tasks t ON t.id=(ev.body->>'origin_task_id')::uuid
   JOIN workflow_versions v ON v.workflow_id=(ev.body->>'workflow_id')::uuid AND v.version=(ev.body->>'workflow_version')::int
   WHERE i.id=NEW.cloud_event_inbox_id AND i.run_id=NEW.id AND i.state='launched' AND i.content_state='active'
    AND s.id=NEW.cloud_event_trigger_id AND s.revision=NEW.cloud_event_revision AND i.revision=s.revision AND s.state='active'
    AND s.private_owner=NEW.private_owner AND s.tenant_id=NEW.tenant_id AND s.project_id=NEW.project_id
    AND q.state='activated' AND ev.body->>'workflow_definition_hash'=v.definition_hash
    AND NEW.workflow_id=v.workflow_id AND NEW.workflow_version=v.version AND NEW.definition=v.definition AND NEW.role_hashes=v.role_hashes
    AND NEW.actor_auth_version=(ev.body->>'actor_auth_version')::int AND NEW.origin_task_id=t.id
    AND t.status='succeeded' AND NOT t.cancel_requested AND t.content_state='active' AND t.retention_expires_at>clock_timestamp()
    AND NEW.authorized_at IS NOT NULL) THEN
   RAISE EXCEPTION 'Event run requires a verified inbox and exact customer authorization' USING ERRCODE='23514'; END IF;
 ELSIF NEW.cloud_schedule_occurrence_id IS NOT NULL THEN
 $event$);
 anchor:='BEGIN';
 definition:=replace(definition,anchor,$event$BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.cloud_event_trigger_id,NEW.cloud_event_revision,NEW.cloud_event_inbox_id)
  IS DISTINCT FROM ROW(OLD.cloud_event_trigger_id,OLD.cloud_event_revision,OLD.cloud_event_inbox_id) THEN
  RAISE EXCEPTION 'Event run binding is immutable' USING ERRCODE='23514'; END IF;
 $event$);
 EXECUTE definition;
END $$;
ALTER FUNCTION check_private_cloud_run_126() OWNER TO cp_control;
REVOKE ALL ON FUNCTION check_private_cloud_run_126() FROM PUBLIC;
DROP TRIGGER private_cloud_run_origin ON workflow_runs;
CREATE TRIGGER private_cloud_run_origin BEFORE INSERT OR UPDATE ON workflow_runs FOR EACH ROW EXECUTE FUNCTION check_private_cloud_run_126();

CREATE FUNCTION erase_cloud_event_content(target uuid) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE old_flag text; patterns text[];
BEGIN
 old_flag:=coalesce(current_setting('app.erasing_content',true),'false');
 PERFORM set_config('app.erasing_content','true',true);
 SELECT array_agg('%'||id||'%') INTO patterns FROM (
  SELECT target::text AS id UNION SELECT request_id::text FROM cloud_event_versions WHERE trigger_id=target
 ) ids;
 UPDATE request_replays SET response='{}',revoked_at=clock_timestamp() WHERE revoked_at IS NULL AND response::text LIKE ANY(patterns);
 UPDATE cloud_event_keys SET sealed_secret=NULL,retired_at=clock_timestamp() WHERE trigger_id=target AND retired_at IS NULL;
 UPDATE cloud_event_versions SET body='{}' WHERE trigger_id=target AND body<>'{}'::jsonb;
 UPDATE cloud_event_requests q SET body='{}',content_state='deleted' WHERE q.id IN(SELECT request_id FROM cloud_event_versions WHERE trigger_id=target) AND content_state='active';
 UPDATE cloud_event_inbox SET data='{}',content_state='deleted',state=CASE WHEN state='pending' THEN 'blocked' ELSE state END,
  code=CASE WHEN state='pending' THEN 'SOURCE_REMOVED' ELSE code END WHERE trigger_id=target AND content_state='active';
 UPDATE cloud_event_triggers SET name='[Removed]',state='retired',content_state='deleted',last_error='SOURCE_REMOVED',version=version+1 WHERE id=target AND content_state='active';
 PERFORM set_config('app.erasing_content',old_flag,true);
END $$;
ALTER FUNCTION erase_cloud_event_content(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION erase_cloud_event_content(uuid) FROM PUBLIC,cp_app,cp_queue;

CREATE FUNCTION cascade_cloud_event_erasure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE item record; old_flag text;
BEGIN
 old_flag:=coalesce(current_setting('app.erasing_content',true),'false');
 IF NEW.content_state<>'active' THEN
  UPDATE request_replays SET response='{}',revoked_at=clock_timestamp() WHERE revoked_at IS NULL AND response::text LIKE '%'||NEW.id::text||'%';
  FOR item IN SELECT DISTINCT ev.trigger_id FROM cloud_event_versions ev
   WHERE (TG_TABLE_NAME='tasks' AND ev.body->>'origin_task_id'=NEW.id::text)
    OR (TG_TABLE_NAME='workflows' AND ev.body->>'workflow_id'=NEW.id::text) LOOP
   PERFORM erase_cloud_event_content(item.trigger_id);
  END LOOP;
  IF TG_TABLE_NAME='tasks' THEN
   PERFORM set_config('app.erasing_content','true',true);
   UPDATE cloud_event_requests SET body='{}',content_state='deleted' WHERE origin_task_id=NEW.id AND content_state='active';
  END IF;
 END IF;
 PERFORM set_config('app.erasing_content',old_flag,true);
 RETURN NEW;
END $$;
ALTER FUNCTION cascade_cloud_event_erasure() OWNER TO cp_control;
REVOKE ALL ON FUNCTION cascade_cloud_event_erasure() FROM PUBLIC;
CREATE TRIGGER erase_task_event_content AFTER UPDATE OF content_state ON tasks FOR EACH ROW EXECUTE FUNCTION cascade_cloud_event_erasure();
CREATE TRIGGER erase_workflow_event_content AFTER UPDATE OF content_state ON workflows FOR EACH ROW EXECUTE FUNCTION cascade_cloud_event_erasure();
