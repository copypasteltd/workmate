-- A registration timestamp supports bounded cursor snapshots without pretending
-- that an old account's original creation time was previously recorded.
ALTER TABLE wallets ADD COLUMN registered_at timestamptz NOT NULL DEFAULT clock_timestamp();
CREATE TABLE billing_actors (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('user','admin','service')),
 user_id uuid UNIQUE REFERENCES users(id), admin_id uuid UNIQUE REFERENCES admin_principals(id), service_key text UNIQUE,
 CHECK((kind='user' AND id=user_id AND admin_id IS NULL AND service_key IS NULL) OR (kind='admin' AND id=admin_id AND user_id IS NULL AND service_key IS NULL) OR (kind='service' AND user_id IS NULL AND admin_id IS NULL AND service_key IS NOT NULL))
);
DO $$ BEGIN IF EXISTS(SELECT 1 FROM users u JOIN admin_principals a ON a.id=u.id) THEN RAISE EXCEPTION 'Financial actor identities collide'; END IF; END $$;
INSERT INTO billing_actors(id,kind,user_id) SELECT id,'user',id FROM users;
INSERT INTO billing_actors(id,kind,admin_id) SELECT id,'admin',id FROM admin_principals;
INSERT INTO billing_actors(id,kind,service_key) VALUES(gen_random_uuid(),'service','billing.expiry'),(gen_random_uuid(),'service','billing.internal');
CREATE FUNCTION register_billing_actor() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF TG_TABLE_NAME='users' THEN INSERT INTO billing_actors(id,kind,user_id) VALUES(NEW.id,'user',NEW.id);
 ELSE INSERT INTO billing_actors(id,kind,admin_id) VALUES(NEW.id,'admin',NEW.id); END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION register_billing_actor() OWNER TO cp_control;
REVOKE ALL ON FUNCTION register_billing_actor() FROM PUBLIC;
GRANT SELECT,INSERT ON billing_actors TO cp_control;
GRANT SELECT ON billing_actors TO cp_app;
CREATE TRIGGER user_billing_actor AFTER INSERT ON users FOR EACH ROW EXECUTE FUNCTION register_billing_actor();
CREATE TRIGGER admin_billing_actor AFTER INSERT ON admin_principals FOR EACH ROW EXECUTE FUNCTION register_billing_actor();

CREATE TABLE billing_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), billing_account_id uuid NOT NULL REFERENCES wallets(id), actor_id uuid NOT NULL REFERENCES billing_actors(id),
 action text NOT NULL, admin_operation_id uuid REFERENCES admin_operations(id),
 policy_version_id uuid REFERENCES admin_operation_policy_versions(id),
 source_ledger_id uuid REFERENCES ledger(id) DEFERRABLE INITIALLY DEFERRED,
 source_task_id uuid REFERENCES tasks(id),
 provenance text NOT NULL CHECK(provenance IN ('recorded_admin_operation','recorded_user_entry','recorded_system_entry','current_event')),
 created_at timestamptz NOT NULL DEFAULT now(), registered_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE billing_journal (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), billing_account_id uuid NOT NULL REFERENCES wallets(id),
 operation_id uuid NOT NULL REFERENCES billing_operations(id), actor_id uuid NOT NULL REFERENCES billing_actors(id),
 kind text NOT NULL CHECK(kind IN ('reserve','consume','release','top_up','gift','gift_expiry','debit','refund','compensation','credit_limit')),
 direction text NOT NULL CHECK(direction IN ('credit','debit','neutral')),
 bucket text NOT NULL CHECK(bucket IN ('paid','promotional','reserved','credit_limit')),
 amount_micros bigint NOT NULL CHECK(amount_micros>=0), reason text NOT NULL CHECK(length(reason)>0),
 source_entry_id uuid, payment_record_id uuid, raw_entry_id uuid UNIQUE REFERENCES ledger(id),
 task_id uuid REFERENCES tasks(id), created_at timestamptz NOT NULL DEFAULT now(), registered_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX billing_journal_account_page ON billing_journal(billing_account_id,created_at,id);
CREATE UNIQUE INDEX billing_task_hold_events ON billing_journal(billing_account_id,task_id,kind) WHERE kind IN ('reserve','release');
ALTER TABLE reservations ADD COLUMN journal_entry_id uuid REFERENCES billing_journal(id);
CREATE TABLE billing_provenance_gaps (
 ledger_id uuid PRIMARY KEY REFERENCES ledger(id), billing_account_id uuid NOT NULL REFERENCES wallets(id),
 reason text NOT NULL, registered_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE ledger ADD COLUMN actor_id uuid REFERENCES billing_actors(id);
ALTER TABLE ledger ADD COLUMN operation_id uuid REFERENCES billing_operations(id) DEFERRABLE INITIALLY DEFERRED;

-- Register genuine old event identifiers and recorded identities. Registration
-- is explicit; it neither fabricates old policy versions nor edits old ledger.
INSERT INTO billing_operations(id,billing_account_id,actor_id,action,admin_operation_id,policy_version_id,source_ledger_id,source_task_id,provenance,created_at)
SELECT DISTINCT ON(coalesce(o.id,l.id)) coalesce(o.id,l.id),w.id,coalesce(o.principal_id,l.user_id,s.id),'billing.'||l.kind,o.id,o.policy_version_id,
 CASE WHEN o.id IS NULL THEN l.id END,l.task_id,
 CASE WHEN o.id IS NOT NULL THEN 'recorded_admin_operation' WHEN l.user_id IS NOT NULL THEN 'recorded_user_entry' ELSE 'recorded_system_entry' END,l.created_at
FROM ledger l JOIN wallets w ON w.tenant_id=l.tenant_id
LEFT JOIN admin_operations o ON l.idempotency_key='admin:'||o.id::text
LEFT JOIN billing_actors s ON s.service_key='billing.expiry' AND l.kind='gift_expiry'
WHERE coalesce(o.principal_id,l.user_id,s.id) IS NOT NULL
ORDER BY coalesce(o.id,l.id),l.created_at,l.id;
INSERT INTO billing_journal(id,billing_account_id,operation_id,actor_id,kind,direction,bucket,amount_micros,reason,source_entry_id,raw_entry_id,task_id,created_at)
SELECT l.id,w.id,coalesce(o.id,l.id),b.actor_id,
 CASE l.kind WHEN 'charge' THEN 'consume' WHEN 'adjustment' THEN 'compensation' ELSE l.kind END,
 CASE WHEN l.amount_micros>0 THEN 'credit' ELSE 'debit' END,
 CASE WHEN l.kind='charge' THEN 'reserved' WHEN l.kind IN ('gift','gift_expiry') OR source.kind='gift' THEN 'promotional' ELSE 'paid' END,
 abs(l.amount_micros),l.reason,l.source_id,l.id,l.task_id,l.created_at
FROM ledger l JOIN wallets w ON w.tenant_id=l.tenant_id
LEFT JOIN admin_operations o ON l.idempotency_key='admin:'||o.id::text
JOIN billing_operations b ON b.id=coalesce(o.id,l.id)
LEFT JOIN ledger source ON source.id=l.source_id
WHERE l.kind<>'adjustment' AND (l.kind<>'charge' OR EXISTS(SELECT 1 FROM reservations r WHERE r.task_id=l.task_id));
INSERT INTO billing_provenance_gaps(ledger_id,billing_account_id,reason)
SELECT l.id,w.id,'Historical actor, funding bucket or reservation provenance was not recorded'
FROM ledger l JOIN wallets w ON w.tenant_id=l.tenant_id WHERE NOT EXISTS(SELECT 1 FROM billing_journal j WHERE j.raw_entry_id=l.id);

CREATE FUNCTION register_ledger_operation() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE adminop admin_operations; principal uuid; eventid uuid;
BEGIN
 IF NEW.operation_id IS NOT NULL THEN
  SELECT actor_id INTO principal FROM billing_operations WHERE id=NEW.operation_id AND billing_account_id=NEW.billing_account_id;
  IF NOT FOUND OR (NEW.actor_id IS NOT NULL AND NEW.actor_id<>principal) THEN RAISE EXCEPTION 'Ledger operation identity mismatch' USING ERRCODE='23514'; END IF;
  NEW.actor_id=principal; RETURN NEW;
 END IF;
 SELECT * INTO adminop FROM admin_operations WHERE 'admin:'||id::text=NEW.idempotency_key;
 IF adminop.id IS NOT NULL THEN principal=adminop.principal_id;eventid=adminop.id;
 ELSIF NEW.user_id IS NOT NULL THEN principal=NEW.user_id;
 ELSIF NEW.kind='gift_expiry' THEN SELECT id INTO principal FROM billing_actors WHERE service_key='billing.expiry';
 ELSE SELECT id INTO principal FROM billing_actors WHERE service_key='billing.internal'; END IF;
 eventid=coalesce(eventid,gen_random_uuid());
 INSERT INTO billing_operations(id,billing_account_id,actor_id,action,admin_operation_id,policy_version_id,source_ledger_id,source_task_id,provenance)
 VALUES(eventid,NEW.billing_account_id,principal,'billing.'||NEW.kind,adminop.id,adminop.policy_version_id,CASE WHEN adminop.id IS NULL THEN NEW.id END,NEW.task_id,'current_event') ON CONFLICT(id) DO NOTHING;
 IF NOT EXISTS(SELECT 1 FROM billing_operations WHERE id=eventid AND actor_id=principal AND billing_account_id=NEW.billing_account_id) THEN RAISE EXCEPTION 'Billing operation target mismatch' USING ERRCODE='23514'; END IF;
 NEW.actor_id=principal;NEW.operation_id=eventid; RETURN NEW;
END $$;
ALTER FUNCTION register_ledger_operation() OWNER TO cp_control;
REVOKE ALL ON FUNCTION register_ledger_operation() FROM PUBLIC;
CREATE TRIGGER billing_ledger_operation BEFORE INSERT ON ledger FOR EACH ROW EXECUTE FUNCTION register_ledger_operation();
CREATE FUNCTION journal_ledger_entry() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE sourcekind text;
BEGIN
 SELECT kind INTO sourcekind FROM ledger WHERE id=NEW.source_id;
 IF NEW.kind='adjustment' THEN RAISE EXCEPTION 'Adjustments require a registered compensation controller' USING ERRCODE='23514'; END IF;
 INSERT INTO billing_journal(id,billing_account_id,operation_id,actor_id,kind,direction,bucket,amount_micros,reason,source_entry_id,raw_entry_id,task_id,created_at)
 VALUES(NEW.id,NEW.billing_account_id,NEW.operation_id,NEW.actor_id,CASE WHEN NEW.kind='charge' THEN 'consume' ELSE NEW.kind END,
 CASE WHEN NEW.amount_micros>0 THEN 'credit' ELSE 'debit' END,
 CASE WHEN NEW.kind='charge' THEN 'reserved' WHEN NEW.kind IN ('gift','gift_expiry') OR sourcekind='gift' THEN 'promotional' ELSE 'paid' END,
 abs(NEW.amount_micros),NEW.reason,CASE WHEN NEW.kind='charge' THEN (SELECT journal_entry_id FROM reservations WHERE task_id=NEW.task_id) ELSE NEW.source_id END,NEW.id,NEW.task_id,NEW.created_at);
 RETURN NULL;
END $$;
ALTER FUNCTION journal_ledger_entry() OWNER TO cp_control;
REVOKE ALL ON FUNCTION journal_ledger_entry() FROM PUBLIC;
CREATE TRIGGER billing_ledger_journal AFTER INSERT ON ledger FOR EACH ROW EXECUTE FUNCTION journal_ledger_entry();

-- A journal may never borrow another subject's event, actor, task or source.
-- Existing imports above retain only recorded facts; this guard applies to all
-- new rows, including direct SQL writes by the application role.
CREATE FUNCTION validate_billing_journal() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM billing_operations o WHERE o.id=NEW.operation_id AND o.billing_account_id=NEW.billing_account_id AND o.actor_id=NEW.actor_id) THEN
  RAISE EXCEPTION 'Journal operation identity mismatch' USING ERRCODE='23514';
 END IF;
 IF NEW.task_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.id=NEW.task_id AND t.billing_account_id=NEW.billing_account_id) THEN
  RAISE EXCEPTION 'Journal task payer mismatch' USING ERRCODE='23514';
 END IF;
 IF NEW.source_entry_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM billing_journal j WHERE j.id=NEW.source_entry_id AND j.billing_account_id=NEW.billing_account_id) THEN
  RAISE EXCEPTION 'Journal source account mismatch or unrecorded source' USING ERRCODE='23514';
 END IF;
 IF NEW.raw_entry_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ledger l WHERE l.id=NEW.raw_entry_id AND l.billing_account_id=NEW.billing_account_id AND l.operation_id=NEW.operation_id AND l.actor_id=NEW.actor_id AND abs(l.amount_micros)=NEW.amount_micros) THEN
  RAISE EXCEPTION 'Journal raw entry mismatch' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION validate_billing_journal() OWNER TO cp_control;
REVOKE ALL ON FUNCTION validate_billing_journal() FROM PUBLIC;
CREATE TRIGGER billing_journal_valid BEFORE INSERT ON billing_journal FOR EACH ROW EXECUTE FUNCTION validate_billing_journal();

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['billing_actors','billing_operations','billing_journal','billing_provenance_gaps'] LOOP
  EXECUTE format('CREATE TRIGGER billing_history_immutable BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION immutable_billing_source()',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['billing_operations','billing_journal','billing_provenance_gaps'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY billing_account_scope ON %I USING(current_user=''cp_control'' OR EXISTS(SELECT 1 FROM wallets w WHERE w.id=billing_account_id)) WITH CHECK(current_user=''cp_control'' OR EXISTS(SELECT 1 FROM wallets w WHERE w.id=billing_account_id))',t);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO cp_app,cp_control',t);
 END LOOP;
END $$;
