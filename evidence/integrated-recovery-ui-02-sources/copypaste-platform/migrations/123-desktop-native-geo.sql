-- Native fixed-question observations retain existing immutable GEO lineage.
-- Replace only the execution-location guard; no historical migration is changed.
CREATE OR REPLACE FUNCTION guard_geo_binding() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE s geo_samples; r geo_runs; e geo_experiments; t tasks; v asset_versions; a assets;
BEGIN
 IF TG_TABLE_NAME='tasks' THEN
  SELECT * INTO t FROM tasks WHERE id=NEW.id;
  IF NOT t.input_context ? 'geo_sample_id' THEN RETURN NULL; END IF;
  SELECT * INTO s FROM geo_samples WHERE id=(t.input_context->>'geo_sample_id')::uuid AND task_id=t.id;
 ELSIF TG_TABLE_NAME='asset_versions' THEN
  SELECT * INTO v FROM asset_versions WHERE id=NEW.id;
  IF NOT v.metadata ? 'geo_sample_id' THEN RETURN NULL; END IF;
  SELECT * INTO s FROM geo_samples WHERE id=(v.metadata->>'geo_sample_id')::uuid AND asset_version_id=v.id;
 ELSE
  SELECT * INTO s FROM geo_samples WHERE id=NEW.id;
 END IF;
 IF s.content_state='deleted' THEN RETURN NULL; END IF;
 SELECT * INTO r FROM geo_runs WHERE id=s.run_id;
 SELECT * INTO e FROM geo_experiments WHERE id=r.experiment_id;
 IF s.id IS NULL OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(e.body->'spec'->'questions') q WHERE q->>'key'=s.question_key AND q->>'text'=s.body->>'question') THEN
  RAISE EXCEPTION 'GEO sample question mismatch' USING ERRCODE='23514'; END IF;
 IF r.surface='internal_api' THEN
  SELECT * INTO t FROM tasks WHERE id=s.task_id;
  IF t.id IS NULL OR t.tenant_id<>s.tenant_id OR t.project_id<>s.project_id OR t.private_owner IS DISTINCT FROM s.private_owner
   OR t.created_by<>s.created_by
   OR t.execution_location IS DISTINCT FROM coalesce(r.body->'effective_config'->>'execution_location','cloud')
   OR (t.execution_location='desktop' AND (
     r.body->'effective_config'->'harness'->>'protocol' IS DISTINCT FROM 'codex-desktop-geo-v1'
     OR t.input_context ? 'project_configuration'
     OR NOT EXISTS(SELECT 1 FROM desktop_executions d WHERE d.task_id=t.id AND d.tenant_id=s.tenant_id
       AND d.project_id=s.project_id AND d.actor_id=s.created_by AND d.method_tools_version=1
       AND d.runtime_sha256=r.body->'effective_config'->'harness'->'native_runtime'->>'windows_x64_sha256')))
   OR t.mode<>'ask' OR t.conversation_id IS NOT NULL OR t.parent_id IS NOT NULL
   OR t.input_context->>'geo_sample_id' IS DISTINCT FROM s.id::text
   OR t.input_context->>'agent_id' IS DISTINCT FROM e.body->'context'->>'agent_id'
   OR t.input_context->>'agent_version' IS DISTINCT FROM e.body->'context'->>'agent_version'
   OR t.input_context->>'role_hash' IS DISTINCT FROM e.body->'context'->>'role_hash'
   OR t.input_context->'memories' IS DISTINCT FROM '[]'::jsonb OR t.input_context->'history' IS DISTINCT FROM '[]'::jsonb THEN
   RAISE EXCEPTION 'GEO task scope mismatch' USING ERRCODE='23514'; END IF;
 ELSIF s.task_id IS NOT NULL THEN RAISE EXCEPTION 'Manual GEO sample cannot bill an API task' USING ERRCODE='23514'; END IF;
 IF s.asset_version_id IS NOT NULL THEN
  SELECT * INTO v FROM asset_versions WHERE id=s.asset_version_id;
  SELECT * INTO a FROM assets WHERE id=v.asset_id;
  IF v.id IS NULL OR a.tenant_id<>s.tenant_id OR a.project_id<>s.project_id OR a.private_owner IS DISTINCT FROM s.private_owner
   OR a.created_by<>s.created_by OR v.mime_type<>'text/plain' OR v.sha256<>s.answer_sha256 OR v.metadata->>'geo_sample_id' IS DISTINCT FROM s.id::text
   OR (r.surface='internal_api' AND v.metadata->>'task_id' IS DISTINCT FROM s.task_id::text) THEN
   RAISE EXCEPTION 'GEO answer scope mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NULL;
END $$;

INSERT INTO schema_migrations(version) VALUES(123);
