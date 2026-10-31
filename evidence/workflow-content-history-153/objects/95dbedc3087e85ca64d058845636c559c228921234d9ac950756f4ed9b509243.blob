-- A scoped administrator may investigate this precise quarantined run. Other
-- source rows, dependencies, owners, retention and fixed publications stay fenced.
-- Do not alter the normal customer/runtime lineage functions or migration150.
DO $$ DECLARE definition text; anchor text; replacement text; BEGIN
 definition:=pg_get_functiondef('public.content_source_manifest_before_creative_feedback(uuid,uuid,uuid[],uuid[])'::regprocedure);
 definition:=regexp_replace(definition,'CREATE OR REPLACE FUNCTION public.content_source_manifest_before_creative_feedback\([^)]*\)',
  'CREATE FUNCTION public.admin_workflow_run_source_walk(scope_tenant uuid, scope_project uuid, task_ids uuid[], version_ids uuid[], root_workflow uuid, root_run uuid)');
 anchor:='OR r.content_state<>''active'' OR NOT EXISTS(SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workflow_id=w.id AND v.version=r.workflow_version';
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Missing run investigation state anchor'; END IF;
 definition:=replace(definition,anchor,'OR (r.content_state<>''active'' AND NOT(r.id=root_run AND r.content_state=''quarantined'')) OR NOT EXISTS(SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workflow_id=w.id AND v.version=r.workflow_version');
 anchor:='WHERE w.id=r.workflow_id AND w.content_state=''active'' AND w.private_owner=r.private_owner';
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Missing run workflow investigation anchor'; END IF;
 definition:=replace(definition,anchor,'WHERE w.id=r.workflow_id AND (w.content_state=''active'' OR (r.id=root_run AND w.id=root_workflow AND w.content_state=''quarantined'')) AND w.private_owner=r.private_owner');
 anchor:='AND w.private_owner=source_task.private_owner AND w.content_state=''active''';
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Missing child workflow read anchor'; END IF;
 definition:=replace(definition,anchor,'AND w.private_owner=source_task.private_owner AND (w.content_state=''active'' OR (w.id=root_workflow AND w.content_state=''quarantined'' AND coalesce(source_task.cloud_workflow_run_id,source_task.desktop_workflow_run_id)=root_run))');
 anchor:='pending_tasks:=pending_tasks||more||ARRAY[r.origin_task_id];';
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Missing creator task traversal anchor'; END IF;
 definition:=replace(definition,anchor,'pending_tasks:=pending_tasks||more||CASE WHEN r.id=root_run THEN ''{}''::uuid[] ELSE ARRAY[r.origin_task_id] END;');
 EXECUTE definition;
 definition:=pg_get_functiondef('public.content_source_manifest(uuid,uuid,uuid[],uuid[])'::regprocedure);
 definition:=regexp_replace(definition,'CREATE OR REPLACE FUNCTION public.content_source_manifest\([^)]*\)',
  'CREATE FUNCTION public.admin_workflow_run_source_manifest(scope_tenant uuid, scope_project uuid, task_ids uuid[], version_ids uuid[], root_workflow uuid, root_run uuid)');
 anchor:='refs:=content_source_manifest_before_creative_feedback(scope_tenant,scope_project,task_ids,version_ids);';
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Missing outer run manifest anchor'; END IF;
 definition:=replace(definition,anchor,'refs:=admin_workflow_run_source_walk(scope_tenant,scope_project,task_ids,version_ids,root_workflow,root_run);');
 anchor:=$a$more:=content_source_manifest_before_creative_feedback(scope_tenant,scope_project,'{}',
    CASE WHEN source_version IS NULL THEN ARRAY[binding.asset_version_id] ELSE ARRAY[binding.asset_version_id,source_version] END);$a$;
 replacement:=$a$more:=admin_workflow_run_source_walk(scope_tenant,scope_project,'{}',
    CASE WHEN source_version IS NULL THEN ARRAY[binding.asset_version_id] ELSE ARRAY[binding.asset_version_id,source_version] END,root_workflow,root_run);$a$;
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Missing nested confirmed feedback anchor'; END IF;
 EXECUTE replace(definition,anchor,replacement);
END $$;
ALTER FUNCTION admin_workflow_run_source_walk(uuid,uuid,uuid[],uuid[],uuid,uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION admin_workflow_run_source_walk(uuid,uuid,uuid[],uuid[],uuid,uuid) FROM PUBLIC;
ALTER FUNCTION admin_workflow_run_source_manifest(uuid,uuid,uuid[],uuid[],uuid,uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION admin_workflow_run_source_manifest(uuid,uuid,uuid[],uuid[],uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_workflow_run_source_manifest(uuid,uuid,uuid[],uuid[],uuid,uuid) TO cp_control;
