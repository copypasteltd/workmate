-- Preserve the exact financial request/decision identities and history while
-- making independent review a shared control-plane resource.
ALTER TABLE admin_fee_approval_requests RENAME TO admin_approval_requests;
ALTER TABLE admin_fee_approval_decisions RENAME TO admin_approval_decisions;
DROP TRIGGER protect_fee_approval_request ON admin_approval_requests;
DROP TRIGGER protect_fee_approval_decision ON admin_approval_decisions;

-- Only already-frozen member/account commands can be registered on upgrade.
-- The request is registered now; its original approval deadline is not extended.
INSERT INTO admin_approval_requests(operation_id,requester_id,payload_hash,policy_version_id,expires_at)
SELECT o.id,o.principal_id,o.payload_hash,o.policy_version_id,(o.payload->>'expires_at')::timestamptz
FROM admin_operations o
WHERE o.state='pending_approval' AND o.policy_version_id IS NOT NULL
 AND o.action IN ('tenants.members.write','users.profile.write','users.status.write','users.sessions.revoke','tenants.status.write')
 AND o.payload->>'actor_session_id' ~ '^[a-f0-9-]{36}$'
 AND jsonb_typeof(o.payload->'actor_auth_version')='number'
 AND o.payload->>'expires_at' IS NOT NULL
 AND NOT EXISTS(SELECT 1 FROM admin_approval_requests a WHERE a.operation_id=o.id);

-- Unknown old policy/session facts must never be invented to approve an old
-- command. Keep a distinct migration record and require a fresh preview.
CREATE TABLE admin_approval_migration_records (
 operation_id uuid PRIMARY KEY REFERENCES admin_operations(id),
 original_state text NOT NULL,
 original_payload_hash text NOT NULL,
 reason_code text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO admin_approval_migration_records(operation_id,original_state,original_payload_hash,reason_code)
SELECT o.id,o.state,o.payload_hash,'APPROVAL_SNAPSHOT_UNRECORDED'
FROM admin_operations o WHERE o.state='pending_approval'
 AND NOT EXISTS(SELECT 1 FROM admin_approval_requests a WHERE a.operation_id=o.id);
UPDATE admin_operations o SET state='cancelled',version=version+1,
 result=coalesce(result,'{}'::jsonb)||'{"error_code":"APPROVAL_SNAPSHOT_UNRECORDED"}'::jsonb
WHERE EXISTS(SELECT 1 FROM admin_approval_migration_records m WHERE m.operation_id=o.id);

CREATE OR REPLACE FUNCTION protect_financial_approval() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o admin_operations; r admin_approval_requests;
BEGIN
 IF TG_TABLE_NAME='admin_approval_decisions' THEN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Review decisions are immutable' USING ERRCODE='42501'; END IF;
  SELECT * INTO r FROM admin_approval_requests WHERE id=NEW.approval_id;
  IF NOT FOUND OR r.state<>'pending' OR r.requester_id=NEW.reviewer_id OR r.version<>NEW.expected_version OR r.payload_hash<>NEW.payload_hash THEN
   RAISE EXCEPTION 'Review does not match its original request' USING ERRCODE='23514';
  END IF;
 ELSE
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Review requests are immutable' USING ERRCODE='42501'; END IF;
  IF TG_OP='INSERT' THEN
   SELECT * INTO o FROM admin_operations WHERE id=NEW.operation_id;
   IF NOT FOUND OR o.state<>'pending_approval' OR o.principal_id<>NEW.requester_id OR o.payload_hash<>NEW.payload_hash OR o.policy_version_id IS DISTINCT FROM NEW.policy_version_id OR (o.payload->>'expires_at')::timestamptz IS DISTINCT FROM NEW.expires_at OR NEW.state<>'pending' OR NEW.version<>1 OR o.payload->>'actor_session_id' IS NULL OR o.payload->>'actor_auth_version' IS NULL THEN
    RAISE EXCEPTION 'Approval must retain its frozen pending operation' USING ERRCODE='23514';
   END IF;
  ELSE
   IF ROW(NEW.id,NEW.operation_id,NEW.requester_id,NEW.payload_hash,NEW.policy_version_id,NEW.expires_at,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.operation_id,OLD.requester_id,OLD.payload_hash,OLD.policy_version_id,OLD.expires_at,OLD.created_at) THEN
    RAISE EXCEPTION 'Frozen approval is immutable' USING ERRCODE='42501';
   END IF;
   IF OLD.state<>'pending' OR NEW.version<>OLD.version+1 OR NOT (
    (NEW.state IN ('approved','rejected') AND EXISTS(SELECT 1 FROM admin_approval_decisions d WHERE d.approval_id=OLD.id AND d.expected_version=OLD.version AND d.payload_hash=OLD.payload_hash AND NEW.state=CASE d.decision WHEN 'approve' THEN 'approved' ELSE 'rejected' END))
    OR (NEW.state='expired' AND OLD.expires_at<=now() AND EXISTS(SELECT 1 FROM admin_operations expired_operation WHERE expired_operation.id=OLD.operation_id AND expired_operation.state='cancelled' AND expired_operation.result->>'error_code'='OPERATION_EXPIRED'))
   ) THEN
    RAISE EXCEPTION 'An approval transition requires its recorded decision or actual expiry' USING ERRCODE='23514';
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_approval_request BEFORE INSERT OR UPDATE OR DELETE ON admin_approval_requests FOR EACH ROW EXECUTE FUNCTION protect_financial_approval();
CREATE TRIGGER protect_approval_decision BEFORE INSERT OR UPDATE OR DELETE ON admin_approval_decisions FOR EACH ROW EXECUTE FUNCTION protect_financial_approval();
GRANT SELECT ON admin_approval_migration_records TO cp_control;
