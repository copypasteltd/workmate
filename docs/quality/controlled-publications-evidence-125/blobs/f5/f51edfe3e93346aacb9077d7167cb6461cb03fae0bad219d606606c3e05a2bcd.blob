-- Preserve applied SQL085. Merge nested publication inputs explicitly and reject absent provenance.
CREATE OR REPLACE FUNCTION publication_input_sources(source_id uuid) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER
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
     refs:=jsonb_set(refs,ARRAY[bucket],(refs->bucket) || (file_row.metadata->'publication_sources'->bucket));
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

CREATE OR REPLACE FUNCTION guard_publication_input_snapshot() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE expected_sources jsonb;
BEGIN
 IF TG_OP='UPDATE' AND ROW(OLD.metadata->'publication_sources',OLD.metadata->'publication_origin_version_id')
  IS DISTINCT FROM ROW(NEW.metadata->'publication_sources',NEW.metadata->'publication_origin_version_id')
  AND NOT(NEW.erased_at IS NOT NULL AND current_setting('app.erasing_content',true)='true') THEN
  RAISE EXCEPTION 'Published input provenance is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' AND (NEW.metadata ? 'publication_sources' OR NEW.metadata ? 'publication_origin_version_id') THEN
  expected_sources:=publication_input_sources((NEW.metadata->>'publication_origin_version_id')::uuid);
  IF NOT EXISTS(SELECT 1 FROM assets a JOIN asset_versions origin ON origin.id=(NEW.metadata->>'publication_origin_version_id')::uuid
   JOIN assets source ON source.id=origin.asset_id WHERE a.id=NEW.asset_id AND a.kind='published_deliverable'
   AND a.tenant_id=source.tenant_id AND a.project_id=source.project_id AND a.created_by=source.private_owner AND source.state='active')
   OR NEW.metadata->'publication_sources' IS NULL OR expected_sources IS NULL
   OR NEW.metadata->'publication_sources' IS DISTINCT FROM expected_sources THEN
   RAISE EXCEPTION 'Published input provenance scope mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_publication_input_snapshot() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_publication_input_snapshot() FROM PUBLIC;

INSERT INTO schema_migrations(version) VALUES(86);
