-- A local task keeps the existing hold, pricing, metering and ledger. It never
-- becomes cloud queue work, including through stale delivery or recovery.
ALTER TABLE tasks ADD COLUMN execution_location text NOT NULL DEFAULT 'cloud'
 CHECK(execution_location IN ('cloud','desktop'));

CREATE TABLE desktop_executions (
 task_id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL, project_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES users(id),
 device_id uuid NOT NULL, local_session_id uuid NOT NULL, native_family_id uuid NOT NULL,
 workspace_hash text NOT NULL CHECK(workspace_hash ~ '^[a-f0-9]{64}$'),
 runtime_sha256 text NOT NULL CHECK(runtime_sha256 ~ '^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN ('prepared','running','stopping','finished','reconciling')),
 credential_cipher text, credential_hash text UNIQUE, credential_expires_at timestamptz,
 started_at timestamptz, finished_at timestamptz, client_report jsonb,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,task_id) REFERENCES tasks(tenant_id,id),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 CHECK((credential_cipher IS NULL)=(credential_hash IS NULL)),
 CHECK((credential_cipher IS NULL)=(credential_expires_at IS NULL)),
 CHECK(state<>'running' OR (credential_hash IS NOT NULL AND started_at IS NOT NULL))
);
CREATE UNIQUE INDEX desktop_one_active_session ON desktop_executions(local_session_id)
 WHERE state IN ('prepared','running','stopping','reconciling');
CREATE INDEX desktop_actor_history ON desktop_executions(tenant_id,project_id,actor_id,created_at DESC);
ALTER TABLE desktop_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE desktop_executions FORCE ROW LEVEL SECURITY;
CREATE POLICY desktop_control ON desktop_executions TO cp_control USING(true) WITH CHECK(true);
CREATE POLICY desktop_owner ON desktop_executions TO cp_app
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND actor_id=nullif(current_setting('app.actor_id',true),'')::uuid
  AND EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id AND t.content_state='active'))
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND actor_id=nullif(current_setting('app.actor_id',true),'')::uuid
  AND EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id AND t.content_state='active'));
GRANT SELECT,INSERT,UPDATE ON desktop_executions TO cp_app,cp_control;

CREATE FUNCTION guard_desktop_execution() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE t tasks; previous desktop_executions;
BEGIN
 IF TG_OP<>'INSERT' THEN
  IF TG_OP='DELETE' OR ROW(OLD.task_id,OLD.tenant_id,OLD.project_id,OLD.actor_id,OLD.device_id,
   OLD.local_session_id,OLD.native_family_id,OLD.workspace_hash,OLD.runtime_sha256,OLD.created_at)
   IS DISTINCT FROM ROW(NEW.task_id,NEW.tenant_id,NEW.project_id,NEW.actor_id,NEW.device_id,
   NEW.local_session_id,NEW.native_family_id,NEW.workspace_hash,NEW.runtime_sha256,NEW.created_at)
   OR (OLD.state IN ('finished','reconciling') AND OLD IS DISTINCT FROM NEW) THEN
   RAISE EXCEPTION 'Immutable desktop execution ownership' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 SELECT * INTO t FROM tasks WHERE id=NEW.task_id;
 IF t.execution_location IS DISTINCT FROM 'desktop' OR t.tenant_id IS DISTINCT FROM NEW.tenant_id
  OR t.project_id IS DISTINCT FROM NEW.project_id OR t.created_by IS DISTINCT FROM NEW.actor_id
  OR t.private_owner IS DISTINCT FROM NEW.actor_id OR t.status<>'queued' OR t.attempt<>0
  OR NEW.state<>'prepared' OR NEW.credential_hash IS NOT NULL OR NEW.client_report IS NOT NULL THEN
  RAISE EXCEPTION 'Invalid local task owner' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('desktop-session:'||NEW.local_session_id::text,0));
 SELECT * INTO previous FROM desktop_executions WHERE local_session_id=NEW.local_session_id LIMIT 1;
 IF FOUND AND ROW(previous.tenant_id,previous.project_id,previous.actor_id,previous.device_id,
  previous.workspace_hash,previous.runtime_sha256,previous.native_family_id)
  IS DISTINCT FROM ROW(NEW.tenant_id,NEW.project_id,NEW.actor_id,NEW.device_id,
  NEW.workspace_hash,NEW.runtime_sha256,NEW.native_family_id) THEN
  RAISE EXCEPTION 'Local session binding is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_desktop_execution() OWNER TO cp_control;
CREATE TRIGGER desktop_execution_guard BEFORE INSERT OR UPDATE OR DELETE ON desktop_executions
 FOR EACH ROW EXECUTE FUNCTION guard_desktop_execution();

CREATE FUNCTION guard_task_execution_location() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.execution_location IS DISTINCT FROM NEW.execution_location THEN
  RAISE EXCEPTION 'Execution placement is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.execution_location='desktop' AND NEW.private_owner IS DISTINCT FROM NEW.created_by THEN
  RAISE EXCEPTION 'Local tasks are private to their operator' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task_execution_location_guard BEFORE INSERT OR UPDATE ON tasks
 FOR EACH ROW EXECUTE FUNCTION guard_task_execution_location();
CREATE FUNCTION assert_desktop_owner_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.execution_location='desktop' AND NOT EXISTS(SELECT 1 FROM desktop_executions WHERE task_id=NEW.id) THEN
  RAISE EXCEPTION 'A local task requires its execution owner' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER desktop_owner_record AFTER INSERT ON tasks DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION assert_desktop_owner_record();
CREATE FUNCTION reject_local_cloud_dispatch() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
BEGIN
 IF NEW.topic='task.run' AND EXISTS(SELECT 1 FROM tasks WHERE id::text=NEW.payload->>'task_id' AND execution_location='desktop') THEN
  RAISE EXCEPTION 'Local execution cannot enter the cloud queue' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION reject_local_cloud_dispatch() OWNER TO cp_control;
CREATE TRIGGER local_dispatch_guard BEFORE INSERT OR UPDATE ON outbox
 FOR EACH ROW EXECUTE FUNCTION reject_local_cloud_dispatch();

-- Preserve v89 admission byte-for-byte as the shared capacity implementation.
-- Only these placement-specific entry points can call it after this migration.
ALTER FUNCTION claim_execution_capacity(uuid,text,integer,uuid) RENAME TO claim_execution_capacity_v89;
REVOKE ALL ON FUNCTION claim_execution_capacity_v89(uuid,text,integer,uuid) FROM PUBLIC,cp_app,cp_queue;
CREATE FUNCTION claim_execution_capacity(p_task uuid,p_class text,p_limit integer,p_nonce uuid)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM tasks WHERE id=p_task AND execution_location='cloud') THEN
  RAISE EXCEPTION 'Cloud admission cannot own local work' USING ERRCODE='42501'; END IF;
 RETURN claim_execution_capacity_v89(p_task,p_class,p_limit,p_nonce);
END $$;
CREATE FUNCTION claim_desktop_capacity(p_task uuid,p_device uuid,p_limit integer,p_nonce uuid)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM desktop_executions d JOIN tasks t ON t.id=d.task_id
  WHERE d.task_id=p_task AND d.device_id=p_device AND d.state='prepared' AND t.execution_location='desktop'
   AND d.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
   AND d.actor_id=nullif(current_setting('app.actor_id',true),'')::uuid) THEN
  RAISE EXCEPTION 'Local admission requires its owner' USING ERRCODE='42501'; END IF;
 RETURN claim_execution_capacity_v89(p_task,'text',p_limit,p_nonce);
END $$;
ALTER FUNCTION claim_execution_capacity(uuid,text,integer,uuid) OWNER TO cp_control;
ALTER FUNCTION claim_desktop_capacity(uuid,uuid,integer,uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION claim_execution_capacity(uuid,text,integer,uuid) FROM PUBLIC,cp_queue;
REVOKE ALL ON FUNCTION claim_desktop_capacity(uuid,uuid,integer,uuid) FROM PUBLIC,cp_queue;
GRANT EXECUTE ON FUNCTION claim_execution_capacity(uuid,text,integer,uuid),claim_desktop_capacity(uuid,uuid,integer,uuid) TO cp_app;
INSERT INTO schema_migrations(version) VALUES(92);
