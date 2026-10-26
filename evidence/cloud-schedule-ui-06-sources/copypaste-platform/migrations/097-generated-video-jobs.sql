-- Forward-only internal asynchronous video. Published SQL001-096 are unchanged.
ALTER TABLE ai_gateway_policy_versions
 ADD COLUMN video_slots integer NOT NULL DEFAULT 2 CHECK(video_slots BETWEEN 1 AND 1000),
 ADD COLUMN video_rpm integer NOT NULL DEFAULT 60 CHECK(video_rpm BETWEEN 1 AND 100000);

CREATE TABLE ai_video_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id), project_id uuid NOT NULL REFERENCES projects(id),
 task_id uuid NOT NULL REFERENCES tasks(id), actor_id uuid NOT NULL REFERENCES users(id),
 private_owner uuid REFERENCES users(id), data_mode text NOT NULL CHECK(data_mode IN('simulated','configured_services')),
 envelope_id uuid NOT NULL REFERENCES ai_request_budget_envelopes(id),
 capability_version_id uuid NOT NULL REFERENCES internal_capability_versions(id),
 policy_version_id uuid NOT NULL REFERENCES ai_gateway_policy_versions(id),
 operation_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 call_id text NOT NULL CHECK(length(call_id) BETWEEN 1 AND 200),
 specification jsonb NOT NULL CHECK(jsonb_typeof(specification)='object'),
 specification_hash text NOT NULL CHECK(specification_hash ~ '^[a-f0-9]{64}$'),
 model_alias text NOT NULL CHECK(length(model_alias) BETWEEN 1 AND 200),
 gateway_fingerprint text NOT NULL CHECK(gateway_fingerprint ~ '^[a-f0-9]{64}$'),
 seconds integer NOT NULL CHECK(seconds IN(4,8,12,16,20)),
 size text NOT NULL CHECK(size IN('720x1280','1280x720','1024x1024')),
 rate_micros bigint NOT NULL CHECK(rate_micros BETWEEN 1 AND 9007199254740991),
 quoted_micros bigint NOT NULL CHECK(quoted_micros BETWEEN 1 AND 9007199254740991),
 reference_asset_id uuid, reference_version integer, reference_sha256 text,
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','submitting','queued','in_progress','completed','failed','cancelled','unknown')),
 provider_id text CHECK(provider_id ~ '^[a-zA-Z0-9_-]{1,160}$'),
 provider_sequence bigint CHECK(provider_sequence BETWEEN 0 AND 9007199254740991),
 progress integer CHECK(progress BETWEEN 0 AND 100),
 usage_known boolean NOT NULL DEFAULT false,
 billable_seconds bigint CHECK(billable_seconds BETWEEN 0 AND 9007199254740991),
 actual_micros numeric(40,0) GENERATED ALWAYS AS (billable_seconds::numeric*rate_micros::numeric) STORED,
 content_sha256 text CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
 content_bytes integer CHECK(content_bytes BETWEEN 1 AND 100000000),
 output_asset_id uuid REFERENCES assets(id), output_version integer,
 delivery_state text NOT NULL DEFAULT 'pending' CHECK(delivery_state IN('pending','available','blocked','invalid')),
 delivery_probe jsonb,
 error_code text CHECK(error_code ~ '^[A-Z0-9_]{1,100}$'),
 delivery_error text CHECK(delivery_error ~ '^[A-Z0-9_]{1,100}$'),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 public_revision integer NOT NULL DEFAULT 1 CHECK(public_revision>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 dispatched_at timestamptz, observed_at timestamptz, finished_at timestamptz,
 cancel_requested_at timestamptz, cancel_sent_at timestamptz,
 next_poll_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 lease_token uuid, lease_until timestamptz,
 erased_at timestamptz,
 UNIQUE(task_id,call_id), UNIQUE(task_id,specification_hash), UNIQUE(id,tenant_id,project_id),
 FOREIGN KEY(reference_asset_id,reference_version) REFERENCES asset_versions(asset_id,version),
 FOREIGN KEY(output_asset_id,output_version) REFERENCES asset_versions(asset_id,version),
 CHECK(quoted_micros::numeric=seconds::numeric*rate_micros::numeric),
 CHECK((reference_asset_id IS NULL AND reference_version IS NULL AND reference_sha256 IS NULL)
   OR (reference_asset_id IS NOT NULL AND reference_version>0 AND reference_sha256 ~ '^[a-f0-9]{64}$')),
 CHECK(usage_known=(billable_seconds IS NOT NULL)),
 CHECK(NOT usage_known OR state IN('completed','failed','cancelled')),
 CHECK((state<>'completed') OR (provider_id IS NOT NULL AND content_sha256 IS NOT NULL AND content_bytes IS NOT NULL)),
 CHECK((delivery_state='available')=(output_asset_id IS NOT NULL AND output_version IS NOT NULL)),
 CHECK((state<>'prepared') OR (dispatched_at IS NULL AND provider_id IS NULL)),
 CHECK((lease_token IS NULL)=(lease_until IS NULL))
);
CREATE INDEX ai_video_job_poll ON ai_video_jobs(data_mode,next_poll_at,id)
 WHERE NOT usage_known OR (state='completed' AND delivery_state='pending');
CREATE INDEX ai_video_job_task ON ai_video_jobs(task_id,created_at,id);
CREATE INDEX ai_video_job_reference ON ai_video_jobs(reference_asset_id) WHERE reference_asset_id IS NOT NULL;
CREATE TABLE ai_video_budget_violations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL UNIQUE REFERENCES ai_video_jobs(id),
 envelope_id uuid NOT NULL REFERENCES ai_request_budget_envelopes(id),
 code text NOT NULL CHECK(code='ALLOCATION_EXCEEDED'), created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER immutable_ai_video_budget_violation BEFORE UPDATE OR DELETE ON ai_video_budget_violations
 FOR EACH ROW EXECUTE FUNCTION guard_ai_gateway_history();
ALTER TABLE ai_video_budget_violations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_video_budget_violations FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_video_violation_control ON ai_video_budget_violations USING(current_user='cp_control') WITH CHECK(current_user='cp_control');
REVOKE ALL ON ai_video_budget_violations FROM PUBLIC,cp_app,cp_queue;
GRANT SELECT,INSERT ON ai_video_budget_violations TO cp_control;
CREATE TABLE ai_video_observations (
 job_id uuid NOT NULL REFERENCES ai_video_jobs(id), event_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence BETWEEN 0 AND 9007199254740991),
 source text NOT NULL CHECK(source IN('submit','poll','lookup','cancel','callback')),
 body jsonb NOT NULL, body_hash text NOT NULL CHECK(body_hash ~ '^[a-f0-9]{64}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(job_id,event_id),
 UNIQUE(job_id,sequence)
);
CREATE TABLE ai_video_job_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES ai_video_jobs(id),
 kind text NOT NULL CHECK(kind IN('prepared','dispatched','observed','cancel_requested','delivery','uncertain','reconciled','erased')),
 body jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER immutable_ai_video_observations BEFORE UPDATE OR DELETE ON ai_video_observations
 FOR EACH ROW EXECUTE FUNCTION guard_ai_gateway_history();
CREATE TRIGGER immutable_ai_video_events BEFORE UPDATE OR DELETE ON ai_video_job_events
 FOR EACH ROW EXECUTE FUNCTION guard_ai_gateway_history();

CREATE FUNCTION guard_ai_video_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retained video operation cannot be deleted' USING ERRCODE='23514'; END IF;
 IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Video revision must advance once' USING ERRCODE='23514'; END IF;
 IF NEW.public_revision NOT IN(OLD.public_revision,OLD.public_revision+1)
 THEN RAISE EXCEPTION 'Invalid video public revision' USING ERRCODE='23514'; END IF;
 -- Lease heartbeats and unchanged polling must not invalidate customer/admin intent.
 -- Explicit administrative rechecks may advance this version once as well.
 IF (NEW.state,NEW.provider_id,NEW.progress,NEW.usage_known,NEW.billable_seconds,
     NEW.content_sha256,NEW.content_bytes,NEW.output_asset_id,NEW.output_version,
     NEW.delivery_state,NEW.delivery_probe,NEW.error_code,NEW.delivery_error,
     NEW.finished_at,NEW.cancel_requested_at,NEW.erased_at)
 IS DISTINCT FROM
    (OLD.state,OLD.provider_id,OLD.progress,OLD.usage_known,OLD.billable_seconds,
     OLD.content_sha256,OLD.content_bytes,OLD.output_asset_id,OLD.output_version,
     OLD.delivery_state,OLD.delivery_probe,OLD.error_code,OLD.delivery_error,
     OLD.finished_at,OLD.cancel_requested_at,OLD.erased_at)
 THEN NEW.public_revision:=OLD.public_revision+1; END IF;
 IF (to_jsonb(NEW)-ARRAY['state','provider_id','provider_sequence','progress','usage_known','billable_seconds','actual_micros',
   'content_sha256','content_bytes','output_asset_id','output_version','delivery_state','delivery_probe','error_code','delivery_error','revision','public_revision',
   'dispatched_at','observed_at','finished_at','cancel_requested_at','cancel_sent_at','next_poll_at','lease_token','lease_until','erased_at','specification'])
 IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','provider_id','provider_sequence','progress','usage_known','billable_seconds','actual_micros',
   'content_sha256','content_bytes','output_asset_id','output_version','delivery_state','delivery_probe','error_code','delivery_error','revision','public_revision',
   'dispatched_at','observed_at','finished_at','cancel_requested_at','cancel_sent_at','next_poll_at','lease_token','lease_until','erased_at','specification'])
 THEN RAISE EXCEPTION 'Immutable video operation specification' USING ERRCODE='23514'; END IF;
 IF NEW.specification IS DISTINCT FROM OLD.specification AND NOT(OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
   AND NEW.specification='{}'::jsonb AND EXISTS(SELECT 1 FROM tasks WHERE id=OLD.task_id AND content_state='deleted'))
 THEN RAISE EXCEPTION 'Video specification can only be erased with its task' USING ERRCODE='23514'; END IF;
 IF OLD.erased_at IS NOT NULL AND (NEW.erased_at IS DISTINCT FROM OLD.erased_at OR NEW.specification<>'{}'::jsonb)
 THEN RAISE EXCEPTION 'Video erasure is irreversible' USING ERRCODE='23514'; END IF;
 IF (OLD.provider_id IS NOT NULL AND NEW.provider_id IS DISTINCT FROM OLD.provider_id)
  OR (OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at)
  OR (OLD.cancel_requested_at IS NOT NULL AND NEW.cancel_requested_at IS DISTINCT FROM OLD.cancel_requested_at)
  OR (OLD.output_asset_id IS NOT NULL AND (NEW.output_asset_id IS DISTINCT FROM OLD.output_asset_id OR NEW.output_version IS DISTINCT FROM OLD.output_version))
  OR (OLD.provider_sequence IS NOT NULL AND (NEW.provider_sequence IS NULL OR NEW.provider_sequence<OLD.provider_sequence))
 THEN RAISE EXCEPTION 'Immutable video operation identity' USING ERRCODE='23514'; END IF;
 IF (OLD.state='prepared' AND NEW.state NOT IN('prepared','submitting','cancelled','failed'))
  OR (OLD.state='submitting' AND NEW.state='prepared')
  OR (OLD.state IN('queued','in_progress','unknown') AND NEW.state IN('prepared','submitting'))
  OR (OLD.state='in_progress' AND NEW.state='queued')
  OR (OLD.progress IS NOT NULL AND (NEW.progress IS NULL OR NEW.progress<OLD.progress))
 THEN RAISE EXCEPTION 'Invalid video operation transition' USING ERRCODE='23514'; END IF;
 IF OLD.state IN('completed','failed','cancelled') AND NEW.state IS DISTINCT FROM OLD.state
 THEN RAISE EXCEPTION 'Immutable video terminal outcome' USING ERRCODE='23514'; END IF;
 IF OLD.usage_known AND (NOT NEW.usage_known OR NEW.billable_seconds IS DISTINCT FROM OLD.billable_seconds)
 THEN RAISE EXCEPTION 'Immutable video usage fact' USING ERRCODE='23514'; END IF;
 IF OLD.content_sha256 IS NOT NULL AND (NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256 OR NEW.content_bytes IS DISTINCT FROM OLD.content_bytes)
 THEN RAISE EXCEPTION 'Immutable video content identity' USING ERRCODE='23514'; END IF;
 IF OLD.delivery_state='available' AND (NEW.delivery_state<>'available' OR NEW.delivery_probe IS DISTINCT FROM OLD.delivery_probe)
 THEN RAISE EXCEPTION 'Immutable generated video delivery' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_ai_video_job BEFORE UPDATE OR DELETE ON ai_video_jobs FOR EACH ROW EXECUTE FUNCTION guard_ai_video_job();

ALTER TABLE ai_video_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_video_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_video_scope ON ai_video_jobs USING(current_user='cp_control' OR
 (data_mode=current_setting('app.data_mode',true) AND tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND (private_owner IS NULL OR private_owner=nullif(current_setting('app.actor_id',true),'')::uuid)))
 WITH CHECK(current_user='cp_control');
ALTER TABLE ai_video_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_video_observations FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_video_observation_control ON ai_video_observations USING(current_user='cp_control') WITH CHECK(current_user='cp_control');
ALTER TABLE ai_video_job_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_video_job_events FORCE ROW LEVEL SECURITY;
CREATE POLICY ai_video_event_control ON ai_video_job_events USING(current_user='cp_control') WITH CHECK(current_user='cp_control');
REVOKE ALL ON ai_video_jobs,ai_video_observations,ai_video_job_events FROM PUBLIC,cp_app,cp_queue;
GRANT SELECT ON ai_video_jobs TO cp_app;
GRANT SELECT,INSERT,UPDATE ON ai_video_jobs TO cp_control;
GRANT SELECT,INSERT ON ai_video_observations,ai_video_job_events TO cp_control;

-- Both request families hold the same original task envelope, including unknown costs.
CREATE OR REPLACE FUNCTION ai_budget_used(p_envelope uuid,p_period uuid) RETURNS numeric
 LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce((SELECT sum(CASE WHEN r.cost_state='manually_confirmed' THEN r.effective_numerator
   WHEN r.state='completed' THEN r.charge_numerator WHEN r.state IN('cancelled','denied') THEN 0
   WHEN r.state='prepared' AND r.prepared_until<=clock_timestamp() THEN 0 ELSE a.amount_numerator END)
 FROM public.ai_request_budget_allocations a JOIN public.current_ai_provider_requests r
 ON (r.channel='generation' AND r.id=a.provider_request_id) OR (r.channel='input_count' AND r.id=a.count_request_id)
 WHERE (p_envelope IS NOT NULL AND a.envelope_id=p_envelope) OR (p_period IS NOT NULL AND a.platform_period_id=p_period)),0)
 + coalesce((SELECT sum(CASE WHEN usage_known THEN actual_micros ELSE quoted_micros END)*1000000
 FROM public.ai_video_jobs WHERE p_envelope IS NOT NULL AND envelope_id=p_envelope),0)
$$;
CREATE OR REPLACE FUNCTION ai_budget_subject_blocked(p_envelope uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.ai_request_budget_violations WHERE envelope_id=p_envelope)
 OR EXISTS(SELECT 1 FROM public.current_ai_provider_requests r JOIN public.ai_request_budget_envelopes e
 ON r.task_id=e.task_id OR r.validation_id=e.validation_id WHERE e.id=p_envelope AND r.state='unknown' AND r.cost_state='unknown')
 OR EXISTS(SELECT 1 FROM public.ai_video_jobs WHERE envelope_id=p_envelope
   AND ((state='unknown' AND NOT usage_known) OR actual_micros>quoted_micros))
$$;
CREATE OR REPLACE FUNCTION task_ai_budget_receipt(p_task uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.tasks%ROWTYPE; receipt jsonb;
BEGIN
 SELECT * INTO STRICT t FROM public.tasks WHERE id=p_task;
 IF t.data_mode IS DISTINCT FROM current_setting('app.data_mode',true)
  OR (session_user<>'cp_control' AND (t.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
    OR t.id IS DISTINCT FROM nullif(current_setting('app.task_id',true),'')::uuid)) THEN
  RAISE EXCEPTION 'Invalid task billing scope' USING ERRCODE='42501'; END IF;
 SELECT jsonb_build_object('requests',count(*),'numerator',coalesce(sum(numerator),0)::text,
  'input_tokens',coalesce(sum(input_tokens),0)::text,'output_tokens',coalesce(sum(output_tokens),0)::text,
  'uncertain',coalesce(bool_or(uncertain),false),'violation',coalesce(bool_or(violation),false)) INTO receipt
 FROM (
  SELECT CASE WHEN cost_state<>'unknown' THEN effective_numerator END AS numerator,
   CASE WHEN cost_state<>'unknown' THEN effective_input_tokens END AS input_tokens,
   CASE WHEN cost_state<>'unknown' THEN effective_output_tokens END AS output_tokens,
   state='dispatched' OR (state='unknown' AND cost_state='unknown') AS uncertain,
   EXISTS(SELECT 1 FROM public.ai_request_budget_violations x JOIN public.ai_gateway_requests q ON q.id=x.provider_request_id WHERE q.task_id=p_task) AS violation
  FROM public.current_ai_provider_requests WHERE task_id=p_task AND channel='generation'
  UNION ALL SELECT CASE WHEN usage_known THEN actual_micros*1000000 END,0,0,NOT usage_known,
   coalesce(actual_micros>quoted_micros,false) FROM public.ai_video_jobs WHERE task_id=p_task
 ) requests;
 RETURN receipt;
END $$;

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
 FROM (
  SELECT tenant_id,actor_id,subject_kind,request_class,
   capacity_held AS active,
   (dispatched_at>stamp-interval '1 minute' AND state NOT IN('cancelled','denied')) OR (state='prepared' AND prepared_until>stamp) AS recent
  -- Keep canonical counting requests and reviewed termination overlays, too.
  FROM public.current_ai_provider_requests WHERE data_mode=p.data_mode AND id IS DISTINCT FROM p_exclude
    AND (capacity_held OR dispatched_at>stamp-interval '1 minute')
  UNION ALL SELECT tenant_id,actor_id,'task','video',NOT usage_known,
   dispatched_at>stamp-interval '1 minute' OR (state='prepared' AND created_at>stamp-interval '1 minute')
  FROM public.ai_video_jobs WHERE data_mode=p.data_mode AND id IS DISTINCT FROM p_exclude
    AND (NOT usage_known OR dispatched_at>stamp-interval '1 minute')
 ) q;
 RETURN CASE WHEN a.total>=p.global_slots THEN 'GLOBAL_CAPACITY'
  WHEN p_tenant IS NOT NULL AND a.tenant>=p.tenant_slots THEN 'TENANT_CAPACITY'
  WHEN a.actor>=p.actor_slots THEN 'ACTOR_CAPACITY'
  WHEN a.class>=CASE p_class WHEN 'text' THEN p.text_slots WHEN 'video' THEN p.video_slots ELSE p.image_slots END THEN 'CAPABILITY_CAPACITY'
  WHEN p_kind='validation' AND a.verification>=p.verification_slots THEN 'VERIFICATION_CAPACITY'
  WHEN a.rpm>=p.global_rpm THEN 'GLOBAL_RATE'
  WHEN p_tenant IS NOT NULL AND a.tenant_rpm>=p.tenant_rpm THEN 'TENANT_RATE'
  WHEN a.actor_rpm>=p.actor_rpm THEN 'ACTOR_RATE'
  WHEN a.class_rpm>=CASE p_class WHEN 'text' THEN p.text_rpm WHEN 'video' THEN p.video_rpm ELSE p.image_rpm END THEN 'CAPABILITY_RATE'
  WHEN p_kind='validation' AND a.verification_rpm>=p.verification_rpm THEN 'VERIFICATION_RATE' ELSE NULL END;
END $$;

CREATE FUNCTION prepare_ai_video_job(p_task uuid,p_fencing uuid,p_call text,p_spec jsonb,p_hash text,p_capability uuid,
 p_reference uuid DEFAULT NULL,p_reference_version integer DEFAULT NULL,p_reference_hash text DEFAULT NULL)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.tasks%ROWTYPE; cap public.internal_capability_versions%ROWTYPE;
 e public.ai_request_budget_envelopes%ROWTYPE; j public.ai_video_jobs%ROWTYPE;
 policy_id uuid; amount numeric; rate bigint; seconds integer; reason text; mode text;
BEGIN
 SELECT * INTO STRICT t FROM public.tasks WHERE id=p_task FOR UPDATE;
 IF t.id IS DISTINCT FROM nullif(current_setting('app.task_id',true),'')::uuid
  OR t.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
  OR t.created_by IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'')::uuid
  OR t.data_mode IS DISTINCT FROM current_setting('app.data_mode',true)
  OR t.status<>'running' OR t.fencing_token IS DISTINCT FROM p_fencing OR t.lease_until<=clock_timestamp()
  OR t.cancel_requested OR t.content_state<>'active' OR t.mode<>'execute'
 THEN RAISE EXCEPTION 'Invalid video task authority' USING ERRCODE='42501'; END IF;
 mode:=t.data_mode;
 PERFORM pg_advisory_xact_lock(hashtextextended('ai-gateway:'||mode,0));
 SELECT * INTO j FROM public.ai_video_jobs WHERE task_id=p_task AND (call_id=p_call OR specification_hash=p_hash) ORDER BY created_at,id LIMIT 1;
 IF j.id IS NOT NULL THEN
  IF j.specification_hash IS DISTINCT FROM p_hash OR j.specification IS DISTINCT FROM p_spec OR j.capability_version_id IS DISTINCT FROM p_capability
  THEN RAISE EXCEPTION 'Video operation replay changed' USING ERRCODE='23514'; END IF;
  RETURN j.id;
 END IF;
 SELECT * INTO cap FROM public.internal_capability_versions WHERE id=p_capability;
 IF cap.id IS NULL OR NOT cap.ready OR cap.revoked OR cap.profile_key<>'internal-video-v1' OR cap.data_mode<>mode
  OR cap.body->>'wire_protocol'<>'company-video-jobs-v1'
  OR cap.body->>'gateway_fingerprint' IS DISTINCT FROM current_setting('app.ai_gateway_fingerprint',true)
  OR NOT EXISTS(SELECT 1 FROM public.task_runtime_bindings WHERE task_id=p_task AND p_capability=ANY(capability_version_ids))
 THEN RAISE EXCEPTION 'Invalid frozen video capability' USING ERRCODE='42501'; END IF;
 IF jsonb_typeof(p_spec)<>'object' OR length(p_spec->>'prompt') NOT BETWEEN 1 AND 12000
  OR p_spec->>'size' NOT IN('720x1280','1280x720','1024x1024')
  OR (p_spec->>'seconds') NOT IN('4','8','12','16','20')
  OR jsonb_array_length(cap.body->'rates')<>1 OR (cap.body#>>'{rates,0}') !~ '^[1-9][0-9]*$'
 THEN RAISE EXCEPTION 'Invalid video specification or rate' USING ERRCODE='23514'; END IF;
 rate:=(cap.body#>>'{rates,0}')::bigint; seconds:=(p_spec->>'seconds')::integer; amount:=rate::numeric*seconds::numeric;
 IF amount>9007199254740991 THEN RAISE EXCEPTION 'Video quote exceeds supported amounts' USING ERRCODE='23514'; END IF;
 SELECT * INTO e FROM public.ai_request_budget_envelopes WHERE task_id=p_task AND subject_kind='task';
 IF e.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.reservations WHERE task_id=p_task AND status='reserved' AND amount_micros=e.amount_micros)
  OR public.ai_budget_subject_blocked(e.id) OR public.ai_budget_used(e.id,NULL)+amount*1000000>e.amount_micros::numeric*1000000
 THEN RAISE EXCEPTION 'Video task budget unavailable' USING ERRCODE='23514'; END IF;
 SELECT policy_version_id INTO STRICT policy_id FROM public.ai_gateway_policy_heads WHERE data_mode=mode;
 reason:=public.ai_gateway_limit_reason(policy_id,t.tenant_id,t.created_by,'video','task');
 IF reason IS NOT NULL THEN RAISE EXCEPTION 'Video provider capacity unavailable' USING ERRCODE='53300'; END IF;
 INSERT INTO public.ai_video_jobs(tenant_id,project_id,task_id,actor_id,private_owner,data_mode,envelope_id,capability_version_id,policy_version_id,call_id,
  specification,specification_hash,model_alias,gateway_fingerprint,seconds,size,rate_micros,quoted_micros,reference_asset_id,reference_version,reference_sha256)
 VALUES(t.tenant_id,t.project_id,t.id,t.created_by,t.private_owner,mode,e.id,cap.id,policy_id,p_call,p_spec,p_hash,cap.body->>'model_alias',
  cap.body->>'gateway_fingerprint',seconds,p_spec->>'size',rate,amount::bigint,p_reference,p_reference_version,p_reference_hash) RETURNING * INTO j;
 INSERT INTO public.ai_video_job_events(job_id,kind,body) VALUES(j.id,'prepared',jsonb_build_object('operation_id',j.operation_id,'quoted_micros',j.quoted_micros::text));
 RETURN j.id;
END $$;
ALTER FUNCTION prepare_ai_video_job(uuid,uuid,text,jsonb,text,uuid,uuid,integer,text) OWNER TO cp_control;
REVOKE ALL ON FUNCTION prepare_ai_video_job(uuid,uuid,text,jsonb,text,uuid,uuid,integer,text) FROM PUBLIC,cp_app,cp_queue;
GRANT EXECUTE ON FUNCTION prepare_ai_video_job(uuid,uuid,text,jsonb,text,uuid,uuid,integer,text) TO cp_control;

CREATE FUNCTION stop_ai_video_task() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.cancel_requested OR NEW.content_state<>'active' OR NEW.status IN('failed','cancelled','reconciling') THEN
  UPDATE public.ai_video_jobs SET cancel_requested_at=coalesce(cancel_requested_at,clock_timestamp()),
   next_poll_at=least(next_poll_at,clock_timestamp()),revision=revision+1
  WHERE task_id=NEW.id AND NOT usage_known AND cancel_requested_at IS NULL;
 END IF;
 IF NEW.content_state='deleted' THEN
  UPDATE public.ai_video_jobs SET specification='{}',erased_at=clock_timestamp(),revision=revision+1,
   delivery_state=CASE WHEN output_asset_id IS NULL THEN 'blocked' ELSE delivery_state END,
   delivery_error=CASE WHEN output_asset_id IS NULL THEN 'CONTENT_DELETED' ELSE delivery_error END
  WHERE task_id=NEW.id AND erased_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION stop_ai_video_task() OWNER TO cp_control;
REVOKE ALL ON FUNCTION stop_ai_video_task() FROM PUBLIC;
CREATE TRIGGER ai_video_origin_stopped AFTER UPDATE OF status,cancel_requested,content_state ON tasks FOR EACH ROW EXECUTE FUNCTION stop_ai_video_task();

-- Saved clips participate in every existing asset read/share/source policy.
-- A revoked model or withdrawn origin/reference cannot be bypassed by a generic
-- download route or by publishing a private result to the shared project.
CREATE FUNCTION generated_video_asset_available(asset uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT NOT EXISTS(SELECT 1 FROM ai_video_jobs j WHERE j.output_asset_id=asset AND (
  j.state<>'completed' OR j.delivery_state<>'available' OR j.erased_at IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM tasks t JOIN users u ON u.id=t.created_by
    JOIN tenants n ON n.id=t.tenant_id JOIN projects p ON p.id=t.project_id
    JOIN memberships m ON m.tenant_id=t.tenant_id AND m.user_id=t.created_by
    JOIN internal_capability_versions c ON c.id=j.capability_version_id
    WHERE t.id=j.task_id AND t.content_state='active' AND t.status IN('running','succeeded') AND NOT t.cancel_requested
     AND u.status='active' AND u.auth_version=t.actor_auth_version AND n.status='active' AND NOT p.archived
     AND m.status='active' AND (m.role IN('owner','admin') OR (m.role='member' AND EXISTS(
       SELECT 1 FROM project_members pm WHERE pm.project_id=t.project_id AND pm.user_id=t.created_by AND pm.role='editor')))
     AND c.ready AND NOT c.revoked
     AND (t.execution_location<>'desktop' OR EXISTS(SELECT 1 FROM desktop_executions d
       JOIN refresh_tokens f ON f.family_id=d.native_family_id JOIN sessions s ON s.id=f.session_id
       WHERE d.task_id=t.id AND d.state IN('running','finished') AND f.client_id='desktop' AND f.user_id=t.created_by
        AND f.revoked_at IS NULL AND f.expires_at>clock_timestamp() AND s.revoked_at IS NULL
        AND s.expires_at>clock_timestamp() AND s.auth_version=t.actor_auth_version)))
  OR (j.reference_asset_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM assets a JOIN asset_versions v
    ON v.asset_id=a.id AND v.version=j.reference_version WHERE a.id=j.reference_asset_id AND a.tenant_id=j.tenant_id
     AND a.project_id=j.project_id AND a.state='active' AND a.retention_expires_at>clock_timestamp()
     AND (a.private_owner IS NULL OR a.private_owner=j.private_owner) AND v.erased_at IS NULL AND v.sha256=j.reference_sha256
     AND analysis_asset_available(a.id) AND matrix_asset_available(a.id) AND video_asset_available(a.id)
     AND task_asset_version_sources_available(v.id)))
 ));
$$;
ALTER FUNCTION generated_video_asset_available(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION generated_video_asset_available(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION generated_video_asset_available(uuid) TO cp_app,cp_control;
CREATE OR REPLACE FUNCTION video_asset_available(asset uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT generated_video_asset_available(asset) AND NOT EXISTS(SELECT 1 FROM video_renders r JOIN creative_projects p ON p.id=r.video_id
  WHERE asset IN(r.mp4_asset_id,r.project_asset_id,r.script_asset_id,r.storyboard_asset_id,r.subtitles_asset_id,r.probe_asset_id)
   AND (p.content_state<>'active' OR p.retention_expires_at<=clock_timestamp()
    OR NOT EXISTS(SELECT 1 FROM assets output WHERE output.id=asset AND output.retention_expires_at>clock_timestamp())
    OR EXISTS(SELECT 1 FROM video_project_sources s WHERE s.video_id=r.video_id AND s.version=r.version
     AND NOT EXISTS(SELECT 1 FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=s.asset_version
      WHERE a.id=s.asset_id AND a.tenant_id=r.tenant_id AND a.project_id=r.project_id AND a.state='active'
       AND (a.private_owner IS NULL OR a.private_owner=p.private_owner)
       AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL AND v.sha256=s.sha256
       AND v.mime_type=s.mime_type AND v.bytes=s.bytes
       AND analysis_asset_available(a.id) AND matrix_asset_available(a.id) AND video_asset_available(a.id))))
 );
$$;
