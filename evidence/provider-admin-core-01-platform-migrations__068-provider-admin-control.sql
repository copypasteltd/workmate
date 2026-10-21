-- Additive Admin control. Original observations, reservations and SQL001-067 remain intact.
CREATE TABLE ai_provider_policy_drafts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), data_mode text NOT NULL CHECK(data_mode IN ('simulated','configured_services')),
 version integer NOT NULL CHECK(version>0), gateway_fingerprint text NOT NULL CHECK(gateway_fingerprint ~ '^[a-f0-9]{64}$'),
 definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),
 actor_id uuid NOT NULL REFERENCES admin_principals(id), operation_id uuid NOT NULL UNIQUE REFERENCES admin_operations(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(data_mode,version), UNIQUE(id,data_mode)
);
CREATE TABLE ai_provider_admin_publications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), data_mode text NOT NULL CHECK(data_mode IN ('simulated','configured_services')),
 draft_id uuid NOT NULL UNIQUE, policy_version_id uuid NOT NULL, budget_policy_id uuid NOT NULL,
 previous_policy_version_id uuid NOT NULL REFERENCES ai_gateway_policy_versions(id),
 previous_budget_policy_id uuid NOT NULL REFERENCES ai_provider_budget_policies(id),
 operation_id uuid NOT NULL UNIQUE REFERENCES admin_operations(id),
 actor_id uuid NOT NULL REFERENCES admin_principals(id), reviewer_id uuid NOT NULL REFERENCES admin_principals(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), CHECK(actor_id<>reviewer_id), UNIQUE(id,data_mode),
 FOREIGN KEY(draft_id,data_mode) REFERENCES ai_provider_policy_drafts(id,data_mode),
 FOREIGN KEY(policy_version_id,data_mode) REFERENCES ai_gateway_policy_versions(id,data_mode),
 FOREIGN KEY(budget_policy_id,data_mode) REFERENCES ai_provider_budget_policies(id,data_mode)
);
CREATE TABLE ai_provider_admin_heads (
 data_mode text PRIMARY KEY CHECK(data_mode IN ('simulated','configured_services')),
 publication_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
 FOREIGN KEY(publication_id,data_mode) REFERENCES ai_provider_admin_publications(id,data_mode)
);
CREATE TABLE ai_provider_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 provider_request_id uuid REFERENCES ai_gateway_requests(id), count_request_id uuid REFERENCES ai_input_count_requests(id),
 data_mode text NOT NULL CHECK(data_mode IN ('simulated','configured_services')),
 canonical_document text NOT NULL CHECK(octet_length(canonical_document)<=40000),
 document jsonb NOT NULL CHECK(document=canonical_document::jsonb),
 document_hash text GENERATED ALWAYS AS (encode(sha256(convert_to(canonical_document,'UTF8')),'hex')) STORED,
 actor_id uuid NOT NULL REFERENCES admin_principals(id), operation_id uuid NOT NULL UNIQUE REFERENCES admin_operations(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(num_nonnulls(provider_request_id,count_request_id)=1)
);
CREATE UNIQUE INDEX ai_provider_evidence_generation_unique ON ai_provider_evidence(provider_request_id,document_hash);
CREATE UNIQUE INDEX ai_provider_evidence_count_unique ON ai_provider_evidence(count_request_id,document_hash);
CREATE TABLE ai_provider_cost_confirmations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 provider_request_id uuid UNIQUE REFERENCES ai_gateway_requests(id), count_request_id uuid UNIQUE REFERENCES ai_input_count_requests(id),
 evidence_id uuid NOT NULL REFERENCES ai_provider_evidence(id), data_mode text NOT NULL CHECK(data_mode IN ('simulated','configured_services')),
 charge_numerator numeric(40,0) NOT NULL CHECK(charge_numerator>=0),
 input_tokens bigint NOT NULL CHECK(input_tokens BETWEEN 0 AND 9007199254740991),
 output_tokens bigint NOT NULL CHECK(output_tokens BETWEEN 0 AND 9007199254740991), image_units integer NOT NULL CHECK(image_units BETWEEN 0 AND 1),
 counted_input_tokens bigint CHECK(counted_input_tokens BETWEEN 0 AND 9007199254740991),
 operation_id uuid NOT NULL UNIQUE REFERENCES admin_operations(id), actor_id uuid NOT NULL REFERENCES admin_principals(id),
 reviewer_id uuid NOT NULL REFERENCES admin_principals(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(num_nonnulls(provider_request_id,count_request_id)=1), CHECK(actor_id<>reviewer_id)
);
CREATE TABLE ai_provider_termination_confirmations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 provider_request_id uuid UNIQUE REFERENCES ai_gateway_requests(id), count_request_id uuid UNIQUE REFERENCES ai_input_count_requests(id),
 evidence_id uuid NOT NULL REFERENCES ai_provider_evidence(id), data_mode text NOT NULL CHECK(data_mode IN ('simulated','configured_services')),
 operation_id uuid NOT NULL UNIQUE REFERENCES admin_operations(id), actor_id uuid NOT NULL REFERENCES admin_principals(id),
 reviewer_id uuid NOT NULL REFERENCES admin_principals(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(num_nonnulls(provider_request_id,count_request_id)=1), CHECK(actor_id<>reviewer_id)
);
CREATE TABLE ai_provider_task_settlements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), task_id uuid NOT NULL UNIQUE REFERENCES tasks(id),
 data_mode text NOT NULL CHECK(data_mode IN ('simulated','configured_services')),
 receipt_hash text NOT NULL CHECK(receipt_hash ~ '^[a-f0-9]{64}$'),
 amount_micros bigint NOT NULL CHECK(amount_micros BETWEEN 0 AND 9007199254740991),
 reservation_micros bigint NOT NULL CHECK(reservation_micros>=amount_micros), charge_id uuid REFERENCES ledger(id),
 operation_id uuid NOT NULL UNIQUE REFERENCES admin_operations(id), actor_id uuid NOT NULL REFERENCES admin_principals(id),
 reviewer_id uuid NOT NULL REFERENCES admin_principals(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(actor_id<>reviewer_id), CHECK((amount_micros=0 AND charge_id IS NULL) OR (amount_micros>0 AND charge_id IS NOT NULL))
);
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['ai_provider_policy_drafts','ai_provider_admin_publications','ai_provider_admin_heads',
 'ai_provider_evidence','ai_provider_cost_confirmations','ai_provider_termination_confirmations','ai_provider_task_settlements'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY provider_admin_control ON %I USING(current_user=''cp_control'') WITH CHECK(current_user=''cp_control'')',tab);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,cp_app,cp_queue',tab);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO cp_control',tab);
  IF tab<>'ai_provider_admin_heads' THEN
   EXECUTE format('CREATE TRIGGER immutable_provider_admin BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_ai_gateway_history()',tab);
  END IF;
 END LOOP;
END $$;
GRANT UPDATE ON ai_provider_admin_heads TO cp_control;

-- This internal view contains no request body, execution nonce, prompt or file path.
CREATE VIEW current_ai_provider_requests AS
 SELECT r.*, c.id AS cost_confirmation_id, c.evidence_id AS cost_evidence_id,
  t.id AS termination_confirmation_id, t.evidence_id AS termination_evidence_id,
  coalesce(c.charge_numerator,r.charge_numerator) AS effective_numerator,
  coalesce(c.input_tokens,r.input_tokens) AS effective_input_tokens,
  coalesce(c.output_tokens,r.output_tokens) AS effective_output_tokens,
  coalesce(c.image_units,r.image_units) AS effective_image_units,
  coalesce(c.counted_input_tokens,r.counted_input_tokens) AS effective_counted_input_tokens,
  CASE WHEN c.id IS NOT NULL THEN 'manually_confirmed' WHEN r.usage_known THEN 'known' ELSE 'unknown' END AS cost_state,
  (r.released_at IS NULL AND t.id IS NULL AND (r.state<>'prepared' OR r.prepared_until>clock_timestamp())) AS capacity_held
 FROM (
  SELECT 'generation'::text AS channel,id,data_mode,subject_kind,task_id,validation_id,tenant_id,project_id,actor_id,
   attempt,capability_version_id,release_id,request_class,operation,operation_id,model_alias,request_hash,request_bytes,
   rate_snapshot,NULL::bigint AS price_micros,policy_version_id,dispatch_policy_version_id,state,prepared_until,
   created_at,dispatched_at,finished_at,released_at,usage_known,input_tokens,output_tokens,image_units,
   NULL::bigint AS counted_input_tokens,charge_numerator,http_status,outcome_code FROM ai_gateway_requests
  UNION ALL
  SELECT 'input_count',id,data_mode,subject_kind,task_id,validation_id,tenant_id,project_id,actor_id,
   attempt,capability_version_id,release_id,'text','responses.input_tokens',operation_id,model_alias,request_hash,request_bytes,
   jsonb_build_array(price_micros),price_micros,policy_version_id,dispatch_policy_version_id,state,prepared_until,
   created_at,dispatched_at,finished_at,released_at,usage_known,0,0,0,counted_input_tokens,charge_numerator,http_status,outcome_code
   FROM ai_input_count_requests
 ) r LEFT JOIN ai_provider_cost_confirmations c ON (r.channel='generation' AND c.provider_request_id=r.id) OR (r.channel='input_count' AND c.count_request_id=r.id)
 LEFT JOIN ai_provider_termination_confirmations t ON (r.channel='generation' AND t.provider_request_id=r.id) OR (r.channel='input_count' AND t.count_request_id=r.id);
ALTER VIEW current_ai_provider_requests OWNER TO cp_control;
REVOKE ALL ON current_ai_provider_requests FROM PUBLIC,cp_app,cp_queue;
GRANT SELECT ON current_ai_provider_requests TO cp_control;

-- Database checks bind human claims to the original observation. They do not
-- assert the claim came from an authenticated provider callback.
CREATE FUNCTION guard_ai_provider_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record; op public.admin_operations%ROWTYPE; d jsonb:=NEW.document;
BEGIN
 SELECT * INTO r FROM public.current_ai_provider_requests WHERE
  (NEW.provider_request_id IS NOT NULL AND channel='generation' AND id=NEW.provider_request_id)
  OR (NEW.count_request_id IS NOT NULL AND channel='input_count' AND id=NEW.count_request_id);
 SELECT * INTO op FROM public.admin_operations WHERE id=NEW.operation_id;
 IF r.id IS NULL OR r.state<>'unknown' OR r.data_mode IS DISTINCT FROM NEW.data_mode
  OR NEW.data_mode IS DISTINCT FROM current_setting('app.data_mode',true)
  OR op.action<>'ai.evidence.write' OR op.state<>'running' OR op.principal_id<>NEW.actor_id
  OR d->>'data_mode' IS DISTINCT FROM r.data_mode OR d->>'operation_id' IS DISTINCT FROM r.operation_id
  OR d->>'request_hash' IS DISTINCT FROM r.request_hash OR d->>'terminated' IS DISTINCT FROM 'true'
  OR d->>'currency' IS DISTINCT FROM 'HKD' OR d->>'schema_version' IS DISTINCT FROM '1'
  OR (d->>'observed_at')::timestamptz>clock_timestamp()
  OR (d->>'observed_at')::timestamptz<r.dispatched_at
  OR d#>>'{usage,kind}' IS DISTINCT FROM CASE WHEN r.channel='input_count' THEN 'input_count' ELSE r.request_class END THEN
  RAISE EXCEPTION 'Evidence does not bind the original unknown request' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bound_ai_provider_evidence BEFORE INSERT ON ai_provider_evidence FOR EACH ROW EXECUTE FUNCTION guard_ai_provider_evidence();

CREATE FUNCTION guard_ai_provider_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e public.ai_provider_evidence%ROWTYPE; r record; op public.admin_operations%ROWTYPE; d jsonb; n numeric;
 i bigint:=0; o bigint:=0; units integer:=0; counted bigint; expected_action text;
BEGIN
 SELECT * INTO STRICT e FROM public.ai_provider_evidence WHERE id=NEW.evidence_id;
 SELECT * INTO STRICT r FROM public.current_ai_provider_requests WHERE
  (NEW.provider_request_id IS NOT NULL AND channel='generation' AND id=NEW.provider_request_id)
  OR (NEW.count_request_id IS NOT NULL AND channel='input_count' AND id=NEW.count_request_id);
 SELECT * INTO STRICT op FROM public.admin_operations WHERE id=NEW.operation_id;
 expected_action:=CASE TG_TABLE_NAME WHEN 'ai_provider_cost_confirmations' THEN 'ai.cost.reconcile' ELSE 'ai.capacity.release' END;
 IF r.state<>'unknown' OR r.data_mode IS DISTINCT FROM NEW.data_mode OR e.data_mode<>NEW.data_mode
  OR NEW.data_mode IS DISTINCT FROM current_setting('app.data_mode',true)
  OR e.provider_request_id IS DISTINCT FROM NEW.provider_request_id OR e.count_request_id IS DISTINCT FROM NEW.count_request_id
  OR op.action<>expected_action OR op.state<>'running' OR op.principal_id<>NEW.actor_id OR op.approved_by IS DISTINCT FROM NEW.reviewer_id THEN
  RAISE EXCEPTION 'Confirmation must bind separately approved evidence' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='ai_provider_cost_confirmations' THEN
  d:=e.document;
  IF r.channel='input_count' THEN
   counted:=(d#>>'{usage,counted_input_tokens}')::bigint;
   n:=CASE WHEN d->>'outcome'='not_executed' THEN 0 ELSE r.price_micros::numeric*1000000 END;
  ELSIF r.request_class='text' THEN
   i:=(d#>>'{usage,input_tokens}')::bigint; o:=(d#>>'{usage,output_tokens}')::bigint;
   n:=i::numeric*(r.rate_snapshot->>0)::numeric+o::numeric*(r.rate_snapshot->>1)::numeric;
  ELSE units:=(d#>>'{usage,image_units}')::integer; n:=units::numeric*(r.rate_snapshot->>0)::numeric*1000000;
  END IF;
  IF n IS NULL OR NEW.charge_numerator IS DISTINCT FROM n OR (d->>'billed_micros')::numeric IS DISTINCT FROM ceil(n/1000000)
   OR NEW.input_tokens IS DISTINCT FROM i OR NEW.output_tokens IS DISTINCT FROM o OR NEW.image_units IS DISTINCT FROM units
   OR NEW.counted_input_tokens IS DISTINCT FROM counted
   OR (d->>'outcome'='not_executed' AND (n<>0 OR i<>0 OR o<>0 OR units<>0 OR counted IS NOT NULL)) THEN
   RAISE EXCEPTION 'Evidence fee must match frozen rates and units' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bound_ai_provider_cost BEFORE INSERT ON ai_provider_cost_confirmations FOR EACH ROW EXECUTE FUNCTION guard_ai_provider_confirmation();
CREATE TRIGGER bound_ai_provider_termination BEFORE INSERT ON ai_provider_termination_confirmations FOR EACH ROW EXECUTE FUNCTION guard_ai_provider_confirmation();

CREATE OR REPLACE FUNCTION ai_budget_used(p_envelope uuid,p_period uuid) RETURNS numeric
 LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT coalesce(sum(CASE WHEN r.cost_state='manually_confirmed' THEN r.effective_numerator
   WHEN r.state='completed' THEN r.charge_numerator WHEN r.state IN ('cancelled','denied') THEN 0
   WHEN r.state='prepared' AND r.prepared_until<=clock_timestamp() THEN 0 ELSE a.amount_numerator END),0)
 FROM public.ai_request_budget_allocations a JOIN public.current_ai_provider_requests r
 ON (r.channel='generation' AND r.id=a.provider_request_id) OR (r.channel='input_count' AND r.id=a.count_request_id)
 WHERE (p_envelope IS NOT NULL AND a.envelope_id=p_envelope) OR (p_period IS NOT NULL AND a.platform_period_id=p_period)
$$;
CREATE OR REPLACE FUNCTION ai_budget_subject_blocked(p_envelope uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM public.ai_request_budget_violations WHERE envelope_id=p_envelope)
 OR EXISTS(SELECT 1 FROM public.current_ai_provider_requests r JOIN public.ai_request_budget_envelopes e
 ON r.task_id=e.task_id OR r.validation_id=e.validation_id WHERE e.id=p_envelope AND r.state='unknown' AND r.cost_state='unknown')
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
 SELECT jsonb_build_object('requests',count(*),'numerator',coalesce(sum(effective_numerator) FILTER(WHERE cost_state<>'unknown'),0)::text,
  'input_tokens',coalesce(sum(effective_input_tokens) FILTER(WHERE cost_state<>'unknown'),0)::text,
  'output_tokens',coalesce(sum(effective_output_tokens) FILTER(WHERE cost_state<>'unknown'),0)::text,
  'uncertain',coalesce(bool_or(state='dispatched' OR (state='unknown' AND cost_state='unknown')),false),
  'violation',EXISTS(SELECT 1 FROM public.ai_request_budget_violations x JOIN public.ai_gateway_requests q ON q.id=x.provider_request_id WHERE q.task_id=p_task))
 INTO receipt FROM public.current_ai_provider_requests WHERE task_id=p_task AND channel='generation';
 RETURN receipt;
END $$;

-- Published pricing declarations are tied to this gateway; changing an endpoint
-- cannot carry an old counting qualification to a new service.
CREATE FUNCTION guard_ai_published_count_gateway() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (TG_OP='INSERT' OR NEW.state='dispatched') AND EXISTS(
  SELECT 1 FROM public.ai_provider_admin_heads h JOIN public.ai_provider_admin_publications p ON p.id=h.publication_id
  JOIN public.ai_provider_policy_drafts d ON d.id=p.draft_id WHERE h.data_mode=NEW.data_mode
  AND d.gateway_fingerprint IS DISTINCT FROM current_setting('app.ai_gateway_fingerprint',true)) THEN
  RAISE EXCEPTION 'Published counting gateway changed; reapprove its contract' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bound_ai_published_count_gateway BEFORE INSERT OR UPDATE ON ai_input_count_requests FOR EACH ROW EXECUTE FUNCTION guard_ai_published_count_gateway();

CREATE FUNCTION guard_ai_manually_confirmed_observation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.state='unknown' AND EXISTS(SELECT 1 FROM public.current_ai_provider_requests r WHERE r.id=OLD.id
  AND r.channel=CASE TG_TABLE_NAME WHEN 'ai_gateway_requests' THEN 'generation' ELSE 'input_count' END
  AND (r.cost_confirmation_id IS NOT NULL OR r.termination_confirmation_id IS NOT NULL)) THEN
  RAISE EXCEPTION 'Preserve original observation after human confirmation' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_ai_manual_generation BEFORE UPDATE ON ai_gateway_requests FOR EACH ROW EXECUTE FUNCTION guard_ai_manually_confirmed_observation();
CREATE TRIGGER immutable_ai_manual_count BEFORE UPDATE ON ai_input_count_requests FOR EACH ROW EXECUTE FUNCTION guard_ai_manually_confirmed_observation();

-- Capacity implementation is installed below, independently from fee overlays.
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
 FROM (SELECT tenant_id,actor_id,subject_kind,request_class,capacity_held AS active,
  (dispatched_at>stamp-interval '1 minute' AND state NOT IN ('cancelled','denied')) OR (state='prepared' AND prepared_until>stamp) AS recent
  FROM public.current_ai_provider_requests WHERE data_mode=p.data_mode AND id IS DISTINCT FROM p_exclude
  AND (capacity_held OR dispatched_at>stamp-interval '1 minute')) q;
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
INSERT INTO schema_migrations(version) VALUES(68);
