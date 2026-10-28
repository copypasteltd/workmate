-- Optional, explicitly authorized leases of operator-preprovisioned physical
-- cloud computers. Existing SQL001-128 and AI task accounting are unchanged.
CREATE TABLE cloud_runtime_plans (
 key text NOT NULL,version integer NOT NULL CHECK(version>0),body jsonb NOT NULL,
 data_mode text NOT NULL CHECK(data_mode IN('simulated','configured_services')),
 created_by uuid NOT NULL REFERENCES admin_principals(id),created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(key,version),CHECK(jsonb_typeof(body)='object')
);
CREATE TABLE cloud_runtime_plan_heads (
 key text PRIMARY KEY,version integer NOT NULL,enabled boolean NOT NULL DEFAULT false,
 FOREIGN KEY(key,version) REFERENCES cloud_runtime_plans(key,version)
);
CREATE TABLE cloud_runtime_nodes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),name text NOT NULL,plan_key text NOT NULL REFERENCES cloud_runtime_plan_heads(key),
 machine_fingerprint text NOT NULL UNIQUE CHECK(machine_fingerprint ~ '^[a-f0-9]{64}$'),
 token_hash text NOT NULL CHECK(token_hash ~ '^[a-f0-9]{64}$'),token_version integer NOT NULL DEFAULT 1 CHECK(token_version>0),
 state text NOT NULL DEFAULT 'registered' CHECK(state IN('registered','available','occupied','draining','quarantined')),
 instance_id uuid,generation integer NOT NULL DEFAULT 0 CHECK(generation>=0),last_heartbeat_at timestamptz,
 created_by uuid NOT NULL REFERENCES admin_principals(id),created_at timestamptz NOT NULL DEFAULT now(),
 version integer NOT NULL DEFAULT 1 CHECK(version>0)
);
CREATE TABLE cloud_runtime_quotes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),project_id uuid NOT NULL,
 private_owner uuid NOT NULL REFERENCES users(id),actor_auth_version integer NOT NULL,
 billing_account_id uuid NOT NULL REFERENCES wallets(id),plan_key text NOT NULL,plan_version integer NOT NULL,
 body jsonb NOT NULL,specification_hash text NOT NULL CHECK(specification_hash ~ '^[a-f0-9]{64}$'),
 maximum_cost_micros bigint NOT NULL CHECK(maximum_cost_micros>0),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','activated','declined')),
 content_state text NOT NULL DEFAULT 'active' CHECK(content_state IN('active','deleted')),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '15 minutes',created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY(plan_key,plan_version) REFERENCES cloud_runtime_plans(key,version),UNIQUE(tenant_id,project_id,id)
);
CREATE TABLE cloud_runtime_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,project_id uuid NOT NULL,private_owner uuid NOT NULL REFERENCES users(id),
 quote_id uuid NOT NULL UNIQUE,node_id uuid NOT NULL REFERENCES cloud_runtime_nodes(id),generation integer NOT NULL CHECK(generation>0),
 fencing_token uuid NOT NULL DEFAULT gen_random_uuid(),
 state text NOT NULL DEFAULT 'starting' CHECK(state IN('starting','running','stop_requested','reconciling','stopped','failed')),
 content_state text NOT NULL DEFAULT 'active' CHECK(content_state IN('active','deleted')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),confirmed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 first_delivered_at timestamptz,started_at timestamptz,expires_at timestamptz NOT NULL,
 last_customer_activity_at timestamptz NOT NULL DEFAULT clock_timestamp(),stopped_at timestamptz,
 cleanup_verified boolean NOT NULL DEFAULT false,usage_milliseconds bigint,charged_micros bigint NOT NULL DEFAULT 0 CHECK(charged_micros>=0),
 last_error text,FOREIGN KEY(tenant_id,project_id,quote_id) REFERENCES cloud_runtime_quotes(tenant_id,project_id,id),
 UNIQUE(tenant_id,project_id,id),UNIQUE(node_id,generation),CHECK(usage_milliseconds IS NULL OR usage_milliseconds>=0),
 CHECK(state NOT IN('stopped','failed') OR cleanup_verified)
);
-- Expiry does not release a computer. A verified cleanup receipt is required
-- before the same physical node can be assigned to another customer.
CREATE UNIQUE INDEX cloud_runtime_exclusive_computer ON cloud_runtime_sessions(node_id)
 WHERE state IN('starting','running','stop_requested','reconciling');
CREATE INDEX cloud_runtime_due ON cloud_runtime_sessions(expires_at)
 WHERE state IN('starting','running','stop_requested','reconciling');
CREATE TABLE cloud_runtime_commands (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,project_id uuid NOT NULL,private_owner uuid NOT NULL,
 session_id uuid NOT NULL,node_id uuid NOT NULL REFERENCES cloud_runtime_nodes(id),generation integer NOT NULL CHECK(generation>0),
 kind text NOT NULL CHECK(kind IN('start','input','stop')),body jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','delivered','completed','failed','cancelled')),
 result text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),delivered_at timestamptz,completed_at timestamptz,
 FOREIGN KEY(tenant_id,project_id,session_id) REFERENCES cloud_runtime_sessions(tenant_id,project_id,id),
 CHECK(result IS NULL OR octet_length(result)<=65536)
);
CREATE UNIQUE INDEX cloud_runtime_one_start_stop ON cloud_runtime_commands(session_id,kind) WHERE kind IN('start','stop');
CREATE TABLE cloud_runtime_holds (
 session_id uuid PRIMARY KEY REFERENCES cloud_runtime_sessions(id),tenant_id uuid NOT NULL,project_id uuid NOT NULL,private_owner uuid NOT NULL,
 billing_account_id uuid NOT NULL REFERENCES wallets(id),amount_micros bigint NOT NULL CHECK(amount_micros>0),
 state text NOT NULL DEFAULT 'reserved' CHECK(state IN('reserved','settled','released','reconciling')),
 journal_entry_id uuid NOT NULL REFERENCES billing_journal(id),charge_id uuid UNIQUE REFERENCES ledger(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,project_id,session_id) REFERENCES cloud_runtime_sessions(tenant_id,project_id,id)
);
CREATE TABLE cloud_runtime_hold_allocations (
 session_id uuid NOT NULL REFERENCES cloud_runtime_holds(session_id),lot_id uuid NOT NULL REFERENCES funding_lots(id),
 amount_micros bigint NOT NULL CHECK(amount_micros>0),PRIMARY KEY(session_id,lot_id)
);
CREATE TABLE cloud_runtime_charge_sources (
 charge_id uuid NOT NULL REFERENCES ledger(id),lot_id uuid REFERENCES funding_lots(id),
 kind text NOT NULL CHECK(kind IN('paid','gift','credit')),amount_micros bigint NOT NULL CHECK(amount_micros>0),
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),UNIQUE NULLS NOT DISTINCT(charge_id,lot_id),CHECK((kind='credit')=(lot_id IS NULL))
);
CREATE TABLE cloud_runtime_frames (
 session_id uuid PRIMARY KEY REFERENCES cloud_runtime_sessions(id),generation integer NOT NULL CHECK(generation>0),
 sequence bigint NOT NULL CHECK(sequence>0),body bytea NOT NULL CHECK(octet_length(body) BETWEEN 8 AND 524288),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE cloud_runtime_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,tenant_id uuid NOT NULL,project_id uuid NOT NULL,private_owner uuid NOT NULL,
 session_id uuid NOT NULL,kind text NOT NULL,body jsonb NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,project_id,session_id) REFERENCES cloud_runtime_sessions(tenant_id,project_id,id)
);
ALTER TABLE ledger ADD COLUMN cloud_runtime_session_id uuid REFERENCES cloud_runtime_sessions(id);
CREATE UNIQUE INDEX cloud_runtime_one_charge ON ledger(cloud_runtime_session_id) WHERE cloud_runtime_session_id IS NOT NULL;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['cloud_runtime_plans','cloud_runtime_plan_heads','cloud_runtime_nodes',
  'cloud_runtime_hold_allocations','cloud_runtime_charge_sources','cloud_runtime_frames'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY runtime_control_only ON %I USING(current_user=''cp_control'') WITH CHECK(current_user=''cp_control'')',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,cp_app,cp_queue',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE,DELETE ON %I TO cp_control',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['cloud_runtime_quotes','cloud_runtime_sessions','cloud_runtime_commands','cloud_runtime_holds','cloud_runtime_events'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY runtime_private_owner ON %I USING(current_user=''cp_control'' OR (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND private_owner=nullif(current_setting(''app.actor_id'',true),'''')::uuid)) WITH CHECK(current_user=''cp_control'' OR (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND private_owner=nullif(current_setting(''app.actor_id'',true),'''')::uuid))',t);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,cp_queue',t);
  EXECUTE format('GRANT SELECT ON %I TO cp_app',t);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO cp_control',t);
 END LOOP;
END $$;
GRANT USAGE,SELECT ON SEQUENCE cloud_runtime_events_id_seq TO cp_control;

CREATE FUNCTION guard_cloud_runtime_facts() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE q cloud_runtime_quotes;s cloud_runtime_sessions;h cloud_runtime_holds;w wallets;plan cloud_runtime_plans;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Dedicated resource facts cannot be deleted' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='cloud_runtime_plans' AND TG_OP<>'INSERT' THEN
  RAISE EXCEPTION 'Published resource price versions are immutable' USING ERRCODE='42501';
 ELSIF TG_TABLE_NAME='cloud_runtime_quotes' THEN
  IF TG_OP='INSERT' THEN
   SELECT * INTO plan FROM cloud_runtime_plans WHERE key=NEW.plan_key AND version=NEW.plan_version;
   SELECT * INTO w FROM wallets WHERE id=NEW.billing_account_id;
   IF plan.key IS NULL OR NEW.body->'plan' IS DISTINCT FROM plan.body OR NEW.body->>'data_mode'<>plan.data_mode
    OR (NEW.body->>'minutes')::int NOT BETWEEN 5 AND (plan.body->>'max_minutes')::int
    OR NEW.maximum_cost_micros<>(NEW.body->>'minutes')::bigint*(plan.body->>'per_minute_micros')::bigint
    OR NEW.body->>'maximum_cost_micros'<>NEW.maximum_cost_micros::text
    OR NEW.body->>'kernel'<>'codex' OR NEW.body->>'ai_routing'<>'company_only' OR NEW.body->>'automatic_renewal'<>'false'
    OR w.data_mode<>plan.data_mode OR NOT(w.user_id=NEW.private_owner OR w.tenant_id=NEW.tenant_id)
    OR NEW.body->>'private_owner'<>NEW.private_owner::text OR NEW.body->>'project_id'<>NEW.project_id::text
    OR NEW.body->>'tenant_id'<>NEW.tenant_id::text THEN
    RAISE EXCEPTION 'Dedicated quote differs from exact price, scope or payer' USING ERRCODE='23514'; END IF;
  ELSE
   IF NEW.content_state='deleted' AND NEW.body='{}'::jsonb AND coalesce(current_setting('app.erasing_content',true),'')='true' THEN RETURN NEW; END IF;
   IF ROW(NEW.id,NEW.tenant_id,NEW.project_id,NEW.private_owner,NEW.actor_auth_version,NEW.billing_account_id,NEW.plan_key,NEW.plan_version,NEW.body,NEW.specification_hash,NEW.maximum_cost_micros,NEW.expires_at,NEW.created_at,NEW.content_state)
   IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.project_id,OLD.private_owner,OLD.actor_auth_version,OLD.billing_account_id,OLD.plan_key,OLD.plan_version,OLD.body,OLD.specification_hash,OLD.maximum_cost_micros,OLD.expires_at,OLD.created_at,OLD.content_state)
   OR (NEW.state<>OLD.state AND (OLD.state<>'pending' OR NEW.state NOT IN('activated','declined'))) THEN
   RAISE EXCEPTION 'Reviewed resource quote cannot be rewritten' USING ERRCODE='23514'; END IF;
  END IF;
 ELSIF TG_TABLE_NAME='cloud_runtime_sessions' THEN
  SELECT * INTO q FROM cloud_runtime_quotes WHERE id=NEW.quote_id;
  IF ROW(NEW.tenant_id,NEW.project_id,NEW.private_owner) IS DISTINCT FROM ROW(q.tenant_id,q.project_id,q.private_owner) THEN
   RAISE EXCEPTION 'Dedicated session differs from its private quote' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
   IF q.state<>'pending' OR q.content_state<>'active' OR q.expires_at<=clock_timestamp()
    OR NEW.expires_at>NEW.confirmed_at+(q.body->>'minutes')::int*interval '1 minute' OR NEW.expires_at<=NEW.confirmed_at
    OR coalesce(current_setting('app.cloud_runtime_confirmation_hash',true),'')<>q.specification_hash
    OR NOT EXISTS(SELECT 1 FROM users u JOIN memberships m ON m.user_id=u.id JOIN tenants t ON t.id=m.tenant_id
      JOIN projects p ON p.tenant_id=t.id WHERE u.id=q.private_owner AND u.status='active' AND u.auth_version=q.actor_auth_version
      AND m.tenant_id=q.tenant_id AND m.status='active' AND t.status='active' AND p.id=q.project_id AND NOT p.archived)
    OR NOT EXISTS(SELECT 1 FROM cloud_runtime_nodes n WHERE n.id=NEW.node_id AND n.state='available' AND n.plan_key=q.plan_key
      AND n.generation+1=NEW.generation AND n.last_heartbeat_at>clock_timestamp()-interval '30 seconds') THEN
    RAISE EXCEPTION 'Dedicated session requires current confirmed cost, scope and an exclusive ready computer' USING ERRCODE='23514'; END IF;
  ELSIF ROW(NEW.id,NEW.tenant_id,NEW.project_id,NEW.private_owner,NEW.quote_id,NEW.node_id,NEW.generation,NEW.fencing_token,NEW.confirmed_at,NEW.expires_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.project_id,OLD.private_owner,OLD.quote_id,OLD.node_id,OLD.generation,OLD.fencing_token,OLD.confirmed_at,OLD.expires_at)
   OR NEW.version<>OLD.version+1 OR (OLD.state IN('stopped','failed') AND NEW.state<>OLD.state)
   OR NEW.charged_micros>q.maximum_cost_micros THEN
   RAISE EXCEPTION 'Invalid dedicated session transition or cost' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='cloud_runtime_holds' THEN
  SELECT * INTO s FROM cloud_runtime_sessions WHERE id=NEW.session_id;
  SELECT * INTO q FROM cloud_runtime_quotes WHERE id=s.quote_id;
  IF ROW(NEW.tenant_id,NEW.project_id,NEW.private_owner,NEW.billing_account_id,NEW.amount_micros)
   IS DISTINCT FROM ROW(s.tenant_id,s.project_id,s.private_owner,q.billing_account_id,q.maximum_cost_micros) THEN
   RAISE EXCEPTION 'Resource hold differs from confirmed payer or ceiling' USING ERRCODE='23514'; END IF;
  IF NOT EXISTS(SELECT 1 FROM billing_journal j JOIN billing_operations o ON o.id=j.operation_id WHERE j.id=NEW.journal_entry_id
   AND j.billing_account_id=NEW.billing_account_id AND j.actor_id=NEW.private_owner AND j.amount_micros=NEW.amount_micros
   AND j.kind='reserve' AND o.action='billing.cloud_runtime.reserve') THEN
   RAISE EXCEPTION 'Resource hold lacks its original financial consent event' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND ROW(NEW.session_id,NEW.tenant_id,NEW.project_id,NEW.private_owner,NEW.billing_account_id,NEW.amount_micros,NEW.journal_entry_id,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.session_id,OLD.tenant_id,OLD.project_id,OLD.private_owner,OLD.billing_account_id,OLD.amount_micros,OLD.journal_entry_id,OLD.created_at) THEN
   RAISE EXCEPTION 'Resource hold provenance cannot change' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='ledger' THEN
  IF NEW.cloud_runtime_session_id IS NOT NULL THEN
   SELECT * INTO h FROM cloud_runtime_holds WHERE session_id=NEW.cloud_runtime_session_id;
   SELECT * INTO s FROM cloud_runtime_sessions WHERE id=NEW.cloud_runtime_session_id;
   IF h.session_id IS NULL OR h.state NOT IN('reserved','reconciling') OR NEW.kind<>'charge' OR NEW.task_id IS NOT NULL
    OR NEW.amount_micros>=0 OR -NEW.amount_micros>h.amount_micros OR NEW.billing_account_id<>h.billing_account_id
    OR NEW.user_id IS DISTINCT FROM h.private_owner OR NEW.tenant_id IS DISTINCT FROM h.tenant_id
    OR NOT s.cleanup_verified OR s.state NOT IN('stopped','failed') OR -NEW.amount_micros<>s.charged_micros THEN
    RAISE EXCEPTION 'Dedicated resource charge lacks its exact funded hold' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_cloud_runtime_facts() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_cloud_runtime_facts() FROM PUBLIC;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['cloud_runtime_plans','cloud_runtime_quotes','cloud_runtime_sessions','cloud_runtime_holds'] LOOP
  EXECUTE format('CREATE TRIGGER cloud_runtime_fact_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_cloud_runtime_facts()',t);
 END LOOP;
END $$;
CREATE TRIGGER cloud_runtime_ledger_guard BEFORE INSERT ON ledger FOR EACH ROW EXECUTE FUNCTION guard_cloud_runtime_facts();
CREATE TRIGGER cloud_runtime_price_immutable BEFORE UPDATE OR DELETE ON cloud_runtime_charge_sources FOR EACH ROW EXECUTE FUNCTION immutable_billing_source();
CREATE TRIGGER cloud_runtime_event_immutable BEFORE UPDATE OR DELETE ON cloud_runtime_events FOR EACH ROW EXECUTE FUNCTION immutable_billing_source();

-- Preserve the original task branch and function identity. Dedicated leases
-- bind their existing shared-journal charge to their exact resource hold.
CREATE OR REPLACE FUNCTION journal_ledger_entry() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE sourcekind text;hold_journal uuid;
BEGIN
 SELECT kind INTO sourcekind FROM ledger WHERE id=NEW.source_id;
 IF NEW.kind='adjustment' THEN RAISE EXCEPTION 'Adjustments require a registered compensation controller' USING ERRCODE='23514'; END IF;
 IF NEW.kind='charge' THEN
  IF NEW.cloud_runtime_session_id IS NOT NULL THEN
   SELECT journal_entry_id INTO hold_journal FROM cloud_runtime_holds WHERE session_id=NEW.cloud_runtime_session_id;
  ELSE SELECT journal_entry_id INTO hold_journal FROM reservations WHERE task_id=NEW.task_id;
  END IF;
 ELSE hold_journal=NEW.source_id;
 END IF;
 INSERT INTO billing_journal(id,billing_account_id,operation_id,actor_id,kind,direction,bucket,amount_micros,reason,source_entry_id,raw_entry_id,task_id,created_at)
 VALUES(NEW.id,NEW.billing_account_id,NEW.operation_id,NEW.actor_id,CASE WHEN NEW.kind='charge' THEN 'consume' ELSE NEW.kind END,
 CASE WHEN NEW.amount_micros>0 THEN 'credit' ELSE 'debit' END,
 CASE WHEN NEW.kind='charge' THEN 'reserved' WHEN NEW.kind IN('gift','gift_expiry') OR sourcekind='gift' THEN 'promotional' ELSE 'paid' END,
 abs(NEW.amount_micros),NEW.reason,hold_journal,NEW.id,NEW.task_id,NEW.created_at);
 RETURN NULL;
END $$;
ALTER FUNCTION journal_ledger_entry() OWNER TO cp_control;
REVOKE ALL ON FUNCTION journal_ledger_entry() FROM PUBLIC;

CREATE FUNCTION validate_cloud_runtime_funding() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE entry ledger;lot funding_lots;hold cloud_runtime_holds;
BEGIN
 IF TG_TABLE_NAME='cloud_runtime_charge_sources' THEN
  SELECT * INTO entry FROM ledger WHERE id=NEW.charge_id AND cloud_runtime_session_id IS NOT NULL;
  IF entry.id IS NULL OR entry.kind<>'charge' THEN RAISE EXCEPTION 'Resource funding needs its confirmed charge' USING ERRCODE='23514'; END IF;
  IF NEW.lot_id IS NOT NULL THEN
   SELECT * INTO lot FROM funding_lots WHERE id=NEW.lot_id AND billing_account_id=entry.billing_account_id;
   IF lot.id IS NULL OR lot.kind<>NEW.kind THEN RAISE EXCEPTION 'Resource funding belongs to another payer or bucket' USING ERRCODE='23514'; END IF;
  END IF;
 ELSE
  SELECT * INTO hold FROM cloud_runtime_holds WHERE session_id=NEW.session_id;
  SELECT * INTO lot FROM funding_lots WHERE id=NEW.lot_id AND billing_account_id=hold.billing_account_id;
  IF lot.id IS NULL OR hold.state<>'reserved' OR NEW.amount_micros>hold.amount_micros THEN
   RAISE EXCEPTION 'Resource allocation differs from its funded hold' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION validate_cloud_runtime_funding() OWNER TO cp_control;
REVOKE ALL ON FUNCTION validate_cloud_runtime_funding() FROM PUBLIC;
CREATE TRIGGER cloud_runtime_source_valid BEFORE INSERT ON cloud_runtime_charge_sources FOR EACH ROW EXECUTE FUNCTION validate_cloud_runtime_funding();
CREATE TRIGGER cloud_runtime_allocation_valid BEFORE INSERT ON cloud_runtime_hold_allocations FOR EACH ROW EXECUTE FUNCTION validate_cloud_runtime_funding();

CREATE OR REPLACE FUNCTION balance_settlement_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE charge uuid;amount bigint;allocated numeric;resource uuid;
BEGIN
 IF TG_TABLE_NAME='ledger' THEN charge=NEW.id; ELSE charge=NEW.charge_id; END IF;
 SELECT -amount_micros,cloud_runtime_session_id INTO amount,resource FROM ledger WHERE id=charge AND tenant_id=NEW.tenant_id AND kind='charge';
 IF resource IS NOT NULL THEN
  SELECT coalesce(sum(amount_micros),0) INTO allocated FROM cloud_runtime_charge_sources WHERE charge_id=charge;
 ELSE
  SELECT coalesce(sum(amount_micros),0) INTO allocated FROM billing_settlement_sources WHERE charge_id=charge AND tenant_id=NEW.tenant_id;
 END IF;
 IF amount IS NULL OR allocated<>amount THEN RAISE EXCEPTION 'Settlement sources must equal the confirmed charge' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION balance_cloud_runtime_sources() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE amount bigint;allocated numeric;
BEGIN
 SELECT -amount_micros INTO amount FROM ledger WHERE id=NEW.charge_id AND cloud_runtime_session_id IS NOT NULL AND kind='charge';
 SELECT coalesce(sum(amount_micros),0) INTO allocated FROM cloud_runtime_charge_sources WHERE charge_id=NEW.charge_id;
 IF amount IS NULL OR allocated<>amount THEN RAISE EXCEPTION 'Resource sources must equal the confirmed charge' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
ALTER FUNCTION balance_cloud_runtime_sources() OWNER TO cp_control;
REVOKE ALL ON FUNCTION balance_cloud_runtime_sources() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER cloud_runtime_sources_balanced AFTER INSERT ON cloud_runtime_charge_sources DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION balance_cloud_runtime_sources();
