-- Append human accounting facts. Original audio observations and SQL001-121 survive.
CREATE TABLE ai_audio_evidence (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audio_job_id uuid REFERENCES ai_audio_jobs(id),audio_probe_id uuid REFERENCES capability_audio_probes(id),
 data_mode text NOT NULL CHECK(data_mode IN('simulated','configured_services')),
 canonical_document text NOT NULL CHECK(octet_length(canonical_document)<=40000),
 document jsonb NOT NULL CHECK(document=canonical_document::jsonb),
 document_hash text GENERATED ALWAYS AS(encode(digest(canonical_document,'sha256'),'hex')) STORED,
 actor_id uuid NOT NULL REFERENCES admin_principals(id),operation_id uuid NOT NULL UNIQUE REFERENCES admin_operations(id),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(num_nonnulls(audio_job_id,audio_probe_id)=1)
);
CREATE UNIQUE INDEX ai_audio_evidence_job_hash ON ai_audio_evidence(audio_job_id,document_hash);
CREATE UNIQUE INDEX ai_audio_evidence_probe_hash ON ai_audio_evidence(audio_probe_id,document_hash);
CREATE TABLE ai_audio_cost_confirmations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audio_job_id uuid UNIQUE REFERENCES ai_audio_jobs(id),audio_probe_id uuid UNIQUE REFERENCES capability_audio_probes(id),
 evidence_id uuid NOT NULL REFERENCES ai_audio_evidence(id),data_mode text NOT NULL CHECK(data_mode IN('simulated','configured_services')),
 billable_units bigint NOT NULL CHECK(billable_units BETWEEN 0 AND 1000000),
 rate_micros bigint NOT NULL CHECK(rate_micros BETWEEN 1 AND 1000000000),
 amount_micros numeric(40,0) GENERATED ALWAYS AS(billable_units::numeric*rate_micros::numeric) STORED,
 operation_id uuid NOT NULL UNIQUE REFERENCES admin_operations(id),actor_id uuid NOT NULL REFERENCES admin_principals(id),
 reviewer_id uuid NOT NULL REFERENCES admin_principals(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(num_nonnulls(audio_job_id,audio_probe_id)=1),CHECK(actor_id<>reviewer_id)
);
CREATE TABLE ai_audio_termination_confirmations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 audio_job_id uuid UNIQUE REFERENCES ai_audio_jobs(id),audio_probe_id uuid UNIQUE REFERENCES capability_audio_probes(id),
 evidence_id uuid NOT NULL REFERENCES ai_audio_evidence(id),data_mode text NOT NULL CHECK(data_mode IN('simulated','configured_services')),
 operation_id uuid NOT NULL UNIQUE REFERENCES admin_operations(id),actor_id uuid NOT NULL REFERENCES admin_principals(id),
 reviewer_id uuid NOT NULL REFERENCES admin_principals(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(num_nonnulls(audio_job_id,audio_probe_id)=1),CHECK(actor_id<>reviewer_id)
);
DO $$ DECLARE n text; BEGIN
 FOREACH n IN ARRAY ARRAY['ai_audio_evidence','ai_audio_cost_confirmations','ai_audio_termination_confirmations'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',n);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',n);
  EXECUTE format('CREATE POLICY audio_accounting_control ON %I USING(current_user=''cp_control'') WITH CHECK(current_user=''cp_control'')',n);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,cp_app,cp_queue',n);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO cp_control',n);
  EXECUTE format('CREATE TRIGGER immutable_audio_accounting BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_ai_gateway_history()',n);
 END LOOP;
END $$;

-- No prompt, transcript, raw source path or execution nonce is exposed here.
CREATE VIEW current_audio_accounting_requests AS
 SELECT r.*,c.id AS cost_confirmation_id,c.evidence_id AS cost_evidence_id,
  t.id AS termination_confirmation_id,t.evidence_id AS termination_evidence_id,
  coalesce(c.billable_units,r.billable_units) AS effective_units,
  coalesce(c.amount_micros,r.actual_micros) AS effective_micros,
  CASE WHEN c.id IS NOT NULL THEN 'manually_confirmed' WHEN r.usage_known THEN 'known' ELSE 'unknown' END AS cost_state,
  (NOT r.usage_known AND t.id IS NULL) AS capacity_held,
  ((r.usage_known OR c.id IS NOT NULL) AND (r.usage_known OR t.id IS NOT NULL)) AS accounting_resolved,
  (c.id IS NOT NULL AND c.amount_micros>r.quoted_micros) AS allocation_exceeded
 FROM (
  SELECT 'audio_customer'::text AS channel,j.id,j.data_mode,j.tenant_id,j.project_id,j.task_id,
   NULL::uuid AS validation_id,NULL::uuid AS release_id,j.actor_id,j.capability_version_id,j.model_alias,j.gateway_fingerprint,
   j.kind,j.pricing_unit,j.rate_micros,j.quoted_units,j.quoted_micros,j.state,j.usage_known,j.billable_units,j.actual_micros,
   j.operation_id,j.request_hash,j.source_sha256,j.created_at,j.dispatched_at,j.finished_at,j.error_code,j.envelope_id,
   NULL::uuid AS platform_period_id FROM ai_audio_jobs j
  UNION ALL
  SELECT 'audio_validation',p.id,p.data_mode,NULL::uuid,NULL::uuid,NULL::uuid,p.validation_id,v.release_id,p.actor_id,
   v.capability_version_id,p.model_alias,p.gateway_fingerprint,p.specification->>'kind',
   CASE WHEN p.specification->>'kind'='speech' THEN 'unicode_scalar' ELSE 'input_millisecond' END,
   p.rate_micros,p.quoted_units,p.quoted_micros,p.state,p.usage_known,p.billable_units,p.actual_micros,
   p.operation_id,p.request_hash,p.source_sha256,p.created_at,p.dispatched_at,p.finished_at,p.error_code,p.envelope_id,
   p.platform_period_id FROM capability_audio_probes p JOIN capability_validations v ON v.id=p.validation_id
 ) r LEFT JOIN ai_audio_cost_confirmations c ON (r.channel='audio_customer' AND c.audio_job_id=r.id)
  OR (r.channel='audio_validation' AND c.audio_probe_id=r.id)
 LEFT JOIN ai_audio_termination_confirmations t ON (r.channel='audio_customer' AND t.audio_job_id=r.id)
  OR (r.channel='audio_validation' AND t.audio_probe_id=r.id);
ALTER VIEW current_audio_accounting_requests OWNER TO cp_control;
REVOKE ALL ON current_audio_accounting_requests FROM PUBLIC,cp_app,cp_queue;
GRANT SELECT ON current_audio_accounting_requests TO cp_control;

CREATE FUNCTION guard_audio_accounting_evidence() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;op public.admin_operations%ROWTYPE;d jsonb:=NEW.document;units bigint;
BEGIN
 SELECT * INTO STRICT r FROM public.current_audio_accounting_requests
  WHERE (NEW.audio_job_id IS NOT NULL AND channel='audio_customer' AND id=NEW.audio_job_id)
   OR (NEW.audio_probe_id IS NOT NULL AND channel='audio_validation' AND id=NEW.audio_probe_id);
 SELECT * INTO STRICT op FROM public.admin_operations WHERE id=NEW.operation_id;
 IF r.state<>'unknown' OR r.usage_known OR r.dispatched_at IS NULL OR r.request_hash IS NULL
  OR NEW.data_mode IS DISTINCT FROM r.data_mode OR NEW.data_mode IS DISTINCT FROM current_setting('app.data_mode',true)
  OR op.action<>'ai.evidence.write' OR op.state<>'running' OR op.principal_id<>NEW.actor_id
  OR op.payload->'command'->'document' IS DISTINCT FROM d
  OR op.payload->'scope'->>'data_mode' IS DISTINCT FROM r.data_mode
  OR (op.payload->'scope'->>'tenant_id')::uuid IS DISTINCT FROM r.tenant_id
  OR (op.payload->'scope'->>'project_id')::uuid IS DISTINCT FROM r.project_id
  OR jsonb_typeof(d->'schema_version') IS DISTINCT FROM 'number' OR d->>'schema_version' IS DISTINCT FROM '1'
  OR d->>'channel' IS DISTINCT FROM r.channel
  OR (d->>'request_id')::uuid IS DISTINCT FROM r.id OR d->>'data_mode' IS DISTINCT FROM r.data_mode
  OR (d->>'operation_id')::uuid IS DISTINCT FROM r.operation_id OR d->>'request_hash' IS DISTINCT FROM r.request_hash
  OR d->>'model_alias' IS DISTINCT FROM r.model_alias OR d->>'gateway_fingerprint' IS DISTINCT FROM r.gateway_fingerprint
  OR NOT (d ? 'source_sha256') OR d->>'source_sha256' IS DISTINCT FROM r.source_sha256
  OR jsonb_typeof(d->'terminated') IS DISTINCT FROM 'boolean' OR d->>'terminated' IS DISTINCT FROM 'true'
  OR d->>'currency' IS DISTINCT FROM 'HKD' OR coalesce(d->>'outcome','') NOT IN('completed','failed','cancelled','not_executed')
  OR d->>'observed_at' IS NULL OR (d->>'observed_at')::timestamptz>clock_timestamp() OR (d->>'observed_at')::timestamptz<r.dispatched_at
  OR jsonb_typeof(d->'billed_micros') IS DISTINCT FROM 'string' OR d->>'billed_micros'!~'^(0|[1-9][0-9]{0,15})$'
  OR d#>>'{usage,kind}' IS DISTINCT FROM r.kind OR d#>>'{usage,pricing_unit}' IS DISTINCT FROM r.pricing_unit
  OR jsonb_typeof(d#>'{usage,billable_units}') IS DISTINCT FROM 'number'
  OR coalesce(length(d->>'provider_reference'),0) NOT BETWEEN 3 AND 300 OR coalesce(length(d->>'source_reference'),0) NOT BETWEEN 3 AND 500
  OR coalesce(length(d->>'source_note'),0) NOT BETWEEN 10 AND 8000
  OR d-ARRAY['schema_version','channel','request_id','data_mode','operation_id','request_hash','model_alias','gateway_fingerprint',
   'source_sha256','provider_reference','source_reference','source_note','observed_at','terminated','outcome','currency','billed_micros','usage']<>'{}'::jsonb
  OR (d->'usage')-ARRAY['kind','pricing_unit','billable_units']<>'{}'::jsonb
 THEN RAISE EXCEPTION 'Audio evidence must bind the original unknown operation and source' USING ERRCODE='23514'; END IF;
 units:=(d#>>'{usage,billable_units}')::bigint;
 IF units NOT BETWEEN 0 AND 1000000 OR (d#>>'{usage,billable_units}')::numeric<>units
  OR (d->>'outcome'='not_executed' AND (units<>0 OR (d->>'billed_micros')::numeric<>0))
 THEN RAISE EXCEPTION 'Invalid final audio evidence units' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bound_audio_accounting_evidence BEFORE INSERT ON ai_audio_evidence
 FOR EACH ROW EXECUTE FUNCTION guard_audio_accounting_evidence();
CREATE FUNCTION guard_audio_accounting_confirmation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE r record;e public.ai_audio_evidence%ROWTYPE;op public.admin_operations%ROWTYPE;expected text;units bigint;
BEGIN
 SELECT * INTO STRICT e FROM public.ai_audio_evidence WHERE id=NEW.evidence_id;
 SELECT * INTO STRICT r FROM public.current_audio_accounting_requests
  WHERE (NEW.audio_job_id IS NOT NULL AND channel='audio_customer' AND id=NEW.audio_job_id)
   OR (NEW.audio_probe_id IS NOT NULL AND channel='audio_validation' AND id=NEW.audio_probe_id);
 SELECT * INTO STRICT op FROM public.admin_operations WHERE id=NEW.operation_id;
 expected:=CASE TG_TABLE_NAME WHEN 'ai_audio_cost_confirmations' THEN 'ai.cost.reconcile' ELSE 'ai.capacity.release' END;
 IF r.state<>'unknown' OR r.usage_known OR NEW.data_mode IS DISTINCT FROM r.data_mode
  OR NEW.data_mode IS DISTINCT FROM current_setting('app.data_mode',true) OR e.data_mode IS DISTINCT FROM NEW.data_mode
  OR e.audio_job_id IS DISTINCT FROM NEW.audio_job_id OR e.audio_probe_id IS DISTINCT FROM NEW.audio_probe_id
  OR op.action<>expected OR op.state<>'running' OR op.principal_id<>NEW.actor_id
  OR op.approved_by IS DISTINCT FROM NEW.reviewer_id OR e.actor_id=NEW.reviewer_id
  OR op.payload#>>'{command,channel}' IS DISTINCT FROM r.channel
  OR (op.payload#>>'{command,request_id}')::uuid IS DISTINCT FROM r.id
  OR (op.payload#>>'{command,evidence_id}')::uuid IS DISTINCT FROM e.id
  OR op.payload#>>'{before,evidence,document_hash}' IS DISTINCT FROM e.document_hash
  OR op.payload#>>'{before,request,request_hash}' IS DISTINCT FROM r.request_hash
  OR e.document->>'terminated' IS DISTINCT FROM 'true'
 THEN RAISE EXCEPTION 'Audio confirmation requires independently approved original evidence' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='ai_audio_cost_confirmations' THEN
  units:=(e.document#>>'{usage,billable_units}')::bigint;
  IF NEW.billable_units IS DISTINCT FROM units OR NEW.rate_micros IS DISTINCT FROM r.rate_micros
   OR (e.document->>'billed_micros')::numeric IS DISTINCT FROM units::numeric*r.rate_micros
  THEN RAISE EXCEPTION 'Audio invoice must match original frozen units and tariff' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bound_audio_accounting_cost BEFORE INSERT ON ai_audio_cost_confirmations
 FOR EACH ROW EXECUTE FUNCTION guard_audio_accounting_confirmation();
CREATE TRIGGER bound_audio_accounting_termination BEFORE INSERT ON ai_audio_termination_confirmations
 FOR EACH ROW EXECUTE FUNCTION guard_audio_accounting_confirmation();

-- Cost and capacity have separate overlays. Neither changes an original row.
-- Preserve the physical column order for existing prepared function callers.
DO $$ DECLARE table_name text;view_name text;fk text;columns text;purpose text; BEGIN
 FOREACH table_name IN ARRAY ARRAY['ai_audio_jobs','capability_audio_probes'] LOOP
  fk:=CASE table_name WHEN 'ai_audio_jobs' THEN 'audio_job_id' ELSE 'audio_probe_id' END;
  FOREACH purpose IN ARRAY ARRAY['accounted','capacity'] LOOP
   view_name:=purpose||CASE table_name WHEN 'ai_audio_jobs' THEN '_audio_jobs' ELSE '_audio_probes' END;
   SELECT string_agg(CASE
    WHEN attname='usage_known' THEN CASE purpose WHEN 'accounted' THEN '(j.usage_known OR c.id IS NOT NULL)' ELSE '(j.usage_known OR t.id IS NOT NULL)' END||' AS usage_known'
    WHEN attname='billable_units' AND purpose='accounted' THEN 'coalesce(j.billable_units,c.billable_units) AS billable_units'
    WHEN attname='actual_micros' AND purpose='accounted' THEN 'coalesce(j.actual_micros,c.amount_micros) AS actual_micros'
    ELSE format('j.%I',attname) END,',' ORDER BY attnum) INTO columns
    FROM pg_attribute WHERE attrelid=table_name::regclass AND attnum>0 AND NOT attisdropped;
   EXECUTE format('CREATE VIEW %I AS SELECT %s,c.id AS human_cost_confirmation_id,c.evidence_id AS human_cost_evidence_id,t.id AS human_termination_confirmation_id FROM %I j LEFT JOIN ai_audio_cost_confirmations c ON c.%I=j.id LEFT JOIN ai_audio_termination_confirmations t ON t.%I=j.id',view_name,columns,table_name,fk,fk);
   EXECUTE format('ALTER VIEW %I OWNER TO cp_control',view_name);
   EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,cp_app,cp_queue',view_name);
   EXECUTE format('GRANT SELECT ON %I TO cp_control',view_name);
  END LOOP;
 END LOOP;
END $$;
-- Replace only the audio relation at each existing layer; retain function OIDs,
-- previous text/image/video histories, canonical rounding and caller-scope checks.
DO $$ DECLARE signature text;definition text;target text; BEGIN
 FOREACH signature IN ARRAY ARRAY['ai_budget_used_before_audio_validation(uuid,uuid)',
  'ai_budget_subject_blocked_before_audio_validation(uuid)','ai_budget_used(uuid,uuid)'] LOOP
  definition:=pg_get_functiondef(signature::regprocedure);
  target:=CASE WHEN signature='ai_budget_used(uuid,uuid)' THEN 'capability_audio_probes' ELSE 'ai_audio_jobs' END;
  IF position('FROM public.'||target IN definition)=0 THEN RAISE EXCEPTION 'Unexpected audio budget implementation: %',signature; END IF;
  EXECUTE replace(definition,'FROM public.'||target,'FROM public.'||CASE target WHEN 'ai_audio_jobs' THEN 'accounted_audio_jobs' ELSE 'accounted_audio_probes' END);
 END LOOP;
 definition:=pg_get_functiondef('ai_gateway_limit_reason(uuid,uuid,uuid,text,text,uuid)'::regprocedure);
 IF position('FROM public.ai_audio_jobs' IN definition)=0 OR position('FROM public.capability_audio_probes' IN definition)=0
 THEN RAISE EXCEPTION 'Unexpected audio capacity implementation'; END IF;
 EXECUTE replace(replace(definition,'FROM public.ai_audio_jobs','FROM public.capacity_audio_jobs'),
  'FROM public.capability_audio_probes','FROM public.capacity_audio_probes');
END $$;
CREATE OR REPLACE FUNCTION ai_budget_subject_blocked(p_envelope uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT public.ai_budget_subject_blocked_before_audio_validation(p_envelope)
 OR EXISTS(SELECT 1 FROM public.accounted_audio_probes WHERE envelope_id=p_envelope AND state='unknown' AND NOT usage_known)
 OR EXISTS(SELECT 1 FROM public.current_audio_accounting_requests WHERE envelope_id=p_envelope AND allocation_exceeded)
$$;
CREATE OR REPLACE FUNCTION task_ai_budget_receipt(p_task uuid) RETURNS jsonb
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r jsonb;a record;
BEGIN
 r:=public.task_ai_budget_receipt_before_audio(p_task); -- Original caller and data-mode boundary.
 SELECT count(*) AS n,coalesce(sum(actual_micros) FILTER(WHERE usage_known),0)*1000000 AS numerator,
  coalesce(bool_or(NOT usage_known),false) AS uncertain INTO a FROM public.accounted_audio_jobs WHERE task_id=p_task;
 RETURN r||jsonb_build_object('requests',(r->>'requests')::bigint+a.n,
  'numerator',((r->>'numerator')::numeric+a.numerator)::text,'uncertain',(r->>'uncertain')::boolean OR a.uncertain,
  'violation',(r->>'violation')::boolean OR EXISTS(SELECT 1 FROM public.current_audio_accounting_requests WHERE task_id=p_task AND allocation_exceeded));
END $$;
ALTER FUNCTION ai_budget_subject_blocked(uuid) OWNER TO cp_control;
ALTER FUNCTION task_ai_budget_receipt(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION ai_budget_subject_blocked(uuid),task_ai_budget_receipt(uuid) FROM PUBLIC,cp_app,cp_queue;
INSERT INTO schema_migrations(version) VALUES(122);
