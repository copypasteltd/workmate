-- Historical tasks have no evidence of their original model/rate selection.
-- Do not backfill those selections from today's environment.
CREATE TABLE task_runtime_bindings (
 task_id uuid PRIMARY KEY,
 tenant_id uuid NOT NULL REFERENCES tenants(id),
 runtime_profile_id uuid NOT NULL REFERENCES codex_runtime_profiles(id),
 capability_version_ids uuid[] NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,task_id) REFERENCES tasks(tenant_id,id),
 CHECK(cardinality(capability_version_ids) BETWEEN 1 AND 8),
 CHECK(array_position(capability_version_ids,NULL) IS NULL)
);

-- SELECT ... FOR SHARE requires UPDATE privilege. cp_app must never gain the
-- ability to change a global profile or revoke another tenant's capabilities.
-- This function returns no data and provides only bounded row locking.
CREATE FUNCTION lock_task_capability_versions(runtime_id uuid, capability_ids uuid[]) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF runtime_id IS NULL OR capability_ids IS NULL OR cardinality(capability_ids) NOT BETWEEN 1 AND 8
  OR array_position(capability_ids,NULL) IS NOT NULL THEN
  RAISE EXCEPTION 'Invalid bounded capability lock' USING ERRCODE='23514';
 END IF;
 PERFORM id FROM public.codex_runtime_profiles WHERE id=runtime_id FOR SHARE;
 PERFORM id FROM public.internal_capability_versions WHERE id=ANY(capability_ids) ORDER BY id FOR SHARE;
END $$;
REVOKE ALL ON FUNCTION lock_task_capability_versions(uuid,uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_task_capability_versions(uuid,uuid[]) TO cp_app,cp_control;

CREATE FUNCTION guard_task_runtime_binding() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE task_mode text; profile codex_runtime_profiles; n integer;
BEGIN
 IF TG_OP<>'INSERT' THEN
  RAISE EXCEPTION 'Immutable task runtime and pricing binding' USING ERRCODE='23514';
 END IF;
 SELECT data_mode INTO task_mode FROM tasks WHERE id=NEW.task_id AND tenant_id=NEW.tenant_id
  AND status IN ('queued','needs_input') AND attempt=0;
 PERFORM lock_task_capability_versions(NEW.runtime_profile_id,NEW.capability_version_ids);
 SELECT * INTO profile FROM codex_runtime_profiles WHERE id=NEW.runtime_profile_id;
 IF task_mode IS NULL OR profile.id IS NULL OR profile.state<>'enabled' OR profile.kernel<>'codex'
  OR profile.transport<>'stdio' OR profile.gateway_policy<>'company_internal_only' OR profile.automatic_fallback THEN
  RAISE EXCEPTION 'Unavailable pinned Codex profile' USING ERRCODE='23514';
 END IF;
 SELECT count(DISTINCT profile_key) INTO n FROM internal_capability_versions
  WHERE id=ANY(NEW.capability_version_ids) AND data_mode=task_mode AND NOT revoked
   AND body->>'schema_version'='2' AND body->>'gateway_policy'='company_internal_only';
 IF n<>cardinality(NEW.capability_version_ids) OR NOT EXISTS(
  SELECT 1 FROM internal_capability_versions WHERE id=ANY(NEW.capability_version_ids)
   AND profile_key='internal-text-v1' AND ready
 ) THEN
  RAISE EXCEPTION 'Unavailable or ambiguous task capability versions' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_task_runtime_binding BEFORE INSERT OR UPDATE OR DELETE ON task_runtime_bindings
 FOR EACH ROW EXECUTE FUNCTION guard_task_runtime_binding();
ALTER TABLE task_runtime_bindings ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_runtime_bindings FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_binding_tenant_scope ON task_runtime_bindings
 USING(current_user='cp_control' OR tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(current_user='cp_control' OR tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY runtime_binding_task_visibility ON task_runtime_bindings AS RESTRICTIVE FOR ALL TO cp_app
 USING(EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id))
 WITH CHECK(EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id));
GRANT SELECT,INSERT ON task_runtime_bindings TO cp_app,cp_control;
INSERT INTO schema_migrations(version) VALUES(63);
