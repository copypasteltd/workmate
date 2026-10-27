ALTER TABLE tasks ADD COLUMN execution_class text NOT NULL DEFAULT 'text'
 CHECK(execution_class IN ('text','image','media'));
ALTER TABLE tasks ADD COLUMN capacity_wait_reason text
 CHECK(capacity_wait_reason IN ('platform','tenant','user','capability','tenant_media'));
ALTER TABLE tasks ADD COLUMN capacity_retry_at timestamptz NOT NULL DEFAULT now();
CREATE INDEX tasks_execution_capacity ON tasks(data_mode,tenant_id,created_by,execution_class)
 WHERE status IN ('running','reconciling') AND attempt>0;
CREATE INDEX outbox_fair_pending ON outbox(tenant_id,created_at,id) WHERE dispatched_at IS NULL;

-- Backfill conservatively from the installed role definitions. Ask/plan never
-- invoke generation tools. Unknown in-flight work continues to occupy capacity.
UPDATE tasks SET execution_class=CASE
 WHEN mode<>'execute' THEN 'text'
 WHEN role_key='video-motion' THEN 'media'
 WHEN role_key IN ('frontend','ui-ux','designer','brand-visual','ad-creative','ecommerce','social-content','illustration-ip','typography-layout','presentation','landing-page','information-design') THEN 'image'
 ELSE 'text' END;

CREATE TABLE execution_capacity_policy (
 data_mode text PRIMARY KEY CHECK(data_mode IN ('simulated','configured_services')),
 agent_slots integer NOT NULL DEFAULT 10 CHECK(agent_slots BETWEEN 1 AND 100),
 tenant_slots integer NOT NULL DEFAULT 2 CHECK(tenant_slots BETWEEN 1 AND 100),
 image_slots integer NOT NULL DEFAULT 2 CHECK(image_slots BETWEEN 1 AND 100),
 media_slots integer NOT NULL DEFAULT 2 CHECK(media_slots BETWEEN 1 AND 100),
 tenant_media_slots integer NOT NULL DEFAULT 1 CHECK(tenant_media_slots BETWEEN 1 AND 100),
 CHECK(tenant_slots<=agent_slots), CHECK(image_slots<=agent_slots), CHECK(media_slots<=agent_slots),
 CHECK(tenant_media_slots<=tenant_slots AND tenant_media_slots<=media_slots)
);
INSERT INTO execution_capacity_policy(data_mode) VALUES('simulated'),('configured_services');
REVOKE ALL ON execution_capacity_policy FROM PUBLIC,cp_app,cp_queue;
GRANT SELECT,UPDATE ON execution_capacity_policy TO cp_control;

-- Only the trusted worker invokes this function, after ordinary RLS/project,
-- Skill, plan and input checks. It reveals no cross-tenant counts or content.
-- The task row is locked before the shared admission lock everywhere; counts
-- and queued->running are committed together across all native worker processes.
CREATE FUNCTION claim_execution_capacity(p_task uuid,p_class text,p_user_limit integer,p_fencing uuid)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.tasks%ROWTYPE; p public.execution_capacity_policy%ROWTYPE;
 total integer; own_tenant integer; own_user integer; same_class integer; tenant_media integer; reason text;
BEGIN
 SELECT * INTO t FROM public.tasks WHERE id=p_task FOR UPDATE;
 IF NOT FOUND OR t.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
  OR t.created_by IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'')::uuid
  OR t.status<>'queued' OR t.attempt<>0 OR t.content_state<>'active' OR t.cancel_requested
  OR p_class NOT IN ('text','image','media') OR p_class IS NULL
  OR p_user_limit IS NULL OR p_user_limit NOT BETWEEN 1 AND 100 OR p_fencing IS NULL THEN
   RAISE EXCEPTION 'Execution admission context is invalid' USING ERRCODE='42501';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('execution-capacity:'||t.data_mode,0));
 SELECT * INTO p FROM public.execution_capacity_policy WHERE data_mode=t.data_mode;
 IF NOT FOUND THEN RAISE EXCEPTION 'Execution capacity is unavailable' USING ERRCODE='55000'; END IF;
 SELECT count(*),count(*) FILTER(WHERE tenant_id=t.tenant_id),
  count(*) FILTER(WHERE tenant_id=t.tenant_id AND created_by=t.created_by),
  count(*) FILTER(WHERE execution_class=p_class),
  count(*) FILTER(WHERE tenant_id=t.tenant_id AND execution_class='media')
 INTO total,own_tenant,own_user,same_class,tenant_media FROM public.tasks
 WHERE data_mode=t.data_mode AND status IN ('running','reconciling') AND attempt>0;
 reason:=CASE
  WHEN total>=p.agent_slots THEN 'platform'
  WHEN own_tenant>=p.tenant_slots THEN 'tenant'
  WHEN own_user>=p_user_limit THEN 'user'
  WHEN p_class='image' AND same_class>=p.image_slots THEN 'capability'
  WHEN p_class='media' AND same_class>=p.media_slots THEN 'capability'
  WHEN p_class='media' AND tenant_media>=p.tenant_media_slots THEN 'tenant_media'
  ELSE NULL END;
 IF reason IS NOT NULL THEN
  UPDATE public.tasks SET execution_class=p_class,capacity_wait_reason=reason,
   capacity_retry_at=now()+interval '2 seconds',next_claim_retry_at=now()+interval '1 minute',
   version=version+CASE WHEN capacity_wait_reason IS DISTINCT FROM reason THEN 1 ELSE 0 END,updated_at=now()
  WHERE id=p_task;
  RETURN reason;
 END IF;
 UPDATE public.tasks SET execution_class=p_class,status='running',attempt=attempt+1,fencing_token=p_fencing,
  lease_until=now()+interval '45 seconds',capacity_wait_reason=NULL,capacity_retry_at=now(),
  updated_at=now(),version=version+1 WHERE id=p_task;
 RETURN NULL;
END $$;
ALTER FUNCTION claim_execution_capacity(uuid,text,integer,uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION claim_execution_capacity(uuid,text,integer,uuid) FROM PUBLIC,cp_queue;
GRANT EXECUTE ON FUNCTION claim_execution_capacity(uuid,text,integer,uuid) TO cp_app;
INSERT INTO schema_migrations(version) VALUES(29);
