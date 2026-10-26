CREATE OR REPLACE FUNCTION content_source_manifest(scope_tenant uuid,scope_project uuid,task_ids uuid[],version_ids uuid[]) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE pending_tasks uuid[]:=task_ids; pending_versions uuid[]:=version_ids; seen_tasks uuid[]:='{}'; seen_versions uuid[]:='{}';
 tid uuid; vid uuid; source_task tasks; source_asset assets; source_version asset_versions; d record; r record; m record; av jsonb; targets jsonb:='[]'; more uuid[]; publication jsonb; bucket text;
BEGIN
 WHILE cardinality(pending_tasks)>0 OR cardinality(pending_versions)>0 LOOP
  IF cardinality(seen_tasks)+cardinality(seen_versions)>4096 THEN RETURN NULL; END IF;
  IF cardinality(pending_tasks)>0 THEN
   tid:=pending_tasks[1]; pending_tasks:=pending_tasks[2:];
   IF tid=ANY(seen_tasks) THEN CONTINUE; END IF;
   seen_tasks:=array_append(seen_tasks,tid);
   SELECT * INTO source_task FROM tasks WHERE id=tid AND tenant_id=scope_tenant AND project_id=scope_project;
   IF source_task.id IS NULL OR source_task.content_state<>'active' OR (source_task.status IN('succeeded','failed','cancelled') AND source_task.retention_expires_at<=clock_timestamp()) THEN RETURN NULL; END IF;
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
  ELSE
   vid:=pending_versions[1]; pending_versions:=pending_versions[2:];
   IF vid=ANY(seen_versions) THEN CONTINUE; END IF;
   seen_versions:=array_append(seen_versions,vid);
   SELECT * INTO source_version FROM asset_versions WHERE id=vid;
   SELECT * INTO source_asset FROM assets WHERE id=source_version.asset_id;
   IF source_asset.id IS NULL OR source_asset.tenant_id<>scope_tenant OR source_asset.project_id<>scope_project OR source_asset.state<>'active' OR source_asset.retention_expires_at<=clock_timestamp()
    OR source_version.erased_at IS NOT NULL OR NOT analysis_asset_available(source_asset.id) OR NOT matrix_asset_available(source_asset.id) OR NOT video_asset_available(source_asset.id) THEN RETURN NULL; END IF;
   targets:=targets||jsonb_build_array(jsonb_build_object('kind','assets','id',source_asset.id));
   IF source_version.metadata ? 'publication_sources' THEN
    publication:=source_version.metadata->'publication_sources';
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
   END IF;
   IF source_version.metadata ? 'task_id' THEN
    IF NOT(source_version.metadata->>'task_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN RETURN NULL; END IF;
    pending_tasks:=array_append(pending_tasks,(source_version.metadata->>'task_id')::uuid);
   END IF;
   IF source_version.metadata ? 'publication_source_version_id' THEN
    IF NOT(source_version.metadata->>'publication_source_version_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') THEN RETURN NULL; END IF;
    pending_versions:=array_append(pending_versions,(source_version.metadata->>'publication_source_version_id')::uuid);
   END IF;
  END IF;
 END LOOP;
 RETURN targets;
END $$;

-- Explicitly published files are independent objects. Freeze their known
-- consumed inputs rather than tying them to a removable private conversation.
CREATE FUNCTION publication_input_sources(source_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE scope_asset assets; file_row asset_versions; task_row tasks; agent_body jsonb; item record;
 pending_versions uuid[]:=ARRAY[source_id]; pending_tasks uuid[]:='{}'; seen_versions uuid[]:='{}'; seen_tasks uuid[]:='{}'; next_id uuid; extra uuid[];
 refs jsonb:=jsonb_build_object('schema',1,'versions','[]'::jsonb,'datasets','[]'::jsonb,'memories','[]'::jsonb,'brands','[]'::jsonb,'connections','[]'::jsonb,'cloud_references','[]'::jsonb); bucket text;
BEGIN
 SELECT a.* INTO scope_asset FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=source_id
  AND a.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND a.private_owner=nullif(current_setting('app.actor_id',true),'')::uuid;
 IF scope_asset.id IS NULL OR content_source_manifest(scope_asset.tenant_id,scope_asset.project_id,'{}',ARRAY[source_id]) IS NULL THEN RETURN NULL; END IF;
 WHILE cardinality(pending_tasks)>0 OR cardinality(pending_versions)>0 LOOP
  IF cardinality(seen_tasks)+cardinality(seen_versions)>4096 THEN RETURN NULL; END IF;
  IF cardinality(pending_tasks)>0 THEN
   next_id:=pending_tasks[1]; pending_tasks:=pending_tasks[2:];
   IF next_id=ANY(seen_tasks) THEN CONTINUE; END IF; seen_tasks:=array_append(seen_tasks,next_id);
   SELECT * INTO task_row FROM tasks WHERE id=next_id AND tenant_id=scope_asset.tenant_id AND project_id=scope_asset.project_id;
   IF task_row.id IS NULL THEN RETURN NULL; END IF;
   FOR item IN SELECT m.id,v.version,m.scope,m.project_id,m.brand_id,m.conversation_id,m.private_owner FROM jsonb_to_recordset(coalesce(task_row.input_context->'memories','[]')) AS r(id uuid,version int)
    JOIN memories m ON m.id=r.id JOIN memory_versions v ON v.memory_id=m.id AND v.version=r.version LOOP
    refs:=jsonb_set(refs,'{memories}',refs->'memories'||jsonb_build_array(to_jsonb(item)));
   END LOOP;
   IF task_row.input_context ? 'agent_id' THEN
    SELECT v.body INTO agent_body FROM agent_versions v WHERE v.agent_id=(task_row.input_context->>'agent_id')::uuid AND v.version=(task_row.input_context->>'agent_version')::int;
    IF agent_body->'brand'->>'id' IS NOT NULL THEN refs:=jsonb_set(refs,'{brands}',refs->'brands'||jsonb_build_array(agent_body->'brand'->>'id')); END IF;
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
   IF file_row.metadata ? 'publication_sources' THEN
    FOREACH bucket IN ARRAY ARRAY['versions','datasets','memories','brands','connections','cloud_references'] LOOP
     refs:=jsonb_set(refs,ARRAY[bucket],refs->bucket||file_row.metadata->'publication_sources'->bucket);
    END LOOP;
   ELSIF file_row.metadata ? 'publication_source_version_id' THEN pending_versions:=array_append(pending_versions,(file_row.metadata->>'publication_source_version_id')::uuid);
   ELSIF file_row.metadata ? 'task_id' THEN pending_tasks:=array_append(pending_tasks,(file_row.metadata->>'task_id')::uuid);
   ELSE refs:=jsonb_set(refs,'{versions}',refs->'versions'||jsonb_build_array(file_row.id)); END IF;
  END IF;
 END LOOP;
 FOREACH bucket IN ARRAY ARRAY['versions','datasets','memories','brands','connections','cloud_references'] LOOP
  SELECT coalesce(jsonb_agg(x.value ORDER BY x.value::text),'[]') INTO agent_body FROM (SELECT DISTINCT value FROM jsonb_array_elements(refs->bucket)) x;
  refs:=jsonb_set(refs,ARRAY[bucket],agent_body);
 END LOOP;
 RETURN refs;
END $$;
ALTER FUNCTION publication_input_sources(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION publication_input_sources(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION publication_input_sources(uuid) TO cp_app,cp_control;

-- Only an already authorized task can acquire these locks. Elevation grants
-- no application UPDATE privilege on read-only cloud workspace metadata.
CREATE FUNCTION lock_task_content_sources(task uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE refs jsonb; source_table text; ids uuid[];
BEGIN
 refs:=task_content_source_manifest(task); IF refs IS NULL THEN RETURN false; END IF;
 FOREACH source_table IN ARRAY ARRAY['assets','connections','analytics_datasets','cloud_workspaces','workspace_nodes','agents','brand_profiles','memories','conversations'] LOOP
  SELECT array_agg(x.id ORDER BY x.id) INTO ids FROM (SELECT DISTINCT r.id FROM jsonb_to_recordset(refs) AS r(kind text,id uuid) WHERE r.kind=source_table) x;
  IF cardinality(ids)>0 THEN EXECUTE format('SELECT id FROM %I WHERE id=ANY($1) ORDER BY id FOR SHARE%s',source_table,CASE WHEN source_table='conversations' THEN '' ELSE ' NOWAIT' END) USING ids; END IF;
 END LOOP;
 RETURN task_content_sources_available(task);
END $$;
ALTER FUNCTION lock_task_content_sources(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION lock_task_content_sources(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_task_content_sources(uuid) TO cp_app,cp_control;

CREATE OR REPLACE FUNCTION task_asset_sources_available(asset uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT NOT EXISTS(SELECT 1 FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version WHERE a.id=asset
  AND (v.metadata ? 'task_id' OR v.metadata ? 'publication_source_version_id' OR v.metadata ? 'publication_sources')
  AND content_source_manifest(a.tenant_id,a.project_id,'{}',ARRAY[v.id]) IS NULL)
$$;
CREATE OR REPLACE FUNCTION task_asset_version_sources_available(p_version uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT NOT EXISTS(SELECT 1 FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=p_version
  AND (v.metadata ? 'task_id' OR v.metadata ? 'publication_source_version_id' OR v.metadata ? 'publication_sources')
  AND content_source_manifest(a.tenant_id,a.project_id,'{}',ARRAY[v.id]) IS NULL)
$$;

CREATE FUNCTION guard_publication_input_snapshot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
BEGIN
 IF TG_OP='UPDATE' AND ROW(OLD.metadata->'publication_sources',OLD.metadata->'publication_origin_version_id')
  IS DISTINCT FROM ROW(NEW.metadata->'publication_sources',NEW.metadata->'publication_origin_version_id')
  AND NOT(NEW.erased_at IS NOT NULL AND current_setting('app.erasing_content',true)='true') THEN
  RAISE EXCEPTION 'Published input provenance is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND (NEW.metadata ? 'publication_sources' OR NEW.metadata ? 'publication_origin_version_id') THEN
  IF NOT EXISTS(SELECT 1 FROM assets a JOIN asset_versions origin ON origin.id=(NEW.metadata->>'publication_origin_version_id')::uuid
   JOIN assets source ON source.id=origin.asset_id WHERE a.id=NEW.asset_id AND a.kind='published_deliverable'
   AND a.tenant_id=source.tenant_id AND a.project_id=source.project_id AND a.created_by=source.private_owner AND source.state='active')
   OR NEW.metadata->'publication_sources' IS DISTINCT FROM publication_input_sources((NEW.metadata->>'publication_origin_version_id')::uuid) THEN
   RAISE EXCEPTION 'Published input provenance scope mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_publication_input_snapshot() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_publication_input_snapshot() FROM PUBLIC;
CREATE TRIGGER asset_publication_input_snapshot BEFORE INSERT OR UPDATE OF metadata ON asset_versions FOR EACH ROW EXECUTE FUNCTION guard_publication_input_snapshot();

INSERT INTO schema_migrations(version) VALUES(85);
