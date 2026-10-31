-- Retain every existing source traversal hook. Workflow inputs are internal
-- exact versions from the customer's frozen plan, not generic task API data.
DO $$ DECLARE definition text; anchor text; BEGIN
 definition:=pg_get_functiondef('content_source_manifest_before_creative_feedback(uuid,uuid,uuid[],uuid[])'::regprocedure);
 anchor:='FOR r IN SELECT * FROM task_source_reads WHERE task_id=source_task.id LOOP';
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Missing unique workflow input source anchor'; END IF;
 definition:=replace(definition,anchor,$hook$
   IF source_task.input_context ? 'workflow_inputs' THEN
    IF source_task.private_owner IS DISTINCT FROM source_task.created_by
     OR (source_task.cloud_workflow_run_id IS NULL AND source_task.desktop_workflow_run_id IS NULL) THEN RETURN NULL; END IF;
    FOR r IN SELECT x.* FROM jsonb_array_elements(source_task.input_context->'workflow_inputs') b,
     jsonb_to_recordset(b->'files') AS x(asset_id uuid,asset_version_id uuid,sha256 text) LOOP
     IF NOT EXISTS(SELECT 1 FROM asset_versions v JOIN assets a ON a.id=v.asset_id
      WHERE v.id=r.asset_version_id AND v.asset_id=r.asset_id AND v.sha256=r.sha256
       AND a.tenant_id=source_task.tenant_id AND a.project_id=source_task.project_id
       AND (a.private_owner IS NULL OR a.private_owner=source_task.created_by)) THEN RETURN NULL; END IF;
     pending_versions:=array_append(pending_versions,r.asset_version_id);
    END LOOP;
   END IF;
   FOR r IN SELECT * FROM task_source_reads WHERE task_id=source_task.id LOOP$hook$);
 EXECUTE definition;
 definition:=pg_get_functiondef('publication_input_sources(uuid,uuid)'::regprocedure);
 anchor:='FOR item IN SELECT * FROM task_source_reads WHERE task_id=task_row.id LOOP';
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Missing unique workflow publication input anchor'; END IF;
 definition:=replace(definition,anchor,$hook$
   FOR item IN SELECT x.* FROM jsonb_array_elements(coalesce(task_row.input_context->'workflow_inputs','[]'::jsonb)) b,
    jsonb_to_recordset(b->'files') AS x(asset_version_id uuid) LOOP
    pending_versions:=array_append(pending_versions,item.asset_version_id);
   END LOOP;
   FOR item IN SELECT * FROM task_source_reads WHERE task_id=task_row.id LOOP$hook$);
 EXECUTE definition;
END $$;
-- A scoped boolean avoids granting the application access to private provider
-- accounting tables. It cannot approve work, replay a step or change a charge.
CREATE FUNCTION workflow_failure_review_ready(p_task uuid) RETURNS boolean
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE t public.tasks%ROWTYPE;
BEGIN
 SELECT * INTO t FROM public.tasks WHERE id=p_task
  AND tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND created_by=nullif(current_setting('app.actor_id',true),'')::uuid
  AND private_owner=created_by;
 IF t.id IS NULL OR t.status<>'failed' OR t.cancel_requested THEN RETURN false; END IF;
 IF NOT EXISTS(SELECT 1 FROM public.workflow_runs r WHERE r.id=coalesce(t.cloud_workflow_run_id,t.desktop_workflow_run_id)
  AND r.tenant_id=t.tenant_id AND r.project_id=t.project_id AND r.private_owner=t.created_by
  AND r.active_task=t.id AND r.state='running' AND r.authorized_at IS NOT NULL AND r.content_state='active'
  AND r.definition->'steps'->r.cursor->>'on_failure'='review') THEN RETURN false; END IF;
 RETURN EXISTS(SELECT 1 FROM public.reservations WHERE task_id=t.id AND status IN('settled','released'))
  AND NOT EXISTS(SELECT 1 FROM public.video_renders WHERE origin_task_id=t.id AND state IN('queued','rendering'))
  AND NOT EXISTS(SELECT 1 FROM public.ai_video_jobs WHERE task_id=t.id AND (NOT usage_known OR state NOT IN('completed','failed','cancelled') OR delivery_state='pending'))
  AND NOT EXISTS(SELECT 1 FROM public.ai_audio_jobs WHERE task_id=t.id AND (NOT usage_known OR state NOT IN('completed','cancelled') OR delivery_state='pending'))
  AND NOT EXISTS(SELECT 1 FROM public.external_budget_operations WHERE task_id=t.id AND state NOT IN('succeeded','failed','cancelled','expired','no_change'))
  AND NOT EXISTS(SELECT 1 FROM public.publication_operations WHERE task_id=t.id AND state NOT IN('succeeded','failed','cancelled','expired'));
END $$;
ALTER FUNCTION workflow_failure_review_ready(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION workflow_failure_review_ready(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION workflow_failure_review_ready(uuid) TO cp_app;
INSERT INTO schema_migrations(version) VALUES(140);
