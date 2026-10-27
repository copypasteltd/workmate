-- Give personal and enterprise balances real account identities. Keep every
-- historical ledger row immutable: its enterprise account is resolved on read.
ALTER TABLE wallets DROP CONSTRAINT wallets_pkey;
ALTER TABLE wallets ADD PRIMARY KEY(id);
ALTER TABLE wallets ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE wallets ADD COLUMN user_id uuid REFERENCES users(id);
ALTER TABLE wallets ADD COLUMN data_mode text NOT NULL DEFAULT 'configured_services' CHECK(data_mode IN ('configured_services','simulated'));
UPDATE wallets w SET data_mode=t.data_mode FROM tenants t WHERE t.id=w.tenant_id;
ALTER TABLE wallets ADD CONSTRAINT wallet_subject CHECK((tenant_id IS NULL)<>(user_id IS NULL));
ALTER TABLE wallets ADD CONSTRAINT wallet_enterprise_unique UNIQUE(tenant_id);
ALTER TABLE wallets ADD CONSTRAINT wallet_personal_mode_unique UNIQUE(user_id,data_mode);
ALTER TABLE wallets ADD CONSTRAINT wallet_account_tenant_unique UNIQUE(id,tenant_id);

CREATE FUNCTION provision_personal_billing_accounts() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 INSERT INTO wallets(user_id,data_mode) VALUES(NEW.id,'configured_services'),(NEW.id,'simulated');
 RETURN NEW;
END $$;
ALTER FUNCTION provision_personal_billing_accounts() OWNER TO cp_control;
REVOKE ALL ON FUNCTION provision_personal_billing_accounts() FROM PUBLIC;
CREATE TRIGGER user_personal_billing_accounts AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION provision_personal_billing_accounts();
INSERT INTO wallets(user_id,data_mode) SELECT u.id,m.mode FROM users u CROSS JOIN (VALUES('configured_services'),('simulated')) m(mode);

DROP POLICY tenant_isolation ON wallets;
CREATE POLICY billing_account_scope ON wallets USING(current_user='cp_control' OR tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid OR user_id=nullif(current_setting('app.actor_id',true),'')::uuid OR user_id=nullif(current_setting('app.billing_actor_id',true),'')::uuid) WITH CHECK(current_user='cp_control' OR tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid OR user_id=nullif(current_setting('app.actor_id',true),'')::uuid OR user_id=nullif(current_setting('app.billing_actor_id',true),'')::uuid);
CREATE FUNCTION stamp_wallet_mode() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.tenant_id IS NOT NULL THEN SELECT data_mode INTO NEW.data_mode FROM tenants WHERE id=NEW.tenant_id; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER wallet_mode BEFORE INSERT ON wallets FOR EACH ROW EXECUTE FUNCTION stamp_wallet_mode();

ALTER TABLE tasks ADD COLUMN billing_account_id uuid REFERENCES wallets(id);
UPDATE tasks t SET billing_account_id=w.id FROM wallets w WHERE w.tenant_id=t.tenant_id;
ALTER TABLE tasks ALTER COLUMN billing_account_id SET NOT NULL;
ALTER TABLE reservations ADD COLUMN billing_account_id uuid REFERENCES wallets(id);
UPDATE reservations r SET billing_account_id=w.id FROM wallets w WHERE w.tenant_id=r.tenant_id;
ALTER TABLE reservations ALTER COLUMN billing_account_id SET NOT NULL;
ALTER TABLE funding_lots ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE funding_lots ADD COLUMN billing_account_id uuid REFERENCES wallets(id);
UPDATE funding_lots f SET billing_account_id=w.id FROM wallets w WHERE w.tenant_id=f.tenant_id;
ALTER TABLE funding_lots ALTER COLUMN billing_account_id SET NOT NULL;
ALTER TABLE funding_lots ADD CONSTRAINT funding_lots_account_unique UNIQUE(billing_account_id,id);
ALTER TABLE ledger ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE ledger ADD COLUMN billing_account_id uuid REFERENCES wallets(id);
CREATE INDEX ledger_billing_account ON ledger(billing_account_id,created_at,id);
CREATE UNIQUE INDEX ledger_account_idempotency ON ledger(billing_account_id,idempotency_key) WHERE billing_account_id IS NOT NULL;
CREATE INDEX funding_lots_billing_account ON funding_lots(billing_account_id,expires_at,id);

CREATE FUNCTION default_billing_account() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.billing_account_id IS NULL THEN SELECT id INTO NEW.billing_account_id FROM wallets WHERE tenant_id=NEW.tenant_id; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task_billing_account BEFORE INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION default_billing_account();
CREATE TRIGGER reservation_billing_account BEFORE INSERT ON reservations FOR EACH ROW EXECUTE FUNCTION default_billing_account();
CREATE TRIGGER funding_lot_billing_account BEFORE INSERT ON funding_lots FOR EACH ROW EXECUTE FUNCTION default_billing_account();
CREATE TRIGGER ledger_billing_account BEFORE INSERT ON ledger FOR EACH ROW EXECUTE FUNCTION default_billing_account();

CREATE OR REPLACE FUNCTION stamp_data_mode() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_TABLE_NAME='ledger' AND NEW.billing_account_id IS NOT NULL THEN
  SELECT data_mode INTO NEW.data_mode FROM wallets WHERE id=NEW.billing_account_id;
 ELSE SELECT data_mode INTO NEW.data_mode FROM tenants WHERE id=NEW.tenant_id;
 END IF;
 RETURN NEW;
END $$;
-- Trigger order is alphabetical: resolve the account before stamping its mode.
DROP TRIGGER ledger_billing_account ON ledger;
CREATE TRIGGER billing_ledger_account BEFORE INSERT ON ledger FOR EACH ROW EXECUTE FUNCTION default_billing_account();

CREATE FUNCTION validate_task_payer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account wallets;
BEGIN
 SELECT * INTO account FROM wallets WHERE id=NEW.billing_account_id;
 IF NOT FOUND OR (account.user_id IS NOT NULL AND account.user_id<>NEW.created_by) OR (account.tenant_id IS NOT NULL AND account.tenant_id<>NEW.tenant_id) OR account.data_mode<>NEW.data_mode THEN
  RAISE EXCEPTION 'Task payer does not match its subject or execution mode' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER z_task_payer_valid BEFORE INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION validate_task_payer();

CREATE FUNCTION validate_reservation_payer() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE account uuid; task_budget bigint;
BEGIN
 IF TG_TABLE_NAME='reservations' THEN
  SELECT billing_account_id,budget_micros INTO account,task_budget FROM tasks WHERE id=NEW.task_id AND tenant_id=NEW.tenant_id;
  IF NOT FOUND OR account<>NEW.billing_account_id OR NEW.amount_micros>task_budget THEN RAISE EXCEPTION 'Reservation does not match its task payer or budget' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT billing_account_id INTO account FROM reservations WHERE task_id=NEW.task_id AND tenant_id=NEW.tenant_id;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM funding_lots WHERE id=NEW.lot_id AND billing_account_id=account) THEN RAISE EXCEPTION 'Reservation funding belongs to another account' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reservation_payer_valid BEFORE INSERT OR UPDATE OF billing_account_id ON reservations FOR EACH ROW EXECUTE FUNCTION validate_reservation_payer();
CREATE TRIGGER allocation_payer_valid BEFORE INSERT ON reservation_allocations FOR EACH ROW EXECUTE FUNCTION validate_reservation_payer();

ALTER TABLE billing_settlement_sources ADD COLUMN billing_account_id uuid REFERENCES wallets(id);
-- Existing source and repayment records are append-only too. Their account
-- remains derivable from the original reservation/enterprise; do not UPDATE.
ALTER TABLE billing_settlement_sources DROP CONSTRAINT billing_settlement_sources_tenant_id_lot_id_fkey;
ALTER TABLE billing_settlement_sources ADD FOREIGN KEY(billing_account_id,lot_id) REFERENCES funding_lots(billing_account_id,id);
ALTER TABLE billing_credit_repayments ALTER COLUMN tenant_id DROP NOT NULL;
ALTER TABLE billing_credit_repayments ADD COLUMN billing_account_id uuid REFERENCES wallets(id);

CREATE FUNCTION default_billing_source_account() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.billing_account_id IS NULL THEN SELECT id INTO NEW.billing_account_id FROM wallets WHERE tenant_id=NEW.tenant_id; END IF;
 RETURN NEW;
END $$;

CREATE FUNCTION immutable_task_payer() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.billing_account_id IS DISTINCT FROM OLD.billing_account_id THEN RAISE EXCEPTION 'A task payer is immutable' USING ERRCODE='42501'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task_payer_immutable BEFORE UPDATE OF billing_account_id ON tasks FOR EACH ROW EXECUTE FUNCTION immutable_task_payer();
CREATE TRIGGER billing_source_account BEFORE INSERT ON billing_settlement_sources FOR EACH ROW EXECUTE FUNCTION default_billing_source_account();
CREATE TRIGGER billing_repayment_account BEFORE INSERT ON billing_credit_repayments FOR EACH ROW EXECUTE FUNCTION default_billing_source_account();

CREATE OR REPLACE FUNCTION validate_billing_source() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE entry ledger; lot funding_lots;
BEGIN
 IF TG_TABLE_NAME='billing_credit_repayments' THEN
  SELECT * INTO entry FROM ledger WHERE id=NEW.funding_entry_id AND coalesce(billing_account_id,(SELECT id FROM wallets WHERE tenant_id=ledger.tenant_id))=NEW.billing_account_id;
  IF NOT FOUND OR entry.kind NOT IN ('top_up','gift') OR NEW.amount_micros>entry.amount_micros THEN RAISE EXCEPTION 'Invalid credit repayment source' USING ERRCODE='23514'; END IF;
 ELSE
  SELECT * INTO entry FROM ledger WHERE tenant_id=NEW.tenant_id AND id=NEW.charge_id AND billing_account_id=NEW.billing_account_id;
  IF NOT FOUND OR entry.kind<>'charge' OR entry.task_id IS DISTINCT FROM NEW.task_id THEN RAISE EXCEPTION 'Invalid settlement charge' USING ERRCODE='23514'; END IF;
  IF NEW.lot_id IS NOT NULL THEN
   SELECT * INTO lot FROM funding_lots WHERE billing_account_id=NEW.billing_account_id AND id=NEW.lot_id;
   IF NOT FOUND OR NEW.kind<>lot.kind THEN RAISE EXCEPTION 'Invalid settlement funding bucket' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['funding_lots','ledger','billing_credit_repayments'] LOOP
  EXECUTE format('DROP POLICY tenant_isolation ON %I',t);
  EXECUTE format('CREATE POLICY billing_account_scope ON %I USING(current_user=''cp_control'' OR (billing_account_id IS NULL AND tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) OR EXISTS(SELECT 1 FROM wallets w WHERE w.id=billing_account_id)) WITH CHECK(current_user=''cp_control'' OR EXISTS(SELECT 1 FROM wallets w WHERE w.id=billing_account_id))',t);
 END LOOP;
END $$;
