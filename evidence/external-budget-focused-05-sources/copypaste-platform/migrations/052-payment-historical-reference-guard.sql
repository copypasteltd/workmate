-- OLD is a trigger record, not a safe SQL alias. Keep applied migrations
-- unchanged and repair only the historical receipt lookup.
CREATE OR REPLACE FUNCTION protect_payment_fact() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
   OR EXISTS(SELECT 1 FROM ledger historical_receipt WHERE historical_receipt.kind='top_up' AND historical_receipt.data_mode=NEW.data_mode AND historical_receipt.reference=NEW.external_reference)
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
