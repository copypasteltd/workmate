-- Forward-only request admission. Original task reservations and historical
-- charges are unchanged; these are provider-request and observed-usage facts.
CREATE TABLE ai_gateway_policy_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 data_mode text NOT NULL CHECK(data_mode IN ('simulated','configured_services')),
 version integer NOT NULL CHECK(version>0),
 global_slots integer NOT NULL DEFAULT 16 CHECK(global_slots BETWEEN 1 AND 1000),
 tenant_slots integer NOT NULL DEFAULT 4 CHECK(tenant_slots BETWEEN 1 AND 1000),
 actor_slots integer NOT NULL DEFAULT 2 CHECK(actor_slots BETWEEN 1 AND 1000),
 text_slots integer NOT NULL DEFAULT 12 CHECK(text_slots BETWEEN 1 AND 1000),
 image_slots integer NOT NULL DEFAULT 4 CHECK(image_slots BETWEEN 1 AND 1000),
 verification_slots integer NOT NULL DEFAULT 2 CHECK(verification_slots BETWEEN 1 AND 1000),
 global_rpm integer NOT NULL DEFAULT 600 CHECK(global_rpm BETWEEN 1 AND 100000),
 tenant_rpm integer NOT NULL DEFAULT 120 CHECK(tenant_rpm BETWEEN 1 AND 100000),
 actor_rpm integer NOT NULL DEFAULT 60 CHECK(actor_rpm BETWEEN 1 AND 100000),
 text_rpm integer NOT NULL DEFAULT 480 CHECK(text_rpm BETWEEN 1 AND 100000),
 image_rpm integer NOT NULL DEFAULT 120 CHECK(image_rpm BETWEEN 1 AND 100000),
 verification_rpm integer NOT NULL DEFAULT 60 CHECK(verification_rpm BETWEEN 1 AND 100000),
 preparation_seconds integer NOT NULL DEFAULT 30 CHECK(preparation_seconds BETWEEN 1 AND 300),
 created_by uuid REFERENCES admin_principals(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(data_mode,version), UNIQUE(id,data_mode)
);
CREATE TABLE ai_gateway_policy_heads (
 data_mode text PRIMARY KEY CHECK(data_mode IN ('simulated','configured_services')),
 policy_version_id uuid NOT NULL,
 FOREIGN KEY(policy_version_id,data_mode) REFERENCES ai_gateway_policy_versions(id,data_mode)
);
WITH seeded AS (
 INSERT INTO ai_gateway_policy_versions(data_mode,version,reason)
 VALUES('simulated',1,'Bootstrap provider request policy'),
       ('configured_services',1,'Bootstrap provider request policy') RETURNING *
) INSERT INTO ai_gateway_policy_heads SELECT data_mode,id FROM seeded;

CREATE TABLE ai_gateway_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operation_id text NOT NULL CHECK(operation_id ~ '^[a-zA-Z0-9_:-]{16,128}$'),
 execution_nonce uuid NOT NULL DEFAULT gen_random_uuid(),
 data_mode text NOT NULL CHECK(data_mode IN ('simulated','configured_services')),
 subject_kind text NOT NULL CHECK(subject_kind IN ('task','validation')),
 task_id uuid REFERENCES tasks(id),
 validation_id uuid REFERENCES capability_validations(id),
 tenant_id uuid REFERENCES tenants(id),
 project_id uuid REFERENCES projects(id),
 actor_id uuid NOT NULL,
 attempt integer CHECK(attempt>0), fencing_token uuid,
 capability_version_id uuid REFERENCES internal_capability_versions(id),
 release_id uuid REFERENCES capability_releases(id),
 request_class text NOT NULL CHECK(request_class IN ('text','image')),
 operation text NOT NULL CHECK(operation IN ('responses','images.generate','images.edit')),
 model_alias text NOT NULL CHECK(length(model_alias) BETWEEN 1 AND 200),
 request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 request_bytes integer NOT NULL CHECK(request_bytes BETWEEN 1 AND 40000000),
 rate_snapshot jsonb NOT NULL CHECK(jsonb_typeof(rate_snapshot)='array'),
 policy_version_id uuid NOT NULL REFERENCES ai_gateway_policy_versions(id),
 dispatch_policy_version_id uuid REFERENCES ai_gateway_policy_versions(id),
 state text NOT NULL CHECK(state IN ('prepared','dispatched','completed','unknown','cancelled','denied')),
 prepared_until timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 dispatched_at timestamptz, finished_at timestamptz, released_at timestamptz,
 usage_known boolean NOT NULL DEFAULT false,
 input_tokens bigint CHECK(input_tokens BETWEEN 0 AND 9007199254740991),
 output_tokens bigint CHECK(output_tokens BETWEEN 0 AND 9007199254740991),
 image_units integer CHECK(image_units BETWEEN 0 AND 1),
 known_charge_micros bigint CHECK(known_charge_micros BETWEEN 0 AND 9007199254740991),
 http_status integer CHECK(http_status BETWEEN 100 AND 599),
 outcome_code text CHECK(outcome_code ~ '^[A-Z0-9_]{1,100}$'),
 UNIQUE(data_mode,operation_id),
 CHECK((subject_kind='task' AND task_id IS NOT NULL AND validation_id IS NULL
    AND tenant_id IS NOT NULL AND project_id IS NOT NULL AND attempt IS NOT NULL
    AND fencing_token IS NOT NULL AND capability_version_id IS NOT NULL AND release_id IS NULL)
  OR (subject_kind='validation' AND task_id IS NULL AND validation_id IS NOT NULL
    AND tenant_id IS NULL AND project_id IS NULL AND attempt IS NULL
    AND fencing_token IS NULL AND capability_version_id IS NULL AND release_id IS NOT NULL)),
 CHECK((operation='responses' AND request_class='text') OR (operation<>'responses' AND request_class='image')),
 CHECK(state<>'completed' OR (known_charge_micros IS NOT NULL AND input_tokens IS NOT NULL AND output_tokens IS NOT NULL
   AND ((request_class='text' AND image_units=0) OR (request_class='image' AND image_units=1 AND input_tokens=0 AND output_tokens=0)))),
 CHECK((state='prepared' AND dispatched_at IS NULL AND finished_at IS NULL AND released_at IS NULL AND NOT usage_known)
  OR (state='dispatched' AND dispatched_at IS NOT NULL AND finished_at IS NULL AND released_at IS NULL AND NOT usage_known)
  OR (state='unknown' AND dispatched_at IS NOT NULL AND finished_at IS NOT NULL AND released_at IS NULL AND NOT usage_known)
  OR (state='completed' AND dispatched_at IS NOT NULL AND finished_at IS NOT NULL AND released_at IS NOT NULL AND usage_known)
  OR (state IN ('cancelled','denied') AND (state='cancelled' OR dispatched_at IS NULL) AND finished_at IS NOT NULL AND released_at IS NOT NULL
    AND usage_known AND input_tokens=0 AND output_tokens=0 AND image_units=0 AND known_charge_micros=0))
);
CREATE INDEX ai_gateway_requests_active ON ai_gateway_requests(data_mode,tenant_id,actor_id,request_class)
 WHERE released_at IS NULL;
CREATE INDEX ai_gateway_requests_rate ON ai_gateway_requests(data_mode,dispatched_at DESC)
 WHERE dispatched_at IS NOT NULL;
CREATE INDEX ai_gateway_requests_task ON ai_gateway_requests(task_id,created_at,id);
CREATE INDEX ai_gateway_requests_validation ON ai_gateway_requests(validation_id,created_at,id);
CREATE TABLE ai_gateway_request_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 request_id uuid NOT NULL REFERENCES ai_gateway_requests(id),
 state text NOT NULL CHECK(state IN ('prepared','dispatched','completed','unknown','cancelled','denied')),
 body jsonb NOT NULL DEFAULT '{}',
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX ai_gateway_request_events_order ON ai_gateway_request_events(request_id,created_at,id);

CREATE FUNCTION guard_ai_gateway_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Immutable provider request history' USING ERRCODE='23514'; END $$;
CREATE TRIGGER immutable_ai_gateway_policy BEFORE UPDATE OR DELETE ON ai_gateway_policy_versions
 FOR EACH ROW EXECUTE FUNCTION guard_ai_gateway_history();
CREATE TRIGGER immutable_ai_gateway_event BEFORE UPDATE OR DELETE ON ai_gateway_request_events
 FOR EACH ROW EXECUTE FUNCTION guard_ai_gateway_history();
CREATE FUNCTION guard_ai_gateway_request() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.state IN ('completed','cancelled','denied') THEN
  RAISE EXCEPTION 'Immutable provider request outcome' USING ERRCODE='23514';
 END IF;
 IF (to_jsonb(NEW)-ARRAY['state','dispatched_at','dispatch_policy_version_id','finished_at','released_at','usage_known',
   'input_tokens','output_tokens','image_units','known_charge_micros','http_status','outcome_code'])
  IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','dispatched_at','dispatch_policy_version_id','finished_at','released_at','usage_known',
   'input_tokens','output_tokens','image_units','known_charge_micros','http_status','outcome_code'])
  OR (OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at)
  OR (OLD.dispatch_policy_version_id IS NOT NULL AND NEW.dispatch_policy_version_id IS DISTINCT FROM OLD.dispatch_policy_version_id)
  OR NOT ((OLD.state='prepared' AND NEW.state IN ('dispatched','cancelled'))
    OR (OLD.state='dispatched' AND NEW.state IN ('completed','unknown','cancelled'))
    OR (OLD.state='unknown' AND NEW.state IN ('completed','cancelled'))) THEN
  RAISE EXCEPTION 'Invalid provider request transition' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_ai_gateway_request BEFORE UPDATE OR DELETE ON ai_gateway_requests
 FOR EACH ROW EXECUTE FUNCTION guard_ai_gateway_request();

ALTER TABLE ai_gateway_policy_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_gateway_policy_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY gateway_policy_control ON ai_gateway_policy_versions USING(current_user='cp_control') WITH CHECK(current_user='cp_control');
ALTER TABLE ai_gateway_policy_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_gateway_policy_heads FORCE ROW LEVEL SECURITY;
CREATE POLICY gateway_head_control ON ai_gateway_policy_heads USING(current_user='cp_control') WITH CHECK(current_user='cp_control');
ALTER TABLE ai_gateway_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_gateway_requests FORCE ROW LEVEL SECURITY;
CREATE POLICY gateway_request_scope ON ai_gateway_requests
 USING(current_user='cp_control' OR (subject_kind='task'
   AND data_mode=current_setting('app.data_mode',true)
   AND tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
   AND actor_id=nullif(current_setting('app.actor_id',true),'')::uuid))
 WITH CHECK(current_user='cp_control');
ALTER TABLE ai_gateway_request_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_gateway_request_events FORCE ROW LEVEL SECURITY;
CREATE POLICY gateway_event_control ON ai_gateway_request_events USING(current_user='cp_control') WITH CHECK(current_user='cp_control');
REVOKE ALL ON ai_gateway_policy_versions,ai_gateway_policy_heads,ai_gateway_requests,ai_gateway_request_events FROM PUBLIC,cp_app,cp_queue;
GRANT SELECT,INSERT ON ai_gateway_policy_versions,ai_gateway_requests,ai_gateway_request_events TO cp_control;
GRANT SELECT,INSERT,UPDATE ON ai_gateway_policy_heads TO cp_control;
GRANT UPDATE(state,dispatched_at,dispatch_policy_version_id,finished_at,released_at,usage_known,
 input_tokens,output_tokens,image_units,known_charge_micros,http_status,outcome_code) ON ai_gateway_requests TO cp_control;
GRANT SELECT ON ai_gateway_requests TO cp_app;

CREATE FUNCTION ai_gateway_limit_reason(p_policy uuid,p_tenant uuid,p_actor uuid,p_class text,p_kind text,p_exclude uuid DEFAULT NULL)
 RETURNS text LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p public.ai_gateway_policy_versions%ROWTYPE; a record; stamp timestamptz:=clock_timestamp();
BEGIN
 SELECT * INTO STRICT p FROM public.ai_gateway_policy_versions WHERE id=p_policy;
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
  FROM public.ai_gateway_requests WHERE data_mode=p.data_mode AND id IS DISTINCT FROM p_exclude
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
ALTER FUNCTION ai_gateway_limit_reason(uuid,uuid,uuid,text,text,uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION ai_gateway_limit_reason(uuid,uuid,uuid,text,text,uuid) FROM PUBLIC,cp_app,cp_queue;

CREATE FUNCTION admit_ai_gateway_request(p_operation_id text,p_kind text,p_subject uuid,p_capability uuid,
 p_fencing uuid,p_operation text,p_model text,p_hash text,p_bytes integer)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.tasks%ROWTYPE; v public.capability_validations%ROWTYPE; cap public.internal_capability_versions%ROWTYPE;
 rel public.capability_releases%ROWTYPE; p public.ai_gateway_policy_versions%ROWTYPE; r public.ai_gateway_requests%ROWTYPE;
 tenant uuid; project uuid; actor uuid; attempt integer; mode text; class text; rates jsonb;
 denied text; old_request record; stamp timestamptz;
BEGIN
 IF p_operation_id IS NULL OR p_operation_id !~ '^[a-zA-Z0-9_:-]{16,128}$' OR p_hash IS NULL
  OR p_hash !~ '^[a-f0-9]{64}$' OR p_bytes IS NULL OR p_bytes NOT BETWEEN 1 AND 40000000
  OR p_operation IS NULL OR p_operation NOT IN ('responses','images.generate','images.edit') THEN
  RAISE EXCEPTION 'Invalid provider request' USING ERRCODE='23514'; END IF;
 class:=CASE WHEN p_operation='responses' THEN 'text' ELSE 'image' END;
 IF p_kind='task' THEN
  SELECT * INTO t FROM public.tasks WHERE id=p_subject;
  SELECT * INTO cap FROM public.internal_capability_versions WHERE id=p_capability;
  IF t.id IS NULL OR cap.id IS NULL OR t.id IS DISTINCT FROM nullif(current_setting('app.task_id',true),'')::uuid
   OR t.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
   OR t.created_by IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'')::uuid
   OR t.status<>'running' OR t.cancel_requested OR t.content_state<>'active' OR t.lease_until IS NULL OR t.lease_until<=clock_timestamp()
   OR t.fencing_token IS DISTINCT FROM p_fencing OR NOT EXISTS(SELECT 1 FROM public.task_runtime_bindings b
     WHERE b.task_id=t.id AND p_capability=ANY(b.capability_version_ids))
   OR cap.revoked OR NOT cap.ready OR cap.data_mode<>t.data_mode OR cap.body->>'model_alias' IS DISTINCT FROM p_model
   OR cap.profile_key IS DISTINCT FROM (CASE class WHEN 'text' THEN 'internal-text-v1' ELSE 'internal-image2-v1' END) THEN
   RAISE EXCEPTION 'Invalid provider task context' USING ERRCODE='42501'; END IF;
  tenant:=t.tenant_id; project:=t.project_id; actor:=t.created_by; attempt:=t.attempt; mode:=t.data_mode; rates:=cap.body->'rates';
 ELSIF p_kind='validation' AND session_user='cp_control' THEN
  SELECT * INTO v FROM public.capability_validations WHERE id=p_subject;
  SELECT * INTO rel FROM public.capability_releases WHERE id=v.release_id;
  IF v.id IS NULL OR rel.id IS NULL OR v.state<>'running' OR v.lease_until<=clock_timestamp()
   OR v.principal_id IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'')::uuid
   OR p_capability IS NOT NULL OR p_fencing IS NOT NULL OR rel.definition->>'model_alias' IS DISTINCT FROM p_model
   OR rel.profile_key IS DISTINCT FROM (CASE class WHEN 'text' THEN 'internal-text-v1' ELSE 'internal-image2-v1' END) THEN
   RAISE EXCEPTION 'Invalid provider verification context' USING ERRCODE='42501'; END IF;
  actor:=v.principal_id; mode:=rel.data_mode; rates:=rel.definition->'rates';
 ELSE RAISE EXCEPTION 'Invalid provider subject' USING ERRCODE='42501'; END IF;
 IF mode IS DISTINCT FROM current_setting('app.data_mode',true) THEN
  RAISE EXCEPTION 'Invalid provider data mode' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ai-gateway:'||mode,0));
 stamp:=clock_timestamp();
 FOR old_request IN UPDATE public.ai_gateway_requests SET state='cancelled',finished_at=stamp,released_at=stamp,
   usage_known=true,input_tokens=0,output_tokens=0,image_units=0,known_charge_micros=0,outcome_code='PREPARATION_EXPIRED'
  WHERE data_mode=mode AND state='prepared' AND prepared_until<=stamp RETURNING id LOOP
   INSERT INTO public.ai_gateway_request_events(request_id,state,body)
    VALUES(old_request.id,'cancelled','{"code":"PREPARATION_EXPIRED"}');
 END LOOP;
 IF EXISTS(SELECT 1 FROM public.ai_gateway_requests WHERE data_mode=mode AND operation_id=p_operation_id) THEN
  RETURN jsonb_build_object('admitted',false,'reason','OPERATION_ALREADY_USED','retry_after_seconds',0);
 END IF;
 SELECT pol.* INTO STRICT p FROM public.ai_gateway_policy_heads h
  JOIN public.ai_gateway_policy_versions pol ON pol.id=h.policy_version_id WHERE h.data_mode=mode;
 denied:=public.ai_gateway_limit_reason(p.id,tenant,actor,class,p_kind);
 INSERT INTO public.ai_gateway_requests(operation_id,data_mode,subject_kind,task_id,validation_id,tenant_id,project_id,actor_id,
   attempt,fencing_token,capability_version_id,release_id,request_class,operation,model_alias,request_hash,request_bytes,
   rate_snapshot,policy_version_id,state,prepared_until,finished_at,released_at,usage_known,input_tokens,output_tokens,image_units,known_charge_micros,outcome_code)
 VALUES(p_operation_id,mode,p_kind,t.id,v.id,tenant,project,actor,attempt,p_fencing,p_capability,rel.id,class,p_operation,p_model,p_hash,p_bytes,
   rates,p.id,CASE WHEN denied IS NULL THEN 'prepared' ELSE 'denied' END,stamp+make_interval(secs=>p.preparation_seconds),
   CASE WHEN denied IS NOT NULL THEN stamp END,CASE WHEN denied IS NOT NULL THEN stamp END,denied IS NOT NULL,
   CASE WHEN denied IS NOT NULL THEN 0 END,CASE WHEN denied IS NOT NULL THEN 0 END,CASE WHEN denied IS NOT NULL THEN 0 END,
   CASE WHEN denied IS NOT NULL THEN 0 END,denied) RETURNING * INTO r;
 INSERT INTO public.ai_gateway_request_events(request_id,state,body) VALUES(r.id,r.state,jsonb_build_object('code',denied));
 RETURN jsonb_build_object('admitted',denied IS NULL,'id',r.id,'execution_nonce',r.execution_nonce,'reason',denied,
  'retry_after_seconds',CASE WHEN denied LIKE '%_RATE' THEN 60 ELSE 1 END);
END $$;
ALTER FUNCTION admit_ai_gateway_request(text,text,uuid,uuid,uuid,text,text,text,integer) OWNER TO cp_control;
REVOKE ALL ON FUNCTION admit_ai_gateway_request(text,text,uuid,uuid,uuid,text,text,text,integer) FROM PUBLIC,cp_queue;
GRANT EXECUTE ON FUNCTION admit_ai_gateway_request(text,text,uuid,uuid,uuid,text,text,text,integer) TO cp_app,cp_control;

CREATE FUNCTION dispatch_ai_gateway_request(p_request uuid,p_nonce uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r public.ai_gateway_requests%ROWTYPE; p public.ai_gateway_policy_versions%ROWTYPE; mode text; denied text; stamp timestamptz;
BEGIN
 SELECT data_mode INTO mode FROM public.ai_gateway_requests WHERE id=p_request AND execution_nonce=p_nonce;
 IF mode IS NULL THEN RAISE EXCEPTION 'Invalid provider permit' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ai-gateway:'||mode,0));
 SELECT * INTO STRICT r FROM public.ai_gateway_requests WHERE id=p_request AND execution_nonce=p_nonce FOR UPDATE;
 IF r.state<>'prepared' OR r.data_mode IS DISTINCT FROM current_setting('app.data_mode',true)
  OR r.actor_id IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'')::uuid
  OR (r.subject_kind='validation' AND session_user<>'cp_control')
  OR (r.subject_kind='task' AND (r.task_id IS DISTINCT FROM nullif(current_setting('app.task_id',true),'')::uuid
    OR r.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid)) THEN
  RAISE EXCEPTION 'Invalid provider dispatch context' USING ERRCODE='42501'; END IF;
 IF (r.subject_kind='task' AND NOT EXISTS(SELECT 1 FROM public.tasks t WHERE t.id=r.task_id
    AND t.created_by=r.actor_id AND t.tenant_id=r.tenant_id AND t.project_id=r.project_id AND t.attempt=r.attempt
    AND t.fencing_token=r.fencing_token AND t.status='running' AND NOT t.cancel_requested
    AND t.content_state='active' AND t.lease_until>clock_timestamp()))
  OR (r.subject_kind='validation' AND NOT EXISTS(SELECT 1 FROM public.capability_validations v WHERE v.id=r.validation_id
    AND v.principal_id=r.actor_id AND v.state='running' AND v.lease_until>clock_timestamp())) THEN
  RAISE EXCEPTION 'Provider subject is no longer active' USING ERRCODE='42501'; END IF;
 stamp:=clock_timestamp();
 SELECT pol.* INTO STRICT p FROM public.ai_gateway_policy_heads h
  JOIN public.ai_gateway_policy_versions pol ON pol.id=h.policy_version_id WHERE h.data_mode=mode;
 denied:=CASE WHEN r.prepared_until<=stamp THEN 'PREPARATION_EXPIRED'
  ELSE public.ai_gateway_limit_reason(p.id,r.tenant_id,r.actor_id,r.request_class,r.subject_kind,r.id) END;
 IF denied IS NOT NULL THEN
  UPDATE public.ai_gateway_requests SET state='cancelled',finished_at=stamp,released_at=stamp,usage_known=true,
   input_tokens=0,output_tokens=0,image_units=0,known_charge_micros=0,outcome_code=denied WHERE id=r.id;
  INSERT INTO public.ai_gateway_request_events(request_id,state,body) VALUES(r.id,'cancelled',jsonb_build_object('code',denied));
  RETURN jsonb_build_object('dispatched',false,'reason',denied,'retry_after_seconds',CASE WHEN denied LIKE '%_RATE' THEN 60 ELSE 1 END);
 END IF;
 UPDATE public.ai_gateway_requests SET state='dispatched',dispatched_at=stamp,dispatch_policy_version_id=p.id WHERE id=r.id;
 INSERT INTO public.ai_gateway_request_events(request_id,state) VALUES(r.id,'dispatched');
 RETURN jsonb_build_object('dispatched',true);
END $$;
ALTER FUNCTION dispatch_ai_gateway_request(uuid,uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION dispatch_ai_gateway_request(uuid,uuid) FROM PUBLIC,cp_queue;
GRANT EXECUTE ON FUNCTION dispatch_ai_gateway_request(uuid,uuid) TO cp_app,cp_control;
INSERT INTO schema_migrations(version) VALUES(66);
