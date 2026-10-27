-- Preserve historical settlement facts. Existing debt has no recorded per-charge
-- repayment assignment, so retain it as an explicit opening cohort rather than
-- inventing links to old charges. New repayments allocate opening debt first,
-- then actual post-upgrade credit charges under the billing-account lock.
CREATE TABLE billing_credit_opening_balances (
 billing_account_id uuid PRIMARY KEY REFERENCES wallets(id),
 amount_micros bigint NOT NULL CHECK(amount_micros>=0),
 captured_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO billing_credit_opening_balances(billing_account_id,amount_micros)
SELECT w.id,coalesce((SELECT sum(f.remaining_micros) FROM funding_lots f WHERE f.billing_account_id=w.id),0)-w.balance_micros FROM wallets w;
CREATE TABLE billing_credit_legacy_sources (
 source_id uuid PRIMARY KEY REFERENCES billing_settlement_sources(id),
 billing_account_id uuid NOT NULL REFERENCES wallets(id)
);
INSERT INTO billing_credit_legacy_sources(source_id,billing_account_id)
SELECT id,billing_account_id FROM billing_settlement_sources WHERE kind='credit';
CREATE TABLE billing_credit_repayment_parts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 billing_account_id uuid NOT NULL REFERENCES wallets(id),
 funding_entry_id uuid NOT NULL REFERENCES billing_credit_repayments(funding_entry_id),
 credit_source_id uuid REFERENCES billing_settlement_sources(id),
 amount_micros bigint NOT NULL CHECK(amount_micros>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE NULLS NOT DISTINCT(funding_entry_id,credit_source_id)
);
CREATE TABLE billing_credit_refund_cancellations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 billing_account_id uuid NOT NULL REFERENCES wallets(id),
 credit_source_id uuid NOT NULL REFERENCES billing_settlement_sources(id),
 refund_operation_id uuid NOT NULL REFERENCES admin_operations(id),
 amount_micros bigint NOT NULL CHECK(amount_micros>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(refund_operation_id,credit_source_id)
);
CREATE INDEX credit_repayment_source ON billing_credit_repayment_parts(credit_source_id);
CREATE INDEX credit_cancel_source ON billing_credit_refund_cancellations(credit_source_id);

CREATE FUNCTION validate_credit_repayment_part() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE paid billing_credit_repayments; source billing_settlement_sources; capacity numeric;
BEGIN
 PERFORM 1 FROM wallets WHERE id=NEW.billing_account_id FOR NO KEY UPDATE;
 SELECT * INTO paid FROM billing_credit_repayments WHERE funding_entry_id=NEW.funding_entry_id;
 IF paid.billing_account_id IS DISTINCT FROM NEW.billing_account_id OR
  NEW.amount_micros+coalesce((SELECT sum(amount_micros) FROM billing_credit_repayment_parts WHERE funding_entry_id=NEW.funding_entry_id),0)>paid.amount_micros THEN
  RAISE EXCEPTION 'Credit repayment allocation exceeds its actual source' USING ERRCODE='23514';
 END IF;
 IF NEW.credit_source_id IS NULL THEN
  SELECT amount_micros INTO capacity FROM billing_credit_opening_balances WHERE billing_account_id=NEW.billing_account_id;
  capacity=coalesce(capacity,0)-coalesce((SELECT sum(amount_micros) FROM billing_credit_repayment_parts WHERE billing_account_id=NEW.billing_account_id AND credit_source_id IS NULL),0);
 ELSE
  SELECT * INTO source FROM billing_settlement_sources WHERE id=NEW.credit_source_id;
  IF source.billing_account_id IS DISTINCT FROM NEW.billing_account_id OR source.kind IS DISTINCT FROM 'credit' OR EXISTS(SELECT 1 FROM billing_credit_legacy_sources WHERE source_id=source.id) THEN
   RAISE EXCEPTION 'Credit repayment requires an actual post-upgrade obligation' USING ERRCODE='23514';
  END IF;
  capacity=source.amount_micros-coalesce((SELECT sum(amount_micros) FROM billing_credit_repayment_parts WHERE credit_source_id=source.id),0)-coalesce((SELECT sum(amount_micros) FROM billing_credit_refund_cancellations WHERE credit_source_id=source.id),0);
 END IF;
 IF NEW.amount_micros>capacity THEN RAISE EXCEPTION 'Credit obligation has already been repaid or cancelled' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER credit_repayment_part_valid BEFORE INSERT ON billing_credit_repayment_parts FOR EACH ROW EXECUTE FUNCTION validate_credit_repayment_part();

CREATE FUNCTION allocate_credit_repayment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE remaining numeric:=NEW.amount_micros; capacity numeric; part numeric; source record;
BEGIN
 PERFORM 1 FROM wallets WHERE id=NEW.billing_account_id FOR NO KEY UPDATE;
 SELECT amount_micros INTO capacity FROM billing_credit_opening_balances WHERE billing_account_id=NEW.billing_account_id;
 capacity=coalesce(capacity,0)-coalesce((SELECT sum(amount_micros) FROM billing_credit_repayment_parts WHERE billing_account_id=NEW.billing_account_id AND credit_source_id IS NULL),0);
 part=least(remaining,greatest(0,capacity));
 IF part>0 THEN
  INSERT INTO billing_credit_repayment_parts(billing_account_id,funding_entry_id,credit_source_id,amount_micros) VALUES(NEW.billing_account_id,NEW.funding_entry_id,NULL,part);
  remaining=remaining-part;
 END IF;
 FOR source IN
  SELECT s.id,s.amount_micros-coalesce((SELECT sum(p.amount_micros) FROM billing_credit_repayment_parts p WHERE p.credit_source_id=s.id),0)-coalesce((SELECT sum(c.amount_micros) FROM billing_credit_refund_cancellations c WHERE c.credit_source_id=s.id),0) AS available
  FROM billing_settlement_sources s WHERE s.billing_account_id=NEW.billing_account_id AND s.kind='credit'
   AND NOT EXISTS(SELECT 1 FROM billing_credit_legacy_sources l WHERE l.source_id=s.id)
  ORDER BY s.created_at,s.id
 LOOP
  EXIT WHEN remaining=0;
  part=least(remaining,greatest(0,source.available));
  IF part>0 THEN
   INSERT INTO billing_credit_repayment_parts(billing_account_id,funding_entry_id,credit_source_id,amount_micros) VALUES(NEW.billing_account_id,NEW.funding_entry_id,source.id,part);
   remaining=remaining-part;
  END IF;
 END LOOP;
 IF remaining<>0 THEN RAISE EXCEPTION 'Actual credit repayment has no matching opening or recorded obligation' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
ALTER FUNCTION allocate_credit_repayment() OWNER TO cp_control;
REVOKE ALL ON FUNCTION allocate_credit_repayment() FROM PUBLIC;
CREATE TRIGGER credit_repayment_allocate AFTER INSERT ON billing_credit_repayments FOR EACH ROW EXECUTE FUNCTION allocate_credit_repayment();

DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['billing_credit_opening_balances','billing_credit_legacy_sources','billing_credit_repayment_parts','billing_credit_refund_cancellations'] LOOP
  EXECUTE format('CREATE TRIGGER credit_lineage_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION immutable_billing_source()',name);
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('CREATE POLICY credit_account_scope ON %I USING(current_user=''cp_control'' OR EXISTS(SELECT 1 FROM wallets w WHERE w.id=billing_account_id)) WITH CHECK(current_user=''cp_control'' OR EXISTS(SELECT 1 FROM wallets w WHERE w.id=billing_account_id))',name);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO cp_control',name);
  EXECUTE format('GRANT SELECT ON %I TO cp_app',name);
 END LOOP;
END $$;
