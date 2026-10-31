-- Explicit two-party responsibility handover. Existing private authorship,
-- billing ownership, task settlement and independent admin approval stay separate.
CREATE TABLE ownership_transfers (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 from_user_id uuid NOT NULL REFERENCES users(id), to_user_id uuid NOT NULL REFERENCES users(id),
 from_version integer NOT NULL CHECK(from_version>0), to_version integer NOT NULL CHECK(to_version>0),
 from_auth_version integer NOT NULL CHECK(from_auth_version>0), to_auth_version integer NOT NULL CHECK(to_auth_version>0),
 state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','accepted','declined','cancelled','expired','invalidated')),
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '24 hours',
 resolved_at timestamptz, resolved_by uuid, resolved_audience text CHECK(resolved_audience IN('user','native','admin')),
 reason_code text CHECK(reason_code IN('accepted','recipient_declined','owner_cancelled','operator_cancelled','authorization_changed','expired','workspace_removed')),
 CHECK(from_user_id<>to_user_id),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '25 hours'),
 CHECK((state='pending' AND resolved_at IS NULL AND reason_code IS NULL) OR (state<>'pending' AND resolved_at IS NOT NULL AND reason_code IS NOT NULL))
);
CREATE UNIQUE INDEX one_pending_ownership_transfer ON ownership_transfers(tenant_id) WHERE state='pending';
CREATE INDEX ownership_transfer_history ON ownership_transfers(tenant_id,created_at DESC,id DESC);
CREATE INDEX ownership_transfer_inbox ON ownership_transfers(to_user_id,expires_at) WHERE state='pending';
ALTER TABLE ownership_transfers ENABLE ROW LEVEL SECURITY;
ALTER TABLE ownership_transfers FORCE ROW LEVEL SECURITY;
CREATE POLICY control_only ON ownership_transfers TO cp_control USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON ownership_transfers TO cp_control;
CREATE FUNCTION guard_ownership_transfer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'pending' OR NEW.revision<>1 OR NOT EXISTS(
   SELECT 1 FROM tenants t JOIN memberships f ON f.tenant_id=t.id JOIN users fu ON fu.id=f.user_id
    JOIN memberships r ON r.tenant_id=t.id JOIN users ru ON ru.id=r.user_id
   WHERE t.id=NEW.tenant_id AND t.status='active' AND t.erasure_requested_at IS NULL
    AND f.user_id=NEW.from_user_id AND f.role='owner' AND f.status='active' AND NOT f.admin_suspended AND fu.status='active' AND f.version=NEW.from_version AND fu.auth_version=NEW.from_auth_version
    AND r.user_id=NEW.to_user_id AND r.role<>'owner' AND r.status='active' AND NOT r.admin_suspended AND ru.status='active' AND r.version=NEW.to_version AND ru.auth_version=NEW.to_auth_version
  ) THEN RAISE EXCEPTION 'Ownership handover requires a current owner and an active recipient' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Ownership history cannot be deleted' USING ERRCODE='23514'; END IF;
 IF OLD.state<>'pending' OR NEW.state='pending' OR NEW.revision<>OLD.revision+1
  OR (to_jsonb(NEW)-ARRAY['state','revision','resolved_at','resolved_by','resolved_audience','reason_code']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['state','revision','resolved_at','resolved_by','resolved_audience','reason_code']) THEN
  RAISE EXCEPTION 'Ownership handover identity and terminal history are immutable' USING ERRCODE='23514';
 END IF;
 IF NEW.state='accepted' AND NOT EXISTS(
  SELECT 1 FROM memberships f JOIN memberships r ON r.tenant_id=f.tenant_id
  WHERE f.tenant_id=OLD.tenant_id AND f.user_id=OLD.from_user_id AND f.role='admin' AND f.status='active' AND NOT f.admin_suspended AND f.version=OLD.from_version+1
   AND r.user_id=OLD.to_user_id AND r.role='owner' AND r.status='active' AND NOT r.admin_suspended AND r.version=OLD.to_version+1
 ) THEN RAISE EXCEPTION 'Ownership handover must change both memberships atomically' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER ownership_transfer_guard BEFORE INSERT OR UPDATE OR DELETE ON ownership_transfers FOR EACH ROW EXECUTE FUNCTION guard_ownership_transfer();
