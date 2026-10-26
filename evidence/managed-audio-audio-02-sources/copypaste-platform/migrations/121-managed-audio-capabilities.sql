-- Additive platform-funded audio verification. SQL001-120 remain unchanged.
ALTER TABLE capability_releases DROP CONSTRAINT capability_releases_profile_key_check;
ALTER TABLE capability_releases ADD CONSTRAINT capability_releases_profile_key_check
 CHECK(profile_key IN('internal-text-v1','internal-image2-v1','internal-video-v1','internal-speech-v1','internal-transcription-v1'));

CREATE TABLE capability_audio_suites (
 validation_id uuid PRIMARY KEY REFERENCES capability_validations(id),
 auth_version integer NOT NULL CHECK(auth_version>0),
 binary_sha256 text NOT NULL CHECK(binary_sha256 ~ '^[a-f0-9]{64}$'),
 plan jsonb NOT NULL CHECK(jsonb_typeof(plan)='array' AND jsonb_array_length(plan) BETWEEN 1 AND 72),
 plan_hash text NOT NULL CHECK(plan_hash ~ '^[a-f0-9]{64}$'),
 quoted_micros bigint NOT NULL CHECK(quoted_micros BETWEEN 1 AND 9007199254740991),
 cancel_requested_at timestamptz,
 error_code text CHECK(error_code ~ '^[A-Z0-9_]{1,100}$'),
 lease_token uuid,lease_until timestamptz,
 next_poll_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((lease_token IS NULL)=(lease_until IS NULL))
);
CREATE TABLE capability_audio_probes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 validation_id uuid NOT NULL REFERENCES capability_audio_suites(validation_id),
 ordinal integer NOT NULL CHECK(ordinal BETWEEN 0 AND 71),
 operation_id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
 actor_id uuid NOT NULL REFERENCES admin_principals(id),
 data_mode text NOT NULL CHECK(data_mode IN('simulated','configured_services')),
 envelope_id uuid NOT NULL REFERENCES ai_request_budget_envelopes(id),
 platform_period_id uuid NOT NULL REFERENCES ai_platform_budget_periods(id),
 policy_version_id uuid NOT NULL REFERENCES ai_gateway_policy_versions(id),
 model_alias text NOT NULL CHECK(length(model_alias) BETWEEN 1 AND 200),
 gateway_fingerprint text NOT NULL CHECK(gateway_fingerprint ~ '^[a-f0-9]{64}$'),
 specification jsonb NOT NULL CHECK(jsonb_typeof(specification)='object'),
 quoted_units bigint NOT NULL CHECK(quoted_units BETWEEN 1 AND 1000000),
 rate_micros bigint NOT NULL CHECK(rate_micros BETWEEN 1 AND 1000000000),
 quoted_micros bigint NOT NULL CHECK(quoted_micros BETWEEN 1 AND 9007199254740991),
 billable_units bigint CHECK(billable_units BETWEEN 0 AND 1000000),
 actual_micros numeric(40,0) GENERATED ALWAYS AS(billable_units::numeric*rate_micros::numeric) STORED,
 state text NOT NULL DEFAULT 'prepared' CHECK(state IN('prepared','dispatched','completed','cancelled','unknown')),
 usage_known boolean NOT NULL DEFAULT false,
 request_hash text CHECK(request_hash ~ '^[a-f0-9]{64}$'),
 source_sha256 text CHECK(source_sha256 ~ '^[a-f0-9]{64}$'),
 response_sha256 text CHECK(response_sha256 ~ '^[a-f0-9]{64}$'),
 response_bytes integer CHECK(response_bytes BETWEEN 1 AND 25000000),
 media jsonb,
 error_code text CHECK(error_code ~ '^[A-Z0-9_]{1,100}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 dispatched_at timestamptz,finished_at timestamptz,verified_at timestamptz,
 UNIQUE(validation_id,ordinal),
 CHECK(quoted_micros::numeric=quoted_units::numeric*rate_micros::numeric),
 CHECK(billable_units IS NULL OR billable_units<=quoted_units),
 CHECK(usage_known=(billable_units IS NOT NULL)),
 CHECK((state IN('prepared','dispatched','unknown') AND NOT usage_known AND finished_at IS NULL)
  OR (state IN('completed','cancelled') AND usage_known AND finished_at IS NOT NULL)),
 CHECK(state<>'prepared' OR (dispatched_at IS NULL AND request_hash IS NULL)),
 CHECK(state<>'dispatched' OR (dispatched_at IS NOT NULL AND request_hash IS NOT NULL)),
 CHECK(state<>'unknown' OR dispatched_at IS NOT NULL),
 CHECK(state<>'cancelled' OR (dispatched_at IS NULL AND billable_units=0)),
 CHECK(state<>'completed' OR (dispatched_at IS NOT NULL AND response_sha256 IS NOT NULL AND response_bytes IS NOT NULL AND media IS NOT NULL)),
 CHECK(verified_at IS NULL OR state='completed')
);

CREATE FUNCTION guard_capability_audio_suite() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['cancel_requested_at','error_code','lease_token','lease_until','next_poll_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['cancel_requested_at','error_code','lease_token','lease_until','next_poll_at'])
  OR (OLD.cancel_requested_at IS NOT NULL AND NEW.cancel_requested_at IS DISTINCT FROM OLD.cancel_requested_at)
  OR (OLD.error_code IS NOT NULL AND NEW.error_code IS DISTINCT FROM OLD.error_code)
 THEN RAISE EXCEPTION 'Immutable audio verification grant or plan' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_capability_audio_suite BEFORE UPDATE OR DELETE ON capability_audio_suites
 FOR EACH ROW EXECUTE FUNCTION guard_capability_audio_suite();
CREATE FUNCTION guard_capability_audio_probe() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NOT EXISTS(SELECT 1 FROM capability_audio_suites s JOIN capability_validations v ON v.id=s.validation_id
    JOIN capability_releases r ON r.id=v.release_id JOIN ai_request_budget_envelopes e ON e.validation_id=v.id
    JOIN ai_platform_budget_periods b ON b.id=NEW.platform_period_id JOIN ai_gateway_policy_versions p ON p.id=NEW.policy_version_id
    WHERE s.validation_id=NEW.validation_id AND v.state='running' AND v.principal_id=NEW.actor_id
     AND r.profile_key IN('internal-speech-v1','internal-transcription-v1')
     AND r.data_mode=NEW.data_mode AND e.data_mode=NEW.data_mode AND b.data_mode=NEW.data_mode AND p.data_mode=NEW.data_mode
     AND e.subject_kind='validation' AND e.id=NEW.envelope_id AND b.purpose='verification'
     AND r.definition->>'model_alias'=NEW.model_alias AND r.gateway_fingerprint=NEW.gateway_fingerprint
     AND (r.definition->'rates'->>0)::bigint=NEW.rate_micros
     AND s.plan->NEW.ordinal=NEW.specification AND NEW.state='prepared')
  THEN RAISE EXCEPTION 'Audio verification does not match its frozen platform grant' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' OR OLD.usage_known OR OLD.state='unknown'
  OR (to_jsonb(NEW)-ARRAY['state','usage_known','billable_units','actual_micros','request_hash','source_sha256','response_sha256','response_bytes','media','error_code','dispatched_at','finished_at','verified_at'])
   IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','usage_known','billable_units','actual_micros','request_hash','source_sha256','response_sha256','response_bytes','media','error_code','dispatched_at','finished_at','verified_at'])
  OR (OLD.request_hash IS NOT NULL AND NEW.request_hash IS DISTINCT FROM OLD.request_hash)
  OR (OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at)
  OR NOT ((OLD.state='prepared' AND NEW.state IN('dispatched','cancelled'))
    OR (OLD.state='dispatched' AND NEW.state IN('completed','unknown')))
 THEN RAISE EXCEPTION 'Immutable audio verification operation or outcome' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_capability_audio_probe BEFORE INSERT OR UPDATE OR DELETE ON capability_audio_probes
 FOR EACH ROW EXECUTE FUNCTION guard_capability_audio_probe();
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['capability_audio_suites','capability_audio_probes'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('CREATE POLICY capability_audio_control ON %I USING(current_user=''cp_control'') WITH CHECK(current_user=''cp_control'')',n);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,cp_app,cp_queue',n);
 END LOOP;
END $$;
GRANT SELECT,INSERT,UPDATE ON capability_audio_suites,capability_audio_probes TO cp_control;

-- Keep the old function OIDs and complete canonical billing history.
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('ai_budget_used(uuid,uuid)'::regprocedure);
 IF position('FUNCTION public.ai_budget_used(' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected budget implementation'; END IF;
 EXECUTE replace(definition,'FUNCTION public.ai_budget_used(','FUNCTION public.ai_budget_used_before_audio_validation(');
 definition:=pg_get_functiondef('ai_budget_subject_blocked(uuid)'::regprocedure);
 IF position('FUNCTION public.ai_budget_subject_blocked(' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected subject implementation'; END IF;
 EXECUTE replace(definition,'FUNCTION public.ai_budget_subject_blocked(','FUNCTION public.ai_budget_subject_blocked_before_audio_validation(');
END $$;
ALTER FUNCTION ai_budget_used_before_audio_validation(uuid,uuid) OWNER TO cp_control;
ALTER FUNCTION ai_budget_subject_blocked_before_audio_validation(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION ai_budget_used_before_audio_validation(uuid,uuid),ai_budget_subject_blocked_before_audio_validation(uuid) FROM PUBLIC,cp_app,cp_queue;
CREATE OR REPLACE FUNCTION ai_budget_used(p_envelope uuid,p_period uuid) RETURNS numeric
 LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.ai_budget_used_before_audio_validation(p_envelope,p_period)
 +coalesce((SELECT sum(CASE WHEN usage_known THEN actual_micros ELSE quoted_micros END)*1000000
  FROM public.capability_audio_probes WHERE (p_envelope IS NOT NULL AND envelope_id=p_envelope)
   OR (p_period IS NOT NULL AND platform_period_id=p_period)),0)
$$;
CREATE OR REPLACE FUNCTION ai_budget_subject_blocked(p_envelope uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.ai_budget_subject_blocked_before_audio_validation(p_envelope)
 OR EXISTS(SELECT 1 FROM public.capability_audio_probes WHERE envelope_id=p_envelope AND state='unknown' AND NOT usage_known)
$$;
ALTER FUNCTION ai_budget_used(uuid,uuid) OWNER TO cp_control;
ALTER FUNCTION ai_budget_subject_blocked(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION ai_budget_used(uuid,uuid),ai_budget_subject_blocked(uuid) FROM PUBLIC,cp_app,cp_queue;
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('ai_gateway_limit_reason(uuid,uuid,uuid,text,text,uuid)'::regprocedure);
 IF position('FROM public.ai_audio_jobs' IN definition)=0 OR position(' ) q;' IN definition)=0
  OR position('FROM public.capability_audio_probes' IN definition)>0 THEN RAISE EXCEPTION 'Unexpected pre-validation audio capacity implementation'; END IF;
 definition:=replace(definition,' ) q;',E' UNION ALL SELECT NULL::uuid,actor_id,''validation'',''audio'',NOT usage_known,\n'
  ||E' dispatched_at>stamp-interval ''1 minute'' OR (state=''prepared'' AND created_at>stamp-interval ''1 minute'')\n'
  ||E' FROM public.capability_audio_probes WHERE data_mode=p.data_mode AND id IS DISTINCT FROM p_exclude\n'
  ||E' AND (NOT usage_known OR dispatched_at>stamp-interval ''1 minute'')\n ) q;');
 EXECUTE definition;
END $$;
INSERT INTO schema_migrations(version) VALUES(121);
