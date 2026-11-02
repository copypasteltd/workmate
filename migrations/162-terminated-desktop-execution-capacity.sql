-- Execution admission and unresolved financial liabilities are different facts.
-- Only a terminal desktop inference credential, an absent lease and independently
-- released provider requests permit a reconciling task to stop consuming slots.
-- Its reservation, unknown provider cost, task status and ledger remain intact.
CREATE FUNCTION task_occupies_execution_slot(t public.tasks) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 -- A caller cannot supply fabricated ownership or terminal fields. Normal
 -- callers obtain the complete row through their existing task RLS policy.
 SELECT CASE WHEN NOT EXISTS(SELECT 1 FROM public.tasks actual WHERE actual.id=t.id AND actual IS NOT DISTINCT FROM t) THEN true
 WHEN t.status<>'reconciling' THEN t.status='running' AND t.attempt>0
 ELSE NOT (
   t.execution_location='desktop' AND t.attempt>0 AND t.lease_until IS NULL
   AND EXISTS(SELECT 1 FROM public.desktop_executions d WHERE d.task_id=t.id
     AND d.state IN ('finished','reconciling') AND d.finished_at IS NOT NULL)
   AND NOT EXISTS(SELECT 1 FROM public.current_ai_provider_requests r
     WHERE r.task_id=t.id AND r.capacity_held)
   AND NOT EXISTS(SELECT 1 FROM public.ai_video_jobs v WHERE v.task_id=t.id
     AND (NOT v.usage_known OR v.state NOT IN ('completed','failed','cancelled')))
   AND NOT EXISTS(SELECT 1 FROM public.current_audio_accounting_requests a WHERE a.task_id=t.id AND a.capacity_held)
   AND NOT EXISTS(SELECT 1 FROM public.tool_operations o WHERE o.task_id=t.id
     AND o.state IN ('accepted','reconciling') AND NOT EXISTS(
       SELECT 1 FROM public.current_ai_provider_requests r
       WHERE r.task_id=t.id AND r.channel='generation' AND r.operation_id=o.id::text AND NOT r.capacity_held))
   AND NOT EXISTS(SELECT 1 FROM public.device_commands d WHERE d.task_id=t.id AND d.state IN ('pending','claimed'))
 ) AND t.attempt>0 END
$$;
ALTER FUNCTION task_occupies_execution_slot(public.tasks) OWNER TO cp_control;
REVOKE ALL ON FUNCTION task_occupies_execution_slot(public.tasks) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION task_occupies_execution_slot(public.tasks) TO cp_app,cp_control;

DO $$ DECLARE definition text; anchor text; BEGIN
 definition:=pg_get_functiondef('claim_execution_capacity_v89(uuid,text,integer,uuid)'::regprocedure);
 anchor:='WHERE data_mode=t.data_mode AND status IN (''running'',''reconciling'') AND attempt>0';
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Capacity predicate anchor missing'; END IF;
 EXECUTE replace(definition,anchor,'WHERE data_mode=t.data_mode AND public.task_occupies_execution_slot(tasks)');
END $$;
INSERT INTO schema_migrations(version) VALUES(162);
