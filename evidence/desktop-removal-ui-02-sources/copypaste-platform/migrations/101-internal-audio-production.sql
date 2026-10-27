-- Additive only. Published SQL001-100 and prior ledger implementations survive.
ALTER TABLE ai_gateway_policy_versions
 ADD COLUMN audio_slots integer NOT NULL DEFAULT 0 CHECK(audio_slots BETWEEN 0 AND 1000),
 ADD COLUMN audio_rpm integer NOT NULL DEFAULT 0 CHECK(audio_rpm BETWEEN 0 AND 100000);
-- Existing policies do not silently acquire a new paid service authority.

CREATE TABLE ai_audio_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id),project_id uuid NOT NULL REFERENCES projects(id),
 task_id uuid NOT NULL REFERENCES tasks(id),actor_id uuid NOT NULL REFERENCES users(id),private_owner uuid REFERENCES users(id),
 origin_fencing uuid NOT NULL,origin_attempt integer NOT NULL CHECK(origin_attempt>0),
 data_mode text NOT NULL CHECK(data_mode IN('simulated','configured_services')),
 envelope_id uuid NOT NULL REFERENCES ai_request_budget_envelopes(id),
 capability_version_id uuid NOT NULL REFERENCES internal_capability_versions(id),
 policy_version_id uuid NOT NULL REFERENCES ai_gateway_policy_versions(id),
 operation_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,call_id text NOT NULL CHECK(length(call_id) BETWEEN 1 AND 200),
 kind text NOT NULL CHECK(kind IN('speech','transcription')),
 specification jsonb NOT NULL CHECK(jsonb_typeof(specification)='object'),
 specification_hash text NOT NULL CHECK(specification_hash ~ '^[a-f0-9]{64}$'),
 model_alias text NOT NULL CHECK(length(model_alias) BETWEEN 1 AND 200),gateway_fingerprint text NOT NULL CHECK(gateway_fingerprint ~ '^[a-f0-9]{64}$'),
 rate_micros bigint NOT NULL CHECK(rate_micros BETWEEN 1 AND 1000000000),
 quoted_units bigint NOT NULL CHECK(quoted_units BETWEEN 1 AND 600000),
 pricing_unit text NOT NULL CHECK(pricing_unit IN('unicode_scalar','input_millisecond')),
 quoted_micros bigint NOT NULL CHECK(quoted_micros BETWEEN 1 AND 9007199254740991),
 source_asset_id uuid,source_version integer,source_sha256 text,source_probe jsonb,
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','dispatched','completed','cancelled','unknown')),
 usage_known boolean NOT NULL DEFAULT false,billable_units bigint CHECK(billable_units BETWEEN 0 AND 600000),
 actual_micros numeric(40,0) GENERATED ALWAYS AS (billable_units::numeric*rate_micros::numeric) STORED,
 request_hash text CHECK(request_hash ~ '^[a-f0-9]{64}$'),response_sha256 text CHECK(response_sha256 ~ '^[a-f0-9]{64}$'),
 response_bytes integer CHECK(response_bytes BETWEEN 1 AND 25000000),duration_ms integer CHECK(duration_ms BETWEEN 1 AND 600000),
 decoded_media jsonb,error_code text CHECK(error_code ~ '^[A-Z0-9_]{1,100}$'),
 delivery_state text NOT NULL DEFAULT 'pending' CHECK(delivery_state IN('pending','available','blocked')),
 subtitle_revision integer NOT NULL DEFAULT 0 CHECK(subtitle_revision>=0),revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),dispatched_at timestamptz,finished_at timestamptz,
 cancel_requested_at timestamptz,erased_at timestamptz,
 UNIQUE(task_id,call_id),UNIQUE(task_id,specification_hash),UNIQUE(id,tenant_id,project_id),
 FOREIGN KEY(source_asset_id,source_version) REFERENCES asset_versions(asset_id,version),
 CHECK(quoted_micros::numeric=quoted_units::numeric*rate_micros::numeric),
 CHECK(usage_known=(billable_units IS NOT NULL)),
 CHECK(NOT usage_known OR state IN('completed','cancelled')),
 CHECK((state<>'completed') OR (usage_known AND response_sha256 IS NOT NULL AND response_bytes IS NOT NULL AND duration_ms IS NOT NULL)),
 CHECK((state<>'prepared') OR (dispatched_at IS NULL AND request_hash IS NULL)),
 CHECK((state NOT IN('dispatched','unknown','completed')) OR (dispatched_at IS NOT NULL AND request_hash IS NOT NULL)),
 CHECK((kind='speech' AND pricing_unit='unicode_scalar' AND source_asset_id IS NULL AND source_version IS NULL AND source_sha256 IS NULL AND source_probe IS NULL)
  OR (kind='transcription' AND pricing_unit='input_millisecond' AND source_asset_id IS NOT NULL AND source_version>0 AND source_sha256 ~ '^[a-f0-9]{64}$' AND source_probe IS NOT NULL))
);
CREATE INDEX ai_audio_job_task ON ai_audio_jobs(task_id,created_at DESC,id);
CREATE TABLE ai_audio_job_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),job_id uuid NOT NULL REFERENCES ai_audio_jobs(id),
 kind text NOT NULL CHECK(kind IN('prepared','dispatched','completed','cancelled','unknown','subtitle_revision','erased')),
 body jsonb NOT NULL DEFAULT '{}',created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE ai_audio_job_artifacts (
 job_id uuid NOT NULL REFERENCES ai_audio_jobs(id),revision integer NOT NULL CHECK(revision>=0),
 kind text NOT NULL CHECK(kind IN('audio','raw_response','transcript','srt','vtt')),
 asset_id uuid NOT NULL,asset_version integer NOT NULL,created_by uuid NOT NULL REFERENCES users(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(job_id,revision,kind),UNIQUE(asset_id,asset_version),
 FOREIGN KEY(asset_id,asset_version) REFERENCES asset_versions(asset_id,version)
);
CREATE TRIGGER immutable_ai_audio_events BEFORE UPDATE OR DELETE ON ai_audio_job_events FOR EACH ROW EXECUTE FUNCTION guard_ai_gateway_history();
CREATE TRIGGER immutable_ai_audio_artifacts BEFORE UPDATE OR DELETE ON ai_audio_job_artifacts FOR EACH ROW EXECUTE FUNCTION guard_ai_gateway_history();
CREATE FUNCTION guard_ai_audio_artifact_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE j ai_audio_jobs; a assets; v asset_versions;
BEGIN
 SELECT * INTO STRICT j FROM ai_audio_jobs WHERE id=NEW.job_id;
 SELECT * INTO STRICT a FROM assets WHERE id=NEW.asset_id;
 SELECT * INTO STRICT v FROM asset_versions WHERE asset_id=NEW.asset_id AND version=NEW.asset_version;
 IF a.tenant_id<>j.tenant_id OR a.project_id<>j.project_id OR a.private_owner IS DISTINCT FROM j.private_owner
  OR v.metadata->>'task_id' IS DISTINCT FROM j.task_id::text OR v.metadata->>'audio_job_id' IS DISTINCT FROM j.id::text
  OR v.metadata->>'artifact_kind' IS DISTINCT FROM NEW.kind
  OR v.metadata->>'subtitle_revision' IS DISTINCT FROM NEW.revision::text
  OR (NEW.kind IN('audio','raw_response') AND NEW.revision<>0)
  OR (NEW.kind IN('transcript','srt','vtt') AND NEW.revision<1)
  OR (NEW.kind='audio' AND j.kind<>'speech') OR (NEW.kind<>'audio' AND j.kind<>'transcription')
 THEN RAISE EXCEPTION 'Audio artifact must retain its exact origin, privacy and revision' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ai_audio_artifact_binding BEFORE INSERT ON ai_audio_job_artifacts FOR EACH ROW EXECUTE FUNCTION guard_ai_audio_artifact_binding();
CREATE FUNCTION guard_ai_audio_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Retained audio operation cannot be deleted' USING ERRCODE='23514'; END IF;
 IF NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'Audio revision must advance once' USING ERRCODE='23514'; END IF;
 IF (to_jsonb(NEW)-ARRAY['state','usage_known','billable_units','actual_micros','request_hash','response_sha256','response_bytes','duration_ms',
   'decoded_media','error_code','delivery_state','subtitle_revision','revision','dispatched_at','finished_at','cancel_requested_at','erased_at','specification'])
 IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','usage_known','billable_units','actual_micros','request_hash','response_sha256','response_bytes','duration_ms',
   'decoded_media','error_code','delivery_state','subtitle_revision','revision','dispatched_at','finished_at','cancel_requested_at','erased_at','specification'])
 THEN RAISE EXCEPTION 'Immutable audio intent' USING ERRCODE='23514'; END IF;
 IF NEW.specification IS DISTINCT FROM OLD.specification AND NOT(OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
   AND NEW.specification='{}'::jsonb AND EXISTS(SELECT 1 FROM tasks WHERE id=OLD.task_id AND content_state='deleted'))
 THEN RAISE EXCEPTION 'Audio intent can only be erased with its task' USING ERRCODE='23514'; END IF;
 IF (OLD.erased_at IS NOT NULL AND (NEW.erased_at IS DISTINCT FROM OLD.erased_at OR NEW.specification<>'{}'::jsonb))
  OR (OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at)
  OR (OLD.request_hash IS NOT NULL AND NEW.request_hash IS DISTINCT FROM OLD.request_hash)
  OR (OLD.response_sha256 IS NOT NULL AND (NEW.response_sha256 IS DISTINCT FROM OLD.response_sha256 OR NEW.response_bytes IS DISTINCT FROM OLD.response_bytes))
  OR (OLD.usage_known AND (NOT NEW.usage_known OR NEW.billable_units IS DISTINCT FROM OLD.billable_units))
  OR (OLD.duration_ms IS NOT NULL AND (NEW.duration_ms IS DISTINCT FROM OLD.duration_ms OR NEW.decoded_media IS DISTINCT FROM OLD.decoded_media))
  OR (OLD.cancel_requested_at IS NOT NULL AND NEW.cancel_requested_at IS DISTINCT FROM OLD.cancel_requested_at)
  OR NEW.subtitle_revision NOT IN(OLD.subtitle_revision,OLD.subtitle_revision+1)
 THEN RAISE EXCEPTION 'Immutable audio identity or outcome' USING ERRCODE='23514'; END IF;
 IF (OLD.state='prepared' AND NEW.state NOT IN('prepared','dispatched','cancelled'))
  OR (OLD.state='dispatched' AND NEW.state NOT IN('dispatched','completed','unknown'))
  OR (OLD.state='unknown' AND NEW.state NOT IN('unknown','completed'))
  OR (OLD.state IN('completed','cancelled') AND NEW.state<>OLD.state)
 THEN RAISE EXCEPTION 'Invalid audio transition; unknown submissions cannot be retried' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_ai_audio_job BEFORE UPDATE OR DELETE ON ai_audio_jobs FOR EACH ROW EXECUTE FUNCTION guard_ai_audio_job();
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['ai_audio_jobs','ai_audio_job_events','ai_audio_job_artifacts'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('CREATE POLICY audio_control ON %I USING(current_user=''cp_control'') WITH CHECK(current_user=''cp_control'')',n);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,cp_app,cp_queue',n);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON ai_audio_jobs TO cp_control;
GRANT SELECT,INSERT ON ai_audio_job_events,ai_audio_job_artifacts TO cp_control;
-- Content reads go through actor-authorized server transactions. cp_app has no
-- direct prompt/transcript access, including within another project of a tenant.

-- Preserve every preceding budget implementation and its original OID.
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('ai_budget_used(uuid,uuid)'::regprocedure);
 EXECUTE replace(definition,'FUNCTION public.ai_budget_used(','FUNCTION public.ai_budget_used_before_audio(');
 definition:=pg_get_functiondef('ai_budget_subject_blocked(uuid)'::regprocedure);
 EXECUTE replace(definition,'FUNCTION public.ai_budget_subject_blocked(','FUNCTION public.ai_budget_subject_blocked_before_audio(');
 definition:=pg_get_functiondef('task_ai_budget_receipt(uuid)'::regprocedure);
 EXECUTE replace(definition,'FUNCTION public.task_ai_budget_receipt(','FUNCTION public.task_ai_budget_receipt_before_audio(');
END $$;
ALTER FUNCTION ai_budget_used_before_audio(uuid,uuid) OWNER TO cp_control;
ALTER FUNCTION ai_budget_subject_blocked_before_audio(uuid) OWNER TO cp_control;
ALTER FUNCTION task_ai_budget_receipt_before_audio(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION ai_budget_used_before_audio(uuid,uuid),ai_budget_subject_blocked_before_audio(uuid),task_ai_budget_receipt_before_audio(uuid) FROM PUBLIC,cp_app,cp_queue;
CREATE OR REPLACE FUNCTION ai_budget_used(p_envelope uuid,p_period uuid) RETURNS numeric
 LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.ai_budget_used_before_audio(p_envelope,p_period)
 +coalesce((SELECT sum(CASE WHEN usage_known THEN actual_micros ELSE quoted_micros END)*1000000
 FROM public.ai_audio_jobs WHERE p_envelope IS NOT NULL AND envelope_id=p_envelope),0)
$$;
CREATE OR REPLACE FUNCTION ai_budget_subject_blocked(p_envelope uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.ai_budget_subject_blocked_before_audio(p_envelope)
 OR EXISTS(SELECT 1 FROM public.ai_audio_jobs WHERE envelope_id=p_envelope AND state='unknown' AND NOT usage_known)
$$;
CREATE OR REPLACE FUNCTION task_ai_budget_receipt(p_task uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r jsonb; a record;
BEGIN
 r:=public.task_ai_budget_receipt_before_audio(p_task); -- Includes original caller scope validation.
 SELECT count(*) AS n,coalesce(sum(actual_micros) FILTER(WHERE usage_known),0)*1000000 AS numerator,
 coalesce(bool_or(NOT usage_known),false) AS uncertain INTO a FROM public.ai_audio_jobs WHERE task_id=p_task;
 RETURN r||jsonb_build_object('requests',(r->>'requests')::bigint+a.n,
  'numerator',((r->>'numerator')::numeric+a.numerator)::text,'uncertain',(r->>'uncertain')::boolean OR a.uncertain);
END $$;
-- Add audio to the existing single capacity/RPM count, preserving text, image,
-- video, input counting, verification and administrative termination overlays.
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('ai_gateway_limit_reason(uuid,uuid,uuid,text,text,uuid)'::regprocedure);
 IF position(') q;' IN definition)=0 OR position('WHEN ''video'' THEN p.video_slots' IN definition)=0
 THEN RAISE EXCEPTION 'Unexpected pre-audio capacity implementation'; END IF;
 definition:=replace(definition,') q;',$insert$
 UNION ALL SELECT tenant_id,actor_id,'task','audio',NOT usage_known,
  dispatched_at>stamp-interval '1 minute' OR (state='prepared' AND created_at>stamp-interval '1 minute')
 FROM public.ai_audio_jobs WHERE data_mode=p.data_mode AND id IS DISTINCT FROM p_exclude
  AND (NOT usage_known OR dispatched_at>stamp-interval '1 minute')
 ) q;$insert$);
 definition:=replace(definition,'WHEN ''video'' THEN p.video_slots','WHEN ''video'' THEN p.video_slots WHEN ''audio'' THEN p.audio_slots');
 definition:=replace(definition,'WHEN ''video'' THEN p.video_rpm','WHEN ''video'' THEN p.video_rpm WHEN ''audio'' THEN p.audio_rpm');
 EXECUTE definition;
END $$;

CREATE FUNCTION prepare_ai_audio_job(p_task uuid,p_fencing uuid,p_call text,p_spec jsonb,p_hash text,p_capability uuid,
 p_source uuid,p_version integer,p_source_hash text,p_probe jsonb,p_units bigint)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.tasks%ROWTYPE; c public.internal_capability_versions%ROWTYPE;e public.ai_request_budget_envelopes%ROWTYPE;
 j public.ai_audio_jobs%ROWTYPE;policy uuid;rate bigint;amount numeric;reason text;kind text;unit text;
BEGIN
 SELECT * INTO STRICT t FROM public.tasks WHERE id=p_task FOR UPDATE;
 IF t.id IS DISTINCT FROM nullif(current_setting('app.task_id',true),'')::uuid
  OR t.tenant_id IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
  OR t.created_by IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'')::uuid
  OR t.data_mode IS DISTINCT FROM current_setting('app.data_mode',true) OR t.status<>'running'
  OR t.fencing_token IS DISTINCT FROM p_fencing OR t.lease_until<=clock_timestamp() OR t.cancel_requested
  OR t.content_state<>'active' OR t.mode<>'execute'
 THEN RAISE EXCEPTION 'Invalid audio task authority' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('ai-gateway:'||t.data_mode,0));
 SELECT * INTO j FROM public.ai_audio_jobs WHERE task_id=p_task AND (call_id=p_call OR specification_hash=p_hash) ORDER BY created_at,id LIMIT 1;
 IF j.id IS NOT NULL THEN
  IF j.specification IS DISTINCT FROM p_spec OR j.specification_hash IS DISTINCT FROM p_hash OR j.capability_version_id IS DISTINCT FROM p_capability
  THEN RAISE EXCEPTION 'Audio operation replay changed' USING ERRCODE='23514'; END IF;
  RETURN j.id;
 END IF;
 kind:=p_spec->>'kind';unit:=CASE kind WHEN 'speech' THEN 'unicode_scalar' WHEN 'transcription' THEN 'input_millisecond' ELSE NULL END;
 SELECT * INTO c FROM public.internal_capability_versions WHERE id=p_capability;
 IF c.id IS NULL OR NOT c.ready OR c.revoked OR c.data_mode<>t.data_mode
  OR c.profile_key IS DISTINCT FROM (CASE kind WHEN 'speech' THEN 'internal-speech-v1' WHEN 'transcription' THEN 'internal-transcription-v1' ELSE '' END)
  OR c.body->>'wire_protocol' IS DISTINCT FROM (CASE kind WHEN 'speech' THEN 'openai-speech-wav-v1' ELSE 'openai-file-transcription-v1' END)
  OR c.body->>'gateway_fingerprint' IS DISTINCT FROM current_setting('app.ai_gateway_fingerprint',true)
  OR NOT EXISTS(SELECT 1 FROM public.task_runtime_bindings WHERE task_id=p_task AND p_capability=ANY(capability_version_ids))
 THEN RAISE EXCEPTION 'Invalid frozen audio capability' USING ERRCODE='42501'; END IF;
 IF unit IS NULL OR p_units NOT BETWEEN 1 AND 600000 OR jsonb_array_length(c.body->'rates')<>1
  OR NOT(c.body#>'{limits,locales}' ? (p_spec->>'locale'))
  OR (c.body#>>'{rates,0}') !~ '^[1-9][0-9]*$' OR p_spec#>>'{rights,authorized}' IS DISTINCT FROM 'true'
  OR (kind='speech' AND (p_units<>char_length(p_spec->>'text') OR p_units>4096 OR p_source IS NOT NULL
   OR NOT(c.body#>'{limits,voices}' ? (p_spec->>'voice'))))
  OR (kind='transcription' AND (p_units IS DISTINCT FROM (p_probe->>'duration_ms')::bigint OR p_source IS NULL
   OR p_probe->>'sha256' IS DISTINCT FROM p_source_hash OR p_probe->>'fully_decoded' IS DISTINCT FROM 'true'
   OR NOT EXISTS(SELECT 1 FROM public.assets a JOIN public.asset_versions v ON v.asset_id=a.id AND v.version=p_version
     WHERE a.id=p_source AND a.tenant_id=t.tenant_id AND a.project_id=t.project_id AND a.state='active'
     AND (a.private_owner IS NULL OR a.private_owner=t.private_owner) AND a.retention_expires_at>clock_timestamp()
     AND v.erased_at IS NULL AND v.sha256=p_source_hash AND public.video_asset_available(a.id) AND public.task_asset_version_sources_available(v.id))))
 THEN RAISE EXCEPTION 'Invalid audio specification or source' USING ERRCODE='23514'; END IF;
 rate:=(c.body#>>'{rates,0}')::bigint;amount:=rate::numeric*p_units::numeric;
 SELECT * INTO e FROM public.ai_request_budget_envelopes WHERE task_id=p_task AND subject_kind='task';
 IF amount>9007199254740991 OR e.id IS NULL OR NOT EXISTS(SELECT 1 FROM public.reservations WHERE task_id=p_task AND status='reserved' AND amount_micros=e.amount_micros)
  OR public.ai_budget_subject_blocked(e.id) OR public.ai_budget_used(e.id,NULL)+amount*1000000>e.amount_micros::numeric*1000000
 THEN RAISE EXCEPTION 'Audio task budget unavailable' USING ERRCODE='23514'; END IF;
 SELECT policy_version_id INTO STRICT policy FROM public.ai_gateway_policy_heads WHERE data_mode=t.data_mode;
 reason:=public.ai_gateway_limit_reason(policy,t.tenant_id,t.created_by,'audio','task');
 IF reason IS NOT NULL THEN RAISE EXCEPTION 'Audio provider capacity unavailable: %',reason USING ERRCODE='53300'; END IF;
 INSERT INTO public.ai_audio_jobs(tenant_id,project_id,task_id,actor_id,private_owner,origin_fencing,origin_attempt,data_mode,envelope_id,capability_version_id,policy_version_id,
  call_id,kind,specification,specification_hash,model_alias,gateway_fingerprint,rate_micros,quoted_units,pricing_unit,quoted_micros,
  source_asset_id,source_version,source_sha256,source_probe)
 VALUES(t.tenant_id,t.project_id,t.id,t.created_by,t.private_owner,t.fencing_token,t.attempt,t.data_mode,e.id,c.id,policy,p_call,kind,p_spec,p_hash,c.body->>'model_alias',
  c.body->>'gateway_fingerprint',rate,p_units,unit,amount::bigint,p_source,p_version,p_source_hash,p_probe) RETURNING * INTO j;
 INSERT INTO public.ai_audio_job_events(job_id,kind,body) VALUES(j.id,'prepared',jsonb_build_object('operation_id',j.operation_id,'quoted_micros',j.quoted_micros::text));
 RETURN j.id;
END $$;
ALTER FUNCTION prepare_ai_audio_job(uuid,uuid,text,jsonb,text,uuid,uuid,integer,text,jsonb,bigint) OWNER TO cp_control;
REVOKE ALL ON FUNCTION prepare_ai_audio_job(uuid,uuid,text,jsonb,text,uuid,uuid,integer,text,jsonb,bigint) FROM PUBLIC,cp_app,cp_queue;
GRANT EXECUTE ON FUNCTION prepare_ai_audio_job(uuid,uuid,text,jsonb,text,uuid,uuid,integer,text,jsonb,bigint) TO cp_control;

CREATE FUNCTION stop_ai_audio_task() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.cancel_requested OR NEW.content_state<>'active' OR NEW.status IN('failed','cancelled','reconciling') THEN
  WITH changed AS (UPDATE public.ai_audio_jobs SET cancel_requested_at=coalesce(cancel_requested_at,clock_timestamp()),
   state=CASE WHEN state='prepared' THEN 'cancelled' ELSE 'unknown' END,
   usage_known=(state='prepared'),billable_units=CASE WHEN state='prepared' THEN 0 ELSE NULL END,
   error_code=CASE WHEN state='prepared' THEN 'CANCELLED_BEFORE_DISPATCH' ELSE 'ORIGINATOR_NOT_ACTIVE' END,
   finished_at=clock_timestamp(),revision=revision+1 WHERE task_id=NEW.id AND state IN('prepared','dispatched') RETURNING id,state)
  INSERT INTO public.ai_audio_job_events(job_id,kind) SELECT id,state FROM changed;
 END IF;
 IF NEW.content_state='deleted' THEN
  WITH changed AS (UPDATE public.ai_audio_jobs SET specification='{}',erased_at=clock_timestamp(),revision=revision+1
   WHERE task_id=NEW.id AND erased_at IS NULL RETURNING id)
  INSERT INTO public.ai_audio_job_events(job_id,kind) SELECT id,'erased' FROM changed;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION stop_ai_audio_task() OWNER TO cp_control;
REVOKE ALL ON FUNCTION stop_ai_audio_task() FROM PUBLIC;
CREATE TRIGGER ai_audio_origin_stopped AFTER UPDATE OF status,cancel_requested,content_state ON tasks FOR EACH ROW EXECUTE FUNCTION stop_ai_audio_task();

CREATE FUNCTION audio_asset_available(asset uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT NOT EXISTS(SELECT 1 FROM public.ai_audio_job_artifacts a JOIN public.ai_audio_jobs j ON j.id=a.job_id
  JOIN public.tasks t ON t.id=j.task_id JOIN public.internal_capability_versions c ON c.id=j.capability_version_id
  WHERE a.asset_id=asset AND (j.erased_at IS NOT NULL OR t.content_state<>'active' OR c.revoked
    OR EXISTS(SELECT 1 FROM public.assets s JOIN public.asset_versions v ON v.asset_id=s.id AND v.version=j.source_version
     WHERE s.id=j.source_asset_id AND (s.state<>'active' OR s.retention_expires_at<=clock_timestamp() OR v.erased_at IS NOT NULL))))
$$;
ALTER FUNCTION audio_asset_available(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION audio_asset_available(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION audio_asset_available(uuid) TO cp_app,cp_control;
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('video_asset_available(uuid)'::regprocedure);
 EXECUTE replace(definition,'FUNCTION public.video_asset_available(','FUNCTION public.video_asset_available_before_audio(');
END $$;
ALTER FUNCTION video_asset_available_before_audio(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION video_asset_available_before_audio(uuid) FROM PUBLIC,cp_app,cp_queue;
CREATE OR REPLACE FUNCTION video_asset_available(asset uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.video_asset_available_before_audio(asset) AND public.audio_asset_available(asset)
$$;
INSERT INTO schema_migrations(version) VALUES(101);
