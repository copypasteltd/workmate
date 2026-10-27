-- Money cannot be reassigned by editing a subject, mode, reservation or lot.
CREATE FUNCTION immutable_billing_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='wallets' THEN
  IF ROW(NEW.id,NEW.tenant_id,NEW.user_id,NEW.data_mode) IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.user_id,OLD.data_mode) THEN
   RAISE EXCEPTION 'Billing account subject and mode are immutable' USING ERRCODE='42501';
  END IF;
 ELSIF TG_TABLE_NAME='tasks' THEN
  IF ROW(NEW.tenant_id,NEW.created_by,NEW.data_mode) IS DISTINCT FROM ROW(OLD.tenant_id,OLD.created_by,OLD.data_mode) THEN
   RAISE EXCEPTION 'Task billing subject and mode are immutable' USING ERRCODE='42501';
  END IF;
 ELSIF TG_TABLE_NAME='reservations' THEN
  IF ROW(NEW.task_id,NEW.tenant_id,NEW.billing_account_id,NEW.amount_micros) IS DISTINCT FROM ROW(OLD.task_id,OLD.tenant_id,OLD.billing_account_id,OLD.amount_micros) THEN
   RAISE EXCEPTION 'Reserved financial identity is immutable' USING ERRCODE='42501';
  END IF;
 ELSE
  IF ROW(NEW.id,NEW.tenant_id,NEW.billing_account_id,NEW.ledger_id,NEW.kind) IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.billing_account_id,OLD.ledger_id,OLD.kind) THEN
   RAISE EXCEPTION 'Funding source identity is immutable' USING ERRCODE='42501';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER billing_subject_immutable BEFORE UPDATE ON wallets FOR EACH ROW EXECUTE FUNCTION immutable_billing_identity();
CREATE TRIGGER task_billing_subject_immutable BEFORE UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION immutable_billing_identity();
CREATE TRIGGER reservation_identity_immutable BEFORE UPDATE ON reservations FOR EACH ROW EXECUTE FUNCTION immutable_billing_identity();
CREATE TRIGGER funding_identity_immutable BEFORE UPDATE ON funding_lots FOR EACH ROW EXECUTE FUNCTION immutable_billing_identity();
