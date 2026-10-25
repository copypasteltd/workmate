-- Solutions copy reviewed method references, never source files or credentials.
CREATE TABLE solution_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 family_id uuid NOT NULL DEFAULT gen_random_uuid(), version integer NOT NULL CHECK(version>0),
 definition jsonb NOT NULL CHECK(jsonb_typeof(definition)='object'),
 frozen jsonb NOT NULL CHECK(jsonb_typeof(frozen)='array' AND jsonb_array_length(frozen) BETWEEN 1 AND 6),
 definition_hash text NOT NULL CHECK(definition_hash~'^[a-f0-9]{64}$'),
 state text NOT NULL DEFAULT 'draft' CHECK(state IN('draft','published','disabled')),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 published_at timestamptz, validation_task_id uuid, disabled_at timestamptz, disable_reason text,
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 UNIQUE(tenant_id,id), UNIQUE(tenant_id,family_id,version),
 CHECK((definition->>'project_id')::uuid=project_id), CHECK((state='draft')=(published_at IS NULL AND disabled_at IS NULL))
);
CREATE INDEX solution_directory ON solution_versions(tenant_id,state,id);
CREATE TABLE solution_installations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 solution_version_id uuid NOT NULL, name text NOT NULL, bindings jsonb NOT NULL DEFAULT '{"assets":[],"connectors":[]}',
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY(tenant_id,solution_version_id) REFERENCES solution_versions(tenant_id,id), UNIQUE(tenant_id,id)
);
CREATE INDEX solution_installation_project ON solution_installations(tenant_id,project_id,id);
CREATE TABLE solution_method_reads (
 tenant_id uuid NOT NULL, project_id uuid NOT NULL, task_id uuid NOT NULL, solution_version_id uuid NOT NULL,
 definition_hash text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(task_id,solution_version_id), FOREIGN KEY(tenant_id,task_id) REFERENCES tasks(tenant_id,id),
 FOREIGN KEY(tenant_id,solution_version_id) REFERENCES solution_versions(tenant_id,id)
);
CREATE TABLE solution_trials (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 solution_version_id uuid NOT NULL, installation_id uuid, private_owner uuid NOT NULL REFERENCES users(id),
 definition_hash text NOT NULL, preview_hash text NOT NULL, bindings jsonb NOT NULL, resolved_sources jsonb NOT NULL DEFAULT '[]',
 budget_micros bigint NOT NULL CHECK(budget_micros BETWEEN 1000 AND 100000000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), reviewed_at timestamptz, review_hashes jsonb,
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY(tenant_id,solution_version_id) REFERENCES solution_versions(tenant_id,id),
 FOREIGN KEY(tenant_id,installation_id) REFERENCES solution_installations(tenant_id,id), UNIQUE(tenant_id,id)
);
CREATE TABLE solution_trial_tasks (
 trial_id uuid NOT NULL, tenant_id uuid NOT NULL, task_id uuid NOT NULL, position integer NOT NULL CHECK(position BETWEEN 0 AND 5),
 template_version_id uuid NOT NULL REFERENCES agent_template_versions(id), private_owner uuid NOT NULL REFERENCES users(id),
 PRIMARY KEY(trial_id,position), UNIQUE(task_id),
 FOREIGN KEY(tenant_id,trial_id) REFERENCES solution_trials(tenant_id,id), FOREIGN KEY(tenant_id,task_id) REFERENCES tasks(tenant_id,id)
);
CREATE FUNCTION guard_solution_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['state','published_at','validation_task_id','disabled_at','disable_reason']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['state','published_at','validation_task_id','disabled_at','disable_reason'])
   OR OLD.state='disabled' OR NEW.state=OLD.state OR NEW.state='draft' THEN
  RAISE EXCEPTION 'Solution versions are immutable; revise or disable explicitly' USING ERRCODE='23514'; END IF;
 IF NEW.state='published' AND (NEW.published_at IS NULL OR NEW.validation_task_id IS NULL) THEN
  RAISE EXCEPTION 'A publication requires its completed reviewed trial' USING ERRCODE='23514'; END IF;
 IF NEW.state='disabled' AND (NEW.disabled_at IS NULL OR coalesce(NEW.disable_reason,'')='') THEN
  RAISE EXCEPTION 'A disabled solution requires a reason' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_solution_version BEFORE UPDATE OR DELETE ON solution_versions FOR EACH ROW EXECUTE FUNCTION guard_solution_version();
CREATE FUNCTION guard_solution_installation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['bindings','revision','updated_at']) IS DISTINCT FROM
   (to_jsonb(OLD)-ARRAY['bindings','revision','updated_at']) OR NEW.revision<>OLD.revision+1 THEN
  RAISE EXCEPTION 'Solution installation scope and method are immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_solution_installation BEFORE UPDATE OR DELETE ON solution_installations FOR EACH ROW EXECUTE FUNCTION guard_solution_installation();
CREATE FUNCTION guard_solution_trial() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.reviewed_at IS NOT NULL OR NEW.reviewed_at IS NULL OR NEW.review_hashes IS NULL OR
  (to_jsonb(NEW)-ARRAY['reviewed_at','review_hashes']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['reviewed_at','review_hashes']) THEN
  RAISE EXCEPTION 'Reviewed solution trial is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_solution_trial BEFORE UPDATE OR DELETE ON solution_trials FOR EACH ROW EXECUTE FUNCTION guard_solution_trial();
CREATE TRIGGER immutable_solution_trial_task BEFORE UPDATE OR DELETE ON solution_trial_tasks FOR EACH ROW EXECUTE FUNCTION guard_template_version();
CREATE FUNCTION check_solution_trial_task() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE run solution_trials; task tasks; definition solution_versions;
BEGIN
 SELECT * INTO run FROM solution_trials WHERE id=NEW.trial_id;
 SELECT * INTO task FROM tasks WHERE id=NEW.task_id;
 SELECT * INTO definition FROM solution_versions WHERE id=run.solution_version_id;
 IF run.id IS NULL OR task.id IS NULL OR run.tenant_id<>NEW.tenant_id OR run.project_id<>task.project_id
  OR run.private_owner<>NEW.private_owner OR task.private_owner<>NEW.private_owner
  OR task.input_context->'solution_trial'->>'trial_id' IS DISTINCT FROM run.id::text
  OR definition.frozen->NEW.position->>'template_version_id' IS DISTINCT FROM NEW.template_version_id::text
  OR definition.frozen->NEW.position->>'role_key' IS DISTINCT FROM task.role_key
  OR definition.frozen->NEW.position->>'role_hash' IS DISTINCT FROM task.role_hash THEN
  RAISE EXCEPTION 'Solution trial task scope or frozen template mismatch' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER solution_trial_task_scope BEFORE INSERT ON solution_trial_tasks FOR EACH ROW EXECUTE FUNCTION check_solution_trial_task();
CREATE FUNCTION check_solution_publication() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE accepted solution_trials;
BEGIN
 IF NEW.state='published' THEN
  SELECT run.* INTO accepted FROM solution_trials run JOIN solution_trial_tasks link ON link.trial_id=run.id
   WHERE link.task_id=NEW.validation_task_id AND run.solution_version_id=NEW.id AND run.tenant_id=NEW.tenant_id
    AND run.project_id=NEW.project_id AND run.definition_hash=NEW.definition_hash AND run.reviewed_at IS NOT NULL;
  IF accepted.id IS NULL OR (SELECT count(*) FROM solution_trial_tasks WHERE trial_id=accepted.id)<>jsonb_array_length(NEW.frozen)
   OR EXISTS(SELECT 1 FROM solution_trial_tasks link JOIN tasks t ON t.id=link.task_id
    WHERE link.trial_id=accepted.id AND (t.status<>'succeeded' OR business_review_state(t.id) IS DISTINCT FROM 'accepted')) THEN
   RAISE EXCEPTION 'A publication requires all exact accepted trial deliveries' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER validated_solution_publication BEFORE UPDATE OF state ON solution_versions FOR EACH ROW EXECUTE FUNCTION check_solution_publication();
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['solution_versions','solution_installations','solution_trials','solution_trial_tasks','solution_method_reads'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY solution_tenant ON %I USING(current_user IN (''cp_control'',''cp_queue'') OR tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',tab);
 END LOOP;
 FOREACH tab IN ARRAY ARRAY['solution_trials','solution_trial_tasks'] LOOP
  EXECUTE format('CREATE POLICY solution_private ON %I AS RESTRICTIVE USING(current_user IN (''cp_control'',''cp_queue'') OR private_owner=nullif(current_setting(''app.actor_id'',true),'''')::uuid)',tab);
 END LOOP;
 CREATE POLICY solution_installation_private ON solution_installations AS RESTRICTIVE USING(
  current_user IN ('cp_control','cp_queue') OR created_by=nullif(current_setting('app.actor_id',true),'')::uuid);
 CREATE POLICY solution_method_read_private ON solution_method_reads AS RESTRICTIVE USING(
  current_user IN ('cp_control','cp_queue') OR EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id AND
   (t.private_owner IS NULL OR t.private_owner=nullif(current_setting('app.actor_id',true),'')::uuid)));
END $$;
GRANT SELECT,INSERT,UPDATE ON solution_versions,solution_installations,solution_trials TO cp_app,cp_control;
GRANT SELECT,INSERT ON solution_trial_tasks TO cp_app,cp_control;
GRANT SELECT,INSERT ON solution_method_reads TO cp_app,cp_control;
GRANT SELECT ON solution_versions,solution_installations,solution_trials,solution_trial_tasks TO cp_queue;
GRANT SELECT ON solution_method_reads TO cp_queue;

CREATE FUNCTION guard_solution_task() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE trial solution_trials; item jsonb;
BEGIN
 IF TG_OP='UPDATE' AND OLD.input_context->'solution_trial' IS DISTINCT FROM NEW.input_context->'solution_trial' THEN
  IF current_setting('app.erasing_content',true)='true' AND pg_has_role(current_user,'cp_control','member') THEN RETURN NEW; END IF;
  RAISE EXCEPTION 'Approved solution task inputs are immutable' USING ERRCODE='23514'; END IF;
 item:=NEW.input_context->'solution_trial';
 IF item IS NOT NULL THEN
  SELECT * INTO trial FROM solution_trials WHERE id=(item->>'trial_id')::uuid;
  IF trial.id IS NULL OR trial.tenant_id<>NEW.tenant_id OR trial.project_id<>NEW.project_id
   OR trial.private_owner<>NEW.created_by OR NEW.private_owner IS DISTINCT FROM NEW.created_by
   OR trial.solution_version_id IS DISTINCT FROM (item->>'solution_version_id')::uuid
   OR NEW.execution_location<>'cloud' OR trial.definition_hash IS DISTINCT FROM item->>'definition_hash'
   OR trial.bindings IS DISTINCT FROM item->'bindings' OR trial.resolved_sources IS DISTINCT FROM item->'resolved_sources' THEN
   RAISE EXCEPTION 'Invalid approved solution task binding' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER approved_solution_task BEFORE INSERT OR UPDATE OF input_context,private_owner,created_by,execution_location ON tasks FOR EACH ROW EXECUTE FUNCTION guard_solution_task();

-- Keep the existing bounded traversal and all previous source hooks in place.
DO $$ DECLARE definition text; anchor text; BEGIN
 definition:=pg_get_functiondef('content_source_manifest_before_creative_feedback(uuid,uuid,uuid[],uuid[])'::regprocedure);
 anchor:='FOR r IN SELECT * FROM task_source_reads WHERE task_id=source_task.id LOOP';
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Missing solution source traversal anchor'; END IF;
 definition:=replace(definition,anchor,$hook$
   IF EXISTS(SELECT 1 FROM solution_method_reads reads JOIN solution_versions s ON s.id=reads.solution_version_id
     JOIN projects p ON p.id=s.project_id WHERE reads.task_id=source_task.id
      AND (s.state<>'published' OR p.archived OR s.definition_hash<>reads.definition_hash)) THEN RETURN NULL; END IF;
   IF source_task.input_context ? 'solution_trial' THEN
    IF NOT EXISTS(SELECT 1 FROM solution_versions s JOIN projects p ON p.id=s.project_id AND p.tenant_id=s.tenant_id
      WHERE s.id=(source_task.input_context->'solution_trial'->>'solution_version_id')::uuid
      AND s.tenant_id=source_task.tenant_id AND s.state<>'disabled' AND NOT p.archived
      AND s.definition_hash=source_task.input_context->'solution_trial'->>'definition_hash') THEN RETURN NULL; END IF;
    FOR r IN SELECT * FROM jsonb_to_recordset(source_task.input_context->'solution_trial'->'bindings'->'assets') AS x(asset_version_id uuid,sha256 text) LOOP
     IF NOT EXISTS(SELECT 1 FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=r.asset_version_id
      AND v.sha256=r.sha256 AND v.erased_at IS NULL AND a.tenant_id=source_task.tenant_id AND a.project_id=source_task.project_id
      AND (a.private_owner IS NULL OR a.private_owner=source_task.created_by) AND a.state='active' AND a.retention_expires_at>clock_timestamp()) THEN RETURN NULL; END IF;
     pending_versions:=array_append(pending_versions,r.asset_version_id);
    END LOOP;
    FOR r IN SELECT * FROM jsonb_to_recordset(coalesce(source_task.input_context->'solution_trial'->'resolved_sources','[]'::jsonb)) AS x(asset_version_id uuid,sha256 text) LOOP
     IF NOT EXISTS(SELECT 1 FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=r.asset_version_id AND v.sha256=r.sha256
      AND a.tenant_id=source_task.tenant_id AND a.project_id=source_task.project_id AND a.state='active' AND v.erased_at IS NULL
      AND a.private_owner IS NULL AND a.retention_expires_at>clock_timestamp()) THEN RETURN NULL; END IF;
     pending_versions:=array_append(pending_versions,r.asset_version_id);
    END LOOP;
    FOR r IN SELECT * FROM jsonb_to_recordset(source_task.input_context->'solution_trial'->'bindings'->'connectors')
      AS x(connection_id uuid,version integer,auth_version integer,account_id text) LOOP
     IF NOT EXISTS(SELECT 1 FROM connections c JOIN connector_profiles p ON p.connection_id=c.id
      WHERE c.id=r.connection_id AND c.tenant_id=source_task.tenant_id AND c.project_id=source_task.project_id AND c.state='connected'
      AND p.version=r.version AND p.auth_version=r.auth_version AND r.account_id=ANY(p.account_ids)
      AND source_task.project_id=ANY(p.project_ids) AND p.catalog_state='complete'
      AND p.configuration_hash<>repeat('0',64) AND p.data_mode=source_task.data_mode) THEN RETURN NULL; END IF;
    END LOOP;
   END IF;
   FOR r IN SELECT * FROM task_source_reads WHERE task_id=source_task.id LOOP$hook$);
 EXECUTE definition;
 definition:=pg_get_functiondef('publication_input_sources(uuid,uuid)'::regprocedure);
 anchor:='FOR item IN SELECT * FROM task_source_reads WHERE task_id=task_row.id LOOP';
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Missing solution publication source anchor'; END IF;
 definition:=replace(definition,anchor,$hook$
   FOR item IN SELECT * FROM jsonb_to_recordset(coalesce(task_row.input_context->'solution_trial'->'bindings'->'assets','[]'::jsonb)) AS x(asset_version_id uuid) LOOP
    pending_versions:=array_append(pending_versions,item.asset_version_id);
   END LOOP;
   FOR item IN SELECT * FROM jsonb_to_recordset(coalesce(task_row.input_context->'solution_trial'->'resolved_sources','[]'::jsonb)) AS x(asset_version_id uuid) LOOP
    pending_versions:=array_append(pending_versions,item.asset_version_id);
   END LOOP;
   FOR item IN SELECT * FROM task_source_reads WHERE task_id=task_row.id LOOP$hook$);
 EXECUTE definition;
END $$;
INSERT INTO schema_migrations(version) VALUES(112);
