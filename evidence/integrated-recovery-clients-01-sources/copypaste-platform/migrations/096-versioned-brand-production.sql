-- Published SQL001-095 are immutable. Preserve only the current legacy
-- snapshot; historical brand bodies that were never stored are not invented.
CREATE TABLE brand_profile_versions (
 brand_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),tenant_id uuid NOT NULL,project_id uuid NOT NULL,
 name text NOT NULL,body jsonb NOT NULL,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 created_by uuid REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT clock_timestamp(),erased_at timestamptz,
 PRIMARY KEY(brand_id,version),FOREIGN KEY(tenant_id,brand_id) REFERENCES brand_profiles(tenant_id,id),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
CREATE TABLE brand_version_assets (
 brand_id uuid NOT NULL,version integer NOT NULL,tenant_id uuid NOT NULL,project_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('font','logo')),source_key text NOT NULL,asset_version_id uuid NOT NULL REFERENCES asset_versions(id),
 PRIMARY KEY(brand_id,version,kind,source_key),FOREIGN KEY(brand_id,version) REFERENCES brand_profile_versions(brand_id,version)
);
INSERT INTO brand_profile_versions(brand_id,version,tenant_id,project_id,name,body,sha256,created_at,erased_at)
 SELECT id,version,tenant_id,project_id,name,CASE WHEN content_state='deleted' THEN '{}'::jsonb ELSE body END,
 encode(digest(jsonb_build_object('name',name,'body',body)::text,'sha256'),'hex'),created_at,
 CASE WHEN content_state='deleted' THEN clock_timestamp() END FROM brand_profiles;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['brand_profile_versions','brand_version_assets'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY brand_control ON %I TO cp_control USING(true) WITH CHECK(true)',tab);
  EXECUTE format($policy$CREATE POLICY brand_read ON %I FOR SELECT TO cp_app USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id WHERE m.user_id=nullif(current_setting('app.actor_id',true),'')::uuid AND m.tenant_id=%I.tenant_id AND m.status='active' AND u.status='active' AND (m.role IN('owner','admin') OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=%I.project_id AND pm.user_id=m.user_id))))$policy$,tab,tab,tab);
  EXECUTE format('GRANT SELECT ON %I TO cp_app',tab);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO cp_control',tab);
 END LOOP;
END $$;
CREATE FUNCTION guard_brand_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND TG_TABLE_NAME='brand_profile_versions' THEN
  IF current_setting('app.erasing_brand',true)='true' AND NEW.body='{}'::jsonb AND NEW.name='[deleted]' AND NEW.erased_at IS NOT NULL
   AND (to_jsonb(NEW)-ARRAY['body','name','erased_at'])=(to_jsonb(OLD)-ARRAY['body','name','erased_at']) THEN RETURN NEW; END IF;
 END IF;
 RAISE EXCEPTION 'Brand versions and source bindings are immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER brand_version_immutable BEFORE UPDATE OR DELETE ON brand_profile_versions FOR EACH ROW EXECUTE FUNCTION guard_brand_version();
CREATE TRIGGER brand_source_immutable BEFORE UPDATE OR DELETE ON brand_version_assets FOR EACH ROW EXECUTE FUNCTION guard_brand_version();
CREATE FUNCTION snapshot_brand_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r record; source asset_versions; asset assets;
BEGIN
 IF TG_OP='UPDATE' AND NEW.content_state='deleted' THEN
  PERFORM set_config('app.erasing_brand','true',true);
  UPDATE brand_profile_versions SET body='{}',name='[deleted]',erased_at=clock_timestamp() WHERE brand_id=NEW.id AND erased_at IS NULL;
  PERFORM set_config('app.erasing_brand','false',true);
  RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND NEW.version=OLD.version THEN
  IF ROW(NEW.body,NEW.name) IS DISTINCT FROM ROW(OLD.body,OLD.name) THEN RAISE EXCEPTION 'Publish a new brand version' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF (TG_OP='UPDATE' AND (NEW.version<>OLD.version+1 OR OLD.content_state<>'active')) OR (TG_OP='INSERT' AND NEW.version<>1) THEN
  RAISE EXCEPTION 'Brand versions must be consecutive publications' USING ERRCODE='23514'; END IF;
 INSERT INTO brand_profile_versions(brand_id,version,tenant_id,project_id,name,body,sha256,created_by)
 VALUES(NEW.id,NEW.version,NEW.tenant_id,NEW.project_id,NEW.name,NEW.body,
  encode(digest(jsonb_build_object('name',NEW.name,'body',NEW.body)::text,'sha256'),'hex'),nullif(current_setting('app.actor_id',true),'')::uuid);
 IF NEW.body->>'schema_version'='2' THEN
  FOR r IN SELECT 'logo' AS kind,x->>'key' AS source_key,x AS source FROM jsonb_array_elements(NEW.body->'logos') x
   UNION ALL SELECT 'font',x->>'key',x->'source' FROM jsonb_array_elements(NEW.body->'font_bindings') x WHERE x->'source' ? 'asset_id' LOOP
   SELECT * INTO source FROM asset_versions v WHERE v.asset_id=(r.source->>'asset_id')::uuid AND v.version=(r.source->>'version')::int;
   SELECT * INTO asset FROM assets a WHERE a.id=source.asset_id FOR SHARE;
   IF asset.id IS NULL OR asset.tenant_id<>NEW.tenant_id OR asset.project_id<>NEW.project_id OR asset.private_owner IS NOT NULL OR asset.state<>'active' OR source.erased_at IS NOT NULL OR asset.retention_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Brand sources must be active shared project versions' USING ERRCODE='23514'; END IF;
   INSERT INTO brand_version_assets(brand_id,version,tenant_id,project_id,kind,source_key,asset_version_id)
    VALUES(NEW.id,NEW.version,NEW.tenant_id,NEW.project_id,r.kind,r.source_key,source.id);
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION snapshot_brand_version() OWNER TO cp_control;
REVOKE ALL ON FUNCTION snapshot_brand_version() FROM PUBLIC;
CREATE TRIGGER brand_version_snapshot AFTER INSERT OR UPDATE ON brand_profiles FOR EACH ROW EXECUTE FUNCTION snapshot_brand_version();
CREATE FUNCTION brand_version_available(brand uuid,revision integer) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT EXISTS(SELECT 1 FROM brand_profiles b JOIN brand_profile_versions v ON v.brand_id=b.id AND v.version=revision
  WHERE b.id=brand AND b.content_state='active' AND v.erased_at IS NULL
  AND NOT EXISTS(SELECT 1 FROM brand_version_assets d LEFT JOIN asset_versions x ON x.id=d.asset_version_id LEFT JOIN assets a ON a.id=x.asset_id
   WHERE d.brand_id=b.id AND d.version=revision AND (a.id IS NULL OR a.tenant_id<>b.tenant_id OR a.project_id<>b.project_id
    OR a.private_owner IS NOT NULL OR a.state<>'active' OR a.retention_expires_at<=clock_timestamp() OR x.erased_at IS NOT NULL)))
$$;
ALTER FUNCTION brand_version_available(uuid,integer) OWNER TO cp_control;
REVOKE ALL ON FUNCTION brand_version_available(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION brand_version_available(uuid,integer) TO cp_app,cp_control;

-- Retain every Stage77 lineage branch and add fixed brand dependencies.
CREATE OR REPLACE FUNCTION content_source_manifest(scope_tenant uuid,scope_project uuid,task_ids uuid[],version_ids uuid[]) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE pending_tasks uuid[]:=task_ids; pending_versions uuid[]:=version_ids; seen_tasks uuid[]:='{}'; seen_versions uuid[]:='{}';
 pending_sources jsonb[]:='{}'; seen_workflows text[]:='{}';
 tid uuid; vid uuid; source_task tasks; source_asset assets; source_version asset_versions; d record; r record; m record; av jsonb; targets jsonb:='[]'; more uuid[]; publication jsonb; bucket text;
BEGIN
 WHILE cardinality(pending_tasks)>0 OR cardinality(pending_versions)>0 OR cardinality(pending_sources)>0 LOOP
  IF cardinality(seen_tasks)+cardinality(seen_versions)+cardinality(seen_workflows)>4096 THEN RETURN NULL; END IF;
  IF cardinality(pending_tasks)>0 THEN
   tid:=pending_tasks[1]; pending_tasks:=pending_tasks[2:];
   IF tid=ANY(seen_tasks) THEN CONTINUE; END IF;
   seen_tasks:=array_append(seen_tasks,tid);
   SELECT * INTO source_task FROM tasks WHERE id=tid AND tenant_id=scope_tenant AND project_id=scope_project;
   IF source_task.id IS NULL OR source_task.content_state<>'active' OR (source_task.status IN('succeeded','failed','cancelled') AND source_task.retention_expires_at<=clock_timestamp()) THEN RETURN NULL; END IF;
   FOR r IN SELECT x.*,v.source_refs FROM native_workflow_reads x JOIN workflow_versions v ON v.workflow_id=x.workflow_id AND v.version=x.version WHERE x.task_id=source_task.id LOOP
    IF NOT EXISTS(SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workflow_id=w.id AND v.version=r.version
     WHERE w.id=r.workflow_id AND w.tenant_id=scope_tenant AND w.project_id=scope_project
      AND w.private_owner=source_task.private_owner AND w.content_state='active') THEN RETURN NULL; END IF;
    targets:=targets||jsonb_build_array(jsonb_build_object('kind','workflows','id',r.workflow_id));
    IF NOT (r.workflow_id::text||':'||r.version::text)=ANY(seen_workflows) THEN
     seen_workflows:=array_append(seen_workflows,r.workflow_id::text||':'||r.version::text);
     pending_sources:=array_append(pending_sources,r.source_refs);
    END IF;
   END LOOP;
   FOR r IN SELECT * FROM workflow_runs WHERE execution_location='desktop'
    AND (origin_task_id=source_task.id OR id=source_task.desktop_workflow_run_id) LOOP
    IF r.tenant_id<>scope_tenant OR r.project_id<>scope_project OR r.private_owner IS DISTINCT FROM source_task.private_owner
     OR r.content_state<>'active' OR NOT EXISTS(SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workflow_id=w.id AND v.version=r.workflow_version
       WHERE w.id=r.workflow_id AND w.content_state='active' AND w.private_owner=r.private_owner AND v.published_at IS NOT NULL
        AND v.definition=r.definition AND v.role_hashes=r.role_hashes) THEN RETURN NULL; END IF;
    targets:=targets||jsonb_build_array(jsonb_build_object('kind','workflows','id',r.workflow_id),jsonb_build_object('kind','workflow_runs','id',r.id));
    IF NOT (r.workflow_id::text||':'||r.workflow_version::text)=ANY(seen_workflows) THEN
     seen_workflows:=array_append(seen_workflows,r.workflow_id::text||':'||r.workflow_version::text);
     SELECT v.source_refs INTO publication FROM workflow_versions v WHERE v.workflow_id=r.workflow_id AND v.version=r.workflow_version;
     pending_sources:=array_append(pending_sources,publication);
    END IF;
    SELECT coalesce(array_agg(x.id),'{}') INTO more FROM tasks x WHERE x.desktop_workflow_run_id=r.id;
    pending_tasks:=pending_tasks||more||ARRAY[r.origin_task_id];
   END LOOP;
   IF NOT EXISTS(SELECT 1 FROM memberships x JOIN users u ON u.id=x.user_id JOIN tenants z ON z.id=x.tenant_id JOIN projects p ON p.id=source_task.project_id
    WHERE x.tenant_id=source_task.tenant_id AND x.user_id=source_task.created_by AND x.status='active' AND u.status='active' AND z.status='active' AND NOT p.archived
    AND (x.role IN('owner','admin') OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=x.user_id))) THEN RETURN NULL; END IF;
   IF source_task.conversation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM conversations c WHERE c.id=source_task.conversation_id AND c.content_state='active' AND c.created_by=source_task.created_by) THEN RETURN NULL; END IF;
   IF source_task.input_context ? 'agent_id' THEN
    SELECT v.body INTO av FROM agents x JOIN agent_versions v ON v.agent_id=x.id AND v.version=(source_task.input_context->>'agent_version')::int
     WHERE x.id=(source_task.input_context->>'agent_id')::uuid AND x.tenant_id=source_task.tenant_id AND x.project_id=source_task.project_id AND x.content_state='active';
    IF av IS NULL THEN RETURN NULL; END IF;
    targets:=targets||jsonb_build_array(jsonb_build_object('kind','agents','id',source_task.input_context->>'agent_id'));
    IF av->'brand'->>'id' IS NOT NULL THEN
     IF NOT EXISTS(SELECT 1 FROM brand_profiles b WHERE b.id=(av->'brand'->>'id')::uuid AND b.tenant_id=source_task.tenant_id AND b.project_id=source_task.project_id AND b.content_state='active') THEN RETURN NULL; END IF;
     targets:=targets||jsonb_build_array(jsonb_build_object('kind','brand_profiles','id',av->'brand'->>'id'));
     IF NOT brand_version_available((av->'brand'->>'id')::uuid,(av->'brand'->>'version')::int) THEN RETURN NULL; END IF;
     SELECT coalesce(array_agg(x.asset_version_id),'{}') INTO more FROM brand_version_assets x WHERE x.brand_id=(av->'brand'->>'id')::uuid AND x.version=(av->'brand'->>'version')::int;
     pending_versions:=pending_versions||more;
    END IF;
    FOR r IN SELECT * FROM jsonb_to_recordset(coalesce(source_task.input_context->'memories','[]')) AS x(id uuid,version int) LOOP
     SELECT x.*,v.content INTO m FROM memories x JOIN memory_versions v ON v.memory_id=x.id AND v.version=r.version
      WHERE x.id=r.id AND x.tenant_id=source_task.tenant_id AND x.content_state='active' AND (x.expires_at IS NULL OR x.expires_at>clock_timestamp());
     IF m.id IS NULL OR m.content IS NULL OR (m.scope='tenant' OR (m.scope='personal' AND m.private_owner=source_task.created_by)
      OR (m.scope='project' AND m.project_id=source_task.project_id) OR (m.scope='brand' AND m.project_id=source_task.project_id AND m.brand_id=(av->'brand'->>'id')::uuid)
      OR (m.scope='conversation' AND m.project_id=source_task.project_id AND m.conversation_id=source_task.conversation_id AND m.private_owner=source_task.created_by)) IS NOT TRUE THEN RETURN NULL; END IF;
     targets:=targets||jsonb_build_array(jsonb_build_object('kind','memories','id',r.id));
    END LOOP;
   END IF;
   FOR r IN SELECT * FROM jsonb_to_recordset(coalesce(source_task.input_context->'history','[]')) AS x(id uuid) LOOP
    SELECT x.* INTO m FROM conversation_messages x WHERE x.id=r.id AND x.conversation_id=source_task.conversation_id;
    IF m.id IS NULL THEN RETURN NULL; END IF;
    IF m.role='assistant' AND m.task_id IS NOT NULL THEN pending_tasks:=array_append(pending_tasks,m.task_id); END IF;
   END LOOP;
   SELECT coalesce(array_agg(p.task_id),'{}') INTO more FROM task_plans p WHERE p.approved_task_id=source_task.id;
   pending_tasks:=pending_tasks||more;
   IF source_task.input_context ? 'plan_source_task_id' THEN
    IF NOT(source_task.input_context->>'plan_source_task_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN RETURN NULL; END IF;
    pending_tasks:=array_append(pending_tasks,(source_task.input_context->>'plan_source_task_id')::uuid);
   END IF;
   -- Only consumed inputs constrain a retained result. The initial input
   -- checkpoint must remain usable for a fresh authorized selection.
   IF source_task.attempt>0 THEN
    FOR d IN SELECT * FROM task_dependencies WHERE task_id=source_task.id AND state='resolved' LOOP
     IF d.kind='file' THEN
      IF EXISTS(SELECT 1 FROM unnest(d.resource_ids) x(id) LEFT JOIN asset_versions v ON v.id=x.id LEFT JOIN assets a ON a.id=v.asset_id
       WHERE a.id IS NULL OR a.tenant_id<>source_task.tenant_id OR a.project_id<>source_task.project_id OR (a.private_owner IS NOT NULL AND (a.private_owner IS DISTINCT FROM source_task.created_by OR a.private_owner IS DISTINCT FROM source_task.private_owner))) THEN RETURN NULL; END IF;
      pending_versions:=pending_versions||d.resource_ids;
     ELSE
      IF cardinality(d.resource_ids)<>1 OR NOT EXISTS(SELECT 1 FROM connections c WHERE c.id=d.resource_ids[1] AND c.tenant_id=source_task.tenant_id AND c.project_id=source_task.project_id AND c.state='connected' AND c.provider=d.provider) THEN RETURN NULL; END IF;
      targets:=targets||jsonb_build_array(jsonb_build_object('kind','connections','id',d.resource_ids[1]));
     END IF;
    END LOOP;
   END IF;
   FOR r IN SELECT * FROM task_source_reads WHERE task_id=source_task.id LOOP
    IF r.kind='dataset' THEN
     SELECT * INTO d FROM analytics_datasets x WHERE x.id=r.resource_id AND x.tenant_id=source_task.tenant_id AND x.project_id=source_task.project_id
      AND x.content_state='active' AND x.source_state='active' AND x.retention_expires_at>clock_timestamp();
     IF d.id IS NULL THEN RETURN NULL; END IF;
     targets:=targets||jsonb_build_array(jsonb_build_object('kind','analytics_datasets','id',d.id));
     IF d.source_asset_version_id IS NOT NULL THEN pending_versions:=array_append(pending_versions,d.source_asset_version_id); END IF;
    ELSE
     IF NOT EXISTS(SELECT 1 FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=r.asset_version_id AND v.sha256=r.sha256
      AND a.tenant_id=source_task.tenant_id AND a.project_id=source_task.project_id AND (a.private_owner IS NULL OR (a.private_owner=source_task.created_by AND a.private_owner=source_task.private_owner))) THEN RETURN NULL; END IF;
     IF r.kind='cloud_reference' THEN
      SELECT n.id,n.workspace_id INTO m FROM workspace_nodes n JOIN cloud_workspaces w ON w.id=n.workspace_id WHERE n.id=r.resource_id
       AND n.asset_version_id=r.asset_version_id AND n.content_state='active' AND n.reference_state='ready' AND w.content_state='active'
       AND w.tenant_id=source_task.tenant_id AND w.project_id=source_task.project_id AND (w.private_owner IS NULL OR (w.private_owner=source_task.created_by AND w.conversation_id=source_task.conversation_id));
      IF m.id IS NULL THEN RETURN NULL; END IF;
      targets:=targets||jsonb_build_array(jsonb_build_object('kind','workspace_nodes','id',m.id),jsonb_build_object('kind','cloud_workspaces','id',m.workspace_id));
     END IF;
     pending_versions:=array_append(pending_versions,r.asset_version_id);
    END IF;
   END LOOP;
   IF source_task.conversation_id IS NOT NULL THEN targets:=targets||jsonb_build_array(jsonb_build_object('kind','conversations','id',source_task.conversation_id)); END IF;
  ELSIF cardinality(pending_versions)>0 THEN
   vid:=pending_versions[1]; pending_versions:=pending_versions[2:];
   IF vid=ANY(seen_versions) THEN CONTINUE; END IF;
   seen_versions:=array_append(seen_versions,vid);
   SELECT * INTO source_version FROM asset_versions WHERE id=vid;
   SELECT * INTO source_asset FROM assets WHERE id=source_version.asset_id;
   IF source_asset.id IS NULL OR source_asset.tenant_id<>scope_tenant OR source_asset.project_id<>scope_project OR source_asset.state<>'active' OR source_asset.retention_expires_at<=clock_timestamp()
    OR source_version.erased_at IS NOT NULL OR NOT analysis_asset_available(source_asset.id) OR NOT matrix_asset_available(source_asset.id) OR NOT video_asset_available(source_asset.id) THEN RETURN NULL; END IF;
   targets:=targets||jsonb_build_array(jsonb_build_object('kind','assets','id',source_asset.id));
   IF source_version.metadata ? 'brand_reference' THEN
    av:=source_version.metadata->'brand_reference';
    IF NOT EXISTS(SELECT 1 FROM brand_profiles b WHERE b.id=(av->>'id')::uuid AND b.tenant_id=scope_tenant AND b.project_id=scope_project)
     OR NOT brand_version_available((av->>'id')::uuid,(av->>'version')::int) THEN RETURN NULL; END IF;
    targets:=targets||jsonb_build_array(jsonb_build_object('kind','brand_profiles','id',av->>'id'));
    SELECT coalesce(array_agg(x.asset_version_id),'{}') INTO more FROM brand_version_assets x WHERE x.brand_id=(av->>'id')::uuid AND x.version=(av->>'version')::int;
    pending_versions:=pending_versions||more;
   END IF;
   IF source_version.metadata ? 'publication_sources' THEN
    pending_sources:=array_append(pending_sources,source_version.metadata->'publication_sources');
   END IF;
   IF source_version.metadata ? 'task_id' THEN
    IF NOT(source_version.metadata->>'task_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN RETURN NULL; END IF;
    pending_tasks:=array_append(pending_tasks,(source_version.metadata->>'task_id')::uuid);
   END IF;
   IF source_version.metadata ? 'publication_source_version_id' THEN
    IF NOT(source_version.metadata->>'publication_source_version_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN RETURN NULL; END IF;
    pending_versions:=array_append(pending_versions,(source_version.metadata->>'publication_source_version_id')::uuid);
   END IF;
  ELSE
   publication:=pending_sources[1]; pending_sources:=pending_sources[2:];
    IF publication->>'schema' IS DISTINCT FROM '1' THEN RETURN NULL; END IF;
    FOREACH bucket IN ARRAY ARRAY['versions','datasets','memories','brands','connections','cloud_references'] LOOP
     IF jsonb_typeof(publication->bucket) IS DISTINCT FROM 'array' THEN RETURN NULL; END IF;
    END LOOP;
    SELECT coalesce(array_agg(value::uuid),'{}') INTO more FROM jsonb_array_elements_text(publication->'versions'); pending_versions:=pending_versions||more;
    FOR r IN SELECT value::uuid AS id FROM jsonb_array_elements_text(publication->'datasets') LOOP
     SELECT * INTO d FROM analytics_datasets x WHERE x.id=r.id AND x.tenant_id=scope_tenant AND x.project_id=scope_project
      AND x.content_state='active' AND x.source_state='active' AND x.retention_expires_at>clock_timestamp();
     IF d.id IS NULL THEN RETURN NULL; END IF;
     targets:=targets||jsonb_build_array(jsonb_build_object('kind','analytics_datasets','id',d.id));
     IF d.source_asset_version_id IS NOT NULL THEN pending_versions:=array_append(pending_versions,d.source_asset_version_id); END IF;
    END LOOP;
    FOR r IN SELECT * FROM jsonb_to_recordset(publication->'memories') AS x(id uuid,version int,scope text,project_id uuid,brand_id uuid,conversation_id uuid,private_owner uuid) LOOP
     SELECT x.*,v.content INTO m FROM memories x JOIN memory_versions v ON v.memory_id=x.id AND v.version=r.version WHERE x.id=r.id AND x.tenant_id=scope_tenant;
     IF m.id IS NULL OR m.content IS NULL OR m.content_state<>'active' OR (m.expires_at IS NOT NULL AND m.expires_at<=clock_timestamp())
      OR ROW(m.scope,m.project_id,m.brand_id,m.conversation_id,m.private_owner) IS DISTINCT FROM ROW(r.scope,r.project_id,r.brand_id,r.conversation_id,r.private_owner) THEN RETURN NULL; END IF;
     targets:=targets||jsonb_build_array(jsonb_build_object('kind','memories','id',m.id));
    END LOOP;
    FOR r IN SELECT value::uuid AS id FROM jsonb_array_elements_text(publication->'brands') LOOP
     IF NOT EXISTS(SELECT 1 FROM brand_profiles x WHERE x.id=r.id AND x.tenant_id=scope_tenant AND x.project_id=scope_project AND x.content_state='active') THEN RETURN NULL; END IF;
     targets:=targets||jsonb_build_array(jsonb_build_object('kind','brand_profiles','id',r.id));
    END LOOP;
    FOR r IN SELECT * FROM jsonb_to_recordset(publication->'connections') AS x(id uuid,provider text) LOOP
     IF NOT EXISTS(SELECT 1 FROM connections x WHERE x.id=r.id AND x.tenant_id=scope_tenant AND x.project_id=scope_project AND x.provider=r.provider AND x.state='connected') THEN RETURN NULL; END IF;
     targets:=targets||jsonb_build_array(jsonb_build_object('kind','connections','id',r.id));
    END LOOP;
    FOR r IN SELECT * FROM jsonb_to_recordset(publication->'cloud_references') AS x(id uuid,asset_version_id uuid,workspace_id uuid,private_owner uuid,conversation_id uuid) LOOP
     SELECT n.id,n.workspace_id INTO m FROM workspace_nodes n JOIN cloud_workspaces w ON w.id=n.workspace_id WHERE n.id=r.id
      AND n.asset_version_id=r.asset_version_id AND n.content_state='active' AND n.reference_state='ready' AND w.content_state='active'
      AND w.tenant_id=scope_tenant AND w.project_id=scope_project AND w.id=r.workspace_id
      AND w.private_owner IS NOT DISTINCT FROM r.private_owner AND w.conversation_id IS NOT DISTINCT FROM r.conversation_id;
     IF m.id IS NULL THEN RETURN NULL; END IF;
     targets:=targets||jsonb_build_array(jsonb_build_object('kind','workspace_nodes','id',m.id),jsonb_build_object('kind','cloud_workspaces','id',m.workspace_id));
    END LOOP;
   FOR r IN SELECT * FROM jsonb_to_recordset(coalesce(publication->'workflows','[]'))
    AS ref(workflow_id uuid,version int,private_owner uuid,definition_hash text,run_id uuid) LOOP
    IF NOT EXISTS(SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workflow_id=w.id AND v.version=r.version
      JOIN users u ON u.id=w.private_owner AND u.status='active' JOIN memberships mm ON mm.user_id=u.id AND mm.tenant_id=w.tenant_id AND mm.status='active'
      WHERE w.id=r.workflow_id AND w.tenant_id=scope_tenant AND w.project_id=scope_project AND w.content_state='active'
       AND w.private_owner=r.private_owner AND v.definition_hash=r.definition_hash
       AND (mm.role IN('owner','admin') OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.user_id=u.id AND pm.project_id=w.project_id))) THEN RETURN NULL; END IF;
    IF r.run_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM workflow_runs wr WHERE wr.id=r.run_id AND wr.workflow_id=r.workflow_id
     AND wr.workflow_version=r.version AND wr.private_owner=r.private_owner AND wr.content_state='active') THEN RETURN NULL; END IF;
    targets:=targets||jsonb_build_array(jsonb_build_object('kind','workflows','id',r.workflow_id));
    IF NOT (r.workflow_id::text||':'||r.version::text)=ANY(seen_workflows) THEN
     seen_workflows:=array_append(seen_workflows,r.workflow_id::text||':'||r.version::text);
     pending_sources:=array_append(pending_sources,(SELECT v.source_refs FROM workflow_versions v WHERE v.workflow_id=r.workflow_id AND v.version=r.version));
    END IF;
    IF r.run_id IS NOT NULL THEN targets:=targets||jsonb_build_array(jsonb_build_object('kind','workflow_runs','id',r.run_id)); END IF;
   END LOOP;
  END IF;
 END LOOP;
 RETURN targets;
END $$;

CREATE OR REPLACE FUNCTION publication_input_sources(source_id uuid,source_task_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE scope_tenant uuid; scope_project uuid; file_row asset_versions; task_row tasks; agent_body jsonb; item record;
 pending_versions uuid[]:='{}'; pending_tasks uuid[]:='{}'; seen_versions uuid[]:='{}'; seen_tasks uuid[]:='{}'; next_id uuid; extra uuid[];
 refs jsonb:=jsonb_build_object('schema',1,'versions','[]'::jsonb,'datasets','[]'::jsonb,'memories','[]'::jsonb,'brands','[]'::jsonb,'connections','[]'::jsonb,'cloud_references','[]'::jsonb,'workflows','[]'::jsonb); bucket text;
BEGIN
 IF num_nonnulls(source_id,source_task_id)<>1 THEN RETURN NULL; END IF;
 IF source_id IS NOT NULL THEN
  SELECT a.tenant_id,a.project_id INTO scope_tenant,scope_project FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=source_id
   AND a.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND a.private_owner=nullif(current_setting('app.actor_id',true),'')::uuid;
  IF scope_tenant IS NULL OR content_source_manifest(scope_tenant,scope_project,'{}',ARRAY[source_id]) IS NULL THEN RETURN NULL; END IF;
  pending_versions:=ARRAY[source_id];
 ELSE
  SELECT t.tenant_id,t.project_id INTO scope_tenant,scope_project FROM tasks t WHERE t.id=source_task_id
   AND t.id=nullif(current_setting('app.task_id',true),'')::uuid AND t.execution_location='desktop' AND t.role_key='workflow-consultant'
   AND t.desktop_workflow_run_id IS NULL AND t.status='running' AND NOT t.cancel_requested AND t.content_state='active'
   AND t.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND t.private_owner=nullif(current_setting('app.actor_id',true),'')::uuid;
  IF scope_tenant IS NULL OR content_source_manifest(scope_tenant,scope_project,ARRAY[source_task_id],'{}') IS NULL THEN RETURN NULL; END IF;
  pending_tasks:=ARRAY[source_task_id];
 END IF;
 WHILE cardinality(pending_tasks)>0 OR cardinality(pending_versions)>0 LOOP
  IF cardinality(seen_tasks)+cardinality(seen_versions)>4096 THEN RETURN NULL; END IF;
  IF cardinality(pending_tasks)>0 THEN
   next_id:=pending_tasks[1]; pending_tasks:=pending_tasks[2:];
   IF next_id=ANY(seen_tasks) THEN CONTINUE; END IF; seen_tasks:=array_append(seen_tasks,next_id);
   SELECT * INTO task_row FROM tasks WHERE id=next_id AND tenant_id=scope_tenant AND project_id=scope_project;
   IF task_row.id IS NULL THEN RETURN NULL; END IF;
   FOR item IN SELECT m.id,v.version,m.scope,m.project_id,m.brand_id,m.conversation_id,m.private_owner FROM jsonb_to_recordset(coalesce(task_row.input_context->'memories','[]')) AS r(id uuid,version int)
    JOIN memories m ON m.id=r.id JOIN memory_versions v ON v.memory_id=m.id AND v.version=r.version LOOP
    refs:=jsonb_set(refs,'{memories}',refs->'memories'||jsonb_build_array(to_jsonb(item)));
   END LOOP;
   IF task_row.input_context ? 'agent_id' THEN
    SELECT v.body INTO agent_body FROM agent_versions v WHERE v.agent_id=(task_row.input_context->>'agent_id')::uuid AND v.version=(task_row.input_context->>'agent_version')::int;
    IF agent_body->'brand'->>'id' IS NOT NULL THEN refs:=jsonb_set(refs,'{brands}',refs->'brands'||jsonb_build_array(agent_body->'brand'->>'id')); END IF;
    IF agent_body->'brand'->>'id' IS NOT NULL THEN
     SELECT coalesce(array_agg(x.asset_version_id),'{}') INTO extra FROM brand_version_assets x WHERE x.brand_id=(agent_body->'brand'->>'id')::uuid AND x.version=(agent_body->'brand'->>'version')::int;
     pending_versions:=pending_versions||extra;
    END IF;
   END IF;
   SELECT coalesce(array_agg(m.task_id),'{}') INTO extra FROM jsonb_to_recordset(coalesce(task_row.input_context->'history','[]')) AS r(id uuid)
    JOIN conversation_messages m ON m.id=r.id WHERE m.role='assistant' AND m.task_id IS NOT NULL AND m.conversation_id=task_row.conversation_id;
   pending_tasks:=pending_tasks||extra;
   SELECT coalesce(array_agg(p.task_id),'{}') INTO extra FROM task_plans p WHERE p.approved_task_id=task_row.id;
   pending_tasks:=pending_tasks||extra;
   IF task_row.input_context ? 'plan_source_task_id' THEN pending_tasks:=array_append(pending_tasks,(task_row.input_context->>'plan_source_task_id')::uuid); END IF;
   IF task_row.attempt>0 THEN
    FOR item IN SELECT * FROM task_dependencies WHERE task_id=task_row.id AND state='resolved' LOOP
     IF item.kind='file' THEN pending_versions:=pending_versions||item.resource_ids;
     ELSE refs:=jsonb_set(refs,'{connections}',refs->'connections'||jsonb_build_array(jsonb_build_object('id',item.resource_ids[1],'provider',item.provider))); END IF;
    END LOOP;
   END IF;
   FOR item IN SELECT x.workflow_id,x.version,w.private_owner,v.definition_hash,v.source_refs FROM native_workflow_reads x
    JOIN workflows w ON w.id=x.workflow_id JOIN workflow_versions v ON v.workflow_id=x.workflow_id AND v.version=x.version
    WHERE x.task_id=task_row.id LOOP
    refs:=jsonb_set(refs,'{workflows}',refs->'workflows'||jsonb_build_array(to_jsonb(item)-'source_refs'));
    FOREACH bucket IN ARRAY ARRAY['versions','datasets','memories','brands','connections','cloud_references','workflows'] LOOP
     refs:=jsonb_set(refs,ARRAY[bucket],refs->bucket||coalesce(item.source_refs->bucket,'[]'::jsonb));
    END LOOP;
   END LOOP;
   FOR item IN SELECT r.workflow_id,r.workflow_version AS version,r.private_owner,v.definition_hash,r.id AS run_id,r.origin_task_id,v.source_refs FROM workflow_runs r
    JOIN workflow_versions v ON v.workflow_id=r.workflow_id AND v.version=r.workflow_version
    WHERE r.execution_location='desktop' AND (r.origin_task_id=task_row.id OR r.id=task_row.desktop_workflow_run_id) LOOP
    refs:=jsonb_set(refs,'{workflows}',refs->'workflows'||jsonb_build_array(to_jsonb(item)-'origin_task_id'-'source_refs'));
    FOREACH bucket IN ARRAY ARRAY['versions','datasets','memories','brands','connections','cloud_references','workflows'] LOOP
     refs:=jsonb_set(refs,ARRAY[bucket],refs->bucket||coalesce(item.source_refs->bucket,'[]'::jsonb));
    END LOOP;
    SELECT coalesce(array_agg(x.id),'{}') INTO extra FROM tasks x WHERE x.desktop_workflow_run_id=item.run_id;
    pending_tasks:=pending_tasks||extra||ARRAY[item.origin_task_id];
   END LOOP;
   FOR item IN SELECT * FROM task_source_reads WHERE task_id=task_row.id LOOP
    IF item.kind='dataset' THEN refs:=jsonb_set(refs,'{datasets}',refs->'datasets'||jsonb_build_array(item.resource_id));
    ELSE
     pending_versions:=array_append(pending_versions,item.asset_version_id);
     IF item.kind='cloud_reference' THEN refs:=jsonb_set(refs,'{cloud_references}',refs->'cloud_references'||jsonb_build_array((SELECT jsonb_build_object('id',n.id,'asset_version_id',item.asset_version_id,'workspace_id',w.id,'private_owner',w.private_owner,'conversation_id',w.conversation_id) FROM workspace_nodes n JOIN cloud_workspaces w ON w.id=n.workspace_id WHERE n.id=item.resource_id))); END IF;
    END IF;
   END LOOP;
  ELSE
   next_id:=pending_versions[1]; pending_versions:=pending_versions[2:];
   IF next_id=ANY(seen_versions) THEN CONTINUE; END IF; seen_versions:=array_append(seen_versions,next_id);
   SELECT * INTO file_row FROM asset_versions WHERE id=next_id;
   IF file_row.id IS NULL THEN RETURN NULL; END IF;
   IF file_row.metadata ? 'brand_reference' THEN
    refs:=jsonb_set(refs,'{brands}',refs->'brands'||jsonb_build_array(file_row.metadata->'brand_reference'->>'id'));
    SELECT coalesce(array_agg(x.asset_version_id),'{}') INTO extra FROM brand_version_assets x
     WHERE x.brand_id=(file_row.metadata->'brand_reference'->>'id')::uuid AND x.version=(file_row.metadata->'brand_reference'->>'version')::int;
    pending_versions:=pending_versions||extra;
   END IF;
   IF file_row.metadata ? 'publication_sources' THEN
    FOREACH bucket IN ARRAY ARRAY['versions','datasets','memories','brands','connections','cloud_references','workflows'] LOOP
     refs:=jsonb_set(refs,ARRAY[bucket],(refs->bucket) || coalesce(file_row.metadata->'publication_sources'->bucket,'[]'::jsonb));
    END LOOP;
   ELSIF file_row.metadata ? 'publication_source_version_id' THEN pending_versions:=array_append(pending_versions,(file_row.metadata->>'publication_source_version_id')::uuid);
   ELSIF file_row.metadata ? 'task_id' THEN pending_tasks:=array_append(pending_tasks,(file_row.metadata->>'task_id')::uuid);
   ELSE refs:=jsonb_set(refs,'{versions}',refs->'versions'||jsonb_build_array(file_row.id)); END IF;
  END IF;
 END LOOP;
 FOREACH bucket IN ARRAY ARRAY['versions','datasets','memories','brands','connections','cloud_references','workflows'] LOOP
  SELECT coalesce(jsonb_agg(x.value ORDER BY x.value::text),'[]') INTO agent_body FROM (SELECT DISTINCT value FROM jsonb_array_elements(refs->bucket)) x;
  refs:=jsonb_set(refs,ARRAY[bucket],agent_body);
 END LOOP;
 IF jsonb_array_length(refs->'workflows')=0 THEN refs:=refs-'workflows'; END IF;
 RETURN refs;
END $$;

CREATE OR REPLACE FUNCTION task_asset_sources_available(asset uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT NOT EXISTS(SELECT 1 FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version WHERE a.id=asset
  AND (v.metadata ? 'task_id' OR v.metadata ? 'publication_source_version_id' OR v.metadata ? 'publication_sources' OR v.metadata ? 'brand_reference')
  AND content_source_manifest(a.tenant_id,a.project_id,'{}',ARRAY[v.id]) IS NULL)
$$;
CREATE OR REPLACE FUNCTION task_asset_version_sources_available(p_version uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT NOT EXISTS(SELECT 1 FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=p_version
  AND (v.metadata ? 'task_id' OR v.metadata ? 'publication_source_version_id' OR v.metadata ? 'publication_sources' OR v.metadata ? 'brand_reference')
  AND content_source_manifest(a.tenant_id,a.project_id,'{}',ARRAY[v.id]) IS NULL)
$$;
INSERT INTO schema_migrations(version) VALUES(96);
