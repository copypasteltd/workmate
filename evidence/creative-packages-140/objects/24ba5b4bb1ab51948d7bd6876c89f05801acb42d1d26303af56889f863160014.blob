-- Additive delivery revisions. Preserve published SQL001-135 and the approved-plan / publication rules.
CREATE OR REPLACE FUNCTION guard_content_source_binding() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE a assets; source assets; reference jsonb; original tasks; parent_row tasks;
BEGIN
 IF TG_TABLE_NAME='tasks' THEN
  IF TG_OP='UPDATE' AND OLD.input_context->'plan_source_task_id' IS DISTINCT FROM NEW.input_context->'plan_source_task_id'
   AND NOT(NEW.content_state='deleted' AND coalesce(current_setting('app.erasing_content',true),'false')='true') THEN
   RAISE EXCEPTION 'Approved plan source is immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='UPDATE' AND OLD.input_context->'delivery_revision' IS DISTINCT FROM NEW.input_context->'delivery_revision'
   AND NOT(NEW.content_state='deleted' AND coalesce(current_setting('app.erasing_content',true),'false')='true') THEN
   RAISE EXCEPTION 'Delivery revision source is immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND NEW.input_context ? 'delivery_revision' THEN
   reference := NEW.input_context->'delivery_revision';
   IF jsonb_typeof(reference)<>'object' OR coalesce(reference->>'source_task_id','') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR coalesce(reference->>'expected_delivery_hash','') !~ '^[0-9a-f]{64}$'
    OR coalesce(reference->>'expected_version','') !~ '^[1-9][0-9]{0,8}$'
    OR coalesce(reference->'target'->>'kind','') NOT IN('whole','output','artifact','text','image','video')
    OR NEW.input_context->>'plan_source_task_id' IS DISTINCT FROM reference->>'source_task_id' THEN
    RAISE EXCEPTION 'Invalid delivery revision source' USING ERRCODE='23514'; END IF;
   SELECT * INTO original FROM tasks WHERE id=(reference->>'source_task_id')::uuid;
   SELECT * INTO parent_row FROM tasks WHERE id=NEW.parent_id;
   IF original.id IS NULL OR parent_row.id IS NULL OR original.tenant_id IS DISTINCT FROM NEW.tenant_id
    OR original.project_id IS DISTINCT FROM NEW.project_id OR original.content_state<>'active'
    OR original.mode='plan' OR original.status NOT IN('succeeded','failed','cancelled')
    OR (original.private_owner IS NOT NULL AND original.private_owner IS DISTINCT FROM NEW.created_by)
    OR original.conversation_id IS DISTINCT FROM NEW.conversation_id
    OR original.execution_location IS DISTINCT FROM NEW.execution_location
    OR original.role_key IS DISTINCT FROM NEW.role_key OR original.role_hash IS DISTINCT FROM NEW.role_hash
    OR original.role_key IS DISTINCT FROM reference->>'source_role_key' OR original.role_hash IS DISTINCT FROM reference->>'source_role_hash'
    OR parent_row.tenant_id IS DISTINCT FROM NEW.tenant_id OR parent_row.project_id IS DISTINCT FROM NEW.project_id
    OR (parent_row.id<>original.id AND parent_row.input_context->'delivery_revision' IS DISTINCT FROM reference)
    OR (parent_row.id=original.id AND original.version<>(reference->>'expected_version')::integer) THEN
    RAISE EXCEPTION 'Delivery revision source scope mismatch' USING ERRCODE='23514'; END IF;
  ELSIF TG_OP='INSERT' AND NEW.input_context ? 'plan_source_task_id' THEN
   IF NOT EXISTS(SELECT 1 FROM tasks parent WHERE parent.id=NEW.parent_id AND parent.tenant_id=NEW.tenant_id AND parent.project_id=NEW.project_id AND parent.created_by=NEW.created_by AND (parent.id::text=NEW.input_context->>'plan_source_task_id' OR parent.input_context->>'plan_source_task_id'=NEW.input_context->>'plan_source_task_id')) OR NOT EXISTS(
    SELECT 1 FROM tasks t JOIN task_plans p ON p.task_id=t.id WHERE t.id=(NEW.input_context->>'plan_source_task_id')::uuid AND t.tenant_id=NEW.tenant_id AND t.project_id=NEW.project_id
     AND t.created_by=NEW.created_by AND t.mode='plan' AND t.status='succeeded') THEN
    RAISE EXCEPTION 'Approved plan source scope mismatch' USING ERRCODE='23514'; END IF;
  END IF;
 ELSE
  IF TG_OP='UPDATE' AND OLD.metadata->'publication_source_version_id' IS DISTINCT FROM NEW.metadata->'publication_source_version_id'
   AND NOT(NEW.erased_at IS NOT NULL AND coalesce(current_setting('app.erasing_content',true),'false')='true') THEN
   RAISE EXCEPTION 'Published source binding is immutable' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND NEW.metadata ? 'publication_source_version_id' THEN
   SELECT * INTO a FROM assets WHERE id=NEW.asset_id;
   SELECT x.* INTO source FROM asset_versions v JOIN assets x ON x.id=v.asset_id WHERE v.id=(NEW.metadata->>'publication_source_version_id')::uuid;
   IF a.kind<>'published_deliverable' OR source.id IS NULL OR source.tenant_id IS DISTINCT FROM a.tenant_id OR source.project_id IS DISTINCT FROM a.project_id
    OR source.private_owner IS DISTINCT FROM a.created_by OR source.state<>'active' THEN
    RAISE EXCEPTION 'Published source scope mismatch' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_content_source_binding() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_content_source_binding() FROM PUBLIC;
