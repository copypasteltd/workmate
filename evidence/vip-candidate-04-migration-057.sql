-- Canonical grants keep their original provenance and immutable plan version.
-- Legacy rows remain original facts; replacement is an explicit new fact.
CREATE TABLE entitlement_subjects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid REFERENCES tenants(id), user_id uuid REFERENCES users(id),
 data_mode text NOT NULL CHECK(data_mode IN ('simulated','configured_services')),
 version integer NOT NULL DEFAULT 1 CHECK(version>=1),
 last_operation_id uuid REFERENCES admin_operations(id),
 CHECK((tenant_id IS NOT NULL)<>(user_id IS NOT NULL)),
 UNIQUE NULLS NOT DISTINCT(data_mode,tenant_id,user_id)
);
CREATE TABLE vip_grants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subject_id uuid NOT NULL REFERENCES entitlement_subjects(id),
 plan_version_id uuid NOT NULL REFERENCES commercial_plan_versions(id),
 starts_at timestamptz NOT NULL, initial_ends_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','suspended','revoked')),
 source text NOT NULL CHECK(source IN ('manual','paid','trial','promotion','compensation','contract')),
 payment_record_id uuid UNIQUE REFERENCES payment_records(id),
 auto_renew boolean NOT NULL DEFAULT false CHECK(NOT auto_renew),
 actor_id uuid NOT NULL REFERENCES admin_principals(id), operation_id uuid NOT NULL UNIQUE REFERENCES admin_operations(id),
 last_operation_id uuid NOT NULL REFERENCES admin_operations(id),
 replacement_at timestamptz, replacement_grant_id uuid REFERENCES vip_grants(id) DEFERRABLE INITIALLY DEFERRED,
 version integer NOT NULL DEFAULT 1 CHECK(version>=1), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK(ends_at>starts_at AND initial_ends_at>starts_at AND ends_at>=initial_ends_at),
 CHECK((source='paid')=(payment_record_id IS NOT NULL)),
 CHECK((replacement_at IS NULL)=(replacement_grant_id IS NULL))
);
CREATE TABLE vip_grant_events (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), grant_id uuid NOT NULL REFERENCES vip_grants(id),
 operation_id uuid NOT NULL REFERENCES admin_operations(id), actor_id uuid NOT NULL REFERENCES admin_principals(id),
 action text NOT NULL CHECK(action IN ('grant','extend','suspend','resume','revoke','replace')),
 version integer NOT NULL CHECK(version>=1), before_value jsonb, after_value jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(grant_id,version)
);
CREATE TABLE legacy_vip_replacements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), entitlement_id uuid NOT NULL REFERENCES entitlements(id),
 grant_id uuid NOT NULL REFERENCES vip_grants(id), effective_from timestamptz NOT NULL,
 operation_id uuid NOT NULL REFERENCES admin_operations(id), actor_id uuid NOT NULL REFERENCES admin_principals(id),
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(entitlement_id,grant_id)
);
CREATE TABLE entitlement_outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), subject_id uuid NOT NULL REFERENCES entitlement_subjects(id),
 grant_id uuid NOT NULL REFERENCES vip_grants(id), operation_id uuid NOT NULL REFERENCES admin_operations(id),
 kind text NOT NULL CHECK(kind IN ('changed','starts','expires','replaced')),
 grant_version integer NOT NULL CHECK(grant_version>=1), available_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now(), dispatched_at timestamptz, discarded_at timestamptz,
 CHECK(dispatched_at IS NULL OR discarded_at IS NULL), UNIQUE(grant_id,grant_version,kind)
);
CREATE TABLE entitlement_notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), outbox_id uuid NOT NULL REFERENCES entitlement_outbox(id),
 recipient_id uuid NOT NULL REFERENCES users(id), read boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(outbox_id,recipient_id)
);
CREATE INDEX vip_grant_subject_window ON vip_grants(subject_id,starts_at,ends_at);
CREATE INDEX vip_grant_page ON vip_grants(created_at DESC,id DESC);
CREATE INDEX legacy_vip_replacement_window ON legacy_vip_replacements(entitlement_id,effective_from);
CREATE INDEX entitlement_outbox_due ON entitlement_outbox(available_at,id) WHERE dispatched_at IS NULL AND discarded_at IS NULL;
CREATE INDEX entitlement_notification_inbox ON entitlement_notifications(recipient_id,created_at DESC,id DESC);

CREATE FUNCTION immutable_vip_facts() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'VIP origin, revision and replacement facts are immutable' USING ERRCODE='42501'; END $$;
CREATE TRIGGER immutable_vip_event BEFORE UPDATE OR DELETE ON vip_grant_events FOR EACH ROW EXECUTE FUNCTION immutable_vip_facts();
CREATE TRIGGER immutable_legacy_vip_replacement BEFORE UPDATE OR DELETE ON legacy_vip_replacements FOR EACH ROW EXECUTE FUNCTION immutable_vip_facts();
CREATE FUNCTION protect_vip_projection() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o admin_operations; s entitlement_subjects; c jsonb; expected_state text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Issued VIP grants are retained' USING ERRCODE='42501'; END IF;
 SELECT * INTO o FROM admin_operations WHERE id=NEW.last_operation_id;
 SELECT * INTO s FROM entitlement_subjects WHERE id=NEW.subject_id;
 c:=o.payload->'command';
 IF o.payload->>'vip_command_version' IS DISTINCT FROM '1' OR o.state NOT IN ('running','succeeded')
  OR o.payload->>'subject_id' IS DISTINCT FROM coalesce(s.tenant_id,s.user_id)::text
  OR o.payload->>'subject_kind' IS DISTINCT FROM (CASE WHEN s.tenant_id IS NULL THEN 'user' ELSE 'tenant' END)
  OR o.payload->>'data_mode' IS DISTINCT FROM s.data_mode THEN
  RAISE EXCEPTION 'VIP changes require their exact subject operation' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.version<>1 OR NEW.initial_ends_at<>NEW.ends_at OR NEW.actor_id<>o.principal_id OR NEW.operation_id<>o.id
   OR o.action<>'entitlements.grant' OR NEW.state<>'active' OR NEW.replacement_at IS NOT NULL
   OR c->>'overlap_policy'='extend_same_plan'
   OR c->>'plan_version_id' IS DISTINCT FROM NEW.plan_version_id::text
   OR (c->>'starts_at')::timestamptz IS DISTINCT FROM NEW.starts_at
   OR (c->>'ends_at')::timestamptz IS DISTINCT FROM NEW.ends_at
   OR c->>'source' IS DISTINCT FROM NEW.source
   OR c->>'payment_record_id' IS DISTINCT FROM NEW.payment_record_id::text
   OR NOT EXISTS(SELECT 1 FROM commercial_plan_publications p WHERE p.plan_version_id=NEW.plan_version_id) THEN
   RAISE EXCEPTION 'VIP creation must retain the actual actor, operation and published definition' USING ERRCODE='23514';
  END IF;
 ELSE
  IF ROW(NEW.id,NEW.subject_id,NEW.plan_version_id,NEW.starts_at,NEW.initial_ends_at,NEW.source,NEW.payment_record_id,NEW.auto_renew,NEW.actor_id,NEW.operation_id,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.subject_id,OLD.plan_version_id,OLD.starts_at,OLD.initial_ends_at,OLD.source,OLD.payment_record_id,OLD.auto_renew,OLD.actor_id,OLD.operation_id,OLD.created_at)
   OR NEW.version<>OLD.version+1 OR NEW.ends_at<OLD.ends_at OR OLD.state='revoked'
   OR (OLD.replacement_at IS NOT NULL AND (NEW.replacement_at IS NULL OR NEW.replacement_at>=OLD.replacement_at)) THEN
   RAISE EXCEPTION 'An issued VIP changes only through a new revision' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM vip_grant_events e WHERE e.grant_id=OLD.id AND e.version=OLD.version AND e.after_value=to_jsonb(OLD)) THEN
   RAISE EXCEPTION 'VIP projection must follow its actual previous revision' USING ERRCODE='23514';
  END IF;
  IF o.action='entitlements.grant' AND c->>'overlap_policy'='replace' THEN
   IF NEW.state<>OLD.state OR NEW.ends_at<>OLD.ends_at OR NEW.replacement_at IS DISTINCT FROM (c->>'starts_at')::timestamptz
    OR NOT EXISTS(SELECT 1 FROM vip_grants n WHERE n.id=NEW.replacement_grant_id AND n.operation_id=o.id AND n.subject_id=NEW.subject_id) THEN
    RAISE EXCEPTION 'Replacement must reference its actual new grant and start' USING ERRCODE='23514';
   END IF;
  ELSE
   IF NEW.replacement_at IS DISTINCT FROM OLD.replacement_at OR NEW.replacement_grant_id IS DISTINCT FROM OLD.replacement_grant_id OR OLD.replacement_at IS NOT NULL THEN
    RAISE EXCEPTION 'A replaced grant cannot be revived or rewritten' USING ERRCODE='23514';
   END IF;
   IF o.action='entitlements.extend' OR (o.action='entitlements.grant' AND c->>'overlap_policy'='extend_same_plan') THEN
    IF NEW.ends_at IS DISTINCT FROM (c->>'ends_at')::timestamptz OR NEW.ends_at<=OLD.ends_at OR NEW.state<>OLD.state
     OR (o.action='entitlements.extend' AND (o.payload->>'target_id'<>OLD.id::text OR (c->>'expected_version')::integer<>OLD.version))
     OR (o.action='entitlements.grant' AND (c->>'plan_version_id'<>OLD.plan_version_id::text OR c->>'source'<>OLD.source OR c->>'payment_record_id' IS DISTINCT FROM OLD.payment_record_id::text)) THEN
     RAISE EXCEPTION 'VIP extension must match its frozen command and source' USING ERRCODE='23514';
    END IF;
   ELSE
    expected_state:=CASE o.action WHEN 'entitlements.suspend' THEN 'suspended' WHEN 'entitlements.resume' THEN 'active' WHEN 'entitlements.revoke' THEN 'revoked' END;
    IF expected_state IS NULL OR NEW.state<>expected_state OR NEW.state=OLD.state OR NEW.ends_at<>OLD.ends_at
     OR o.payload->>'target_id'<>OLD.id::text OR (c->>'expected_version')::integer<>OLD.version THEN
     RAISE EXCEPTION 'VIP state must match its exact frozen revision command' USING ERRCODE='23514';
    END IF;
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_vip_projection BEFORE INSERT OR UPDATE OR DELETE ON vip_grants FOR EACH ROW EXECUTE FUNCTION protect_vip_projection();
CREATE FUNCTION check_vip_revision_commit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g vip_grants; o admin_operations;
BEGIN
 IF TG_TABLE_NAME='vip_grants' THEN SELECT * INTO g FROM vip_grants WHERE id=NEW.id;
 ELSE SELECT * INTO g FROM vip_grants WHERE id=NEW.grant_id; END IF;
 SELECT * INTO o FROM admin_operations WHERE id=g.last_operation_id;
 IF o.state<>'succeeded' OR NOT (g.id=ANY(o.result_ids))
  OR NOT EXISTS(SELECT 1 FROM vip_grant_events e WHERE e.grant_id=g.id AND e.version=g.version AND e.operation_id=g.last_operation_id AND e.actor_id=o.principal_id AND e.after_value=to_jsonb(g))
  OR NOT EXISTS(SELECT 1 FROM entitlement_outbox e WHERE e.grant_id=g.id AND e.grant_version=g.version AND e.operation_id=g.last_operation_id AND e.kind='changed') THEN
  RAISE EXCEPTION 'VIP, revision, operation and outbox must commit together' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER vip_projection_committed AFTER INSERT OR UPDATE ON vip_grants DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_vip_revision_commit();
CREATE CONSTRAINT TRIGGER vip_revision_committed AFTER INSERT ON vip_grant_events DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_vip_revision_commit();
CREATE FUNCTION protect_vip_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.payload->>'vip_command_version'='1' OR (TG_OP<>'DELETE' AND NEW.payload->>'vip_command_version'='1') THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'VIP intent is retained' USING ERRCODE='42501'; END IF;
  IF TG_OP='UPDATE' AND ROW(NEW.principal_id,NEW.action,NEW.payload,NEW.payload_hash) IS DISTINCT FROM ROW(OLD.principal_id,OLD.action,OLD.payload,OLD.payload_hash) THEN
   RAISE EXCEPTION 'VIP intent is immutable' USING ERRCODE='42501';
  END IF;
  IF TG_OP='UPDATE' AND TG_TABLE_NAME='admin_previews' THEN
   IF (to_jsonb(NEW)-'consumed_at') IS DISTINCT FROM (to_jsonb(OLD)-'consumed_at')
    OR (OLD.consumed_at IS NOT NULL AND NEW.consumed_at IS DISTINCT FROM OLD.consumed_at) THEN
    RAISE EXCEPTION 'VIP preview identity, expiry and consumption are immutable' USING ERRCODE='42501';
   END IF;
  END IF;
  IF TG_OP='UPDATE' AND TG_TABLE_NAME='admin_operations' AND
   (to_jsonb(NEW)-ARRAY['state','version','result','result_ids','approved_by']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['state','version','result','result_ids','approved_by']) THEN
   RAISE EXCEPTION 'VIP operation origin and policy are immutable' USING ERRCODE='42501';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
CREATE TRIGGER protect_vip_operation_intent BEFORE UPDATE OR DELETE ON admin_operations FOR EACH ROW EXECUTE FUNCTION protect_vip_intent();
CREATE TRIGGER protect_vip_preview_intent BEFORE UPDATE OR DELETE ON admin_previews FOR EACH ROW EXECUTE FUNCTION protect_vip_intent();
CREATE FUNCTION protect_entitlement_outbox() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR ROW(NEW.id,NEW.subject_id,NEW.grant_id,NEW.operation_id,NEW.kind,NEW.grant_version,NEW.available_at,NEW.created_at)
  IS DISTINCT FROM ROW(OLD.id,OLD.subject_id,OLD.grant_id,OLD.operation_id,OLD.kind,OLD.grant_version,OLD.available_at,OLD.created_at) THEN
  RAISE EXCEPTION 'Entitlement delivery intent is immutable' USING ERRCODE='42501';
 END IF; RETURN NEW;
END $$;
CREATE TRIGGER protect_entitlement_delivery BEFORE UPDATE OR DELETE ON entitlement_outbox FOR EACH ROW EXECUTE FUNCTION protect_entitlement_outbox();
CREATE FUNCTION check_entitlement_delivery_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g vip_grants;
BEGIN
 SELECT * INTO g FROM vip_grants WHERE id=NEW.grant_id;
 IF g.id IS NULL OR NEW.subject_id<>g.subject_id OR NEW.operation_id<>g.last_operation_id OR NEW.grant_version<>g.version
  OR NEW.dispatched_at IS NOT NULL OR NEW.discarded_at IS NOT NULL
  OR (NEW.kind='changed' AND NEW.available_at<>now())
  OR (NEW.kind='starts' AND NEW.available_at<>g.starts_at)
  OR (NEW.kind='expires' AND NEW.available_at<>g.ends_at)
  OR (NEW.kind='replaced' AND NEW.available_at IS DISTINCT FROM g.replacement_at) THEN
  RAISE EXCEPTION 'Entitlement delivery must match its actual grant revision and boundary' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER check_entitlement_delivery_insert BEFORE INSERT ON entitlement_outbox FOR EACH ROW EXECUTE FUNCTION check_entitlement_delivery_insert();

CREATE FUNCTION check_vip_fact_insert() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE g vip_grants; s entitlement_subjects; e entitlements; o admin_operations; previous jsonb;
BEGIN
 SELECT * INTO g FROM vip_grants WHERE id=NEW.grant_id;
 SELECT * INTO s FROM entitlement_subjects WHERE id=g.subject_id;
 SELECT * INTO o FROM admin_operations WHERE id=NEW.operation_id;
 IF o.id IS NULL OR o.id<>g.last_operation_id OR o.principal_id IS DISTINCT FROM NEW.actor_id THEN
  RAISE EXCEPTION 'VIP fact must retain the actual current operation and actor' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='vip_grant_events' THEN
  SELECT after_value INTO previous FROM vip_grant_events WHERE grant_id=g.id AND version=g.version-1;
  IF NEW.version<>g.version OR NEW.after_value<>to_jsonb(g) OR NEW.before_value IS DISTINCT FROM previous
   OR NEW.action IS DISTINCT FROM (CASE WHEN g.version=1 THEN 'grant' WHEN o.action='entitlements.grant' THEN CASE WHEN o.payload->'command'->>'overlap_policy'='replace' THEN 'replace' ELSE 'extend' END ELSE split_part(o.action,'.',2) END) THEN
   RAISE EXCEPTION 'VIP event must preserve consecutive actual before and after facts' USING ERRCODE='23514';
  END IF;
 ELSE
  SELECT * INTO e FROM entitlements WHERE id=NEW.entitlement_id;
  IF o.action<>'entitlements.grant' OR o.payload->'command'->>'overlap_policy'<>'replace'
   OR NEW.effective_from<>g.starts_at OR g.operation_id<>o.id
   OR ROW(e.tenant_id,e.user_id) IS DISTINCT FROM ROW(s.tenant_id,s.user_id) THEN
   RAISE EXCEPTION 'Historical replacement must match its real subject and new grant' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER check_vip_event_insert BEFORE INSERT ON vip_grant_events FOR EACH ROW EXECUTE FUNCTION check_vip_fact_insert();
CREATE TRIGGER check_legacy_vip_replace_insert BEFORE INSERT ON legacy_vip_replacements FOR EACH ROW EXECUTE FUNCTION check_vip_fact_insert();
CREATE FUNCTION protect_entitlement_subject() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Entitlement subject revisions are retained' USING ERRCODE='42501'; END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.version<>1 OR NEW.last_operation_id IS NOT NULL THEN RAISE EXCEPTION 'Subject starts before its first revision' USING ERRCODE='23514'; END IF;
 ELSE
  IF ROW(NEW.id,NEW.tenant_id,NEW.user_id,NEW.data_mode) IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.user_id,OLD.data_mode)
   OR NEW.version<>OLD.version+1 OR NEW.last_operation_id IS NULL OR NEW.last_operation_id IS NOT DISTINCT FROM OLD.last_operation_id THEN
   RAISE EXCEPTION 'Entitlement subject changes through one new operation revision' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_entitlement_subject BEFORE INSERT OR UPDATE OR DELETE ON entitlement_subjects FOR EACH ROW EXECUTE FUNCTION protect_entitlement_subject();
CREATE FUNCTION check_entitlement_subject_commit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s entitlement_subjects;
BEGIN
 SELECT * INTO s FROM entitlement_subjects WHERE id=NEW.id;
 IF NOT EXISTS(SELECT 1 FROM admin_operations o JOIN vip_grants g ON g.last_operation_id=o.id
  WHERE o.id=s.last_operation_id AND o.state='succeeded' AND g.subject_id=s.id
  AND o.payload->>'subject_id'=coalesce(s.tenant_id,s.user_id)::text AND o.payload->>'data_mode'=s.data_mode
  AND (o.payload->'before'->>'subject_version')::integer=s.version-1) THEN
  RAISE EXCEPTION 'Subject revision must commit with its successful exact VIP operation' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER entitlement_subject_committed AFTER INSERT OR UPDATE ON entitlement_subjects DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_entitlement_subject_commit();

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['entitlement_subjects','vip_grants','vip_grant_events','legacy_vip_replacements','entitlement_outbox','entitlement_notifications'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY control_all ON %I TO cp_control USING(true) WITH CHECK(true)',t);
 END LOOP;
END $$;
CREATE POLICY entitlement_subject_read ON entitlement_subjects TO cp_app USING(data_mode=current_setting('app.data_mode',true) AND (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid OR user_id=nullif(current_setting('app.actor_id',true),'')::uuid));
CREATE POLICY vip_grant_subject_read ON vip_grants TO cp_app USING(EXISTS(SELECT 1 FROM entitlement_subjects s WHERE s.id=subject_id));
CREATE POLICY vip_event_subject_read ON vip_grant_events TO cp_app USING(EXISTS(SELECT 1 FROM vip_grants g WHERE g.id=grant_id));
CREATE POLICY legacy_vip_replacement_read ON legacy_vip_replacements TO cp_app USING(EXISTS(SELECT 1 FROM entitlements e WHERE e.id=entitlement_id) AND EXISTS(SELECT 1 FROM vip_grants g WHERE g.id=grant_id));
CREATE POLICY entitlement_outbox_read ON entitlement_outbox TO cp_app USING(EXISTS(SELECT 1 FROM entitlement_subjects s WHERE s.id=subject_id));
CREATE POLICY entitlement_notification_read ON entitlement_notifications TO cp_app USING(recipient_id=nullif(current_setting('app.actor_id',true),'')::uuid);
CREATE POLICY entitlement_notification_update ON entitlement_notifications TO cp_app USING(recipient_id=nullif(current_setting('app.actor_id',true),'')::uuid) WITH CHECK(recipient_id=nullif(current_setting('app.actor_id',true),'')::uuid);
GRANT SELECT,INSERT,UPDATE ON entitlement_subjects,vip_grants,entitlement_outbox TO cp_control;
GRANT SELECT,INSERT ON vip_grant_events,legacy_vip_replacements,entitlement_notifications TO cp_control;
GRANT SELECT ON entitlement_subjects,vip_grants,vip_grant_events,legacy_vip_replacements,entitlement_outbox,entitlement_notifications TO cp_app;
GRANT UPDATE(read) ON entitlement_notifications TO cp_app;
CREATE VIEW entitlement_access WITH(security_invoker=true) AS
 SELECT g.id,s.tenant_id,s.user_id,coalesce(p.legacy_key,v.name) AS plan,v.version AS plan_version,v.runtime_body AS plan_body,
  g.starts_at,least(g.ends_at,g.replacement_at) AS ends_at,
  CASE WHEN g.replacement_at<=now() THEN 'revoked' ELSE g.state END AS state,g.auto_renew,
  g.actor_id AS created_by,g.created_at,g.version,g.plan_version_id,'canonical_grant'::text AS provenance
 FROM vip_grants g JOIN entitlement_subjects s ON s.id=g.subject_id JOIN commercial_plan_versions v ON v.id=g.plan_version_id JOIN commercial_plans p ON p.id=v.plan_id
 WHERE s.data_mode=current_setting('app.data_mode',true)
 UNION ALL
 SELECT e.id,e.tenant_id,e.user_id,e.plan,e.plan_version,b.runtime_body,e.starts_at,
  least(e.ends_at,(SELECT min(r.effective_from) FROM legacy_vip_replacements r JOIN vip_grants n ON n.id=r.grant_id JOIN entitlement_subjects s ON s.id=n.subject_id WHERE r.entitlement_id=e.id AND s.data_mode=current_setting('app.data_mode',true))),
  CASE WHEN EXISTS(SELECT 1 FROM legacy_vip_replacements r JOIN vip_grants n ON n.id=r.grant_id JOIN entitlement_subjects s ON s.id=n.subject_id WHERE r.entitlement_id=e.id AND s.data_mode=current_setting('app.data_mode',true) AND r.effective_from<=now()) THEN 'revoked' ELSE e.state END,
  e.auto_renew,e.created_by,e.created_at,e.version,b.plan_version_id,b.provenance
 FROM entitlements e LEFT JOIN legacy_entitlement_plan_bindings b ON b.entitlement_id=e.id;
GRANT SELECT ON entitlement_access TO cp_app,cp_control;
INSERT INTO schema_migrations(version) VALUES(57);
