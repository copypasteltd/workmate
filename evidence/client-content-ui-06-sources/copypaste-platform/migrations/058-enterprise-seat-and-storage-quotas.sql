-- Charge retained logical versions and live upload commitments to the tenant.
-- No old grant, allowance, financial entry or retained content is rewritten.
ALTER TABLE asset_versions ADD COLUMN upload_session_id uuid UNIQUE REFERENCES upload_sessions(id);
CREATE INDEX resource_retained_versions ON asset_versions(tenant_id) INCLUDE(bytes) WHERE erased_at IS NULL;
CREATE INDEX resource_pending_uploads ON upload_sessions(tenant_id,expires_at) INCLUDE(size_bytes) WHERE state='pending';

-- Private to control transactions and the narrow guards below. It must see all
-- tenant versions, including other users' private files hidden by application RLS.
CREATE FUNCTION tenant_resource_state(p_tenant uuid) RETURNS jsonb
LANGUAGE plpgsql SET search_path=pg_catalog,public AS $$
DECLARE
 at_time timestamptz:=clock_timestamp(); mode text; g record; definition jsonb;
 plans uuid[]:='{}'; seats bigint:=0; capacity bigint:=0; members bigint;
 retained numeric; reserved numeric; total numeric; compatibility boolean:=false;
BEGIN
 SELECT coalesce(nullif(current_setting('app.data_mode',true),''),data_mode) INTO mode FROM tenants WHERE id=p_tenant;
 IF mode NOT IN ('simulated','configured_services') OR mode IS NULL THEN
  RAISE EXCEPTION 'PLAN_RECONCILIATION_REQUIRED' USING ERRCODE='23514';
 END IF;
 FOR g IN
  SELECT v.id,v.allowances,v.provenance FROM vip_grants n
   JOIN entitlement_subjects s ON s.id=n.subject_id
   LEFT JOIN commercial_plan_versions v ON v.id=n.plan_version_id
   WHERE s.tenant_id=p_tenant AND s.data_mode=mode AND n.state='active'
    AND n.starts_at<=at_time AND n.ends_at>at_time AND (n.replacement_at IS NULL OR n.replacement_at>at_time)
  UNION ALL
  SELECT v.id,v.allowances,v.provenance FROM entitlements e
   LEFT JOIN legacy_entitlement_plan_bindings b ON b.entitlement_id=e.id
   LEFT JOIN commercial_plan_versions v ON v.id=coalesce(b.plan_version_id,b.catalog_version_id)
   WHERE e.tenant_id=p_tenant AND e.state='active' AND e.starts_at<=at_time AND e.ends_at>at_time
    AND NOT EXISTS(SELECT 1 FROM legacy_vip_replacements r JOIN vip_grants n ON n.id=r.grant_id
     JOIN entitlement_subjects s ON s.id=n.subject_id WHERE r.entitlement_id=e.id AND s.data_mode=mode AND r.effective_from<=at_time)
 LOOP
  IF g.id IS NULL OR g.allowances IS NULL THEN
   RAISE EXCEPTION 'PLAN_RECONCILIATION_REQUIRED' USING ERRCODE='23514';
  END IF;
  seats:=greatest(seats,(g.allowances->>'seat_limit')::bigint);
  capacity:=greatest(capacity,(g.allowances->>'storage_bytes')::bigint);
  compatibility:=compatibility OR g.provenance<>'admin_draft';
  IF NOT(g.id=ANY(plans)) THEN plans:=array_append(plans,g.id); END IF;
 END LOOP;
 IF cardinality(plans)=0 THEN
  SELECT v.id,v.allowances,v.provenance INTO g FROM commercial_plans p
   JOIN commercial_plan_versions v ON v.id=p.published_version_id WHERE p.legacy_key='starter';
  IF NOT FOUND THEN RAISE EXCEPTION 'PLAN_RECONCILIATION_REQUIRED' USING ERRCODE='23514'; END IF;
  seats:=(g.allowances->>'seat_limit')::bigint;
  capacity:=(g.allowances->>'storage_bytes')::bigint;
  compatibility:=g.provenance<>'admin_draft';
  plans:=ARRAY[g.id];
 END IF;
 IF seats IS NULL OR seats<1 OR capacity IS NULL OR capacity<0 THEN
  RAISE EXCEPTION 'PLAN_RECONCILIATION_REQUIRED' USING ERRCODE='23514';
 END IF;
 -- A global account freeze does not free a membership that can be restored.
 SELECT count(*) INTO members FROM memberships WHERE tenant_id=p_tenant AND status='active' AND NOT admin_suspended;
 -- Logical versions are charged independently, even when old physical keys
 -- happen to be shared. Soft deletion/quarantine does not release retained data.
 SELECT coalesce(sum(bytes),0) INTO retained FROM asset_versions WHERE tenant_id=p_tenant AND erased_at IS NULL;
 SELECT coalesce(sum(s.size_bytes),0) INTO reserved FROM upload_sessions s WHERE s.tenant_id=p_tenant
  AND s.state='pending' AND s.expires_at>at_time
  AND NOT EXISTS(SELECT 1 FROM asset_versions v WHERE v.upload_session_id=s.id);
 total:=retained+reserved;
 RETURN jsonb_build_object('tenant_id',p_tenant,'data_mode',mode,'scope','tenant','as_of',at_time,
  'plan_version_ids',(SELECT jsonb_agg(id ORDER BY id) FROM unnest(plans) id),
  'legacy_compatibility_limits',compatibility,
  'seats',jsonb_build_object('used',members,'limit',seats,'remaining',greatest(0,seats-members),'over_limit',members>seats),
  'storage',jsonb_build_object('used_bytes',retained::text,'reserved_bytes',reserved::text,'total_bytes',total::text,
   'limit_bytes',capacity::text,'remaining_bytes',greatest(0,capacity-total)::text,'over_limit',total>capacity));
END $$;
REVOKE ALL ON FUNCTION tenant_resource_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION tenant_resource_state(uuid) TO cp_control;

CREATE FUNCTION guard_membership_resource_capacity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s jsonb; already_active boolean;
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.tenant_id,NEW.user_id) IS DISTINCT FROM ROW(OLD.tenant_id,OLD.user_id) THEN
  RAISE EXCEPTION 'RESOURCE_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('members:'||NEW.tenant_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('tenant-resources:'||NEW.tenant_id::text,0));
 IF NEW.status='active' AND NOT NEW.admin_suspended THEN
  -- BEFORE INSERT also runs for ON CONFLICT UPDATE of an existing active seat.
  SELECT EXISTS(SELECT 1 FROM memberships WHERE tenant_id=NEW.tenant_id AND user_id=NEW.user_id AND status='active' AND NOT admin_suspended) INTO already_active;
  IF NOT already_active THEN
   s:=tenant_resource_state(NEW.tenant_id);
   IF (s#>>'{seats,used}')::bigint >= (s#>>'{seats,limit}')::bigint THEN
    RAISE EXCEPTION 'PLAN_SEAT_LIMIT' USING ERRCODE='23514';
   END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_membership_resource_capacity() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_membership_resource_capacity() FROM PUBLIC;
CREATE TRIGGER membership_resource_guard BEFORE INSERT OR UPDATE ON memberships FOR EACH ROW EXECUTE FUNCTION guard_membership_resource_capacity();

-- Used before object I/O and again by the database. The caller cannot inspect
-- private file rows; the function only succeeds or returns a bounded error.
CREATE FUNCTION assert_tenant_storage_capacity(p_tenant uuid,p_bytes bigint,p_upload uuid DEFAULT NULL) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE s jsonb; credit bigint:=0;
BEGIN
 IF (session_user='cp_app' AND p_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid) OR p_bytes IS NULL OR p_bytes<0 THEN
  RAISE EXCEPTION 'RESOURCE_SCOPE_INVALID' USING ERRCODE='23514';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('upload-quota:'||p_tenant::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('tenant-resources:'||p_tenant::text,0));
 IF p_upload IS NOT NULL THEN
  SELECT size_bytes INTO credit FROM upload_sessions WHERE id=p_upload AND tenant_id=p_tenant AND state='pending' AND expires_at>clock_timestamp()
   AND NOT EXISTS(SELECT 1 FROM asset_versions WHERE upload_session_id=p_upload);
  IF credit IS NULL OR credit<>p_bytes THEN
   RAISE EXCEPTION 'UPLOAD_RESERVATION_INVALID' USING ERRCODE='23514';
  END IF;
 END IF;
 s:=tenant_resource_state(p_tenant);
 -- Converting a valid, already-reserved upload adds no capacity. A downgrade
 -- blocks growth while allowing existing commitments to finish atomically.
 IF p_bytes>credit AND (s#>>'{storage,total_bytes}')::numeric+p_bytes-credit>(s#>>'{storage,limit_bytes}')::numeric THEN
  RAISE EXCEPTION 'PLAN_STORAGE_LIMIT' USING ERRCODE='23514';
 END IF;
END $$;
ALTER FUNCTION assert_tenant_storage_capacity(uuid,bigint,uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION assert_tenant_storage_capacity(uuid,bigint,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION assert_tenant_storage_capacity(uuid,bigint,uuid) TO cp_app,cp_control;

CREATE FUNCTION guard_asset_resource_capacity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a assets; u upload_sessions;
BEGIN
 -- Parent before capacity locks matches version/copy routes and FK locking.
 SELECT * INTO a FROM assets WHERE id=NEW.asset_id AND tenant_id=NEW.tenant_id FOR KEY SHARE;
 IF NOT FOUND OR NEW.erased_at IS NOT NULL THEN
  RAISE EXCEPTION 'RESOURCE_SCOPE_INVALID' USING ERRCODE='23514';
 END IF;
 IF NEW.upload_session_id IS NOT NULL THEN
  SELECT * INTO u FROM upload_sessions WHERE id=NEW.upload_session_id;
  IF u.id IS NULL OR ROW(u.tenant_id,u.project_id,u.size_bytes,u.sha256,u.mime_type)
   IS DISTINCT FROM ROW(NEW.tenant_id,a.project_id,NEW.bytes,NEW.sha256,NEW.mime_type)
   OR (session_user='cp_app' AND u.created_by IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'')::uuid)
   OR (u.asset_id IS NOT NULL AND (u.asset_id<>a.id OR u.expected_version+1<>NEW.version))
   OR (u.asset_id IS NULL AND (NEW.version<>1 OR a.created_by<>u.created_by)) THEN
   RAISE EXCEPTION 'UPLOAD_RESERVATION_INVALID' USING ERRCODE='23514';
  END IF;
 END IF;
 -- Control-owned fixtures and workers still require an explicit tenant scope.
 PERFORM assert_tenant_storage_capacity(NEW.tenant_id,NEW.bytes,NEW.upload_session_id);
 RETURN NEW;
END $$;
ALTER FUNCTION guard_asset_resource_capacity() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_asset_resource_capacity() FROM PUBLIC;
CREATE TRIGGER a_resource_asset_guard BEFORE INSERT ON asset_versions FOR EACH ROW EXECUTE FUNCTION guard_asset_resource_capacity();

CREATE FUNCTION guard_upload_resource_capacity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.id,NEW.tenant_id,NEW.project_id,NEW.created_by,NEW.mime_type,NEW.size_bytes,NEW.sha256,NEW.part_size,NEW.asset_id,NEW.expected_version,NEW.conversation_id,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.project_id,OLD.created_by,OLD.mime_type,OLD.size_bytes,OLD.sha256,OLD.part_size,OLD.asset_id,OLD.expected_version,OLD.conversation_id,OLD.created_at)
   OR NEW.expires_at>OLD.expires_at OR (OLD.state<>'pending' AND NEW.state<>OLD.state) THEN
   RAISE EXCEPTION 'RESOURCE_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
 ELSIF NEW.state<>'pending' OR NEW.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'UPLOAD_RESERVATION_INVALID' USING ERRCODE='23514';
 ELSE
  PERFORM assert_tenant_storage_capacity(NEW.tenant_id,NEW.size_bytes);
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_upload_resource_capacity() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_upload_resource_capacity() FROM PUBLIC;
CREATE TRIGGER resource_upload_guard BEFORE INSERT OR UPDATE ON upload_sessions FOR EACH ROW EXECUTE FUNCTION guard_upload_resource_capacity();

CREATE FUNCTION check_upload_resource_commit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE u upload_sessions; v asset_versions;
BEGIN
 IF TG_TABLE_NAME='asset_versions' THEN
  IF NEW.upload_session_id IS NULL THEN RETURN NEW; END IF;
  SELECT * INTO u FROM upload_sessions WHERE id=NEW.upload_session_id;
  SELECT * INTO v FROM asset_versions WHERE id=NEW.id;
 ELSE
  IF NEW.state<>'completed' OR OLD.state='completed' THEN RETURN NEW; END IF;
  SELECT * INTO u FROM upload_sessions WHERE id=NEW.id;
  SELECT * INTO v FROM asset_versions WHERE upload_session_id=NEW.id;
 END IF;
 IF u.state IS DISTINCT FROM 'completed' OR v.id IS NULL OR u.result#>>'{version,id}' IS DISTINCT FROM v.id::text
  OR u.result->>'id' IS DISTINCT FROM v.asset_id::text THEN
  RAISE EXCEPTION 'UPLOAD_RESERVATION_INVALID' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION check_upload_resource_commit() OWNER TO cp_control;
REVOKE ALL ON FUNCTION check_upload_resource_commit() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER upload_version_resource_commit AFTER INSERT ON asset_versions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_upload_resource_commit();
CREATE CONSTRAINT TRIGGER upload_session_resource_commit AFTER UPDATE ON upload_sessions DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_upload_resource_commit();

-- A grant change and a resource admission have a common serialization point.
-- Scheduled boundaries are evaluated by clock time, without relying on a worker.
CREATE FUNCTION lock_vip_tenant_resources() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t uuid;
BEGIN
 IF TG_TABLE_NAME='vip_grants' THEN SELECT tenant_id INTO t FROM entitlement_subjects WHERE id=NEW.subject_id;
 ELSE t:=NEW.tenant_id; END IF;
 IF t IS NOT NULL THEN PERFORM pg_advisory_xact_lock(hashtextextended('tenant-resources:'||t::text,0)); END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION lock_vip_tenant_resources() OWNER TO cp_control;
REVOKE ALL ON FUNCTION lock_vip_tenant_resources() FROM PUBLIC;
CREATE TRIGGER a_vip_resource_lock BEFORE INSERT OR UPDATE ON vip_grants FOR EACH ROW EXECUTE FUNCTION lock_vip_tenant_resources();
CREATE TRIGGER a_legacy_resource_lock BEFORE INSERT OR UPDATE ON entitlements FOR EACH ROW EXECUTE FUNCTION lock_vip_tenant_resources();
INSERT INTO schema_migrations(version) VALUES(58);
