-- Preserve exact-count allocations; new pinned native code-mode requests can
-- pre-fund a conservative input ceiling derived from complete serialized bytes.
-- Count proof, hash, actor, release, wallet and platform limits remain mandatory.
ALTER TABLE ai_request_budget_allocations ADD COLUMN input_bound_mode text NOT NULL DEFAULT 'exact'
 CHECK(input_bound_mode IN ('exact','serialized_ceiling'));
CREATE FUNCTION allocate_ai_generation_budget(p_request uuid,p_nonce uuid,p_count uuid,p_max_output integer,p_input_ceiling bigint) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.ai_gateway_requests%ROWTYPE; e public.ai_request_budget_envelopes%ROWTYPE;
 c public.ai_input_count_requests%ROWTYPE; p public.ai_provider_budget_policies%ROWTYPE;
 a public.ai_request_budget_allocations%ROWTYPE; period_id uuid; period_limit bigint;
 amount numeric; denied text; mode text; input_bound bigint;
BEGIN
 SELECT data_mode INTO mode FROM public.ai_gateway_requests WHERE id=p_request AND execution_nonce=p_nonce;
 IF mode IS NULL THEN RAISE EXCEPTION 'Invalid provider budget context' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ai-gateway:'||mode,0));
 SELECT * INTO STRICT r FROM public.ai_gateway_requests WHERE id=p_request AND execution_nonce=p_nonce FOR UPDATE;
 IF r.state<>'prepared' OR r.data_mode IS DISTINCT FROM current_setting('app.data_mode',true)
  OR r.actor_id IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'')::uuid
  OR (r.subject_kind='validation' AND session_user<>'cp_control')
  OR (r.subject_kind='task' AND (r.task_id IS DISTINCT FROM nullif(current_setting('app.task_id',true),'')::uuid
    OR r.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid)) THEN
  RAISE EXCEPTION 'Invalid provider budget actor' USING ERRCODE='42501'; END IF;
 SELECT * INTO e FROM public.ai_request_budget_envelopes WHERE data_mode=r.data_mode AND subject_kind=r.subject_kind
   AND (task_id=r.task_id OR validation_id=r.validation_id);
 IF e.id IS NULL THEN denied:='BUDGET_BOUNDARY_MISSING';
 ELSIF public.ai_budget_subject_blocked(e.id) THEN denied:='BUDGET_RECONCILIATION_REQUIRED';
 END IF;
 IF r.request_class='text' THEN
  SELECT * INTO c FROM public.ai_input_count_requests WHERE id=p_count;
  IF NOT (c.id IS NOT NULL AND c.state='completed' AND c.usage_known AND c.generation_operation_id=r.operation_id
   AND c.generation_hash=r.request_hash AND c.data_mode=r.data_mode AND c.subject_kind=r.subject_kind
   AND c.actor_id=r.actor_id AND c.model_alias=r.model_alias
   AND c.task_id IS NOT DISTINCT FROM r.task_id AND c.validation_id IS NOT DISTINCT FROM r.validation_id
   AND c.capability_version_id IS NOT DISTINCT FROM r.capability_version_id AND c.release_id IS NOT DISTINCT FROM r.release_id
   AND c.attempt IS NOT DISTINCT FROM r.attempt AND c.fencing_token IS NOT DISTINCT FROM r.fencing_token
   AND p_max_output BETWEEN 16 AND 131072) IS TRUE THEN denied:=coalesce(denied,'INPUT_COUNT_REQUIRED');
  ELSE
   input_bound:=coalesce(p_input_ceiling,c.counted_input_tokens);
   IF p_input_ceiling IS NOT NULL AND p_input_ceiling IS DISTINCT FROM greatest(c.counted_input_tokens,r.request_bytes::bigint) THEN
    denied:=coalesce(denied,'INVALID_INPUT_BOUND'); END IF;
   amount:=input_bound::numeric*(r.rate_snapshot->>0)::numeric+p_max_output::numeric*(r.rate_snapshot->>1)::numeric;
  END IF;
 ELSE
  IF p_count IS NOT NULL OR p_max_output IS NOT NULL OR p_input_ceiling IS NOT NULL THEN denied:=coalesce(denied,'INVALID_IMAGE_BUDGET'); END IF;
  amount:=(r.rate_snapshot->>0)::numeric*1000000;
 END IF;
 SELECT * INTO a FROM public.ai_request_budget_allocations WHERE provider_request_id=r.id;
 IF a.id IS NOT NULL THEN
  IF a.input_count_id IS DISTINCT FROM p_count OR a.max_output_tokens IS DISTINCT FROM p_max_output
   OR a.input_bound_mode IS DISTINCT FROM (CASE WHEN p_input_ceiling IS NULL THEN 'exact' ELSE 'serialized_ceiling' END)
   OR a.input_tokens_bound IS DISTINCT FROM input_bound THEN
   RAISE EXCEPTION 'Immutable provider allocation' USING ERRCODE='23514'; END IF;
  RETURN jsonb_build_object('allowed',true);
 END IF;
 IF denied IS NULL AND r.subject_kind='task' AND NOT EXISTS(SELECT 1 FROM public.reservations v
   WHERE v.task_id=r.task_id AND v.status='reserved' AND v.amount_micros=e.amount_micros) THEN denied:='BUDGET_RESERVATION_CHANGED'; END IF;
 IF denied IS NULL AND public.ai_budget_used(e.id,NULL)+amount>e.amount_micros::numeric*1000000 THEN denied:='BUDGET_EXHAUSTED'; END IF;
 IF denied IS NULL AND r.subject_kind='validation' THEN
  SELECT b.* INTO STRICT p FROM public.ai_provider_budget_heads h JOIN public.ai_provider_budget_policies b ON b.id=h.policy_id WHERE h.data_mode=mode;
  IF public.ai_budget_used(e.id,NULL)+amount>p.verification_run_micros::numeric*1000000 THEN denied:='VERIFICATION_BUDGET_EXHAUSTED'; END IF;
  period_id:=public.ai_platform_budget_period(mode,'verification');
  SELECT least(amount_micros,p.verification_daily_micros) INTO STRICT period_limit FROM public.ai_platform_budget_periods WHERE id=period_id;
  IF public.ai_budget_used(NULL,period_id)+amount>period_limit::numeric*1000000 THEN denied:='PLATFORM_BUDGET_EXHAUSTED'; END IF;
 END IF;
 IF denied IS NOT NULL THEN
  UPDATE public.ai_gateway_requests SET state='cancelled',finished_at=clock_timestamp(),released_at=clock_timestamp(),usage_known=true,
   input_tokens=0,output_tokens=0,image_units=0,known_charge_micros=0,charge_numerator=0,outcome_code=denied WHERE id=r.id;
  INSERT INTO public.ai_gateway_request_events(request_id,state,body) VALUES(r.id,'cancelled',jsonb_build_object('code',denied));
  RETURN jsonb_build_object('allowed',false,'reason',denied);
 END IF;
 INSERT INTO public.ai_request_budget_allocations(provider_request_id,envelope_id,platform_period_id,input_count_id,input_tokens_bound,max_output_tokens,amount_numerator,input_bound_mode)
  VALUES(r.id,e.id,period_id,p_count,input_bound,p_max_output,amount,CASE WHEN p_input_ceiling IS NULL THEN 'exact' ELSE 'serialized_ceiling' END);
 RETURN jsonb_build_object('allowed',true);
END $$;
ALTER FUNCTION allocate_ai_generation_budget(uuid,uuid,uuid,integer,bigint) OWNER TO cp_control;
REVOKE ALL ON FUNCTION allocate_ai_generation_budget(uuid,uuid,uuid,integer,bigint) FROM PUBLIC,cp_queue;
GRANT EXECUTE ON FUNCTION allocate_ai_generation_budget(uuid,uuid,uuid,integer,bigint) TO cp_app,cp_control;

CREATE OR REPLACE FUNCTION guard_ai_generation_budget() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE a public.ai_request_budget_allocations%ROWTYPE; violation text;
BEGIN
 IF NEW.state='dispatched' AND NOT EXISTS(SELECT 1 FROM public.ai_request_budget_allocations WHERE provider_request_id=NEW.id) THEN
  RAISE EXCEPTION 'A provider dispatch requires its original budget allocation' USING ERRCODE='23514'; END IF;
 IF NEW.state='completed' AND OLD.state<>'completed' THEN
  SELECT * INTO a FROM public.ai_request_budget_allocations WHERE provider_request_id=NEW.id;
  IF a.id IS NOT NULL THEN
   violation:=CASE WHEN a.input_count_id IS NOT NULL AND ((a.input_bound_mode='exact' AND NEW.input_tokens<>a.input_tokens_bound)
      OR (a.input_bound_mode='serialized_ceiling' AND NEW.input_tokens>a.input_tokens_bound)) THEN 'INPUT_COUNT_MISMATCH'
    WHEN a.max_output_tokens IS NOT NULL AND NEW.output_tokens>a.max_output_tokens THEN 'OUTPUT_LIMIT_EXCEEDED'
    WHEN NEW.charge_numerator>a.amount_numerator THEN 'ALLOCATION_EXCEEDED' END;
   IF violation IS NOT NULL THEN INSERT INTO public.ai_request_budget_violations(provider_request_id,envelope_id,code)
    VALUES(NEW.id,a.envelope_id,violation) ON CONFLICT(provider_request_id) DO NOTHING; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;



-- Existing callers and historical exact-count semantics remain compatible.
CREATE OR REPLACE FUNCTION allocate_ai_generation_budget(p_request uuid,p_nonce uuid,p_count uuid,p_max_output integer) RETURNS jsonb
 LANGUAGE sql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.allocate_ai_generation_budget(p_request,p_nonce,p_count,p_max_output,NULL::bigint)
$$;
ALTER FUNCTION allocate_ai_generation_budget(uuid,uuid,uuid,integer) OWNER TO cp_control;
REVOKE ALL ON FUNCTION allocate_ai_generation_budget(uuid,uuid,uuid,integer) FROM PUBLIC,cp_queue;
GRANT EXECUTE ON FUNCTION allocate_ai_generation_budget(uuid,uuid,uuid,integer) TO cp_app,cp_control;
