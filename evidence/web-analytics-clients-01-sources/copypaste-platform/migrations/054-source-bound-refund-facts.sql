CREATE TABLE billing_refunds (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), billing_account_id uuid NOT NULL REFERENCES wallets(id),
 operation_id uuid NOT NULL UNIQUE REFERENCES admin_operations(id), original_entry_id uuid NOT NULL REFERENCES billing_journal(id),
 destination text NOT NULL CHECK(destination IN ('paid_balance','payment_method')),
 amount_micros bigint NOT NULL CHECK(amount_micros>0),
 payment_record_id uuid REFERENCES payment_records(id), lot_id uuid REFERENCES funding_lots(id),
 hold_journal_id uuid UNIQUE REFERENCES billing_journal(id),
 created_by uuid NOT NULL REFERENCES admin_principals(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((destination='payment_method')=(payment_record_id IS NOT NULL AND lot_id IS NOT NULL AND hold_journal_id IS NOT NULL)),
 CHECK(destination<>'paid_balance' OR (payment_record_id IS NULL AND lot_id IS NULL AND hold_journal_id IS NULL))
);
CREATE INDEX refund_account_page ON billing_refunds(billing_account_id,created_at,id);
CREATE INDEX refund_original ON billing_refunds(original_entry_id);
CREATE TABLE billing_refund_source_parts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), refund_id uuid NOT NULL REFERENCES billing_refunds(id),
 billing_account_id uuid NOT NULL REFERENCES wallets(id), source_id uuid NOT NULL REFERENCES billing_settlement_sources(id),
 repayment_part_id uuid REFERENCES billing_credit_repayment_parts(id), cancellation_id uuid UNIQUE REFERENCES billing_credit_refund_cancellations(id),
 restored_lot_id uuid REFERENCES funding_lots(id), amount_micros bigint NOT NULL CHECK(amount_micros>0),
 journal_id uuid NOT NULL UNIQUE REFERENCES billing_journal(id), expiry_journal_id uuid UNIQUE REFERENCES billing_journal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX refund_parts_source ON billing_refund_source_parts(source_id);
CREATE INDEX refund_parts_repayment ON billing_refund_source_parts(repayment_part_id);
ALTER TABLE billing_credit_refund_cancellations ADD CONSTRAINT credit_cancel_refund FOREIGN KEY(refund_operation_id) REFERENCES billing_refunds(operation_id) DEFERRABLE INITIALLY DEFERRED;
CREATE TABLE billing_refund_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), refund_id uuid NOT NULL REFERENCES billing_refunds(id),
 billing_account_id uuid NOT NULL REFERENCES wallets(id), data_mode text NOT NULL CHECK(data_mode IN ('simulated','configured_services')),
 expected_version integer NOT NULL CHECK(expected_version>=1), outcome text NOT NULL CHECK(outcome IN ('paid','not_paid','unknown','mismatch')),
 observed_amount_micros bigint CHECK(observed_amount_micros>=0), external_reference text,
 evidence_asset_version_id uuid REFERENCES asset_versions(id), evidence_sha256 text, occurred_at timestamptz,
 verified_by uuid NOT NULL REFERENCES admin_principals(id), operation_id uuid NOT NULL UNIQUE REFERENCES admin_operations(id),
 reason text NOT NULL CHECK(length(reason)>=3), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(refund_id,expected_version),
 CHECK(outcome='unknown' OR (observed_amount_micros IS NOT NULL AND external_reference IS NOT NULL AND evidence_asset_version_id IS NOT NULL AND evidence_sha256 IS NOT NULL AND occurred_at IS NOT NULL))
);
CREATE UNIQUE INDEX external_refund_once ON billing_refund_events(data_mode,external_reference) WHERE outcome='paid';
CREATE INDEX refund_event_history ON billing_refund_events(refund_id,expected_version);
CREATE TABLE billing_refund_closures (
 refund_id uuid NOT NULL REFERENCES billing_refunds(id), event_id uuid PRIMARY KEY REFERENCES billing_refund_events(id),
 billing_account_id uuid NOT NULL REFERENCES wallets(id), journal_id uuid NOT NULL UNIQUE REFERENCES billing_journal(id),
 release_journal_id uuid NOT NULL UNIQUE REFERENCES billing_journal(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE FUNCTION validate_refund_request() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE command admin_operations; entry billing_journal; hold billing_journal; payment payment_records; capacity numeric;
BEGIN
 PERFORM 1 FROM wallets WHERE id=NEW.billing_account_id FOR NO KEY UPDATE;
 SELECT * INTO command FROM admin_operations WHERE id=NEW.operation_id;
 SELECT * INTO entry FROM billing_journal WHERE id=NEW.original_entry_id;
 IF command.id IS NULL OR command.action<>'billing.refund' OR command.principal_id<>NEW.created_by OR command.payload->>'financial_command_version' IS DISTINCT FROM '1'
  OR command.payload->>'billing_account_id' IS DISTINCT FROM NEW.billing_account_id::text
  OR command.payload#>>'{command,original_entry_id}' IS DISTINCT FROM NEW.original_entry_id::text
  OR command.payload#>>'{command,destination}' IS DISTINCT FROM NEW.destination
  OR command.payload#>>'{command,amount,amount_micros}' IS DISTINCT FROM NEW.amount_micros::text
  OR entry.billing_account_id IS DISTINCT FROM NEW.billing_account_id THEN
  RAISE EXCEPTION 'Refund must retain its canonical intent, account, actor and original entry' USING ERRCODE='23514';
 END IF;
 IF NEW.destination='paid_balance' THEN
  IF entry.kind<>'consume' OR entry.raw_entry_id IS NULL OR NEW.amount_micros+coalesce((SELECT sum(amount_micros) FROM billing_refunds WHERE original_entry_id=entry.id),0)>entry.amount_micros THEN
   RAISE EXCEPTION 'Consumption refunds exceed their actual original charge' USING ERRCODE='23514';
  END IF;
 ELSE
  SELECT * INTO payment FROM payment_records WHERE id=NEW.payment_record_id;
  SELECT * INTO hold FROM billing_journal WHERE id=NEW.hold_journal_id;
  IF entry.kind<>'top_up' OR entry.payment_record_id IS DISTINCT FROM payment.id OR payment.billing_account_id IS DISTINCT FROM NEW.billing_account_id
   OR NOT EXISTS(SELECT 1 FROM payment_confirmations WHERE payment_record_id=payment.id)
   OR NOT EXISTS(SELECT 1 FROM payment_postings WHERE payment_record_id=payment.id AND ledger_id=entry.raw_entry_id)
   OR NOT EXISTS(SELECT 1 FROM funding_lots WHERE id=NEW.lot_id AND ledger_id=entry.raw_entry_id AND billing_account_id=NEW.billing_account_id AND kind='paid')
   OR hold.kind IS DISTINCT FROM 'reserve' OR hold.bucket IS DISTINCT FROM 'reserved' OR hold.direction IS DISTINCT FROM 'credit'
   OR hold.operation_id IS DISTINCT FROM NEW.operation_id OR hold.billing_account_id IS DISTINCT FROM NEW.billing_account_id OR hold.amount_micros IS DISTINCT FROM NEW.amount_micros
   OR hold.source_entry_id IS DISTINCT FROM entry.id THEN
   RAISE EXCEPTION 'Cash refund requires an independently confirmed original payment and an actual source hold' USING ERRCODE='23514';
  END IF;
  SELECT entry.amount_micros-coalesce((SELECT sum(-l.amount_micros) FROM ledger l WHERE l.kind='refund' AND l.source_id=entry.raw_entry_id),0)
   -coalesce((SELECT sum(r.amount_micros-coalesce((SELECT sum(e.observed_amount_micros) FROM billing_refund_events e WHERE e.refund_id=r.id AND e.outcome='paid'),0)) FROM billing_refunds r WHERE r.original_entry_id=entry.id AND r.destination='payment_method'
     AND NOT EXISTS(SELECT 1 FROM billing_refund_events e WHERE e.refund_id=r.id AND e.outcome='not_paid')),0) INTO capacity;
  IF NEW.amount_micros>capacity THEN RAISE EXCEPTION 'Cash refunds and outstanding requests exceed the original payment' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER refund_request_valid BEFORE INSERT ON billing_refunds FOR EACH ROW EXECUTE FUNCTION validate_refund_request();

CREATE FUNCTION validate_credit_refund_cancellation() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source billing_settlement_sources;
BEGIN
 PERFORM 1 FROM wallets WHERE id=NEW.billing_account_id FOR NO KEY UPDATE;
 SELECT * INTO source FROM billing_settlement_sources WHERE id=NEW.credit_source_id;
 IF source.kind IS DISTINCT FROM 'credit' OR source.billing_account_id IS DISTINCT FROM NEW.billing_account_id
  OR EXISTS(SELECT 1 FROM billing_credit_legacy_sources WHERE source_id=source.id)
  OR NEW.amount_micros+coalesce((SELECT sum(amount_micros) FROM billing_credit_refund_cancellations WHERE credit_source_id=source.id),0)
   +coalesce((SELECT sum(amount_micros) FROM billing_credit_repayment_parts WHERE credit_source_id=source.id),0)>source.amount_micros THEN
  RAISE EXCEPTION 'Refund can cancel only the actual unpaid portion of its original credit obligation' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER credit_refund_cancellation_valid BEFORE INSERT ON billing_credit_refund_cancellations FOR EACH ROW EXECUTE FUNCTION validate_credit_refund_cancellation();

CREATE FUNCTION validate_refund_source_part() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE request billing_refunds; source billing_settlement_sources; repaid billing_credit_repayment_parts; entry billing_journal; expiry billing_journal;
BEGIN
 PERFORM 1 FROM wallets WHERE id=NEW.billing_account_id FOR NO KEY UPDATE;
 SELECT * INTO request FROM billing_refunds WHERE id=NEW.refund_id;
 SELECT * INTO source FROM billing_settlement_sources WHERE id=NEW.source_id;
 SELECT * INTO entry FROM billing_journal WHERE id=NEW.journal_id;
 IF request.destination IS DISTINCT FROM 'paid_balance' OR request.billing_account_id IS DISTINCT FROM NEW.billing_account_id
  OR source.billing_account_id IS DISTINCT FROM NEW.billing_account_id
  OR source.charge_id IS DISTINCT FROM (SELECT raw_entry_id FROM billing_journal WHERE id=request.original_entry_id)
  OR NEW.amount_micros+coalesce((SELECT sum(amount_micros) FROM billing_refund_source_parts WHERE source_id=source.id),0)>source.amount_micros
  OR entry.operation_id IS DISTINCT FROM request.operation_id OR entry.kind IS DISTINCT FROM 'compensation' OR entry.direction IS DISTINCT FROM 'credit'
  OR entry.amount_micros IS DISTINCT FROM NEW.amount_micros OR entry.source_entry_id IS DISTINCT FROM request.original_entry_id THEN
  RAISE EXCEPTION 'Refund compensation exceeds or changes the original consumption source' USING ERRCODE='23514';
 END IF;
 IF source.kind='credit' THEN
  IF EXISTS(SELECT 1 FROM billing_credit_legacy_sources WHERE source_id=source.id) THEN RAISE EXCEPTION 'Historical credit source needs explicit reconciliation' USING ERRCODE='23514'; END IF;
  IF NEW.repayment_part_id IS NULL THEN
   IF NEW.restored_lot_id IS NOT NULL OR NEW.expiry_journal_id IS NOT NULL OR NOT EXISTS(SELECT 1 FROM billing_credit_refund_cancellations c WHERE c.id=NEW.cancellation_id AND c.credit_source_id=source.id AND c.refund_operation_id=request.operation_id AND c.amount_micros=NEW.amount_micros) OR entry.bucket<>'credit_limit' THEN
    RAISE EXCEPTION 'Credit refund must retain its unpaid cancellation' USING ERRCODE='23514';
   END IF;
  ELSE
   SELECT * INTO repaid FROM billing_credit_repayment_parts WHERE id=NEW.repayment_part_id;
   IF repaid.credit_source_id IS DISTINCT FROM source.id OR NEW.cancellation_id IS NOT NULL
    OR NOT EXISTS(SELECT 1 FROM funding_lots WHERE id=NEW.restored_lot_id AND billing_account_id=NEW.billing_account_id AND ledger_id=repaid.funding_entry_id)
    OR NEW.amount_micros+coalesce((SELECT sum(amount_micros) FROM billing_refund_source_parts WHERE repayment_part_id=repaid.id),0)>repaid.amount_micros THEN
    RAISE EXCEPTION 'Repaid credit refund must restore its actual funding lot exactly once' USING ERRCODE='23514';
   END IF;
  END IF;
 ELSE
  IF NEW.restored_lot_id IS DISTINCT FROM source.lot_id OR NEW.repayment_part_id IS NOT NULL OR NEW.cancellation_id IS NOT NULL THEN
   RAISE EXCEPTION 'Refund cannot turn original promotional funds into paid funds' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW.restored_lot_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM funding_lots f WHERE f.id=NEW.restored_lot_id AND entry.bucket=CASE WHEN f.kind='gift' THEN 'promotional' ELSE 'paid' END) THEN
  RAISE EXCEPTION 'Compensation bucket does not match its original funding lot' USING ERRCODE='23514';
 END IF;
 IF NEW.expiry_journal_id IS NOT NULL THEN
  SELECT * INTO expiry FROM billing_journal WHERE id=NEW.expiry_journal_id;
  IF NOT EXISTS(SELECT 1 FROM funding_lots WHERE id=NEW.restored_lot_id AND kind='gift' AND expires_at<=now())
   OR expiry.kind IS DISTINCT FROM 'gift_expiry' OR expiry.bucket IS DISTINCT FROM 'promotional' OR expiry.direction IS DISTINCT FROM 'debit'
   OR expiry.amount_micros IS DISTINCT FROM NEW.amount_micros OR expiry.source_entry_id IS DISTINCT FROM entry.id OR expiry.operation_id IS DISTINCT FROM request.operation_id THEN
   RAISE EXCEPTION 'Expired promotional compensation must have its matching expiry fact' USING ERRCODE='23514';
  END IF;
 ELSIF EXISTS(SELECT 1 FROM funding_lots WHERE id=NEW.restored_lot_id AND kind='gift' AND expires_at<=now()) THEN
  RAISE EXCEPTION 'An expired gift cannot become spendable on refund' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER refund_source_valid BEFORE INSERT ON billing_refund_source_parts FOR EACH ROW EXECUTE FUNCTION validate_refund_source_part();
CREATE FUNCTION refund_compensation_balanced() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.destination='paid_balance' AND NEW.amount_micros<>(SELECT coalesce(sum(amount_micros),0) FROM billing_refund_source_parts WHERE refund_id=NEW.id) THEN
  RAISE EXCEPTION 'Every consumption refund must be fully allocated to original sources' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER refund_balanced AFTER INSERT ON billing_refunds DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION refund_compensation_balanced();

DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['billing_refunds','billing_refund_source_parts','billing_refund_events','billing_refund_closures'] LOOP
  EXECUTE format('CREATE TRIGGER refund_history_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION immutable_billing_source()',name);
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('CREATE POLICY refund_account_scope ON %I USING(current_user=''cp_control'' OR EXISTS(SELECT 1 FROM wallets w WHERE w.id=billing_account_id)) WITH CHECK(current_user=''cp_control'' OR EXISTS(SELECT 1 FROM wallets w WHERE w.id=billing_account_id))',name);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO cp_control',name);
  EXECUTE format('GRANT SELECT ON %I TO cp_app',name);
 END LOOP;
END $$;
REVOKE INSERT ON billing_credit_opening_balances,billing_credit_legacy_sources FROM cp_control;
