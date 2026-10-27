-- Forward-only control-plane video verification. SQL001-097 stay immutable.
ALTER TABLE capability_releases DROP CONSTRAINT capability_releases_profile_key_check;
ALTER TABLE capability_releases ADD CONSTRAINT capability_releases_profile_key_check
 CHECK(profile_key IN('internal-text-v1','internal-image2-v1','internal-video-v1'));

CREATE TABLE capability_video_suites (
 validation_id uuid PRIMARY KEY REFERENCES capability_validations(id),
 auth_version integer NOT NULL CHECK(auth_version>0),
 binary_sha256 text NOT NULL CHECK(binary_sha256 ~ '^[a-f0-9]{64}$'),
 plan jsonb NOT NULL CHECK(jsonb_typeof(plan)='array' AND jsonb_array_length(plan)=16),
 plan_hash text NOT NULL CHECK(plan_hash ~ '^[a-f0-9]{64}$'),
 quoted_micros bigint NOT NULL CHECK(quoted_micros BETWEEN 1 AND 9007199254740991),
 cancel_requested_at timestamptz,
 error_code text CHECK(error_code ~ '^[A-Z0-9_]{1,100}$'),
 lease_token uuid, lease_until timestamptz,
 next_poll_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((lease_token IS NULL)=(lease_until IS NULL))
);
CREATE TABLE capability_video_probes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), validation_id uuid NOT NULL REFERENCES capability_video_suites(validation_id),
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 15), operation_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 actor_id uuid NOT NULL REFERENCES admin_principals(id), data_mode text NOT NULL CHECK(data_mode IN('simulated','configured_services')),
 envelope_id uuid NOT NULL REFERENCES ai_request_budget_envelopes(id),
 platform_period_id uuid NOT NULL REFERENCES ai_platform_budget_periods(id),
 policy_version_id uuid NOT NULL REFERENCES ai_gateway_policy_versions(id),
 model_alias text NOT NULL CHECK(length(model_alias) BETWEEN 1 AND 200),
 gateway_fingerprint text NOT NULL CHECK(gateway_fingerprint ~ '^[a-f0-9]{64}$'),
 specification jsonb NOT NULL CHECK(jsonb_typeof(specification)='object'),
 size text NOT NULL CHECK(size IN('720x1280','1280x720','1024x1024')),
 seconds integer NOT NULL CHECK(seconds IN(4,8,12,16,20)),
 rate_micros bigint NOT NULL CHECK(rate_micros BETWEEN 1 AND 1000000000000),
 quoted_micros bigint NOT NULL CHECK(quoted_micros BETWEEN 1 AND 9007199254740991),
 actual_micros numeric(40,0) GENERATED ALWAYS AS(billable_seconds::numeric*rate_micros::numeric) STORED,
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','submitting','queued','in_progress','completed','failed','cancelled','unknown')),
 provider_id text CHECK(provider_id ~ '^[a-zA-Z0-9_-]{1,160}$'),
 provider_sequence bigint CHECK(provider_sequence BETWEEN 0 AND 9007199254740991),
 progress integer CHECK(progress BETWEEN 0 AND 100),
 usage_known boolean NOT NULL DEFAULT false,
 billable_seconds bigint CHECK(billable_seconds BETWEEN 0 AND 9007199254740991),
 content_sha256 text CHECK(content_sha256 ~ '^[a-f0-9]{64}$'),
 content_bytes integer CHECK(content_bytes BETWEEN 1 AND 100000000),
 operations text[] NOT NULL DEFAULT '{}',
 decoded_media jsonb, verified_at timestamptz,
 error_code text CHECK(error_code ~ '^[A-Z0-9_]{1,100}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), dispatched_at timestamptz,
 observed_at timestamptz, cancel_sent_at timestamptz, cancel_observed_at timestamptz,
 UNIQUE(validation_id,ordinal),
 CHECK(quoted_micros::numeric=seconds::numeric*rate_micros::numeric),
 CHECK(usage_known=(billable_seconds IS NOT NULL)),
 CHECK(NOT usage_known OR state IN('completed','failed','cancelled')),
 CHECK(state<>'prepared' OR (dispatched_at IS NULL AND provider_id IS NULL)),
 CHECK(state<>'completed' OR (provider_id IS NOT NULL AND content_sha256 IS NOT NULL AND content_bytes IS NOT NULL)),
 CHECK(verified_at IS NULL OR (usage_known AND ((ordinal=15 AND state='cancelled' AND cancel_observed_at IS NOT NULL) OR (ordinal<15 AND state='completed' AND decoded_media IS NOT NULL))))
);
CREATE TABLE capability_video_observations (
 probe_id uuid NOT NULL REFERENCES capability_video_probes(id), event_id uuid NOT NULL,
 sequence bigint NOT NULL CHECK(sequence BETWEEN 0 AND 9007199254740991),
 body_hash text NOT NULL CHECK(body_hash ~ '^[a-f0-9]{64}$'),
 body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(probe_id,event_id), UNIQUE(probe_id,sequence)
);
CREATE TABLE capability_video_budget_violations (
 probe_id uuid PRIMARY KEY REFERENCES capability_video_probes(id),
 envelope_id uuid NOT NULL REFERENCES ai_request_budget_envelopes(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), code text NOT NULL CHECK(code='ALLOCATION_EXCEEDED')
);
CREATE TRIGGER immutable_capability_video_observation BEFORE UPDATE OR DELETE ON capability_video_observations
 FOR EACH ROW EXECUTE FUNCTION guard_ai_gateway_history();
CREATE TRIGGER immutable_capability_video_violation BEFORE UPDATE OR DELETE ON capability_video_budget_violations
 FOR EACH ROW EXECUTE FUNCTION guard_ai_gateway_history();

CREATE FUNCTION guard_capability_video_suite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['cancel_requested_at','error_code','lease_token','lease_until','next_poll_at'])
  IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['cancel_requested_at','error_code','lease_token','lease_until','next_poll_at'])
  OR (OLD.cancel_requested_at IS NOT NULL AND NEW.cancel_requested_at IS DISTINCT FROM OLD.cancel_requested_at)
 THEN RAISE EXCEPTION 'Immutable video verification grant' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_capability_video_suite BEFORE UPDATE OR DELETE ON capability_video_suites
 FOR EACH ROW EXECUTE FUNCTION guard_capability_video_suite();
CREATE FUNCTION guard_capability_video_probe() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['state','provider_id','provider_sequence','progress','usage_known','billable_seconds','actual_micros',
  'content_sha256','content_bytes','operations','decoded_media','verified_at','error_code','dispatched_at','observed_at','cancel_sent_at','cancel_observed_at'])
  IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','provider_id','provider_sequence','progress','usage_known','billable_seconds','actual_micros',
  'content_sha256','content_bytes','operations','decoded_media','verified_at','error_code','dispatched_at','observed_at','cancel_sent_at','cancel_observed_at'])
  OR (OLD.provider_id IS NOT NULL AND NEW.provider_id IS DISTINCT FROM OLD.provider_id)
  OR (OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at)
  OR (OLD.usage_known AND (NOT NEW.usage_known OR NEW.billable_seconds IS DISTINCT FROM OLD.billable_seconds))
  OR (OLD.state IN('completed','failed','cancelled') AND NEW.state<>OLD.state)
  OR (OLD.state<>'prepared' AND NEW.state='prepared')
  OR (OLD.content_sha256 IS NOT NULL AND (NEW.content_sha256 IS DISTINCT FROM OLD.content_sha256 OR NEW.content_bytes IS DISTINCT FROM OLD.content_bytes))
  OR (OLD.verified_at IS NOT NULL AND (NEW.verified_at IS DISTINCT FROM OLD.verified_at OR NEW.decoded_media IS DISTINCT FROM OLD.decoded_media))
  OR (OLD.cancel_observed_at IS NOT NULL AND NEW.cancel_observed_at IS DISTINCT FROM OLD.cancel_observed_at)
  OR NOT OLD.operations<@NEW.operations
 THEN RAISE EXCEPTION 'Immutable video verification operation or outcome' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_capability_video_probe BEFORE UPDATE OR DELETE ON capability_video_probes
 FOR EACH ROW EXECUTE FUNCTION guard_capability_video_probe();
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['capability_video_suites','capability_video_probes','capability_video_observations','capability_video_budget_violations'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('CREATE POLICY capability_video_control ON %I USING(current_user=''cp_control'') WITH CHECK(current_user=''cp_control'')',n);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,cp_app,cp_queue',n);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON capability_video_suites,capability_video_probes TO cp_control;
GRANT SELECT,INSERT ON capability_video_observations,capability_video_budget_violations TO cp_control;

-- Preserve the complete prior canonical ledger (including counting/reviews).
-- Copy the old implementation, then replace the original entry in place.
-- Its OID must survive an upgrade with existing prepared statements/callers.
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('ai_budget_used(uuid,uuid)'::regprocedure);
 IF position('FUNCTION public.ai_budget_used(' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected budget function definition'; END IF;
 EXECUTE replace(definition,'FUNCTION public.ai_budget_used(','FUNCTION public.ai_budget_used_before_video_validation(');
END $$;
ALTER FUNCTION ai_budget_used_before_video_validation(uuid,uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION ai_budget_used_before_video_validation(uuid,uuid) FROM PUBLIC,cp_app,cp_queue;
CREATE OR REPLACE FUNCTION ai_budget_used(p_envelope uuid,p_period uuid) RETURNS numeric
 LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.ai_budget_used_before_video_validation(p_envelope,p_period)
 +coalesce((SELECT sum(CASE WHEN usage_known THEN actual_micros ELSE quoted_micros END)*1000000
 FROM public.capability_video_probes WHERE (p_envelope IS NOT NULL AND envelope_id=p_envelope)
  OR (p_period IS NOT NULL AND platform_period_id=p_period)),0)
$$;
ALTER FUNCTION ai_budget_used(uuid,uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION ai_budget_used(uuid,uuid) FROM PUBLIC,cp_app,cp_queue;
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('ai_budget_subject_blocked(uuid)'::regprocedure);
 IF position('FUNCTION public.ai_budget_subject_blocked(' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected budget function definition'; END IF;
 EXECUTE replace(definition,'FUNCTION public.ai_budget_subject_blocked(','FUNCTION public.ai_budget_subject_blocked_before_video_validation(');
END $$;
ALTER FUNCTION ai_budget_subject_blocked_before_video_validation(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION ai_budget_subject_blocked_before_video_validation(uuid) FROM PUBLIC,cp_app,cp_queue;
CREATE OR REPLACE FUNCTION ai_budget_subject_blocked(p_envelope uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.ai_budget_subject_blocked_before_video_validation(p_envelope)
 OR EXISTS(SELECT 1 FROM public.capability_video_budget_violations WHERE envelope_id=p_envelope)
 OR EXISTS(SELECT 1 FROM public.capability_video_probes WHERE envelope_id=p_envelope AND state='unknown' AND NOT usage_known)
$$;
ALTER FUNCTION ai_budget_subject_blocked(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION ai_budget_subject_blocked(uuid) FROM PUBLIC,cp_app,cp_queue;

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
  FROM public.current_ai_provider_requests WHERE data_mode=p.data_mode AND id IS DISTINCT FROM p_exclude
    AND (capacity_held OR dispatched_at>stamp-interval '1 minute')
  UNION ALL SELECT tenant_id,actor_id,'task','video',NOT usage_known,
   dispatched_at>stamp-interval '1 minute' OR (state='prepared' AND created_at>stamp-interval '1 minute')
  FROM public.ai_video_jobs WHERE data_mode=p.data_mode AND id IS DISTINCT FROM p_exclude
    AND (NOT usage_known OR dispatched_at>stamp-interval '1 minute')
  UNION ALL SELECT NULL::uuid,actor_id,'validation','video',NOT usage_known,
   dispatched_at>stamp-interval '1 minute' OR (state='prepared' AND created_at>stamp-interval '1 minute')
  FROM public.capability_video_probes WHERE data_mode=p.data_mode AND id IS DISTINCT FROM p_exclude
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
INSERT INTO schema_migrations(version) VALUES(98);
