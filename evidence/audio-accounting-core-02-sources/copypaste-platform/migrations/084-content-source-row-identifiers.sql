-- Keep row variables distinct from table aliases during provenance traversal.
CREATE OR REPLACE FUNCTION content_source_manifest(scope_tenant uuid,scope_project uuid,task_ids uuid[],version_ids uuid[]) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE pending_tasks uuid[]:=task_ids; pending_versions uuid[]:=version_ids; seen_tasks uuid[]:='{}'; seen_versions uuid[]:='{}';
 tid uuid; vid uuid; source_task tasks; source_asset assets; source_version asset_versions; d record; r record; m record; av jsonb; targets jsonb:='[]'; more uuid[];
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
INSERT INTO schema_migrations(version) VALUES(84);
