-- Receiving money, independently checking its evidence and posting product
-- credit are separate append-only facts. Historical ledger rows are unchanged.
CREATE TABLE payment_records (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), billing_account_id uuid NOT NULL REFERENCES wallets(id),
 data_mode text NOT NULL CHECK(data_mode IN ('simulated','configured_services')),
 external_reference text NOT NULL CHECK(length(btrim(external_reference))>0 AND external_reference=btrim(external_reference)),
 amount_micros bigint NOT NULL CHECK(amount_micros>0), received_at timestamptz NOT NULL,
 evidence_asset_version_id uuid NOT NULL REFERENCES asset_versions(id), evidence_sha256 text NOT NULL CHECK(evidence_sha256~'^[a-f0-9]{64}$'),
 created_by uuid NOT NULL REFERENCES admin_principals(id), operation_id uuid NOT NULL UNIQUE REFERENCES admin_operations(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(data_mode,external_reference)
);
CREATE INDEX payment_records_page ON payment_records(created_at,id);
CREATE TABLE payment_confirmations (
 payment_record_id uuid PRIMARY KEY REFERENCES payment_records(id),
 verified_reference text NOT NULL, verified_by uuid NOT NULL REFERENCES admin_principals(id),
 evidence_sha256 text NOT NULL, operation_id uuid NOT NULL UNIQUE REFERENCES admin_operations(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE payment_postings (
 payment_record_id uuid PRIMARY KEY REFERENCES payment_records(id),
 ledger_id uuid NOT NULL UNIQUE REFERENCES ledger(id), operation_id uuid NOT NULL UNIQUE REFERENCES admin_operations(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION protect_payment_fact() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE p payment_records; w wallets; a assets; v asset_versions; o admin_operations; l ledger;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Payment facts are append-only' USING ERRCODE='23514'; END IF;
 SELECT * INTO o FROM admin_operations WHERE id=NEW.operation_id;
 IF o.id IS NULL OR o.state NOT IN ('running','pending_approval') THEN RAISE EXCEPTION 'Payment fact requires a live operation' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='payment_records' THEN
  SELECT * INTO w FROM wallets WHERE id=NEW.billing_account_id;
  SELECT * INTO v FROM asset_versions WHERE id=NEW.evidence_asset_version_id;
  SELECT * INTO a FROM assets WHERE id=v.asset_id;
  IF w.id IS NULL OR w.data_mode<>NEW.data_mode OR NEW.received_at>now() OR o.action<>'billing.reconcile' OR o.principal_id<>NEW.created_by
   OR o.payload->>'payment_record_command_version' IS DISTINCT FROM '1' OR o.payload->>'billing_account_id' IS DISTINCT FROM w.id::text
   OR o.payload#>>'{command,kind}' IS DISTINCT FROM 'record' OR o.payload#>>'{command,body,external_reference}' IS DISTINCT FROM NEW.external_reference
   OR o.payload#>>'{command,body,amount,amount_micros}' IS DISTINCT FROM NEW.amount_micros::text
   OR o.payload#>>'{command,body,amount,currency}' IS DISTINCT FROM 'HKD'
   OR EXISTS(SELECT 1 FROM ledger old WHERE old.kind='top_up' AND old.data_mode=NEW.data_mode AND old.reference=NEW.external_reference)
   OR (o.payload#>>'{command,body,received_at}')::timestamptz IS DISTINCT FROM NEW.received_at
   OR o.payload#>>'{command,body,evidence_asset_version_id}' IS DISTINCT FROM NEW.evidence_asset_version_id::text
   OR v.id IS NULL OR a.state<>'active' OR a.retention_expires_at<=now() OR v.erased_at IS NOT NULL OR v.sha256<>NEW.evidence_sha256
   OR NOT EXISTS(SELECT 1 FROM tenants t WHERE t.id=a.tenant_id AND t.data_mode=w.data_mode)
   OR (w.tenant_id IS NOT NULL AND (a.tenant_id<>w.tenant_id OR a.private_owner IS NOT NULL))
   OR (w.user_id IS NOT NULL AND a.private_owner IS DISTINCT FROM w.user_id)
  THEN RAISE EXCEPTION 'Invalid recorded payment evidence or identity' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='payment_confirmations' THEN
  SELECT * INTO p FROM payment_records WHERE id=NEW.payment_record_id;
  SELECT * INTO v FROM asset_versions WHERE id=p.evidence_asset_version_id;
  SELECT * INTO a FROM assets WHERE id=v.asset_id;
  IF p.id IS NULL OR NEW.verified_by=p.created_by OR NEW.verified_reference<>p.external_reference OR NEW.evidence_sha256<>p.evidence_sha256
   OR o.action<>'billing.reconcile' OR o.principal_id<>NEW.verified_by OR o.payload->>'payment_record_command_version' IS DISTINCT FROM '1'
   OR o.payload->>'billing_account_id' IS DISTINCT FROM p.billing_account_id::text OR o.payload#>>'{command,kind}' IS DISTINCT FROM 'confirm'
   OR o.payload#>>'{command,body,expected_version}' IS DISTINCT FROM '1'
   OR o.payload#>>'{command,payment_id}' IS DISTINCT FROM p.id::text OR o.payload#>>'{command,body,verified_reference}' IS DISTINCT FROM NEW.verified_reference
   OR v.erased_at IS NOT NULL OR v.sha256<>p.evidence_sha256 OR a.state<>'active' OR a.retention_expires_at<=now()
  THEN RAISE EXCEPTION 'Invalid independent payment confirmation' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO p FROM payment_records WHERE id=NEW.payment_record_id;
  SELECT * INTO l FROM ledger WHERE id=NEW.ledger_id;
  IF p.id IS NULL OR NOT EXISTS(SELECT 1 FROM payment_confirmations WHERE payment_record_id=p.id)
   OR l.id IS NULL OR l.kind<>'top_up' OR l.billing_account_id<>p.billing_account_id OR l.data_mode<>p.data_mode
   OR l.amount_micros<>p.amount_micros OR l.reference<>'payment:'||p.id::text OR l.operation_id<>o.id OR o.action<>'billing.top_up'
   OR o.payload#>>'{command,payment_record_id}' IS DISTINCT FROM p.id::text OR o.payload->>'financial_command_version' IS DISTINCT FROM '1'
  THEN RAISE EXCEPTION 'Invalid payment posting or amount' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION protect_payment_fact() OWNER TO cp_control;
REVOKE ALL ON FUNCTION protect_payment_fact() FROM PUBLIC;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['payment_records','payment_confirmations','payment_postings'] LOOP
  EXECUTE format('CREATE TRIGGER payment_fact_guard BEFORE INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION protect_payment_fact()',t);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO cp_control',t);
 END LOOP;
END $$;

-- New admin top-ups must refer to a confirmed payment, even if an old
-- operation controller or direct control-role statement tries to bypass HTTP.
CREATE FUNCTION validate_admin_payment_ledger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE o admin_operations; p payment_records;
BEGIN
 SELECT * INTO o FROM admin_operations WHERE 'admin:'||id::text=NEW.idempotency_key;
 IF NEW.kind='top_up' AND (o.id IS NOT NULL OR NEW.reference LIKE 'payment:%') THEN
  SELECT * INTO p FROM payment_records WHERE id::text=o.payload#>>'{command,payment_record_id}';
  IF p.id IS NULL OR o.id IS NULL OR o.action<>'billing.top_up' OR o.payload->>'financial_command_version' IS DISTINCT FROM '1'
   OR p.billing_account_id<>NEW.billing_account_id OR p.amount_micros<>NEW.amount_micros OR NEW.reference IS DISTINCT FROM 'payment:'||p.id::text
   OR NOT EXISTS(SELECT 1 FROM payment_confirmations WHERE payment_record_id=p.id)
   OR EXISTS(SELECT 1 FROM payment_postings WHERE payment_record_id=p.id)
  THEN RAISE EXCEPTION 'Admin top-up requires an unposted confirmed payment' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION validate_admin_payment_ledger() OWNER TO cp_control;
REVOKE ALL ON FUNCTION validate_admin_payment_ledger() FROM PUBLIC;
CREATE TRIGGER admin_payment_ledger BEFORE INSERT ON ledger FOR EACH ROW EXECUTE FUNCTION validate_admin_payment_ledger();
CREATE FUNCTION link_payment_journal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.kind<>'top_up' AND NEW.payment_record_id IS NOT NULL THEN RAISE EXCEPTION 'Only verified top-ups can claim a payment' USING ERRCODE='23514'; END IF;
 IF NEW.kind='top_up' THEN
  SELECT p.id INTO NEW.payment_record_id FROM payment_records p JOIN ledger l ON l.id=NEW.raw_entry_id
   WHERE l.reference='payment:'||p.id::text AND p.billing_account_id=NEW.billing_account_id AND p.amount_micros=NEW.amount_micros;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION link_payment_journal() OWNER TO cp_control;
REVOKE ALL ON FUNCTION link_payment_journal() FROM PUBLIC;
CREATE TRIGGER payment_journal_link BEFORE INSERT ON billing_journal FOR EACH ROW EXECUTE FUNCTION link_payment_journal();
ALTER TABLE billing_journal ADD CONSTRAINT journal_payment_record FOREIGN KEY(payment_record_id) REFERENCES payment_records(id);
