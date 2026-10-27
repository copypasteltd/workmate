-- Keep the original capacity limits and atomic admission. Add only a completed,
-- measured same-task checkpoint as another eligible queued execution boundary.
CREATE OR REPLACE FUNCTION claim_execution_capacity(p_task uuid,p_class text,p_user_limit integer,p_fencing uuid)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.tasks%ROWTYPE; p public.execution_capacity_policy%ROWTYPE;
 total integer; own_tenant integer; own_user integer; same_class integer; tenant_media integer; reason text;
BEGIN
 SELECT * INTO t FROM public.tasks WHERE id=p_task FOR UPDATE;
 IF NOT FOUND OR t.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
  OR t.created_by IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'')::uuid
  OR t.status<>'queued' OR t.content_state<>'active' OR t.cancel_requested
  OR (t.attempt<>0 AND NOT EXISTS(
   SELECT 1 FROM public.task_input_checkpoints c JOIN public.reservations r ON r.task_id=c.task_id
   WHERE c.task_id=t.id AND c.attempt=t.attempt AND c.state='queued' AND c.fencing_token=t.fencing_token
    AND c.runtime_thread=t.runtime_thread AND c.runtime_turn=t.runtime_turn AND c.ready_at IS NOT NULL
    AND c.input_tokens=t.input_tokens AND c.output_tokens=t.output_tokens AND c.accrued_micros=t.accrued_micros
    AND c.accrued_micros<=t.budget_micros AND r.status='reserved' AND r.amount_micros=t.budget_micros
    AND NOT EXISTS(SELECT 1 FROM public.task_dependencies d WHERE d.task_id=t.id AND d.state<>'resolved')
    AND NOT EXISTS(SELECT 1 FROM public.tool_operations o WHERE o.task_id=t.id AND o.state IN('accepted','reconciling'))
    AND NOT EXISTS(SELECT 1 FROM public.device_commands d WHERE d.task_id=t.id AND d.state IN('pending','claimed'))
    AND NOT EXISTS(SELECT 1 FROM public.current_ai_provider_requests q WHERE q.task_id=t.id AND (q.state='dispatched' OR (q.state='unknown' AND q.cost_state='unknown')))
    AND NOT EXISTS(SELECT 1 FROM public.ai_request_budget_violations v JOIN public.ai_gateway_requests q ON q.id=v.provider_request_id WHERE q.task_id=t.id)
    AND public.task_content_sources_available(t.id)))
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
INSERT INTO schema_migrations(version) VALUES(89);
