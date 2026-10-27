-- Commercial definitions are immutable. Publication changes a pointer and
-- appends a fact; it never edits an issued version or an old grant snapshot.
CREATE TABLE commercial_plans (
 id uuid PRIMARY KEY,
 legacy_key text UNIQUE,
 published_version_id uuid,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>=1),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE commercial_plan_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 plan_id uuid NOT NULL REFERENCES commercial_plans(id),
 version integer NOT NULL CHECK(version>=1),
 name text NOT NULL CHECK(length(name)>0),
 allowances jsonb NOT NULL CHECK(jsonb_typeof(allowances)='object'),
 runtime_body jsonb NOT NULL CHECK(jsonb_typeof(runtime_body)='object'),
 provenance text NOT NULL CHECK(provenance IN ('admin_draft','recorded_legacy_catalog','bootstrap_default')),
 source_catalog_entry_id uuid UNIQUE REFERENCES catalog_entries(id),
 source_state text CHECK(source_state IN ('draft','published','retired')),
 actor_id uuid REFERENCES admin_principals(id),
 operation_id uuid UNIQUE REFERENCES admin_operations(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(plan_id,version), UNIQUE(plan_id,id),
 CHECK((provenance='admin_draft')=(operation_id IS NOT NULL)),
 CHECK((provenance='admin_draft')=(actor_id IS NOT NULL)),
 CHECK((provenance='recorded_legacy_catalog')=(source_catalog_entry_id IS NOT NULL))
);
ALTER TABLE commercial_plans ADD FOREIGN KEY(id,published_version_id) REFERENCES commercial_plan_versions(plan_id,id);
CREATE TABLE commercial_plan_publications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 plan_id uuid NOT NULL REFERENCES commercial_plans(id),
 plan_version_id uuid NOT NULL UNIQUE REFERENCES commercial_plan_versions(id),
 previous_version_id uuid REFERENCES commercial_plan_versions(id),
 operation_id uuid UNIQUE REFERENCES admin_operations(id),
 actor_id uuid REFERENCES admin_principals(id),
 provenance text NOT NULL CHECK(provenance IN ('admin_publication','evaluated_at_upgrade')),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(plan_id,plan_version_id) REFERENCES commercial_plan_versions(plan_id,id),
 FOREIGN KEY(plan_id,previous_version_id) REFERENCES commercial_plan_versions(plan_id,id),
 CHECK((provenance='admin_publication')=(operation_id IS NOT NULL)),
 CHECK((provenance='admin_publication')=(actor_id IS NOT NULL))
);
CREATE TABLE legacy_entitlement_plan_bindings (
 entitlement_id uuid PRIMARY KEY REFERENCES entitlements(id),
 tenant_id uuid REFERENCES tenants(id),
 user_id uuid REFERENCES users(id),
 catalog_version_id uuid NOT NULL REFERENCES commercial_plan_versions(id),
 plan_version_id uuid REFERENCES commercial_plan_versions(id),
 runtime_body jsonb NOT NULL,
 provenance text NOT NULL CHECK(provenance IN ('recorded_grant_snapshot','evaluated_fallback_at_binding')),
 bound_at timestamptz NOT NULL DEFAULT now(),
 CHECK((tenant_id IS NOT NULL)<>(user_id IS NOT NULL))
);
CREATE TABLE commercial_plan_migration_issues (
 source_catalog_entry_id uuid PRIMARY KEY REFERENCES catalog_entries(id),
 reason_code text NOT NULL,
 recorded_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX commercial_plan_versions_page ON commercial_plan_versions(created_at DESC,id DESC);
CREATE INDEX commercial_plan_publications_page ON commercial_plan_publications(created_at DESC,id DESC);

CREATE FUNCTION protect_commercial_plan_facts() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o admin_operations; f commercial_plans; v commercial_plan_versions;
BEGIN
 IF TG_OP<>'INSERT' THEN
  RAISE EXCEPTION 'Commercial version and publication facts are immutable' USING ERRCODE='42501';
 END IF;
 IF TG_TABLE_NAME='commercial_plan_versions' THEN
  SELECT * INTO f FROM commercial_plans WHERE id=NEW.plan_id;
  IF NEW.provenance='admin_draft' THEN
   SELECT * INTO o FROM admin_operations WHERE id=NEW.operation_id;
   IF NOT FOUND OR o.action<>'plans.draft' OR o.principal_id<>NEW.actor_id
    OR o.payload->>'commercial_plan_command_version' IS DISTINCT FROM '1'
    OR (o.payload#>>'{command,plan_id}')::uuid IS DISTINCT FROM NEW.plan_id
    OR o.payload#>>'{command,name}' IS DISTINCT FROM NEW.name
    OR o.payload#>'{command,allowances}' IS DISTINCT FROM NEW.allowances
    OR o.state<>'running' THEN
    RAISE EXCEPTION 'Plan draft must retain its recorded operation and exact command' USING ERRCODE='23514';
   END IF;
  ELSIF f.legacy_key IS NULL OR EXISTS(SELECT 1 FROM commercial_plan_publications p WHERE p.plan_id=NEW.plan_id) THEN
   RAISE EXCEPTION 'Legacy plan import is only available before its initial binding' USING ERRCODE='23514';
  END IF;
 ELSIF TG_TABLE_NAME='commercial_plan_publications' THEN
  SELECT * INTO f FROM commercial_plans WHERE id=NEW.plan_id;
  SELECT * INTO v FROM commercial_plan_versions WHERE id=NEW.plan_version_id;
  IF f.published_version_id IS DISTINCT FROM NEW.previous_version_id OR v.plan_id<>NEW.plan_id
   OR EXISTS(SELECT 1 FROM commercial_plan_versions prior_version WHERE prior_version.id=NEW.previous_version_id AND prior_version.version>=v.version) THEN
   RAISE EXCEPTION 'Publication must advance the actual current plan version' USING ERRCODE='23514';
  END IF;
  IF NEW.provenance='admin_publication' THEN
   SELECT * INTO o FROM admin_operations WHERE id=NEW.operation_id;
   IF NOT FOUND OR o.action<>'plans.publish' OR o.principal_id<>NEW.actor_id
    OR o.payload->>'commercial_plan_command_version' IS DISTINCT FROM '1'
    OR o.payload->>'plan_version_id' IS DISTINCT FROM NEW.plan_version_id::text
    OR o.state<>'running' THEN
    RAISE EXCEPTION 'Plan publication must retain its authorized operation' USING ERRCODE='23514';
   END IF;
  ELSIF f.legacy_key IS NULL OR f.published_version_id IS NOT NULL OR NEW.previous_version_id IS NOT NULL THEN
   RAISE EXCEPTION 'Upgrade publication is an initial evaluation, never an invented historical publication' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_commercial_version BEFORE INSERT OR UPDATE OR DELETE ON commercial_plan_versions FOR EACH ROW EXECUTE FUNCTION protect_commercial_plan_facts();
CREATE TRIGGER protect_commercial_publication BEFORE INSERT OR UPDATE OR DELETE ON commercial_plan_publications FOR EACH ROW EXECUTE FUNCTION protect_commercial_plan_facts();
CREATE FUNCTION protect_commercial_plan_head() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Plan identity is immutable' USING ERRCODE='42501'; END IF;
 IF TG_OP='UPDATE' AND (ROW(NEW.id,NEW.legacy_key,NEW.created_at) IS DISTINCT FROM ROW(OLD.id,OLD.legacy_key,OLD.created_at)
  OR NEW.revision<>OLD.revision+1 OR NEW.published_version_id IS NOT DISTINCT FROM OLD.published_version_id
  OR NOT EXISTS(SELECT 1 FROM commercial_plan_publications p WHERE p.plan_id=OLD.id AND p.plan_version_id=NEW.published_version_id AND p.previous_version_id IS NOT DISTINCT FROM OLD.published_version_id)) THEN
  RAISE EXCEPTION 'A plan head changes only through its exact publication fact' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_commercial_head BEFORE UPDATE OR DELETE ON commercial_plans FOR EACH ROW EXECUTE FUNCTION protect_commercial_plan_head();
CREATE FUNCTION protect_legacy_plan_definition() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='catalog_entries' THEN
  IF (TG_OP<>'DELETE' AND NEW.kind='plan') OR (TG_OP<>'INSERT' AND OLD.kind='plan') THEN
   RAISE EXCEPTION 'Use immutable commercial plan versions' USING ERRCODE='42501';
  END IF;
 ELSE
  IF ROW(NEW.tenant_id,NEW.user_id,NEW.plan,NEW.plan_body,NEW.plan_version,NEW.created_by,NEW.created_at,NEW.auto_renew)
   IS DISTINCT FROM ROW(OLD.tenant_id,OLD.user_id,OLD.plan,OLD.plan_body,OLD.plan_version,OLD.created_by,OLD.created_at,OLD.auto_renew) THEN
   RAISE EXCEPTION 'An issued grant keeps its original identity and plan snapshot' USING ERRCODE='42501';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER legacy_plan_catalog_frozen BEFORE INSERT OR UPDATE OR DELETE ON catalog_entries FOR EACH ROW EXECUTE FUNCTION protect_legacy_plan_definition();
CREATE TRIGGER legacy_grant_plan_frozen BEFORE UPDATE ON entitlements FOR EACH ROW EXECUTE FUNCTION protect_legacy_plan_definition();

CREATE FUNCTION bind_legacy_entitlement_plan() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE v commercial_plan_versions;
BEGIN
 SELECT pv.* INTO v FROM commercial_plans p JOIN commercial_plan_versions pv ON pv.id=p.published_version_id WHERE p.legacy_key=NEW.plan;
 -- The startup seed records older rows after importing their actual definitions.
 IF FOUND THEN
  INSERT INTO legacy_entitlement_plan_bindings(entitlement_id,tenant_id,user_id,catalog_version_id,plan_version_id,runtime_body,provenance)
  VALUES(NEW.id,NEW.tenant_id,NEW.user_id,v.id,CASE WHEN NEW.plan_body='{}'::jsonb OR NEW.plan_body=v.runtime_body THEN v.id ELSE NULL END,CASE WHEN NEW.plan_body='{}'::jsonb THEN v.runtime_body ELSE NEW.plan_body END,
   CASE WHEN NEW.plan_body='{}'::jsonb THEN 'evaluated_fallback_at_binding' ELSE 'recorded_grant_snapshot' END);
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER bind_legacy_grant_plan AFTER INSERT ON entitlements FOR EACH ROW EXECUTE FUNCTION bind_legacy_entitlement_plan();
CREATE FUNCTION immutable_commercial_binding() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Bound legacy plan snapshots and migration facts are immutable' USING ERRCODE='42501'; END $$;
CREATE TRIGGER protect_legacy_plan_binding BEFORE UPDATE OR DELETE ON legacy_entitlement_plan_bindings FOR EACH ROW EXECUTE FUNCTION immutable_commercial_binding();
CREATE TRIGGER protect_plan_migration_issue BEFORE UPDATE OR DELETE ON commercial_plan_migration_issues FOR EACH ROW EXECUTE FUNCTION immutable_commercial_binding();
CREATE FUNCTION immutable_commercial_intent() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.payload->>'commercial_plan_command_version'='1' THEN
  IF TG_OP='DELETE' OR ROW(NEW.id,NEW.principal_id,NEW.action,NEW.payload_hash,NEW.payload)
   IS DISTINCT FROM ROW(OLD.id,OLD.principal_id,OLD.action,OLD.payload_hash,OLD.payload) THEN
   RAISE EXCEPTION 'Commercial plan command intent is immutable' USING ERRCODE='42501';
  END IF;
  IF TG_TABLE_NAME='admin_operations' THEN
   IF ROW(NEW.tenant_id,NEW.policy_version_id,NEW.target_ids,NEW.created_at,NEW.idempotency_key)
    IS DISTINCT FROM ROW(OLD.tenant_id,OLD.policy_version_id,OLD.target_ids,OLD.created_at,OLD.idempotency_key) THEN
    RAISE EXCEPTION 'Commercial operation authority is immutable' USING ERRCODE='42501';
   END IF;
  ELSIF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
   RAISE EXCEPTION 'Commercial preview expiry is immutable' USING ERRCODE='42501';
  END IF;
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_commercial_operation BEFORE UPDATE OR DELETE ON admin_operations FOR EACH ROW EXECUTE FUNCTION immutable_commercial_intent();
CREATE TRIGGER protect_commercial_preview BEFORE UPDATE OR DELETE ON admin_previews FOR EACH ROW EXECUTE FUNCTION immutable_commercial_intent();

CREATE FUNCTION check_commercial_plan_commit() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.operation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM admin_operations o WHERE o.id=NEW.operation_id AND o.state='succeeded' AND NEW.id=ANY(o.result_ids)) THEN
  RAISE EXCEPTION 'Commercial fact and successful operation must commit together' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='commercial_plan_publications' THEN
  IF NOT EXISTS(SELECT 1 FROM commercial_plans p WHERE p.id=NEW.plan_id AND p.published_version_id=NEW.plan_version_id) THEN
   RAISE EXCEPTION 'Publication and current head must commit together' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER commercial_version_committed AFTER INSERT ON commercial_plan_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_commercial_plan_commit();
CREATE CONSTRAINT TRIGGER commercial_publication_committed AFTER INSERT ON commercial_plan_publications DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_commercial_plan_commit();

CREATE FUNCTION check_legacy_plan_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e entitlements; v commercial_plan_versions;
BEGIN
 SELECT * INTO e FROM entitlements WHERE id=NEW.entitlement_id;
 SELECT * INTO v FROM commercial_plan_versions WHERE id=NEW.catalog_version_id;
 IF ROW(NEW.tenant_id,NEW.user_id) IS DISTINCT FROM ROW(e.tenant_id,e.user_id)
  OR NOT EXISTS(SELECT 1 FROM commercial_plans p WHERE p.id=v.plan_id AND p.legacy_key=e.plan)
  OR NEW.runtime_body IS DISTINCT FROM (CASE WHEN e.plan_body='{}'::jsonb THEN v.runtime_body ELSE e.plan_body END)
  OR NEW.provenance<>(CASE WHEN e.plan_body='{}'::jsonb THEN 'evaluated_fallback_at_binding' ELSE 'recorded_grant_snapshot' END)
  OR NEW.plan_version_id IS DISTINCT FROM (CASE WHEN e.plan_body='{}'::jsonb OR e.plan_body=v.runtime_body THEN v.id ELSE NULL END)
  OR NEW.bound_at IS DISTINCT FROM now() THEN
  RAISE EXCEPTION 'Binding must preserve actual grant facts and evaluated fallback provenance' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validate_legacy_plan_binding BEFORE INSERT ON legacy_entitlement_plan_bindings FOR EACH ROW EXECUTE FUNCTION check_legacy_plan_binding();

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['commercial_plans','commercial_plan_versions','commercial_plan_publications','legacy_entitlement_plan_bindings','commercial_plan_migration_issues'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY control_access ON %I TO cp_control USING(true) WITH CHECK(true)',t);
 END LOOP;
END $$;
CREATE POLICY plan_public_read ON commercial_plans TO cp_app USING(published_version_id IS NOT NULL);
CREATE POLICY plan_version_public_read ON commercial_plan_versions TO cp_app USING(EXISTS(SELECT 1 FROM commercial_plan_publications p WHERE p.plan_version_id=commercial_plan_versions.id));
CREATE POLICY plan_publication_read ON commercial_plan_publications TO cp_app USING(true);
CREATE POLICY legacy_binding_subject_read ON legacy_entitlement_plan_bindings TO cp_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid OR user_id=nullif(current_setting('app.actor_id',true),'')::uuid);
GRANT SELECT,INSERT ON commercial_plans,commercial_plan_versions,commercial_plan_publications,legacy_entitlement_plan_bindings,commercial_plan_migration_issues TO cp_control;
GRANT UPDATE ON commercial_plans TO cp_control;
GRANT SELECT ON commercial_plans,commercial_plan_versions,commercial_plan_publications,legacy_entitlement_plan_bindings TO cp_app;
