-- Forward only: financial facts already recorded before this migration are not
-- replayed or rewritten. Every new fact records its delivery intent atomically.
CREATE TABLE financial_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), billing_account_id uuid NOT NULL REFERENCES wallets(id),
 kind text NOT NULL CHECK(kind IN ('journal','payment_recorded','payment_confirmed','refund_requested','refund_outcome')),
 journal_id uuid UNIQUE REFERENCES billing_journal(id), payment_id uuid REFERENCES payment_records(id),
 refund_id uuid REFERENCES billing_refunds(id), refund_event_id uuid UNIQUE REFERENCES billing_refund_events(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), dispatched_at timestamptz,
 UNIQUE(kind,payment_id), UNIQUE(kind,refund_id),
 CHECK((kind='journal' AND journal_id IS NOT NULL AND num_nonnulls(payment_id,refund_id,refund_event_id)=0)
    OR (kind IN ('payment_recorded','payment_confirmed') AND payment_id IS NOT NULL AND num_nonnulls(journal_id,refund_id,refund_event_id)=0)
    OR (kind='refund_requested' AND refund_id IS NOT NULL AND num_nonnulls(journal_id,payment_id,refund_event_id)=0)
    OR (kind='refund_outcome' AND refund_event_id IS NOT NULL AND num_nonnulls(journal_id,payment_id,refund_id)=0)),
 CHECK(dispatched_at IS NULL OR dispatched_at>=created_at)
);
CREATE INDEX financial_outbox_due ON financial_outbox(created_at,id) WHERE dispatched_at IS NULL;
CREATE TABLE financial_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), outbox_id uuid NOT NULL REFERENCES financial_outbox(id),
 recipient_id uuid NOT NULL REFERENCES users(id), read boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(outbox_id,recipient_id)
);
CREATE INDEX financial_notification_inbox ON financial_notifications(recipient_id,created_at DESC,id DESC);

CREATE FUNCTION financial_recipient_allowed(account uuid,recipient uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT EXISTS(SELECT 1 FROM wallets w JOIN users u ON u.id=recipient
 WHERE w.id=account AND u.status='active' AND u.admin_closed_at IS NULL
 AND (w.user_id=u.id OR EXISTS(SELECT 1 FROM memberships m JOIN tenants t ON t.id=m.tenant_id
   WHERE m.tenant_id=w.tenant_id AND m.user_id=u.id AND m.status='active' AND NOT m.admin_suspended
   AND m.role IN ('owner','admin') AND t.status='active' AND t.admin_closed_at IS NULL)))
$$;
ALTER FUNCTION financial_recipient_allowed(uuid,uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION financial_recipient_allowed(uuid,uuid) FROM PUBLIC;

CREATE FUNCTION guard_financial_delivery() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE account uuid;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Financial delivery history cannot be removed' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='financial_outbox' THEN
  IF TG_OP='UPDATE' THEN
   IF ROW(NEW.id,NEW.billing_account_id,NEW.kind,NEW.journal_id,NEW.payment_id,NEW.refund_id,NEW.refund_event_id,NEW.created_at)
      IS DISTINCT FROM ROW(OLD.id,OLD.billing_account_id,OLD.kind,OLD.journal_id,OLD.payment_id,OLD.refund_id,OLD.refund_event_id,OLD.created_at)
      OR (OLD.dispatched_at IS NOT NULL AND NEW.dispatched_at IS DISTINCT FROM OLD.dispatched_at)
      OR (NEW.dispatched_at IS NOT NULL AND NEW.dispatched_at>clock_timestamp()) THEN
    RAISE EXCEPTION 'Financial delivery intent and completed delivery are immutable' USING ERRCODE='23514';
   END IF;
   RETURN NEW;
  END IF;
  CASE NEW.kind
   WHEN 'journal' THEN SELECT billing_account_id INTO account FROM billing_journal WHERE id=NEW.journal_id;
   WHEN 'payment_recorded' THEN SELECT billing_account_id INTO account FROM payment_records WHERE id=NEW.payment_id;
   WHEN 'payment_confirmed' THEN SELECT p.billing_account_id INTO account FROM payment_confirmations c JOIN payment_records p ON p.id=c.payment_record_id WHERE p.id=NEW.payment_id;
   WHEN 'refund_requested' THEN SELECT billing_account_id INTO account FROM billing_refunds WHERE id=NEW.refund_id;
   WHEN 'refund_outcome' THEN SELECT billing_account_id INTO account FROM billing_refund_events WHERE id=NEW.refund_event_id;
   ELSE account=NULL;
  END CASE;
  IF account IS NULL OR account IS DISTINCT FROM NEW.billing_account_id OR NEW.dispatched_at IS NOT NULL THEN
   RAISE EXCEPTION 'Financial delivery must retain its real unconsumed source' USING ERRCODE='23514';
  END IF;
 ELSE
  IF TG_OP='UPDATE' THEN
   IF ROW(NEW.id,NEW.outbox_id,NEW.recipient_id,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.outbox_id,OLD.recipient_id,OLD.created_at) THEN
    RAISE EXCEPTION 'Financial notification identity and delivery time are immutable' USING ERRCODE='23514';
   END IF;
   RETURN NEW;
  END IF;
  SELECT billing_account_id INTO account FROM financial_outbox WHERE id=NEW.outbox_id;
  IF account IS NULL OR NOT financial_recipient_allowed(account,NEW.recipient_id) THEN
   RAISE EXCEPTION 'Financial notification requires an authorized account recipient' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_financial_delivery() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_financial_delivery() FROM PUBLIC;
CREATE TRIGGER financial_outbox_guard BEFORE INSERT OR UPDATE OR DELETE ON financial_outbox FOR EACH ROW EXECUTE FUNCTION guard_financial_delivery();
CREATE TRIGGER financial_notification_guard BEFORE INSERT OR UPDATE OR DELETE ON financial_notifications FOR EACH ROW EXECUTE FUNCTION guard_financial_delivery();

CREATE FUNCTION capture_financial_delivery() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 CASE TG_TABLE_NAME
 WHEN 'billing_journal' THEN
  INSERT INTO financial_outbox(billing_account_id,kind,journal_id) VALUES(NEW.billing_account_id,'journal',NEW.id);
 WHEN 'payment_records' THEN
  INSERT INTO financial_outbox(billing_account_id,kind,payment_id) VALUES(NEW.billing_account_id,'payment_recorded',NEW.id);
 WHEN 'payment_confirmations' THEN
  INSERT INTO financial_outbox(billing_account_id,kind,payment_id)
   SELECT billing_account_id,'payment_confirmed',id FROM payment_records WHERE id=NEW.payment_record_id;
 WHEN 'billing_refunds' THEN
  INSERT INTO financial_outbox(billing_account_id,kind,refund_id) VALUES(NEW.billing_account_id,'refund_requested',NEW.id);
 WHEN 'billing_refund_events' THEN
  INSERT INTO financial_outbox(billing_account_id,kind,refund_event_id) VALUES(NEW.billing_account_id,'refund_outcome',NEW.id);
 END CASE;
 RETURN NULL;
END $$;
ALTER FUNCTION capture_financial_delivery() OWNER TO cp_control;
REVOKE ALL ON FUNCTION capture_financial_delivery() FROM PUBLIC;
DO $$ DECLARE name text; BEGIN
 FOREACH name IN ARRAY ARRAY['billing_journal','payment_records','payment_confirmations','billing_refunds','billing_refund_events'] LOOP
  EXECUTE format('CREATE TRIGGER financial_delivery_capture AFTER INSERT ON %I FOR EACH ROW EXECUTE FUNCTION capture_financial_delivery()',name);
 END LOOP;
 FOREACH name IN ARRAY ARRAY['financial_outbox','financial_notifications'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',name);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',name);
  EXECUTE format('CREATE POLICY financial_delivery_control ON %I TO cp_control USING(true) WITH CHECK(true)',name);
 END LOOP;
END $$;
-- Public APIs use current-authority control transactions with an explicit
-- recipient/account/mode filter. cp_app cannot query or modify either table.
GRANT SELECT,INSERT ON financial_outbox,financial_notifications TO cp_control;
GRANT UPDATE(dispatched_at) ON financial_outbox TO cp_control;
GRANT UPDATE(read) ON financial_notifications TO cp_control;
