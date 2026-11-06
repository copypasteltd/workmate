-- A tool holds its existing FOR SHARE authority lock on tasks throughout the
-- transaction. Heartbeats must not contend for that task row. Desktop keeps
-- its authenticated native heartbeat contract and its original lease column.
CREATE TABLE cloud_task_leases (
 task_id uuid PRIMARY KEY, tenant_id uuid NOT NULL, actor_id uuid NOT NULL,
 attempt integer NOT NULL CHECK(attempt>0), fencing_token uuid NOT NULL,
 lease_until timestamptz NOT NULL, heartbeat_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,task_id) REFERENCES tasks(tenant_id,id) ON DELETE CASCADE,
 FOREIGN KEY(actor_id) REFERENCES users(id)
);
ALTER TABLE cloud_task_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE cloud_task_leases FORCE ROW LEVEL SECURITY;
CREATE POLICY cloud_lease_control ON cloud_task_leases TO cp_control USING(true) WITH CHECK(true);
CREATE POLICY cloud_lease_owner ON cloud_task_leases TO cp_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND actor_id=nullif(current_setting('app.actor_id',true),'')::uuid);
REVOKE ALL ON cloud_task_leases FROM PUBLIC,cp_app,cp_queue;
GRANT SELECT ON cloud_task_leases TO cp_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON cloud_task_leases TO cp_control;

CREATE FUNCTION task_live_lease_until(t public.tasks) RETURNS timestamptz
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT CASE WHEN actual.execution_location='desktop' THEN actual.lease_until
 WHEN actual.status<>'running' THEN NULL
 ELSE coalesce((SELECT l.lease_until FROM public.cloud_task_leases l
   WHERE l.task_id=actual.id AND l.tenant_id=actual.tenant_id AND l.actor_id=actual.created_by
     AND l.attempt=actual.attempt AND l.fencing_token=actual.fencing_token),'-infinity'::timestamptz) END
 FROM public.tasks actual WHERE actual.id=t.id AND actual.tenant_id=t.tenant_id
   AND actual.created_by=t.created_by AND actual.attempt=t.attempt
   AND actual.fencing_token IS NOT DISTINCT FROM t.fencing_token
$$;
ALTER FUNCTION task_live_lease_until(public.tasks) OWNER TO cp_control;
REVOKE ALL ON FUNCTION task_live_lease_until(public.tasks) FROM PUBLIC,cp_queue;
GRANT EXECUTE ON FUNCTION task_live_lease_until(public.tasks) TO cp_app,cp_control;

CREATE FUNCTION bind_cloud_task_lease() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.execution_location<>'cloud' OR NEW.status<>'running' THEN RETURN NEW; END IF;
 IF TG_OP='INSERT' OR OLD.status IS DISTINCT FROM NEW.status
   OR OLD.fencing_token IS DISTINCT FROM NEW.fencing_token OR OLD.attempt IS DISTINCT FROM NEW.attempt
   OR OLD.lease_until IS DISTINCT FROM NEW.lease_until THEN
  IF NEW.lease_until IS NULL OR NEW.fencing_token IS NULL OR NEW.attempt<1 THEN
   -- An explicit legacy/control invalidation remains effective. It never
   -- leaves a previously renewed side record capable of authorizing work.
   DELETE FROM public.cloud_task_leases WHERE task_id=NEW.id;
   RETURN NEW;
  END IF;
  INSERT INTO public.cloud_task_leases(task_id,tenant_id,actor_id,attempt,fencing_token,lease_until)
   VALUES(NEW.id,NEW.tenant_id,NEW.created_by,NEW.attempt,NEW.fencing_token,NEW.lease_until)
   ON CONFLICT(task_id) DO UPDATE SET attempt=excluded.attempt,fencing_token=excluded.fencing_token,
     lease_until=excluded.lease_until,heartbeat_at=clock_timestamp();
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION bind_cloud_task_lease() OWNER TO cp_control;
REVOKE ALL ON FUNCTION bind_cloud_task_lease() FROM PUBLIC,cp_app,cp_queue;
CREATE TRIGGER bind_cloud_task_lease AFTER INSERT OR UPDATE OF status,attempt,fencing_token,lease_until ON tasks
 FOR EACH ROW EXECUTE FUNCTION bind_cloud_task_lease();
-- Preserve live ownership during an application-only migration. No task is
-- restarted, replayed, given more budget, or revived after an expired deadline.
INSERT INTO cloud_task_leases(task_id,tenant_id,actor_id,attempt,fencing_token,lease_until)
 SELECT id,tenant_id,created_by,attempt,fencing_token,lease_until FROM tasks
 WHERE execution_location='cloud' AND status='running' AND attempt>0
   AND fencing_token IS NOT NULL AND lease_until IS NOT NULL;

CREATE FUNCTION renew_cloud_task_lease(p_task uuid,p_fencing uuid) RETURNS timestamptz
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE deadline timestamptz;
BEGIN
 -- UPDATE only the non-key lease fields: the task foreign key is not
 -- rechecked or locked. Existing source/role/plan authorization runs before
 -- this call; current ownership/authentication is checked here as well.
 UPDATE public.cloud_task_leases l SET lease_until=clock_timestamp()+interval '45 seconds',heartbeat_at=clock_timestamp()
 WHERE l.task_id=p_task AND l.fencing_token=p_fencing AND l.lease_until>clock_timestamp()
 AND l.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND l.actor_id=nullif(current_setting('app.actor_id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM public.tasks t JOIN public.users u ON u.id=t.created_by
   WHERE t.id=l.task_id AND t.tenant_id=l.tenant_id AND t.created_by=l.actor_id
     AND t.execution_location='cloud' AND t.status='running' AND t.attempt=l.attempt
     AND t.fencing_token=l.fencing_token AND t.content_state='active' AND NOT t.cancel_requested
     AND u.status='active' AND u.auth_version=t.actor_auth_version)
 RETURNING l.lease_until INTO deadline;
 RETURN deadline;
END $$;
ALTER FUNCTION renew_cloud_task_lease(uuid,uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION renew_cloud_task_lease(uuid,uuid) FROM PUBLIC,cp_queue;
GRANT EXECUTE ON FUNCTION renew_cloud_task_lease(uuid,uuid) TO cp_app;

-- Preserve every existing authorization, reservation, provider budget, input
-- checkpoint and private workflow predicate. Only replace the task deadline
-- expression; validation/video/audio jobs keep their independent leases.
DO $$ DECLARE f record; definition text; patched integer:=0; BEGIN
 FOR f IN SELECT p.oid,p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND p.proname=ANY(ARRAY[
  'admit_ai_gateway_request','dispatch_ai_gateway_request','admit_ai_input_count_request','dispatch_ai_input_count_request',
  'guard_task_tool_receipt','guard_paid_input_checkpoint','prepare_ai_video_job','prepare_ai_audio_job',
  'guard_audio_authorization','check_private_cloud_workflow']) LOOP
  definition:=pg_get_functiondef(f.oid);
  IF position('t.lease_until' IN definition)=0 THEN
   RAISE EXCEPTION 'Missing task lease predicate in %',f.proname;
  END IF;
  EXECUTE replace(replace(definition,'t.lease_until','public.task_live_lease_until(t)'),
   'public.task_live_lease_until(t)<=now()','public.task_live_lease_until(t)<=clock_timestamp()');
  patched:=patched+1;
 END LOOP;
 IF patched<>10 THEN RAISE EXCEPTION 'Expected ten task lease guard functions, got %',patched; END IF;
END $$;
INSERT INTO schema_migrations(version) VALUES(164);
