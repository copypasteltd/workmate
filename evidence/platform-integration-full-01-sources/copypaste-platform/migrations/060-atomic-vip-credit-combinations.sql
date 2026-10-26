-- Additive: retain all canonical VIP, financial and historical migration bytes.
CREATE TABLE admin_vip_credit_combinations (
 parent_operation_id uuid PRIMARY KEY REFERENCES admin_operations(id),
 vip_operation_id uuid NOT NULL UNIQUE REFERENCES admin_operations(id),
 gift_operation_id uuid NOT NULL UNIQUE REFERENCES admin_operations(id),
 grant_id uuid NOT NULL REFERENCES vip_grants(id),
 credit_journal_id uuid NOT NULL UNIQUE REFERENCES billing_journal(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(parent_operation_id<>vip_operation_id AND parent_operation_id<>gift_operation_id AND vip_operation_id<>gift_operation_id)
);
CREATE TRIGGER vip_credit_link_immutable BEFORE UPDATE OR DELETE ON admin_vip_credit_combinations
 FOR EACH ROW EXECUTE FUNCTION immutable_billing_source();
ALTER TABLE admin_vip_credit_combinations ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_vip_credit_combinations FORCE ROW LEVEL SECURITY;
CREATE POLICY vip_credit_control ON admin_vip_credit_combinations TO cp_control USING(true) WITH CHECK(true);
GRANT SELECT,INSERT ON admin_vip_credit_combinations TO cp_control;

CREATE FUNCTION protect_vip_credit_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP<>'INSERT' AND (OLD.payload->>'vip_credit_command_version'='1' OR OLD.payload ? 'combination_parent_id') THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Combined intent and children are retained' USING ERRCODE='42501'; END IF;
  IF TG_TABLE_NAME='admin_previews' THEN
   IF (to_jsonb(NEW)-'consumed_at') IS DISTINCT FROM (to_jsonb(OLD)-'consumed_at')
    OR (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at) THEN
    RAISE EXCEPTION 'Combined preview identity and expiry are immutable' USING ERRCODE='42501';
   END IF;
  ELSE
   IF (to_jsonb(NEW)-ARRAY['state','version','result','result_ids','approved_by']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['state','version','result','result_ids','approved_by'])
    OR (OLD.state IN ('succeeded','cancelled') AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD)) THEN
    RAISE EXCEPTION 'Combined origin and completed result are immutable' USING ERRCODE='42501';
   END IF;
  END IF;
 END IF;
 IF TG_OP<>'DELETE' THEN
  IF (NEW.action='entitlements.grant_with_credit') IS DISTINCT FROM (coalesce(NEW.payload->>'vip_credit_command_version','')='1') THEN
   RAISE EXCEPTION 'Combined actions require their registered controller marker' USING ERRCODE='23514';
  END IF;
  IF NEW.payload ? 'combination_parent_id' AND
   NOT ((NEW.action='entitlements.grant' AND NEW.payload->>'vip_command_version'='1') OR
        (NEW.action='billing.gift' AND NEW.payload->>'financial_command_version'='1')) THEN
   RAISE EXCEPTION 'Only canonical VIP and gift children can belong to a combination' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 RETURN OLD;
END $$;
CREATE TRIGGER vip_credit_operation_intent BEFORE INSERT OR UPDATE OR DELETE ON admin_operations
 FOR EACH ROW EXECUTE FUNCTION protect_vip_credit_intent();
CREATE TRIGGER vip_credit_preview_intent BEFORE INSERT OR UPDATE OR DELETE ON admin_previews
 FOR EACH ROW EXECUTE FUNCTION protect_vip_credit_intent();

CREATE FUNCTION assert_vip_credit_commit(parent_id uuid) RETURNS void LANGUAGE plpgsql AS $$
DECLARE p admin_operations; v admin_operations; f admin_operations;
 l admin_vip_credit_combinations; w wallets; j billing_journal; s entitlement_subjects;
BEGIN
 SELECT * INTO p FROM admin_operations WHERE id=parent_id;
 IF p.id IS NULL OR p.action<>'entitlements.grant_with_credit' OR p.payload->>'vip_credit_command_version' IS DISTINCT FROM '1' THEN
  RAISE EXCEPTION 'A combined child must retain its actual registered parent' USING ERRCODE='23514';
 END IF;
 SELECT * INTO l FROM admin_vip_credit_combinations WHERE parent_operation_id=p.id;
 IF p.state IN ('pending_approval','cancelled') THEN
  IF l.parent_operation_id IS NOT NULL OR EXISTS(SELECT 1 FROM admin_operations WHERE payload->>'combination_parent_id'=p.id::text) THEN
   RAISE EXCEPTION 'Unapproved and cancelled combinations have no children or business effects' USING ERRCODE='23514';
  END IF;
  RETURN;
 END IF;
 IF p.state<>'succeeded' OR l.parent_operation_id IS NULL THEN
  RAISE EXCEPTION 'A combination commits both effects and its link or commits neither' USING ERRCODE='23514';
 END IF;
 SELECT * INTO v FROM admin_operations WHERE id=l.vip_operation_id;
 SELECT * INTO f FROM admin_operations WHERE id=l.gift_operation_id;
 SELECT * INTO w FROM wallets WHERE id=(p.payload->>'billing_account_id')::uuid;
 SELECT * INTO j FROM billing_journal WHERE id=l.credit_journal_id;
 SELECT es.* INTO s FROM vip_grants g JOIN entitlement_subjects es ON es.id=g.subject_id WHERE g.id=l.grant_id;
 IF v.id IS NULL OR f.id IS NULL OR w.id IS NULL OR j.id IS NULL OR s.id IS NULL
  OR v.action<>'entitlements.grant' OR v.payload->>'vip_command_version' IS DISTINCT FROM '1'
  OR f.action<>'billing.gift' OR f.payload->>'financial_command_version' IS DISTINCT FROM '1'
  OR v.state<>'succeeded' OR f.state<>'succeeded'
  OR v.principal_id IS DISTINCT FROM p.principal_id OR f.principal_id IS DISTINCT FROM p.principal_id
  OR v.approved_by IS DISTINCT FROM p.approved_by OR f.approved_by IS DISTINCT FROM p.approved_by
  OR v.tenant_id IS DISTINCT FROM p.tenant_id OR f.tenant_id IS DISTINCT FROM p.tenant_id
  OR v.payload->>'combination_parent_id' IS DISTINCT FROM p.id::text OR f.payload->>'combination_parent_id' IS DISTINCT FROM p.id::text
  OR v.payload->'command' IS DISTINCT FROM p.payload#>'{command,vip}'
  OR f.payload->'command' IS DISTINCT FROM p.payload#>'{command,gift}'
  OR v.payload->'before' IS DISTINCT FROM p.payload#>'{before,vip}' OR f.payload->'before' IS DISTINCT FROM p.payload#>'{before,gift}'
  OR v.payload->>'actor_session_id' IS DISTINCT FROM p.payload->>'actor_session_id'
  OR f.payload->>'actor_session_id' IS DISTINCT FROM p.payload->>'actor_session_id'
  OR v.payload->>'actor_auth_version' IS DISTINCT FROM p.payload->>'actor_auth_version'
  OR f.payload->>'actor_auth_version' IS DISTINCT FROM p.payload->>'actor_auth_version'
  OR v.policy_version_id::text IS DISTINCT FROM p.payload->>'vip_policy_version_id'
  OR f.policy_version_id::text IS DISTINCT FROM p.payload->>'gift_policy_version_id'
  OR w.id::text IS DISTINCT FROM p.payload#>>'{command,billing_account_id}'
  OR w.data_mode IS DISTINCT FROM p.payload->>'data_mode' OR s.data_mode IS DISTINCT FROM w.data_mode
  OR v.payload->>'data_mode' IS DISTINCT FROM w.data_mode
  OR ROW(w.tenant_id,w.user_id) IS DISTINCT FROM ROW(s.tenant_id,s.user_id)
  OR w.tenant_id IS DISTINCT FROM p.tenant_id
  OR coalesce(s.tenant_id,s.user_id)::text IS DISTINCT FROM p.payload->>'subject_id'
  OR (CASE WHEN s.tenant_id IS NULL THEN 'user' ELSE 'tenant' END) IS DISTINCT FROM p.payload->>'subject_kind'
  OR j.operation_id IS DISTINCT FROM f.id OR j.billing_account_id IS DISTINCT FROM w.id OR j.actor_id IS DISTINCT FROM p.principal_id
  OR j.kind<>'gift' OR j.direction<>'credit' OR j.bucket<>'promotional'
  OR j.amount_micros::text IS DISTINCT FROM p.payload#>>'{command,gift,amount,amount_micros}'
  OR NOT EXISTS(SELECT 1 FROM ledger e JOIN funding_lots lot ON lot.ledger_id=e.id
     WHERE e.id=j.raw_entry_id AND e.idempotency_key='admin:'||f.id::text AND e.expires_at=(p.payload#>>'{command,gift,expires_at}')::timestamptz
     AND lot.billing_account_id=w.id AND lot.kind='gift')
  OR NOT EXISTS(SELECT 1 FROM vip_grant_events e WHERE e.grant_id=l.grant_id AND e.operation_id=v.id AND e.actor_id=p.principal_id)
  OR p.result->>'atomic' IS DISTINCT FROM 'true'
  OR p.result->>'vip_operation_id' IS DISTINCT FROM v.id::text OR p.result->>'gift_operation_id' IS DISTINCT FROM f.id::text
  OR p.result->>'grant_id' IS DISTINCT FROM l.grant_id::text OR p.result->>'credit_reference' IS DISTINCT FROM 'admin:'||f.id::text
  OR p.result->>'billing_account_id' IS DISTINCT FROM w.id::text
  OR NOT (p.result_ids @> ARRAY[v.id,f.id,l.grant_id,j.id])
  OR (SELECT count(*) FROM admin_operations WHERE payload->>'combination_parent_id'=p.id::text)<>2 THEN
  RAISE EXCEPTION 'Combined success must retain the exact two authorized effects, subjects, credit reference and provenance' USING ERRCODE='23514';
 END IF;
END $$;
REVOKE ALL ON FUNCTION assert_vip_credit_commit(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assert_vip_credit_commit(uuid) TO cp_control;
CREATE FUNCTION check_vip_credit_operation_commit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.payload->>'vip_credit_command_version'='1' THEN PERFORM assert_vip_credit_commit(NEW.id);
 ELSIF NEW.payload ? 'combination_parent_id' THEN PERFORM assert_vip_credit_commit((NEW.payload->>'combination_parent_id')::uuid);
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER vip_credit_operation_committed AFTER INSERT OR UPDATE ON admin_operations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_vip_credit_operation_commit();
CREATE FUNCTION check_vip_credit_link_commit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM assert_vip_credit_commit(NEW.parent_operation_id); RETURN NEW; END $$;
CREATE CONSTRAINT TRIGGER vip_credit_link_committed AFTER INSERT ON admin_vip_credit_combinations
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_vip_credit_link_commit();
INSERT INTO schema_migrations(version) VALUES(60);
