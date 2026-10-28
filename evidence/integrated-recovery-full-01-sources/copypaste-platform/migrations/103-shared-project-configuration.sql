-- Shared, immutable project publications. Never backfill consent or change
-- the input of an existing task; old tasks without a reference keep no brief.
CREATE TABLE project_configurations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,project_id uuid NOT NULL UNIQUE,
 name text NOT NULL,draft jsonb NOT NULL,current_version integer,version integer NOT NULL DEFAULT 1 CHECK(version>0),
 content_state text NOT NULL DEFAULT 'active' CHECK(content_state IN('active','quarantined','deleted')),
 moderation_version integer NOT NULL DEFAULT 1,created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),UNIQUE(tenant_id,project_id,id)
);
CREATE TABLE project_configuration_versions (
 configuration_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),tenant_id uuid NOT NULL,project_id uuid NOT NULL,
 body jsonb NOT NULL,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),erased_at timestamptz,
 PRIMARY KEY(configuration_id,version),FOREIGN KEY(tenant_id,project_id,configuration_id) REFERENCES project_configurations(tenant_id,project_id,id)
);
ALTER TABLE project_configurations ADD CONSTRAINT current_project_publication
 FOREIGN KEY(id,current_version) REFERENCES project_configuration_versions(configuration_id,version) DEFERRABLE INITIALLY DEFERRED;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['project_configurations','project_configuration_versions'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY configuration_control ON %I TO cp_control USING(true) WITH CHECK(true)',tab);
  EXECUTE format($policy$CREATE POLICY configuration_read ON %I FOR SELECT TO cp_app USING(
   tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(
    SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id JOIN tenants t ON t.id=m.tenant_id
    JOIN projects p ON p.tenant_id=m.tenant_id AND p.id=%I.project_id
    WHERE m.tenant_id=%I.tenant_id AND m.user_id=nullif(current_setting('app.actor_id',true),'')::uuid
    AND m.status='active' AND u.status='active' AND t.status='active' AND NOT p.archived
    AND (m.role IN('owner','admin') OR EXISTS(SELECT 1 FROM project_members x WHERE x.project_id=p.id AND x.user_id=m.user_id))))$policy$,tab,tab,tab);
  EXECUTE format($policy$CREATE POLICY configuration_insert ON %I FOR INSERT TO cp_app WITH CHECK(
   tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(
    SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id JOIN tenants t ON t.id=m.tenant_id
    JOIN projects p ON p.tenant_id=m.tenant_id AND p.id=%I.project_id
    WHERE m.tenant_id=%I.tenant_id AND m.user_id=nullif(current_setting('app.actor_id',true),'')::uuid
    AND m.status='active' AND u.status='active' AND t.status='active' AND NOT p.archived AND m.role IN('owner','admin')))$policy$,tab,tab,tab);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO cp_app',tab);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO cp_control',tab);
 END LOOP;
END $$;
CREATE POLICY configuration_update ON project_configurations FOR UPDATE TO cp_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id
 WHERE m.tenant_id=project_configurations.tenant_id AND m.user_id=nullif(current_setting('app.actor_id',true),'')::uuid
 AND m.status='active' AND m.role IN('owner','admin') AND u.status='active')) WITH CHECK(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
GRANT UPDATE ON project_configurations TO cp_app;
CREATE FUNCTION guard_project_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.tenant_id,NEW.project_id,NEW.created_by,NEW.id) IS DISTINCT FROM ROW(OLD.tenant_id,OLD.project_id,OLD.created_by,OLD.id) THEN
  RAISE EXCEPTION 'Immutable shared project scope' USING ERRCODE='23514'; END IF;
 IF OLD.content_state='deleted' AND NEW IS DISTINCT FROM OLD THEN RAISE EXCEPTION 'Deleted shared configuration is permanent' USING ERRCODE='23514'; END IF;
 IF NEW.current_version IS DISTINCT FROM OLD.current_version AND NEW.current_version IS DISTINCT FROM coalesce(OLD.current_version,0)+1 THEN
  RAISE EXCEPTION 'Publish consecutive shared versions' USING ERRCODE='23514'; END IF;
 IF ROW(NEW.draft,NEW.current_version) IS DISTINCT FROM ROW(OLD.draft,OLD.current_version) AND NEW.content_state<>'deleted' AND NEW.version<>OLD.version+1 THEN
  RAISE EXCEPTION 'Shared configuration revision is required' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER project_configuration_guard BEFORE UPDATE ON project_configurations FOR EACH ROW EXECUTE FUNCTION guard_project_configuration();
CREATE FUNCTION guard_project_configuration_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND current_user='cp_control' AND NEW.body='{}'::jsonb AND NEW.erased_at IS NOT NULL
  AND EXISTS(SELECT 1 FROM project_configurations c WHERE c.id=NEW.configuration_id AND c.content_state='deleted')
  AND (to_jsonb(NEW)-ARRAY['body','erased_at'])=(to_jsonb(OLD)-ARRAY['body','erased_at']) THEN RETURN NEW; END IF;
 RAISE EXCEPTION 'Shared project versions are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER immutable_project_configuration_version BEFORE UPDATE OR DELETE ON project_configuration_versions FOR EACH ROW EXECUTE FUNCTION guard_project_configuration_version();
CREATE FUNCTION erase_project_configuration() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.content_state='deleted' AND OLD.content_state<>'deleted' THEN
  UPDATE project_configuration_versions SET body='{}',erased_at=clock_timestamp() WHERE configuration_id=NEW.id AND erased_at IS NULL;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION erase_project_configuration() OWNER TO cp_control;
REVOKE ALL ON FUNCTION erase_project_configuration() FROM PUBLIC;
CREATE TRIGGER erase_project_configuration AFTER UPDATE OF content_state ON project_configurations FOR EACH ROW EXECUTE FUNCTION erase_project_configuration();

-- Only lock connector rows selected by a current administrator in this project.
-- cp_app keeps SELECT-only privileges on profiles, including encrypted cursors.
CREATE FUNCTION lock_project_configuration_connectors(connection_ids uuid[],scope_tenant uuid,scope_project uuid)
 RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
BEGIN
 IF connection_ids IS NULL OR cardinality(connection_ids)>12 OR array_position(connection_ids,NULL) IS NOT NULL
  OR scope_tenant IS DISTINCT FROM nullif(current_setting('app.tenant_id',true),'')::uuid
  OR NOT EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id JOIN tenants t ON t.id=m.tenant_id
   JOIN projects p ON p.tenant_id=m.tenant_id WHERE m.tenant_id=scope_tenant AND p.id=scope_project AND NOT p.archived
   AND m.user_id=nullif(current_setting('app.actor_id',true),'')::uuid AND m.status='active' AND u.status='active'
   AND t.status='active' AND m.role IN('owner','admin')) THEN
  RAISE EXCEPTION 'A current project administrator is required' USING ERRCODE='42501'; END IF;
 PERFORM c.id FROM connections c JOIN connector_profiles p ON p.connection_id=c.id
  WHERE c.id=ANY(connection_ids) AND c.tenant_id=scope_tenant AND scope_project=ANY(p.project_ids)
  ORDER BY c.id FOR SHARE OF c,p;
END $$;
ALTER FUNCTION lock_project_configuration_connectors(uuid[],uuid,uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION lock_project_configuration_connectors(uuid[],uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_project_configuration_connectors(uuid[],uuid,uuid) TO cp_app;

CREATE FUNCTION project_configuration_available(target uuid,revision integer,digest text,scope_tenant uuid,scope_project uuid)
 RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE b jsonb; r jsonb; a jsonb;
BEGIN
 SELECT v.body INTO b FROM project_configurations c JOIN project_configuration_versions v ON v.configuration_id=c.id
 WHERE c.id=target AND c.tenant_id=scope_tenant AND c.project_id=scope_project AND c.content_state='active'
 AND v.version=revision AND v.sha256=digest AND v.erased_at IS NULL;
 IF b IS NULL THEN RETURN false; END IF;
 a:=b->'resolved'->'default_agent';
 IF a IS NOT NULL AND a<>'null'::jsonb THEN
  IF NOT EXISTS(SELECT 1 FROM agents x JOIN agent_versions v ON v.agent_id=x.id AND v.version=(a->>'version')::int
   WHERE x.id=(a->>'id')::uuid AND x.tenant_id=scope_tenant AND x.project_id=scope_project AND x.content_state='active'
   AND v.body->>'kernel'='codex' AND v.body->>'role_hash'=a->>'role_hash') THEN RETURN false; END IF;
  FOR r IN SELECT value FROM jsonb_array_elements(a->'skills') LOOP
   IF NOT EXISTS(SELECT 1 FROM skill_installations i JOIN skill_versions s ON s.id=i.skill_version_id
    WHERE i.id=(r->>'installation_id')::uuid AND i.tenant_id=scope_tenant AND i.project_id=scope_project
    AND i.skill_version_id=(r->>'skill_version_id')::uuid AND i.state='installed' AND s.state='verified'
    AND s.content_hash=r->>'content_hash') THEN RETURN false; END IF;
  END LOOP;
 END IF;
 IF b->'brand'<>'null'::jsonb AND NOT brand_version_available((b->'brand'->>'id')::uuid,(b->'brand'->>'version')::int) THEN RETURN false; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(b->'resolved'->'resources') LOOP
  IF NOT EXISTS(SELECT 1 FROM asset_versions v JOIN assets x ON x.id=v.asset_id WHERE v.id=(r->>'asset_version_id')::uuid
   AND x.tenant_id=scope_tenant AND x.project_id=scope_project AND x.private_owner IS NULL AND x.state='active'
   AND x.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL AND v.sha256=r->>'sha256') THEN RETURN false; END IF;
 END LOOP;
 FOR r IN SELECT value FROM jsonb_array_elements(b->'resolved'->'connections') LOOP
  IF NOT EXISTS(SELECT 1 FROM connections c JOIN connector_profiles p ON p.connection_id=c.id
   WHERE c.id=(r->>'id')::uuid AND c.tenant_id=scope_tenant AND c.state='connected'
   AND p.auth_version=(r->>'auth_version')::int AND scope_project=ANY(p.project_ids) AND p.catalog_state='complete'
   AND p.configuration_hash=r->>'configuration_hash'
   AND (SELECT array_agg(x ORDER BY x) FROM unnest(p.account_ids) x)=(SELECT array_agg(x ORDER BY x) FROM jsonb_array_elements_text(r->'account_ids') x)) THEN RETURN false; END IF;
 END LOOP;
 RETURN true;
END $$;
ALTER FUNCTION project_configuration_available(uuid,integer,text,uuid,uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION project_configuration_available(uuid,integer,text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION project_configuration_available(uuid,integer,text,uuid,uuid) TO cp_app,cp_control;

CREATE FUNCTION guard_task_project_configuration() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ref jsonb:=NEW.input_context->'project_configuration'; limit_micros numeric;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ref IS DISTINCT FROM OLD.input_context->'project_configuration' THEN RAISE EXCEPTION 'Task shared configuration is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF ref IS NULL THEN RETURN NEW; END IF;
 IF NOT project_configuration_available((ref->>'id')::uuid,(ref->>'version')::integer,ref->>'sha256',NEW.tenant_id,NEW.project_id) THEN
  RAISE EXCEPTION 'Task shared configuration unavailable' USING ERRCODE='23514'; END IF;
 SELECT (body->>'max_task_budget_micros')::numeric INTO limit_micros FROM project_configuration_versions
  WHERE configuration_id=(ref->>'id')::uuid AND version=(ref->>'version')::integer;
 IF limit_micros IS NOT NULL AND NEW.budget_micros>limit_micros THEN RAISE EXCEPTION 'Project budget limit exceeded' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task_project_configuration_guard BEFORE INSERT OR UPDATE OF input_context ON tasks FOR EACH ROW EXECUTE FUNCTION guard_task_project_configuration();

CREATE FUNCTION project_configuration_source_manifest(source tasks) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE ref jsonb:=source.input_context->'project_configuration'; b jsonb; a jsonb; r jsonb; refs jsonb:='[]'; versions jsonb:='[]';
BEGIN
 IF ref IS NULL THEN RETURN jsonb_build_object('targets',refs,'asset_version_ids',versions); END IF;
 IF NOT project_configuration_available((ref->>'id')::uuid,(ref->>'version')::int,ref->>'sha256',source.tenant_id,source.project_id) THEN RETURN NULL; END IF;
 SELECT body INTO b FROM project_configuration_versions WHERE configuration_id=(ref->>'id')::uuid AND version=(ref->>'version')::int;
 refs:=refs||jsonb_build_array(jsonb_build_object('kind','project_configurations','id',ref->>'id'));
 a:=b->'resolved'->'default_agent';
 IF a IS NOT NULL AND a<>'null'::jsonb THEN refs:=refs||jsonb_build_array(jsonb_build_object('kind','agents','id',a->>'id')); END IF;
 IF b->'brand'<>'null'::jsonb THEN refs:=refs||jsonb_build_array(jsonb_build_object('kind','brand_profiles','id',b->'brand'->>'id')); END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(b->'resolved'->'resources') LOOP versions:=versions||jsonb_build_array(r->>'asset_version_id'); END LOOP;
 FOR r IN SELECT value FROM jsonb_array_elements(b->'resolved'->'connections') LOOP refs:=refs||jsonb_build_array(jsonb_build_object('kind','connections','id',r->>'id')); END LOOP;
 RETURN jsonb_build_object('targets',refs,'asset_version_ids',versions);
END $$;
ALTER FUNCTION project_configuration_source_manifest(tasks) OWNER TO cp_control;
REVOKE ALL ON FUNCTION project_configuration_source_manifest(tasks) FROM PUBLIC;

-- Retain the current traversal OID and every previous source branch. Insert at
-- every task visit, so derived outputs and explicit publications inherit the
-- same revocation/expiry policy, including indirect reads.
DO $$ DECLARE definition text; anchor text; hook text; BEGIN
 definition:=pg_get_functiondef('content_source_manifest_before_creative_feedback(uuid,uuid,uuid[],uuid[])'::regprocedure);
 anchor:='   IF source_task.input_context ? ''agent_id'' THEN';
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Unexpected project source traversal'; END IF;
 hook:=$hook$   DECLARE shared_sources jsonb; BEGIN
    shared_sources:=project_configuration_source_manifest(source_task);
    IF shared_sources IS NULL THEN RETURN NULL; END IF;
    targets:=targets||(shared_sources->'targets');
    pending_versions:=pending_versions||ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(shared_sources->'asset_version_ids'));
   END;
$hook$;
 EXECUTE replace(definition,anchor,hook||anchor);
 definition:=pg_get_functiondef('lock_task_content_sources(uuid)'::regprocedure);
 anchor:='''geo_samples'']';
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Missing project source lock anchor'; END IF;
 EXECUTE replace(definition,anchor,'''geo_samples'',''project_configurations'']');
END $$;
INSERT INTO schema_migrations(version) VALUES(103);
