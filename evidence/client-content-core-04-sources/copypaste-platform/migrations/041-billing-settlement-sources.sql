-- Only new events receive source allocations. Historical ledger entries retain
-- their original bytes; missing historical provenance is not reconstructed.
ALTER TABLE ledger ADD CONSTRAINT ledger_tenant_entry_unique UNIQUE(tenant_id,id);
ALTER TABLE funding_lots ADD CONSTRAINT funding_lots_tenant_unique UNIQUE(tenant_id,id);

CREATE TABLE billing_settlement_sources (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id), task_id uuid NOT NULL,
 charge_id uuid NOT NULL, lot_id uuid, kind text NOT NULL CHECK(kind IN ('paid','gift','credit')),
 amount_micros bigint NOT NULL CHECK(amount_micros>0), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,task_id) REFERENCES tasks(tenant_id,id),
 FOREIGN KEY(tenant_id,charge_id) REFERENCES ledger(tenant_id,id),
 FOREIGN KEY(tenant_id,lot_id) REFERENCES funding_lots(tenant_id,id),
 CHECK((kind='credit')=(lot_id IS NULL)),
 UNIQUE NULLS NOT DISTINCT(charge_id,lot_id)
);
CREATE INDEX billing_settlement_task ON billing_settlement_sources(tenant_id,task_id);
CREATE TABLE billing_credit_repayments (
 funding_entry_id uuid PRIMARY KEY, tenant_id uuid NOT NULL REFERENCES tenants(id),
 amount_micros bigint NOT NULL CHECK(amount_micros>0), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,funding_entry_id) REFERENCES ledger(tenant_id,id)
);

CREATE FUNCTION immutable_billing_source() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'Billing source history is immutable' USING ERRCODE='42501';
END $$;
CREATE TRIGGER settlement_source_immutable BEFORE UPDATE OR DELETE ON billing_settlement_sources FOR EACH ROW EXECUTE FUNCTION immutable_billing_source();
CREATE TRIGGER credit_repayment_immutable BEFORE UPDATE OR DELETE ON billing_credit_repayments FOR EACH ROW EXECUTE FUNCTION immutable_billing_source();

CREATE FUNCTION validate_billing_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entry ledger; lot funding_lots;
BEGIN
 IF TG_TABLE_NAME='billing_credit_repayments' THEN
  SELECT * INTO entry FROM ledger WHERE tenant_id=NEW.tenant_id AND id=NEW.funding_entry_id;
  IF NOT FOUND OR entry.kind NOT IN ('top_up','gift') OR NEW.amount_micros>entry.amount_micros THEN
   RAISE EXCEPTION 'Invalid credit repayment source' USING ERRCODE='23514';
  END IF;
 ELSE
  SELECT * INTO entry FROM ledger WHERE tenant_id=NEW.tenant_id AND id=NEW.charge_id;
  IF NOT FOUND OR entry.kind<>'charge' OR entry.task_id IS DISTINCT FROM NEW.task_id THEN
   RAISE EXCEPTION 'Invalid settlement charge' USING ERRCODE='23514';
  END IF;
  IF NEW.lot_id IS NOT NULL THEN
   SELECT * INTO lot FROM funding_lots WHERE tenant_id=NEW.tenant_id AND id=NEW.lot_id;
   IF NOT FOUND OR NEW.kind<>lot.kind THEN
    RAISE EXCEPTION 'Invalid settlement funding bucket' USING ERRCODE='23514';
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER settlement_source_validate BEFORE INSERT ON billing_settlement_sources FOR EACH ROW EXECUTE FUNCTION validate_billing_source();
CREATE TRIGGER credit_repayment_validate BEFORE INSERT ON billing_credit_repayments FOR EACH ROW EXECUTE FUNCTION validate_billing_source();

CREATE FUNCTION balance_settlement_sources() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE charge uuid; amount bigint; allocated numeric;
BEGIN
 IF TG_TABLE_NAME='ledger' THEN charge=NEW.id; ELSE charge=NEW.charge_id; END IF;
 SELECT -amount_micros INTO amount FROM ledger WHERE id=charge AND tenant_id=NEW.tenant_id AND kind='charge';
 SELECT coalesce(sum(amount_micros),0) INTO allocated FROM billing_settlement_sources WHERE charge_id=charge AND tenant_id=NEW.tenant_id;
 IF amount IS NULL OR allocated<>amount THEN
  RAISE EXCEPTION 'Settlement sources must equal the confirmed charge' USING ERRCODE='23514';
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER ledger_settlement_balanced AFTER INSERT ON ledger DEFERRABLE INITIALLY DEFERRED FOR EACH ROW WHEN(NEW.kind='charge') EXECUTE FUNCTION balance_settlement_sources();
CREATE CONSTRAINT TRIGGER settlement_sources_balanced AFTER INSERT ON billing_settlement_sources DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION balance_settlement_sources();

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['billing_settlement_sources','billing_credit_repayments'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (current_user=''cp_control'' OR tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (current_user=''cp_control'' OR tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO cp_app,cp_control',t);
 END LOOP;
END $$;
