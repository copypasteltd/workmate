-- Persist actual review requests and immutable decisions. An operation UUID is
-- not substituted for a request identity in the normative approval endpoint.
CREATE TABLE admin_fee_approval_requests (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 operation_id uuid NOT NULL UNIQUE REFERENCES admin_operations(id),
 requester_id uuid NOT NULL REFERENCES admin_principals(id),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 policy_version_id uuid NOT NULL REFERENCES admin_operation_policy_versions(id),
 expires_at timestamptz NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected','expired','revoked')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_fee_approval_queue ON admin_fee_approval_requests(state,created_at DESC,id DESC);
CREATE TABLE admin_fee_approval_decisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 approval_id uuid NOT NULL UNIQUE REFERENCES admin_fee_approval_requests(id),
 reviewer_id uuid NOT NULL REFERENCES admin_principals(id),
 expected_version integer NOT NULL CHECK(expected_version>0),
 payload_hash text NOT NULL CHECK(payload_hash ~ '^[a-f0-9]{64}$'),
 decision text NOT NULL CHECK(decision IN ('approve','reject')),
 reason text NOT NULL CHECK(length(reason) BETWEEN 3 AND 1000),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION protect_financial_approval() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o admin_operations; r admin_fee_approval_requests;
BEGIN
 IF TG_TABLE_NAME='admin_fee_approval_decisions' THEN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Financial review decisions are immutable' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM admin_fee_approval_requests WHERE id=NEW.approval_id;
  IF NOT FOUND OR r.state<>'pending' OR r.requester_id=NEW.reviewer_id OR r.version<>NEW.expected_version OR r.payload_hash<>NEW.payload_hash THEN
   RAISE EXCEPTION 'Financial review does not match its original request' USING ERRCODE='23514';
  END IF;
 ELSE
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Financial review requests are immutable' USING ERRCODE='42501'; END IF;
  IF TG_OP='INSERT' THEN
   SELECT * INTO o FROM admin_operations WHERE id=NEW.operation_id;
   IF NOT FOUND OR o.state<>'pending_approval' OR o.payload->>'financial_command_version' IS DISTINCT FROM '1' OR o.principal_id<>NEW.requester_id OR o.payload_hash<>NEW.payload_hash OR o.policy_version_id IS DISTINCT FROM NEW.policy_version_id OR (o.payload->>'expires_at')::timestamptz IS DISTINCT FROM NEW.expires_at OR NEW.state<>'pending' OR NEW.version<>1 THEN
    RAISE EXCEPTION 'Financial approval must retain its real pending operation' USING ERRCODE='23514';
   END IF;
  ELSE
   IF ROW(NEW.id,NEW.operation_id,NEW.requester_id,NEW.payload_hash,NEW.policy_version_id,NEW.expires_at,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.operation_id,OLD.requester_id,OLD.payload_hash,OLD.policy_version_id,OLD.expires_at,OLD.created_at) THEN
    RAISE EXCEPTION 'Frozen financial approval is immutable' USING ERRCODE='42501';
   END IF;
   IF OLD.state<>'pending' OR NEW.version<>OLD.version+1 OR NOT EXISTS(SELECT 1 FROM admin_fee_approval_decisions d WHERE d.approval_id=OLD.id AND d.expected_version=OLD.version AND d.payload_hash=OLD.payload_hash AND NEW.state=CASE d.decision WHEN 'approve' THEN 'approved' ELSE 'rejected' END) THEN
    RAISE EXCEPTION 'A financial approval transition requires its recorded decision' USING ERRCODE='23514';
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_fee_approval_request BEFORE INSERT OR UPDATE OR DELETE ON admin_fee_approval_requests FOR EACH ROW EXECUTE FUNCTION protect_financial_approval();
CREATE TRIGGER protect_fee_approval_decision BEFORE INSERT OR UPDATE OR DELETE ON admin_fee_approval_decisions FOR EACH ROW EXECUTE FUNCTION protect_financial_approval();
GRANT SELECT,INSERT,UPDATE ON admin_fee_approval_requests TO cp_control;
GRANT SELECT,INSERT ON admin_fee_approval_decisions TO cp_control;
