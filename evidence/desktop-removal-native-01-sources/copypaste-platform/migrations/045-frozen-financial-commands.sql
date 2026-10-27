-- New canonical fee previews/commands keep the exact approved intent. Historical
-- generic operations are retained with their original behavior and provenance.
CREATE FUNCTION immutable_financial_command() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.payload->>'financial_command_version'='1' THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Financial command history is immutable' USING ERRCODE='42501'; END IF;
  IF ROW(NEW.id,NEW.principal_id,NEW.action,NEW.payload_hash,NEW.payload,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.principal_id,OLD.action,OLD.payload_hash,OLD.payload,OLD.created_at) THEN
   RAISE EXCEPTION 'Frozen financial intent is immutable' USING ERRCODE='42501';
  END IF;
  IF TG_TABLE_NAME='admin_operations' THEN
   IF ROW(NEW.tenant_id,NEW.idempotency_key,NEW.policy_version_id,NEW.target_ids) IS DISTINCT FROM ROW(OLD.tenant_id,OLD.idempotency_key,OLD.policy_version_id,OLD.target_ids) THEN
    RAISE EXCEPTION 'Financial authority and targets are immutable' USING ERRCODE='42501';
   END IF;
  ELSIF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
   RAISE EXCEPTION 'A financial preview cannot be extended' USING ERRCODE='42501';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER frozen_financial_operation BEFORE UPDATE OR DELETE ON admin_operations FOR EACH ROW EXECUTE FUNCTION immutable_financial_command();
CREATE TRIGGER frozen_financial_preview BEFORE UPDATE OR DELETE ON admin_previews FOR EACH ROW EXECUTE FUNCTION immutable_financial_command();
