CREATE INDEX billing_journal_operation_time ON billing_journal(operation_id,created_at);
CREATE FUNCTION validate_cash_refund_event() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request billing_refunds; command admin_operations; account wallets; evidence record; paid numeric; remaining numeric; expected text;
BEGIN
 SELECT * INTO account FROM wallets WHERE id=NEW.billing_account_id FOR NO KEY UPDATE;
 SELECT * INTO request FROM billing_refunds WHERE id=NEW.refund_id;
 SELECT * INTO command FROM admin_operations WHERE id=NEW.operation_id;
 SELECT coalesce(sum(observed_amount_micros) FILTER(WHERE outcome='paid'),0) INTO paid FROM billing_refund_events WHERE refund_id=request.id;
 remaining=request.amount_micros-paid;
 IF request.destination IS DISTINCT FROM 'payment_method' OR request.billing_account_id IS DISTINCT FROM account.id OR account.data_mode IS DISTINCT FROM NEW.data_mode
  OR request.created_by IS NOT DISTINCT FROM NEW.verified_by OR remaining<=0
  OR EXISTS(SELECT 1 FROM billing_refund_events WHERE refund_id=request.id AND outcome='not_paid')
  OR NEW.expected_version<>1+(SELECT count(*) FROM billing_refund_events WHERE refund_id=request.id)
  OR command.action IS DISTINCT FROM 'billing.reconcile' OR command.principal_id IS DISTINCT FROM NEW.verified_by
  OR command.payload->>'payment_record_command_version' IS DISTINCT FROM '1'
  OR command.payload->>'billing_account_id' IS DISTINCT FROM account.id::text
  OR command.payload#>>'{command,kind}' IS DISTINCT FROM 'refund_outcome'
  OR command.payload#>>'{command,refund_id}' IS DISTINCT FROM request.id::text
  OR command.payload#>>'{command,body,expected_version}' IS DISTINCT FROM NEW.expected_version::text
  OR command.payload#>>'{command,body,observed_amount,amount_micros}' IS DISTINCT FROM NEW.observed_amount_micros::text
  OR command.payload#>>'{command,body,external_reference}' IS DISTINCT FROM NEW.external_reference
  OR command.payload#>>'{command,body,evidence_asset_version_id}' IS DISTINCT FROM NEW.evidence_asset_version_id::text
  OR command.payload#>>'{command,body,reason}' IS DISTINCT FROM NEW.reason THEN
  RAISE EXCEPTION 'Cash refund outcome requires current original intent, version and an independent actual observer' USING ERRCODE='23514';
 END IF;
 expected=command.payload#>>'{command,body,outcome}';
 IF expected='paid' AND (NEW.observed_amount_micros IS NULL OR NEW.observed_amount_micros<=0 OR NEW.observed_amount_micros>remaining)
  OR expected='not_paid' AND NEW.observed_amount_micros IS DISTINCT FROM 0 THEN expected='mismatch'; END IF;
 IF NEW.outcome IS DISTINCT FROM expected THEN RAISE EXCEPTION 'A discrepant external amount must remain in reconciliation' USING ERRCODE='23514'; END IF;
 IF NEW.evidence_asset_version_id IS NOT NULL THEN
  SELECT v.sha256,v.erased_at,v.bytes,a.state,a.retention_expires_at,a.tenant_id,a.private_owner,t.data_mode INTO evidence
   FROM asset_versions v JOIN assets a ON a.id=v.asset_id JOIN tenants t ON t.id=a.tenant_id WHERE v.id=NEW.evidence_asset_version_id;
  IF evidence.sha256 IS DISTINCT FROM NEW.evidence_sha256 OR evidence.erased_at IS NOT NULL OR coalesce(evidence.bytes,0)<=0
   OR evidence.state IS DISTINCT FROM 'active' OR evidence.retention_expires_at<=now() OR evidence.data_mode IS DISTINCT FROM account.data_mode
   OR (account.user_id IS NOT NULL AND evidence.private_owner IS DISTINCT FROM account.user_id)
   OR (account.tenant_id IS NOT NULL AND (evidence.tenant_id IS DISTINCT FROM account.tenant_id OR evidence.private_owner IS NOT NULL)) THEN
   RAISE EXCEPTION 'Refund evidence must retain its active version, subject, digest and execution mode' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW.occurred_at>now() THEN RAISE EXCEPTION 'An external outcome cannot occur in the future' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cash_refund_event_valid BEFORE INSERT ON billing_refund_events FOR EACH ROW EXECUTE FUNCTION validate_cash_refund_event();

CREATE FUNCTION validate_refund_closure() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request billing_refunds; event billing_refund_events; entry billing_journal; release billing_journal; amount numeric;
BEGIN
 SELECT * INTO request FROM billing_refunds WHERE id=NEW.refund_id;
 SELECT * INTO event FROM billing_refund_events WHERE id=NEW.event_id;
 SELECT * INTO entry FROM billing_journal WHERE id=NEW.journal_id;
 SELECT * INTO release FROM billing_journal WHERE id=NEW.release_journal_id;
 amount=CASE WHEN event.outcome='paid' THEN event.observed_amount_micros ELSE request.amount_micros-coalesce((SELECT sum(observed_amount_micros) FROM billing_refund_events WHERE refund_id=request.id AND outcome='paid'),0) END;
 IF request.billing_account_id IS DISTINCT FROM NEW.billing_account_id OR event.refund_id IS DISTINCT FROM request.id OR event.outcome NOT IN ('paid','not_paid')
  OR entry.operation_id IS DISTINCT FROM event.operation_id OR entry.actor_id IS DISTINCT FROM event.verified_by
  OR release.operation_id IS DISTINCT FROM event.operation_id OR release.actor_id IS DISTINCT FROM event.verified_by
  OR release.billing_account_id IS DISTINCT FROM NEW.billing_account_id OR release.kind IS DISTINCT FROM 'release' OR release.bucket IS DISTINCT FROM 'reserved'
  OR release.direction IS DISTINCT FROM 'debit' OR release.source_entry_id IS DISTINCT FROM request.hold_journal_id OR release.amount_micros IS DISTINCT FROM amount THEN
  RAISE EXCEPTION 'Actual refund outcome and source hold release must be committed together' USING ERRCODE='23514';
 END IF;
 IF event.outcome='paid' THEN
  IF entry.kind<>'refund' OR entry.direction<>'debit' OR entry.bucket<>'paid' OR entry.amount_micros<>amount OR entry.source_entry_id<>request.original_entry_id THEN
   RAISE EXCEPTION 'Paid refund requires its exact original payment debit' USING ERRCODE='23514';
  END IF;
 ELSIF NEW.journal_id<>NEW.release_journal_id THEN RAISE EXCEPTION 'Not-paid confirmation only releases the remaining hold' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER refund_closure_valid BEFORE INSERT ON billing_refund_closures FOR EACH ROW EXECUTE FUNCTION validate_refund_closure();
CREATE FUNCTION refund_outcome_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (NEW.outcome IN ('paid','not_paid')) IS DISTINCT FROM EXISTS(SELECT 1 FROM billing_refund_closures WHERE event_id=NEW.id) THEN
  RAISE EXCEPTION 'Refund evidence and its financial effect must be atomic' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER refund_outcome_balanced AFTER INSERT ON billing_refund_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION refund_outcome_balanced();

CREATE FUNCTION verified_cash_refund_ledger() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request billing_refunds; event billing_refund_events; original billing_journal;
BEGIN
 SELECT r.* INTO request FROM billing_refund_closures c JOIN billing_refunds r ON r.id=c.refund_id WHERE c.journal_id=NEW.id;
 IF request.id IS NULL THEN RAISE EXCEPTION 'Refund ledger writes require independently verified refund evidence' USING ERRCODE='23514'; END IF;
 SELECT e.* INTO event FROM billing_refund_events e JOIN billing_refund_closures c ON c.event_id=e.id WHERE c.journal_id=NEW.id;
 SELECT * INTO original FROM billing_journal WHERE id=request.original_entry_id;
 IF event.outcome IS DISTINCT FROM 'paid' OR NEW.billing_account_id IS DISTINCT FROM request.billing_account_id
  OR NEW.operation_id IS DISTINCT FROM event.operation_id OR NEW.actor_id IS DISTINCT FROM event.verified_by
  OR NEW.amount_micros IS DISTINCT FROM -event.observed_amount_micros OR NEW.source_id IS DISTINCT FROM original.raw_entry_id
  OR NEW.reference IS DISTINCT FROM 'refund:'||request.id::text||':'||event.id::text
  OR (SELECT coalesce(sum(-amount_micros),0) FROM ledger WHERE source_id=NEW.source_id AND kind='refund')>original.amount_micros THEN
  RAISE EXCEPTION 'Cash refunds cannot exceed or change their actual verified original transaction' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER cash_refund_ledger_verified AFTER INSERT ON ledger DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.kind='refund') EXECUTE FUNCTION verified_cash_refund_ledger();

CREATE FUNCTION cash_refund_holds_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request billing_refunds; held numeric; actual numeric;
BEGIN
 IF TG_TABLE_NAME='billing_refunds' THEN request=NEW; ELSE SELECT * INTO request FROM billing_refunds WHERE id=NEW.refund_id; END IF;
 SELECT coalesce(sum(amount_micros),0) INTO held FROM reservations WHERE billing_account_id=request.billing_account_id AND status IN ('reserved','reconciling');
 SELECT held+coalesce(sum(r.amount_micros-coalesce((SELECT sum(e.observed_amount_micros) FROM billing_refund_events e WHERE e.refund_id=r.id AND e.outcome='paid'),0)),0) INTO held
  FROM billing_refunds r WHERE r.billing_account_id=request.billing_account_id AND r.destination='payment_method' AND NOT EXISTS(SELECT 1 FROM billing_refund_events e WHERE e.refund_id=r.id AND e.outcome='not_paid');
 SELECT reserved_micros INTO actual FROM wallets WHERE id=request.billing_account_id;
 IF actual IS DISTINCT FROM held THEN RAISE EXCEPTION 'Cash and task commitments do not match the account hold' USING ERRCODE='23514'; END IF;
 SELECT coalesce(sum(a.amount_micros),0) INTO held FROM reservation_allocations a JOIN reservations r ON r.task_id=a.task_id WHERE a.lot_id=request.lot_id AND r.status IN ('reserved','reconciling');
 SELECT held+coalesce(sum(r.amount_micros-coalesce((SELECT sum(e.observed_amount_micros) FROM billing_refund_events e WHERE e.refund_id=r.id AND e.outcome='paid'),0)),0) INTO held
  FROM billing_refunds r WHERE r.lot_id=request.lot_id AND r.destination='payment_method' AND NOT EXISTS(SELECT 1 FROM billing_refund_events e WHERE e.refund_id=r.id AND e.outcome='not_paid');
 SELECT reserved_micros INTO actual FROM funding_lots WHERE id=request.lot_id;
 IF actual IS DISTINCT FROM held THEN RAISE EXCEPTION 'Cash and task commitments do not match the original paid lot' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER cash_request_hold_balanced AFTER INSERT ON billing_refunds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.destination='payment_method') EXECUTE FUNCTION cash_refund_holds_balanced();
CREATE CONSTRAINT TRIGGER cash_outcome_hold_balanced AFTER INSERT ON billing_refund_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION cash_refund_holds_balanced();

-- A refund may not extend an original promotional funding window.
CREATE OR REPLACE FUNCTION immutable_billing_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='wallets' THEN
  IF ROW(NEW.id,NEW.tenant_id,NEW.user_id,NEW.data_mode) IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.user_id,OLD.data_mode) THEN RAISE EXCEPTION 'Billing account subject and mode are immutable' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='tasks' THEN
  IF ROW(NEW.tenant_id,NEW.created_by,NEW.data_mode) IS DISTINCT FROM ROW(OLD.tenant_id,OLD.created_by,OLD.data_mode) THEN RAISE EXCEPTION 'Task billing subject and mode are immutable' USING ERRCODE='42501'; END IF;
 ELSIF TG_TABLE_NAME='reservations' THEN
  IF ROW(NEW.task_id,NEW.tenant_id,NEW.billing_account_id,NEW.amount_micros) IS DISTINCT FROM ROW(OLD.task_id,OLD.tenant_id,OLD.billing_account_id,OLD.amount_micros) THEN RAISE EXCEPTION 'Reserved financial identity is immutable' USING ERRCODE='42501'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.tenant_id,NEW.billing_account_id,NEW.ledger_id,NEW.kind,NEW.expires_at) IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.billing_account_id,OLD.ledger_id,OLD.kind,OLD.expires_at) THEN RAISE EXCEPTION 'Funding source identity and expiry are immutable' USING ERRCODE='42501'; END IF;
 END IF;
 RETURN NEW;
END $$;
