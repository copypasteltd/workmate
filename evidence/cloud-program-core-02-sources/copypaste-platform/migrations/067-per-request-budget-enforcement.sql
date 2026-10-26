-- Additive monetary controls. SQL001-066 and original table rows remain intact.
CREATE TABLE ai_provider_budget_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 data_mode text NOT NULL CHECK(data_mode IN ('simulated','configured_services')),
 fingerprint text NOT NULL CHECK(fingerprint ~ '^[a-f0-9]{64}$'),
 count_verified boolean NOT NULL,
 count_price_micros bigint CHECK(count_price_micros BETWEEN 0 AND 9007199254740991),
 verification_run_micros bigint NOT NULL CHECK(verification_run_micros BETWEEN 1 AND 9007199254740991),
 verification_daily_micros bigint NOT NULL CHECK(verification_daily_micros BETWEEN 1 AND 9007199254740991),
 counting_daily_micros bigint NOT NULL CHECK(counting_daily_micros BETWEEN 1 AND 9007199254740991),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(NOT count_verified OR count_price_micros IS NOT NULL),
 UNIQUE(data_mode,fingerprint), UNIQUE(id,data_mode)
);
CREATE TABLE ai_provider_budget_heads (
 data_mode text PRIMARY KEY CHECK(data_mode IN ('simulated','configured_services')),
 policy_id uuid NOT NULL,
 FOREIGN KEY(policy_id,data_mode) REFERENCES ai_provider_budget_policies(id,data_mode)
);
CREATE TABLE ai_request_budget_envelopes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 data_mode text NOT NULL CHECK(data_mode IN ('simulated','configured_services')),
 subject_kind text NOT NULL CHECK(subject_kind IN ('task','validation')),
 task_id uuid UNIQUE REFERENCES tasks(id),
 validation_id uuid UNIQUE REFERENCES capability_validations(id),
 amount_micros bigint NOT NULL CHECK(amount_micros BETWEEN 1 AND 9007199254740991),
 policy_id uuid REFERENCES ai_provider_budget_policies(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((subject_kind='task' AND task_id IS NOT NULL AND validation_id IS NULL AND policy_id IS NULL)
    OR (subject_kind='validation' AND task_id IS NULL AND validation_id IS NOT NULL AND policy_id IS NOT NULL))
);
CREATE TABLE ai_platform_budget_periods (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 data_mode text NOT NULL CHECK(data_mode IN ('simulated','configured_services')),
 purpose text NOT NULL CHECK(purpose IN ('input_count','verification')),
 utc_day date NOT NULL,
 policy_id uuid NOT NULL REFERENCES ai_provider_budget_policies(id),
 amount_micros bigint NOT NULL CHECK(amount_micros BETWEEN 1 AND 9007199254740991),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(data_mode,purpose,utc_day)
);
CREATE TABLE ai_input_count_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 execution_nonce uuid NOT NULL DEFAULT gen_random_uuid(),
 operation_id text NOT NULL CHECK(operation_id ~ '^[a-zA-Z0-9_:-]{16,128}$'),
 generation_operation_id text NOT NULL CHECK(generation_operation_id ~ '^[a-zA-Z0-9_:-]{16,128}$'),
 generation_hash text NOT NULL CHECK(generation_hash ~ '^[a-f0-9]{64}$'),
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 request_bytes integer NOT NULL CHECK(request_bytes BETWEEN 1 AND 40000000),
 data_mode text NOT NULL CHECK(data_mode IN ('simulated','configured_services')),
 subject_kind text NOT NULL CHECK(subject_kind IN ('task','validation')),
 task_id uuid REFERENCES tasks(id), validation_id uuid REFERENCES capability_validations(id),
 tenant_id uuid REFERENCES tenants(id), project_id uuid REFERENCES projects(id),
 actor_id uuid NOT NULL, attempt integer CHECK(attempt>0), fencing_token uuid,
 capability_version_id uuid REFERENCES internal_capability_versions(id),
 release_id uuid REFERENCES capability_releases(id),
 model_alias text NOT NULL CHECK(length(model_alias) BETWEEN 1 AND 200),
 policy_version_id uuid NOT NULL REFERENCES ai_gateway_policy_versions(id),
 dispatch_policy_version_id uuid REFERENCES ai_gateway_policy_versions(id),
 budget_policy_id uuid NOT NULL REFERENCES ai_provider_budget_policies(id),
 price_micros bigint CHECK(price_micros BETWEEN 0 AND 9007199254740991),
 state text NOT NULL CHECK(state IN ('prepared','dispatched','completed','unknown','cancelled','denied')),
 prepared_until timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 dispatched_at timestamptz, finished_at timestamptz, released_at timestamptz,
 usage_known boolean NOT NULL DEFAULT false,
 counted_input_tokens bigint CHECK(counted_input_tokens BETWEEN 0 AND 9007199254740991),
 charge_numerator numeric(40,0) CHECK(charge_numerator>=0),
 http_status integer CHECK(http_status BETWEEN 100 AND 599),
 outcome_code text CHECK(outcome_code ~ '^[A-Z0-9_]{1,100}$'),
 UNIQUE(data_mode,operation_id), UNIQUE(data_mode,generation_operation_id),
 CHECK((subject_kind='task' AND task_id IS NOT NULL AND validation_id IS NULL AND tenant_id IS NOT NULL
    AND project_id IS NOT NULL AND attempt IS NOT NULL AND fencing_token IS NOT NULL AND capability_version_id IS NOT NULL AND release_id IS NULL)
   OR (subject_kind='validation' AND validation_id IS NOT NULL AND task_id IS NULL AND tenant_id IS NULL
    AND project_id IS NULL AND attempt IS NULL AND fencing_token IS NULL AND capability_version_id IS NULL AND release_id IS NOT NULL)),
 CHECK(((state='prepared' AND dispatched_at IS NULL AND finished_at IS NULL AND released_at IS NULL AND NOT usage_known AND counted_input_tokens IS NULL AND charge_numerator IS NULL)
    OR (state='dispatched' AND dispatched_at IS NOT NULL AND finished_at IS NULL AND released_at IS NULL AND NOT usage_known AND counted_input_tokens IS NULL AND charge_numerator IS NULL)
    OR (state='unknown' AND dispatched_at IS NOT NULL AND finished_at IS NOT NULL AND released_at IS NULL AND NOT usage_known AND counted_input_tokens IS NULL AND charge_numerator IS NULL)
    OR (state='completed' AND dispatched_at IS NOT NULL AND finished_at IS NOT NULL AND released_at IS NOT NULL AND usage_known
      AND counted_input_tokens IS NOT NULL AND price_micros IS NOT NULL AND http_status BETWEEN 200 AND 299 AND charge_numerator=price_micros::numeric*1000000)
    OR (state IN ('cancelled','denied') AND finished_at IS NOT NULL AND released_at IS NOT NULL AND usage_known
      AND counted_input_tokens IS NULL AND charge_numerator=0 AND (state='cancelled' OR dispatched_at IS NULL))) IS TRUE)
);
CREATE INDEX ai_input_count_active ON ai_input_count_requests(data_mode,tenant_id,actor_id) WHERE released_at IS NULL;
CREATE INDEX ai_input_count_rate ON ai_input_count_requests(data_mode,dispatched_at DESC) WHERE dispatched_at IS NOT NULL;
CREATE INDEX ai_input_count_task ON ai_input_count_requests(task_id,created_at,id);
CREATE INDEX ai_input_count_validation ON ai_input_count_requests(validation_id,created_at,id);
CREATE TABLE ai_input_count_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL REFERENCES ai_input_count_requests(id),
 state text NOT NULL CHECK(state IN ('prepared','dispatched','completed','unknown','cancelled','denied')),
 body jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ai_input_count_event_order ON ai_input_count_events(request_id,created_at,id);
CREATE TABLE ai_request_budget_allocations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 provider_request_id uuid UNIQUE REFERENCES ai_gateway_requests(id),
 count_request_id uuid UNIQUE REFERENCES ai_input_count_requests(id),
 envelope_id uuid REFERENCES ai_request_budget_envelopes(id),
 platform_period_id uuid REFERENCES ai_platform_budget_periods(id),
 input_count_id uuid UNIQUE REFERENCES ai_input_count_requests(id),
 input_tokens_bound bigint CHECK(input_tokens_bound BETWEEN 0 AND 9007199254740991),
 max_output_tokens integer CHECK(max_output_tokens BETWEEN 16 AND 131072),
 amount_numerator numeric(40,0) NOT NULL CHECK(amount_numerator>=0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((provider_request_id IS NOT NULL AND count_request_id IS NULL AND envelope_id IS NOT NULL)
   OR (provider_request_id IS NULL AND count_request_id IS NOT NULL AND platform_period_id IS NOT NULL)),
 CHECK((input_count_id IS NOT NULL AND input_tokens_bound IS NOT NULL AND max_output_tokens IS NOT NULL)
   OR (input_count_id IS NULL AND input_tokens_bound IS NULL AND max_output_tokens IS NULL))
);
CREATE INDEX ai_budget_allocation_envelope ON ai_request_budget_allocations(envelope_id);
CREATE INDEX ai_budget_allocation_period ON ai_request_budget_allocations(platform_period_id);
CREATE TABLE ai_request_budget_violations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 provider_request_id uuid UNIQUE NOT NULL REFERENCES ai_gateway_requests(id),
 envelope_id uuid NOT NULL REFERENCES ai_request_budget_envelopes(id),
 code text NOT NULL CHECK(code IN ('INPUT_COUNT_MISMATCH','OUTPUT_LIMIT_EXCEEDED','ALLOCATION_EXCEEDED')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TRIGGER immutable_ai_budget_policy BEFORE UPDATE OR DELETE ON ai_provider_budget_policies FOR EACH ROW EXECUTE FUNCTION guard_ai_gateway_history();
CREATE TRIGGER immutable_ai_budget_envelope BEFORE UPDATE OR DELETE ON ai_request_budget_envelopes FOR EACH ROW EXECUTE FUNCTION guard_ai_gateway_history();
CREATE TRIGGER immutable_ai_budget_period BEFORE UPDATE OR DELETE ON ai_platform_budget_periods FOR EACH ROW EXECUTE FUNCTION guard_ai_gateway_history();
CREATE TRIGGER immutable_ai_budget_allocation BEFORE UPDATE OR DELETE ON ai_request_budget_allocations FOR EACH ROW EXECUTE FUNCTION guard_ai_gateway_history();
CREATE TRIGGER immutable_ai_budget_violation BEFORE UPDATE OR DELETE ON ai_request_budget_violations FOR EACH ROW EXECUTE FUNCTION guard_ai_gateway_history();
CREATE TRIGGER immutable_ai_count_event BEFORE UPDATE OR DELETE ON ai_input_count_events FOR EACH ROW EXECUTE FUNCTION guard_ai_gateway_history();
CREATE FUNCTION guard_ai_input_count_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.state IN ('completed','cancelled','denied')
  OR (to_jsonb(NEW)-ARRAY['state','dispatched_at','dispatch_policy_version_id','finished_at','released_at','usage_known','counted_input_tokens','charge_numerator','http_status','outcome_code'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','dispatched_at','dispatch_policy_version_id','finished_at','released_at','usage_known','counted_input_tokens','charge_numerator','http_status','outcome_code'])
  OR (OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at)
  OR (OLD.dispatch_policy_version_id IS NOT NULL AND NEW.dispatch_policy_version_id IS DISTINCT FROM OLD.dispatch_policy_version_id)
  OR NOT ((OLD.state='prepared' AND NEW.state IN ('dispatched','cancelled'))
      OR (OLD.state='dispatched' AND NEW.state IN ('completed','unknown','cancelled'))
      OR (OLD.state='unknown' AND NEW.state IN ('completed','cancelled'))) THEN
  RAISE EXCEPTION 'Immutable input counting identity or invalid transition' USING ERRCODE='23514';
 END IF;
 IF NEW.state='dispatched' AND NOT EXISTS(SELECT 1 FROM public.ai_request_budget_allocations WHERE count_request_id=NEW.id) THEN
  RAISE EXCEPTION 'Input counting requires a platform budget allocation' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_ai_count_request BEFORE UPDATE OR DELETE ON ai_input_count_requests FOR EACH ROW EXECUTE FUNCTION guard_ai_input_count_request();

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['ai_provider_budget_policies','ai_provider_budget_heads','ai_request_budget_envelopes',
   'ai_platform_budget_periods','ai_input_count_requests','ai_input_count_events','ai_request_budget_allocations','ai_request_budget_violations'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY budget_control ON %I USING(current_user=''cp_control'') WITH CHECK(current_user=''cp_control'')',tab);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,cp_app,cp_queue',tab);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO cp_control',tab);
 END LOOP;
END $$;
GRANT UPDATE ON ai_provider_budget_heads TO cp_control;
GRANT UPDATE(state,dispatched_at,dispatch_policy_version_id,finished_at,released_at,usage_known,counted_input_tokens,charge_numerator,http_status,outcome_code) ON ai_input_count_requests TO cp_control;

-- New boundaries for definitely unexecuted accepted work; never invent old spend.
INSERT INTO ai_request_budget_envelopes(data_mode,subject_kind,task_id,amount_micros)
 SELECT t.data_mode,'task',t.id,r.amount_micros FROM tasks t JOIN reservations r ON r.task_id=t.id
 WHERE t.status IN ('queued','paused') AND t.attempt=0 AND r.status='reserved'
   AND r.amount_micros BETWEEN 1 AND 9007199254740991 AND r.amount_micros=t.budget_micros
   AND NOT EXISTS(SELECT 1 FROM ai_gateway_requests g WHERE g.task_id=t.id AND g.dispatched_at IS NOT NULL)
   AND NOT EXISTS(SELECT 1 FROM tool_operations o WHERE o.task_id=t.id AND o.state IN ('accepted','succeeded','reconciling'));

CREATE FUNCTION ai_budget_used(p_envelope uuid,p_period uuid) RETURNS numeric
 LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(sum(CASE WHEN coalesce(g.state,c.state)='completed' THEN coalesce(g.charge_numerator,c.charge_numerator)
   WHEN coalesce(g.state,c.state) IN ('cancelled','denied') THEN 0
   WHEN coalesce(g.state,c.state)='prepared' AND coalesce(g.prepared_until,c.prepared_until)<=clock_timestamp() THEN 0
   ELSE a.amount_numerator END),0)
 FROM public.ai_request_budget_allocations a
 LEFT JOIN public.ai_gateway_requests g ON g.id=a.provider_request_id
 LEFT JOIN public.ai_input_count_requests c ON c.id=a.count_request_id
 WHERE (p_envelope IS NOT NULL AND a.envelope_id=p_envelope) OR (p_period IS NOT NULL AND a.platform_period_id=p_period)
$$;
ALTER FUNCTION ai_budget_used(uuid,uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION ai_budget_used(uuid,uuid) FROM PUBLIC,cp_app,cp_queue;

CREATE FUNCTION register_task_ai_budget(p_task uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.tasks%ROWTYPE; r public.reservations%ROWTYPE;
BEGIN
 SELECT * INTO STRICT t FROM public.tasks WHERE id=p_task;
 SELECT * INTO STRICT r FROM public.reservations WHERE task_id=p_task;
 IF t.data_mode IS DISTINCT FROM current_setting('app.data_mode',true)
  OR (session_user<>'cp_control' AND t.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid)
  OR t.created_by IS DISTINCT FROM nullif(current_setting('app.billing_actor_id',true),'')::uuid
  OR r.status<>'reserved' OR r.amount_micros<>t.budget_micros THEN
  RAISE EXCEPTION 'Invalid original task budget' USING ERRCODE='42501'; END IF;
 INSERT INTO public.ai_request_budget_envelopes(data_mode,subject_kind,task_id,amount_micros)
  VALUES(t.data_mode,'task',p_task,r.amount_micros) ON CONFLICT(task_id) DO NOTHING;
END $$;
ALTER FUNCTION register_task_ai_budget(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION register_task_ai_budget(uuid) FROM PUBLIC,cp_queue;
GRANT EXECUTE ON FUNCTION register_task_ai_budget(uuid) TO cp_app,cp_control;

CREATE FUNCTION register_validation_ai_budget(p_validation uuid) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE v public.capability_validations%ROWTYPE; p public.ai_provider_budget_policies%ROWTYPE; mode text;
BEGIN
 SELECT * INTO STRICT v FROM public.capability_validations WHERE id=p_validation;
 SELECT data_mode INTO STRICT mode FROM public.capability_releases WHERE id=v.release_id;
 IF session_user<>'cp_control' OR v.state<>'running' OR v.lease_until<=clock_timestamp()
  OR v.principal_id IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'')::uuid
  OR mode IS DISTINCT FROM current_setting('app.data_mode',true) THEN
  RAISE EXCEPTION 'Invalid verification budget' USING ERRCODE='42501'; END IF;
 SELECT b.* INTO STRICT p FROM public.ai_provider_budget_heads h JOIN public.ai_provider_budget_policies b ON b.id=h.policy_id WHERE h.data_mode=mode;
 INSERT INTO public.ai_request_budget_envelopes(data_mode,subject_kind,validation_id,amount_micros,policy_id)
  VALUES(mode,'validation',v.id,p.verification_run_micros,p.id) ON CONFLICT(validation_id) DO NOTHING;
END $$;
ALTER FUNCTION register_validation_ai_budget(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION register_validation_ai_budget(uuid) FROM PUBLIC,cp_app,cp_queue;
GRANT EXECUTE ON FUNCTION register_validation_ai_budget(uuid) TO cp_control;

CREATE FUNCTION ai_platform_budget_period(p_mode text,p_purpose text) RETURNS uuid
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.ai_provider_budget_policies%ROWTYPE; result uuid; day date:=(clock_timestamp() AT TIME ZONE 'UTC')::date;
BEGIN
 SELECT b.* INTO STRICT p FROM public.ai_provider_budget_heads h JOIN public.ai_provider_budget_policies b ON b.id=h.policy_id WHERE h.data_mode=p_mode;
 INSERT INTO public.ai_platform_budget_periods(data_mode,purpose,utc_day,policy_id,amount_micros)
  VALUES(p_mode,p_purpose,day,p.id,
   CASE p_purpose WHEN 'input_count' THEN p.counting_daily_micros ELSE p.verification_daily_micros END)
  ON CONFLICT(data_mode,purpose,utc_day) DO NOTHING;
 SELECT id INTO STRICT result FROM public.ai_platform_budget_periods
  WHERE data_mode=p_mode AND purpose=p_purpose AND utc_day=day;
 RETURN result;
END $$;
ALTER FUNCTION ai_platform_budget_period(text,text) OWNER TO cp_control;
REVOKE ALL ON FUNCTION ai_platform_budget_period(text,text) FROM PUBLIC,cp_app,cp_queue;

CREATE FUNCTION ai_budget_subject_blocked(p_envelope uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.ai_request_budget_violations WHERE envelope_id=p_envelope)
  OR EXISTS(SELECT 1 FROM public.ai_request_budget_allocations a
   LEFT JOIN public.ai_gateway_requests g ON g.id=a.provider_request_id
   LEFT JOIN public.ai_input_count_requests c ON c.id=a.count_request_id
   WHERE a.envelope_id=p_envelope AND coalesce(g.state,c.state)='unknown')
  OR EXISTS(SELECT 1 FROM public.ai_input_count_requests c JOIN public.ai_request_budget_envelopes e
   ON c.task_id=e.task_id OR c.validation_id=e.validation_id WHERE e.id=p_envelope AND c.state='unknown')
$$;
ALTER FUNCTION ai_budget_subject_blocked(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION ai_budget_subject_blocked(uuid) FROM PUBLIC,cp_app,cp_queue;

CREATE FUNCTION allocate_ai_generation_budget(p_request uuid,p_nonce uuid,p_count uuid,p_max_output integer) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.ai_gateway_requests%ROWTYPE; e public.ai_request_budget_envelopes%ROWTYPE;
 c public.ai_input_count_requests%ROWTYPE; p public.ai_provider_budget_policies%ROWTYPE;
 a public.ai_request_budget_allocations%ROWTYPE; period_id uuid; period_limit bigint;
 amount numeric; denied text; mode text;
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
  ELSE amount:=c.counted_input_tokens::numeric*(r.rate_snapshot->>0)::numeric+p_max_output::numeric*(r.rate_snapshot->>1)::numeric;
  END IF;
 ELSE
  IF p_count IS NOT NULL OR p_max_output IS NOT NULL THEN denied:=coalesce(denied,'INVALID_IMAGE_BUDGET'); END IF;
  amount:=(r.rate_snapshot->>0)::numeric*1000000;
 END IF;
 SELECT * INTO a FROM public.ai_request_budget_allocations WHERE provider_request_id=r.id;
 IF a.id IS NOT NULL THEN
  IF a.input_count_id IS DISTINCT FROM p_count OR a.max_output_tokens IS DISTINCT FROM p_max_output THEN
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
 INSERT INTO public.ai_request_budget_allocations(provider_request_id,envelope_id,platform_period_id,input_count_id,input_tokens_bound,max_output_tokens,amount_numerator)
  VALUES(r.id,e.id,period_id,p_count,CASE WHEN p_count IS NOT NULL THEN c.counted_input_tokens END,p_max_output,amount);
 RETURN jsonb_build_object('allowed',true);
END $$;
ALTER FUNCTION allocate_ai_generation_budget(uuid,uuid,uuid,integer) OWNER TO cp_control;
REVOKE ALL ON FUNCTION allocate_ai_generation_budget(uuid,uuid,uuid,integer) FROM PUBLIC,cp_queue;
GRANT EXECUTE ON FUNCTION allocate_ai_generation_budget(uuid,uuid,uuid,integer) TO cp_app,cp_control;

CREATE FUNCTION guard_ai_generation_budget() RETURNS trigger LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE a public.ai_request_budget_allocations%ROWTYPE; violation text;
BEGIN
 IF NEW.state='dispatched' AND NOT EXISTS(SELECT 1 FROM public.ai_request_budget_allocations WHERE provider_request_id=NEW.id) THEN
  RAISE EXCEPTION 'A provider dispatch requires its original budget allocation' USING ERRCODE='23514'; END IF;
 IF NEW.state='completed' AND OLD.state<>'completed' THEN
  SELECT * INTO a FROM public.ai_request_budget_allocations WHERE provider_request_id=NEW.id;
  IF a.id IS NOT NULL THEN
   violation:=CASE WHEN a.input_count_id IS NOT NULL AND NEW.input_tokens<>a.input_tokens_bound THEN 'INPUT_COUNT_MISMATCH'
    WHEN a.max_output_tokens IS NOT NULL AND NEW.output_tokens>a.max_output_tokens THEN 'OUTPUT_LIMIT_EXCEEDED'
    WHEN NEW.charge_numerator>a.amount_numerator THEN 'ALLOCATION_EXCEEDED' END;
   IF violation IS NOT NULL THEN INSERT INTO public.ai_request_budget_violations(provider_request_id,envelope_id,code)
    VALUES(NEW.id,a.envelope_id,violation) ON CONFLICT(provider_request_id) DO NOTHING; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER enforce_ai_generation_budget BEFORE UPDATE ON ai_gateway_requests FOR EACH ROW EXECUTE FUNCTION guard_ai_generation_budget();

-- Counting is a real text-service call and shares the same limits and rate promises.
CREATE OR REPLACE FUNCTION ai_gateway_limit_reason(p_policy uuid,p_tenant uuid,p_actor uuid,p_class text,p_kind text,p_exclude uuid DEFAULT NULL)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.ai_gateway_policy_versions%ROWTYPE; a record; stamp timestamptz:=clock_timestamp(); old_count record;
BEGIN
 SELECT * INTO STRICT p FROM public.ai_gateway_policy_versions WHERE id=p_policy;
 FOR old_count IN UPDATE public.ai_input_count_requests SET state='cancelled',finished_at=stamp,released_at=stamp,
   usage_known=true,charge_numerator=0,outcome_code='PREPARATION_EXPIRED'
  WHERE data_mode=p.data_mode AND state='prepared' AND prepared_until<=stamp RETURNING id LOOP
  INSERT INTO public.ai_input_count_events(request_id,state,body) VALUES(old_count.id,'cancelled','{"code":"PREPARATION_EXPIRED"}');
 END LOOP;
 SELECT count(*) FILTER(WHERE active) AS total,
  count(*) FILTER(WHERE active AND tenant_id=p_tenant) AS tenant,
  count(*) FILTER(WHERE active AND actor_id=p_actor AND subject_kind=p_kind) AS actor,
  count(*) FILTER(WHERE active AND request_class=p_class) AS class,
  count(*) FILTER(WHERE active AND subject_kind='validation') AS verification,
  count(*) FILTER(WHERE recent) AS rpm,
  count(*) FILTER(WHERE recent AND tenant_id=p_tenant) AS tenant_rpm,
  count(*) FILTER(WHERE recent AND actor_id=p_actor AND subject_kind=p_kind) AS actor_rpm,
  count(*) FILTER(WHERE recent AND request_class=p_class) AS class_rpm,
  count(*) FILTER(WHERE recent AND subject_kind='validation') AS verification_rpm INTO a
 FROM (SELECT tenant_id,actor_id,subject_kind,request_class,
   released_at IS NULL AND (state<>'prepared' OR prepared_until>stamp) AS active,
   (dispatched_at>stamp-interval '1 minute' AND state NOT IN ('cancelled','denied')) OR (state='prepared' AND prepared_until>stamp) AS recent
  FROM (SELECT id,data_mode,tenant_id,actor_id,subject_kind,request_class,state,prepared_until,dispatched_at,released_at FROM public.ai_gateway_requests
    UNION ALL SELECT id,data_mode,tenant_id,actor_id,subject_kind,'text',state,prepared_until,dispatched_at,released_at FROM public.ai_input_count_requests) requests
  WHERE data_mode=p.data_mode AND id IS DISTINCT FROM p_exclude
    AND (released_at IS NULL OR dispatched_at>stamp-interval '1 minute')) q;
 RETURN CASE WHEN a.total>=p.global_slots THEN 'GLOBAL_CAPACITY'
  WHEN p_tenant IS NOT NULL AND a.tenant>=p.tenant_slots THEN 'TENANT_CAPACITY'
  WHEN a.actor>=p.actor_slots THEN 'ACTOR_CAPACITY'
  WHEN a.class>=CASE p_class WHEN 'text' THEN p.text_slots ELSE p.image_slots END THEN 'CAPABILITY_CAPACITY'
  WHEN p_kind='validation' AND a.verification>=p.verification_slots THEN 'VERIFICATION_CAPACITY'
  WHEN a.rpm>=p.global_rpm THEN 'GLOBAL_RATE'
  WHEN p_tenant IS NOT NULL AND a.tenant_rpm>=p.tenant_rpm THEN 'TENANT_RATE'
  WHEN a.actor_rpm>=p.actor_rpm THEN 'ACTOR_RATE'
  WHEN a.class_rpm>=CASE p_class WHEN 'text' THEN p.text_rpm ELSE p.image_rpm END THEN 'CAPABILITY_RATE'
  WHEN p_kind='validation' AND a.verification_rpm>=p.verification_rpm THEN 'VERIFICATION_RATE' ELSE NULL END;
END $$;

CREATE FUNCTION admit_ai_input_count_request(p_operation_id text,p_kind text,p_subject uuid,p_capability uuid,
 p_fencing uuid,p_model text,p_hash text,p_bytes integer,p_generation text,p_generation_hash text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.tasks%ROWTYPE; v public.capability_validations%ROWTYPE; cap public.internal_capability_versions%ROWTYPE;
 rel public.capability_releases%ROWTYPE; p public.ai_gateway_policy_versions%ROWTYPE;
 b public.ai_provider_budget_policies%ROWTYPE; r public.ai_input_count_requests%ROWTYPE;
 e public.ai_request_budget_envelopes%ROWTYPE;
 tenant uuid; project uuid; actor uuid; attempt integer; mode text; denied text; stamp timestamptz;
BEGIN
 IF p_operation_id IS NULL OR p_operation_id !~ '^[a-zA-Z0-9_:-]{16,128}$' OR p_generation IS NULL
  OR p_generation !~ '^[a-zA-Z0-9_:-]{16,128}$' OR p_hash IS NULL OR p_hash !~ '^[a-f0-9]{64}$'
  OR p_generation_hash IS NULL OR p_generation_hash !~ '^[a-f0-9]{64}$'
  OR p_bytes IS NULL OR p_bytes NOT BETWEEN 1 AND 40000000 THEN
  RAISE EXCEPTION 'Invalid input count request' USING ERRCODE='23514'; END IF;
 IF p_kind='task' THEN
  SELECT * INTO t FROM public.tasks WHERE id=p_subject;
  SELECT * INTO cap FROM public.internal_capability_versions WHERE id=p_capability;
  IF t.id IS NULL OR cap.id IS NULL OR t.id IS DISTINCT FROM nullif(current_setting('app.task_id',true),'')::uuid
   OR t.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR t.created_by IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'')::uuid
   OR t.status<>'running' OR t.cancel_requested OR t.content_state<>'active' OR t.lease_until IS NULL OR t.lease_until<=clock_timestamp()
   OR t.fencing_token IS DISTINCT FROM p_fencing OR NOT EXISTS(SELECT 1 FROM public.task_runtime_bindings x
    WHERE x.task_id=t.id AND p_capability=ANY(x.capability_version_ids))
   OR cap.revoked OR NOT cap.ready OR cap.data_mode<>t.data_mode OR cap.body->>'model_alias' IS DISTINCT FROM p_model
   OR cap.profile_key IS DISTINCT FROM 'internal-text-v1' THEN
   RAISE EXCEPTION 'Invalid input count task context' USING ERRCODE='42501'; END IF;
  tenant:=t.tenant_id; project:=t.project_id; actor:=t.created_by; attempt:=t.attempt; mode:=t.data_mode;
 ELSIF p_kind='validation' AND session_user='cp_control' THEN
  SELECT * INTO v FROM public.capability_validations WHERE id=p_subject;
  SELECT * INTO rel FROM public.capability_releases WHERE id=v.release_id;
  IF v.id IS NULL OR rel.id IS NULL OR v.state<>'running' OR v.lease_until<=clock_timestamp()
   OR v.principal_id IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'')::uuid
   OR p_capability IS NOT NULL OR p_fencing IS NOT NULL OR rel.definition->>'model_alias' IS DISTINCT FROM p_model
   OR rel.profile_key IS DISTINCT FROM 'internal-text-v1' THEN
   RAISE EXCEPTION 'Invalid input count verification context' USING ERRCODE='42501'; END IF;
  actor:=v.principal_id; mode:=rel.data_mode;
 ELSE RAISE EXCEPTION 'Invalid input count subject' USING ERRCODE='42501'; END IF;
 IF mode IS DISTINCT FROM current_setting('app.data_mode',true) THEN
  RAISE EXCEPTION 'Invalid input count data mode' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ai-gateway:'||mode,0));
 stamp:=clock_timestamp();
 IF EXISTS(SELECT 1 FROM public.ai_input_count_requests WHERE data_mode=mode
   AND (operation_id=p_operation_id OR generation_operation_id=p_generation)) THEN
  RETURN jsonb_build_object('admitted',false,'reason','OPERATION_ALREADY_USED'); END IF;
 SELECT pol.* INTO STRICT p FROM public.ai_gateway_policy_heads h
  JOIN public.ai_gateway_policy_versions pol ON pol.id=h.policy_version_id WHERE h.data_mode=mode;
 SELECT pol.* INTO STRICT b FROM public.ai_provider_budget_heads h
  JOIN public.ai_provider_budget_policies pol ON pol.id=h.policy_id WHERE h.data_mode=mode;
 SELECT * INTO e FROM public.ai_request_budget_envelopes WHERE data_mode=mode AND subject_kind=p_kind
  AND (task_id=t.id OR validation_id=v.id);
 denied:=CASE WHEN NOT b.count_verified OR b.count_price_micros IS NULL THEN 'INPUT_COUNT_NOT_VERIFIED'
  WHEN e.id IS NULL THEN 'BUDGET_BOUNDARY_MISSING'
  WHEN public.ai_budget_subject_blocked(e.id) THEN 'BUDGET_RECONCILIATION_REQUIRED'
  ELSE public.ai_gateway_limit_reason(p.id,tenant,actor,'text',p_kind) END;
 INSERT INTO public.ai_input_count_requests(operation_id,generation_operation_id,generation_hash,request_hash,request_bytes,
  data_mode,subject_kind,task_id,validation_id,tenant_id,project_id,actor_id,attempt,fencing_token,capability_version_id,release_id,
  model_alias,policy_version_id,budget_policy_id,price_micros,state,prepared_until,finished_at,released_at,usage_known,charge_numerator,outcome_code)
 VALUES(p_operation_id,p_generation,p_generation_hash,p_hash,p_bytes,mode,p_kind,t.id,v.id,tenant,project,actor,attempt,p_fencing,p_capability,rel.id,
  p_model,p.id,b.id,b.count_price_micros,CASE WHEN denied IS NULL THEN 'prepared' ELSE 'denied' END,
  stamp+make_interval(secs=>p.preparation_seconds),CASE WHEN denied IS NOT NULL THEN stamp END,
  CASE WHEN denied IS NOT NULL THEN stamp END,denied IS NOT NULL,CASE WHEN denied IS NOT NULL THEN 0 END,denied)
 RETURNING * INTO r;
 INSERT INTO public.ai_input_count_events(request_id,state,body) VALUES(r.id,r.state,jsonb_build_object('code',denied));
 RETURN jsonb_build_object('admitted',denied IS NULL,'id',r.id,'execution_nonce',r.execution_nonce,'reason',denied,
  'retry_after_seconds',CASE WHEN denied LIKE '%_RATE' THEN 60 ELSE 1 END);
END $$;
ALTER FUNCTION admit_ai_input_count_request(text,text,uuid,uuid,uuid,text,text,integer,text,text) OWNER TO cp_control;
REVOKE ALL ON FUNCTION admit_ai_input_count_request(text,text,uuid,uuid,uuid,text,text,integer,text,text) FROM PUBLIC,cp_queue;
GRANT EXECUTE ON FUNCTION admit_ai_input_count_request(text,text,uuid,uuid,uuid,text,text,integer,text,text) TO cp_app,cp_control;

CREATE FUNCTION dispatch_ai_input_count_request(p_request uuid,p_nonce uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.ai_input_count_requests%ROWTYPE; e public.ai_request_budget_envelopes%ROWTYPE;
 p public.ai_gateway_policy_versions%ROWTYPE; b public.ai_provider_budget_policies%ROWTYPE;
 mode text; denied text; stamp timestamptz; period_id uuid; period_limit bigint; amount numeric;
BEGIN
 SELECT data_mode INTO mode FROM public.ai_input_count_requests WHERE id=p_request AND execution_nonce=p_nonce;
 IF mode IS NULL THEN RAISE EXCEPTION 'Invalid input count permit' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ai-gateway:'||mode,0));
 SELECT * INTO STRICT r FROM public.ai_input_count_requests WHERE id=p_request AND execution_nonce=p_nonce FOR UPDATE;
 IF r.state<>'prepared' OR r.data_mode IS DISTINCT FROM current_setting('app.data_mode',true)
  OR r.actor_id IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'')::uuid
  OR (r.subject_kind='validation' AND session_user<>'cp_control')
  OR (r.subject_kind='task' AND (r.task_id IS DISTINCT FROM nullif(current_setting('app.task_id',true),'')::uuid
    OR r.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid)) THEN
  RAISE EXCEPTION 'Invalid input count dispatch context' USING ERRCODE='42501'; END IF;
 IF (r.subject_kind='task' AND NOT EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=r.task_id AND t.created_by=r.actor_id
    AND t.tenant_id=r.tenant_id AND t.project_id=r.project_id AND t.attempt=r.attempt AND t.fencing_token=r.fencing_token
    AND t.status='running' AND NOT t.cancel_requested AND t.content_state='active' AND t.lease_until>clock_timestamp()))
  OR (r.subject_kind='validation' AND NOT EXISTS(SELECT 1 FROM public.capability_validations v WHERE v.id=r.validation_id
    AND v.principal_id=r.actor_id AND v.state='running' AND v.lease_until>clock_timestamp())) THEN
  RAISE EXCEPTION 'Input count subject is no longer active' USING ERRCODE='42501'; END IF;
 stamp:=clock_timestamp();
 SELECT pol.* INTO STRICT p FROM public.ai_gateway_policy_heads h JOIN public.ai_gateway_policy_versions pol ON pol.id=h.policy_version_id WHERE h.data_mode=mode;
 SELECT pol.* INTO STRICT b FROM public.ai_provider_budget_heads h JOIN public.ai_provider_budget_policies pol ON pol.id=h.policy_id WHERE h.data_mode=mode;
 SELECT * INTO e FROM public.ai_request_budget_envelopes WHERE data_mode=mode AND subject_kind=r.subject_kind
  AND (task_id=r.task_id OR validation_id=r.validation_id);
 denied:=CASE WHEN r.prepared_until<=stamp THEN 'PREPARATION_EXPIRED'
  WHEN NOT b.count_verified OR b.count_price_micros IS NULL OR r.price_micros IS NULL THEN 'INPUT_COUNT_NOT_VERIFIED'
  WHEN e.id IS NULL THEN 'BUDGET_BOUNDARY_MISSING'
  WHEN public.ai_budget_subject_blocked(e.id) THEN 'BUDGET_RECONCILIATION_REQUIRED'
  ELSE public.ai_gateway_limit_reason(p.id,r.tenant_id,r.actor_id,'text',r.subject_kind,r.id) END;
 amount:=r.price_micros::numeric*1000000;
 IF denied IS NULL THEN
  period_id:=public.ai_platform_budget_period(mode,CASE r.subject_kind WHEN 'task' THEN 'input_count' ELSE 'verification' END);
  SELECT least(amount_micros,CASE r.subject_kind WHEN 'task' THEN b.counting_daily_micros ELSE b.verification_daily_micros END)
   INTO STRICT period_limit FROM public.ai_platform_budget_periods WHERE id=period_id;
  IF public.ai_budget_used(NULL,period_id)+amount>period_limit::numeric*1000000 THEN denied:='PLATFORM_BUDGET_EXHAUSTED'; END IF;
  IF r.subject_kind='validation' AND public.ai_budget_used(e.id,NULL)+amount>least(e.amount_micros,b.verification_run_micros)::numeric*1000000
   THEN denied:='VERIFICATION_BUDGET_EXHAUSTED'; END IF;
 END IF;
 IF denied IS NOT NULL THEN
  UPDATE public.ai_input_count_requests SET state='cancelled',finished_at=stamp,released_at=stamp,usage_known=true,
   charge_numerator=0,outcome_code=denied WHERE id=r.id;
  INSERT INTO public.ai_input_count_events(request_id,state,body) VALUES(r.id,'cancelled',jsonb_build_object('code',denied));
  RETURN jsonb_build_object('dispatched',false,'reason',denied);
 END IF;
 INSERT INTO public.ai_request_budget_allocations(count_request_id,envelope_id,platform_period_id,amount_numerator)
  VALUES(r.id,CASE WHEN r.subject_kind='validation' THEN e.id END,period_id,amount);
 UPDATE public.ai_input_count_requests SET state='dispatched',dispatched_at=stamp,dispatch_policy_version_id=p.id WHERE id=r.id;
 INSERT INTO public.ai_input_count_events(request_id,state) VALUES(r.id,'dispatched');
 RETURN jsonb_build_object('dispatched',true);
END $$;
ALTER FUNCTION dispatch_ai_input_count_request(uuid,uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION dispatch_ai_input_count_request(uuid,uuid) FROM PUBLIC,cp_queue;
GRANT EXECUTE ON FUNCTION dispatch_ai_input_count_request(uuid,uuid) TO cp_app,cp_control;
CREATE FUNCTION task_ai_budget_receipt(p_task uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.tasks%ROWTYPE; receipt jsonb;
BEGIN
 SELECT * INTO STRICT t FROM public.tasks WHERE id=p_task;
 IF t.data_mode IS DISTINCT FROM current_setting('app.data_mode',true)
  OR (session_user<>'cp_control' AND (t.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
    OR t.id IS DISTINCT FROM nullif(current_setting('app.task_id',true),'')::uuid)) THEN
  RAISE EXCEPTION 'Invalid task billing scope' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('requests',count(*),'numerator',coalesce(sum(charge_numerator) FILTER(WHERE state='completed'),0)::text,
  'input_tokens',coalesce(sum(input_tokens) FILTER(WHERE state='completed'),0)::text,
  'output_tokens',coalesce(sum(output_tokens) FILTER(WHERE state='completed'),0)::text,
  'uncertain',coalesce(bool_or(state IN ('dispatched','unknown')),false),
  'violation',EXISTS(SELECT 1 FROM public.ai_request_budget_violations x JOIN public.ai_gateway_requests q ON q.id=x.provider_request_id WHERE q.task_id=p_task))
  INTO receipt FROM public.ai_gateway_requests WHERE task_id=p_task;
 RETURN receipt;
END $$;
ALTER FUNCTION task_ai_budget_receipt(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION task_ai_budget_receipt(uuid) FROM PUBLIC,cp_queue;
GRANT EXECUTE ON FUNCTION task_ai_budget_receipt(uuid) TO cp_app,cp_control;
INSERT INTO schema_migrations(version) VALUES(67);
