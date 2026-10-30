-- Persisted team methods and separately approved private runs. SQL001-107 and
-- the existing role/Skill definitions remain unchanged.
CREATE TABLE agent_groups (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),project_id uuid NOT NULL REFERENCES projects(id),
 name text NOT NULL,coordinator_agent_id uuid NOT NULL REFERENCES agents(id),workspace_id uuid NOT NULL REFERENCES cloud_workspaces(id),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),state text NOT NULL DEFAULT 'active' CHECK(state IN('active','archived')),
 created_by uuid NOT NULL REFERENCES users(id),content_state text NOT NULL DEFAULT 'active' CHECK(content_state IN('active','quarantined','deleted')),
 moderation_version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(id,tenant_id,project_id),FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
CREATE INDEX agent_group_directory ON agent_groups(project_id,created_at DESC,id DESC);
CREATE TABLE agent_group_versions (
 group_id uuid NOT NULL,version integer NOT NULL CHECK(version>0),tenant_id uuid NOT NULL,project_id uuid NOT NULL,
 body jsonb NOT NULL,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),erased_at timestamptz,
 PRIMARY KEY(group_id,version),FOREIGN KEY(group_id,tenant_id,project_id) REFERENCES agent_groups(id,tenant_id,project_id)
);
CREATE TABLE agent_group_members (
 group_id uuid NOT NULL,group_version integer NOT NULL,tenant_id uuid NOT NULL,project_id uuid NOT NULL,
 agent_id uuid NOT NULL,agent_version integer NOT NULL,is_coordinator boolean NOT NULL,role_description text NOT NULL,
 PRIMARY KEY(group_id,group_version,agent_id),FOREIGN KEY(group_id,group_version) REFERENCES agent_group_versions(group_id,version),
 FOREIGN KEY(group_id,tenant_id,project_id) REFERENCES agent_groups(id,tenant_id,project_id),
 FOREIGN KEY(agent_id,agent_version) REFERENCES agent_versions(agent_id,version)
);
CREATE UNIQUE INDEX one_group_coordinator ON agent_group_members(group_id,group_version) WHERE is_coordinator;
CREATE TABLE agent_group_preflights (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),group_id uuid NOT NULL,group_version integer NOT NULL,tenant_id uuid NOT NULL,project_id uuid NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),definition jsonb NOT NULL,definition_hash text NOT NULL CHECK(definition_hash ~ '^[a-f0-9]{64}$'),
 approved_budget_micros bigint NOT NULL CHECK(approved_budget_micros BETWEEN 1 AND 1000000000000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '15 minutes',
 erased_at timestamptz,FOREIGN KEY(group_id,group_version) REFERENCES agent_group_versions(group_id,version),
 FOREIGN KEY(group_id,tenant_id,project_id) REFERENCES agent_groups(id,tenant_id,project_id)
);
CREATE TABLE agent_group_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),group_id uuid NOT NULL,group_version integer NOT NULL,tenant_id uuid NOT NULL,project_id uuid NOT NULL,
 preflight_id uuid NOT NULL UNIQUE REFERENCES agent_group_preflights(id),name text NOT NULL,
 created_by uuid NOT NULL REFERENCES users(id),private_owner uuid NOT NULL REFERENCES users(id),actor_auth_version integer NOT NULL,
 conversation_id uuid NOT NULL UNIQUE REFERENCES conversations(id),coordinator_task_id uuid UNIQUE REFERENCES tasks(id),
 definition jsonb NOT NULL,definition_hash text NOT NULL CHECK(definition_hash ~ '^[a-f0-9]{64}$'),
 approved_budget_micros bigint NOT NULL CHECK(approved_budget_micros BETWEEN 1 AND 1000000000000),
 max_parallelism integer NOT NULL CHECK(max_parallelism BETWEEN 1 AND 3),
 state text NOT NULL DEFAULT 'running' CHECK(state IN('running','succeeded','failed','cancelled','reconciling')),
 revision integer NOT NULL DEFAULT 1,error_code text,
 content_state text NOT NULL DEFAULT 'active' CHECK(content_state IN('active','quarantined','deleted')),
 moderation_version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 deadline_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '2 hours',
 retention_expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '90 days',
 CHECK(private_owner=created_by),UNIQUE(id,tenant_id,project_id),
 FOREIGN KEY(group_id,group_version) REFERENCES agent_group_versions(group_id,version),
 FOREIGN KEY(group_id,tenant_id,project_id) REFERENCES agent_groups(id,tenant_id,project_id)
);
CREATE INDEX agent_group_run_dispatch ON agent_group_runs(created_at,id) WHERE state='running' AND content_state='active';
CREATE INDEX agent_group_run_owner ON agent_group_runs(project_id,created_by,created_at DESC);
CREATE TABLE agent_group_nodes (
 run_id uuid NOT NULL,step_key text NOT NULL CHECK(step_key ~ '^[a-z][a-z0-9_]{0,39}$' AND step_key<>'coordinator'),
 tenant_id uuid NOT NULL,project_id uuid NOT NULL,position integer NOT NULL CHECK(position BETWEEN 0 AND 15),
 agent_id uuid NOT NULL,agent_version integer NOT NULL,role_key text NOT NULL,role_hash text NOT NULL,
 budget_micros bigint NOT NULL CHECK(budget_micros BETWEEN 1 AND 1000000000000),body jsonb NOT NULL,depends_on text[] NOT NULL,
 task_id uuid UNIQUE REFERENCES tasks(id),state text NOT NULL DEFAULT 'pending' CHECK(state IN('pending','active','succeeded','failed','cancelled')),
 error_code text,PRIMARY KEY(run_id,step_key),UNIQUE(run_id,position),
 FOREIGN KEY(run_id,tenant_id,project_id) REFERENCES agent_group_runs(id,tenant_id,project_id),
 FOREIGN KEY(agent_id,agent_version) REFERENCES agent_versions(agent_id,version)
);
ALTER TABLE tasks ADD COLUMN agent_group_run_id uuid REFERENCES agent_group_runs(id);
ALTER TABLE tasks ADD COLUMN agent_group_node_key text;
ALTER TABLE tasks ADD CONSTRAINT agent_group_task_binding CHECK(
 (agent_group_run_id IS NULL AND agent_group_node_key IS NULL) OR
 (agent_group_run_id IS NOT NULL AND agent_group_node_key IS NOT NULL AND execution_location='cloud' AND private_owner=created_by));
CREATE UNIQUE INDEX one_actual_group_task ON tasks(agent_group_run_id,agent_group_node_key) WHERE agent_group_run_id IS NOT NULL;
DROP INDEX conversation_one_active_task;
CREATE UNIQUE INDEX conversation_one_active_task ON tasks(conversation_id)
 WHERE conversation_id IS NOT NULL AND agent_group_run_id IS NULL AND status IN('queued','running','paused','awaiting_approval','reconciling','needs_input');

-- A reviewed coordinator binds its real Codex/pricing snapshot while waiting.
-- Ordinary paused tasks still cannot acquire or replace a runtime binding.
DO $$ DECLARE definition text; anchor text; BEGIN
 definition:=pg_get_functiondef('guard_task_runtime_binding()'::regprocedure);
 anchor:='AND status IN (''queued'',''needs_input'') AND attempt=0';
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Unexpected coordinator runtime checkpoint'; END IF;
 EXECUTE replace(definition,anchor,'AND (status IN (''queued'',''needs_input'') OR (status=''paused'' AND agent_group_node_key=''coordinator'' AND agent_group_run_id IS NOT NULL)) AND attempt=0');
END $$;

CREATE FUNCTION agent_group_project_access(tenant uuid,project uuid,writing boolean DEFAULT false) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT tenant=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(
 SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id JOIN tenants t ON t.id=m.tenant_id JOIN projects p ON p.id=project AND p.tenant_id=t.id
 WHERE m.tenant_id=tenant AND m.user_id=nullif(current_setting('app.actor_id',true),'')::uuid
 AND m.status='active' AND u.status='active' AND t.status='active' AND NOT p.archived
 AND (m.role IN('owner','admin') OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=m.user_id
  AND (NOT writing OR (m.role='member' AND pm.role='editor')))))
$$;
ALTER FUNCTION agent_group_project_access(uuid,uuid,boolean) OWNER TO cp_control;
REVOKE ALL ON FUNCTION agent_group_project_access(uuid,uuid,boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION agent_group_project_access(uuid,uuid,boolean) TO cp_app,cp_control;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['agent_groups','agent_group_versions','agent_group_members','agent_group_preflights','agent_group_runs','agent_group_nodes'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY group_control ON %I TO cp_control USING(true) WITH CHECK(true)',tab);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,cp_app,cp_queue',tab);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO cp_control',tab);
 END LOOP;
 FOREACH tab IN ARRAY ARRAY['agent_groups','agent_group_versions','agent_group_members'] LOOP
  EXECUTE format('CREATE POLICY group_read ON %I FOR SELECT TO cp_app USING(agent_group_project_access(tenant_id,project_id))',tab);
  EXECUTE format('CREATE POLICY group_insert ON %I FOR INSERT TO cp_app WITH CHECK(agent_group_project_access(tenant_id,project_id,true))',tab);
 END LOOP;
END $$;
CREATE POLICY group_edit ON agent_groups FOR UPDATE TO cp_app USING(agent_group_project_access(tenant_id,project_id,true)) WITH CHECK(agent_group_project_access(tenant_id,project_id,true));
CREATE POLICY group_preflight_owner ON agent_group_preflights TO cp_app USING(created_by=nullif(current_setting('app.actor_id',true),'')::uuid AND agent_group_project_access(tenant_id,project_id))
 WITH CHECK(created_by=nullif(current_setting('app.actor_id',true),'')::uuid AND agent_group_project_access(tenant_id,project_id,true));
CREATE POLICY group_run_owner ON agent_group_runs TO cp_app USING(created_by=nullif(current_setting('app.actor_id',true),'')::uuid AND agent_group_project_access(tenant_id,project_id))
 WITH CHECK(created_by=nullif(current_setting('app.actor_id',true),'')::uuid AND agent_group_project_access(tenant_id,project_id,true));
CREATE POLICY group_node_owner ON agent_group_nodes TO cp_app USING(EXISTS(SELECT 1 FROM agent_group_runs r WHERE r.id=run_id AND r.created_by=nullif(current_setting('app.actor_id',true),'')::uuid))
 WITH CHECK(EXISTS(SELECT 1 FROM agent_group_runs r WHERE r.id=run_id AND r.created_by=nullif(current_setting('app.actor_id',true),'')::uuid AND agent_group_project_access(r.tenant_id,r.project_id,true)));
GRANT SELECT,INSERT,UPDATE ON agent_groups,agent_group_runs,agent_group_nodes TO cp_app;
GRANT SELECT,INSERT ON agent_group_versions,agent_group_members,agent_group_preflights TO cp_app;

CREATE FUNCTION guard_agent_group_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Team history is immutable' USING ERRCODE='23514'; END IF;
 IF TG_OP='UPDATE' THEN
  IF current_user='cp_control' AND coalesce(current_setting('app.erasing_content',true),'')='true' THEN RETURN NEW; END IF;
  IF TG_TABLE_NAME IN('agent_group_versions','agent_group_members','agent_group_preflights') THEN
   RAISE EXCEPTION 'Team versions and review receipts are immutable' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='agent_groups' THEN
   IF ROW(NEW.id,NEW.tenant_id,NEW.project_id,NEW.created_by,NEW.workspace_id,NEW.created_at)
    IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.project_id,OLD.created_by,OLD.workspace_id,OLD.created_at)
    OR (ROW(NEW.name,NEW.coordinator_agent_id,NEW.state) IS DISTINCT FROM ROW(OLD.name,OLD.coordinator_agent_id,OLD.state) AND NEW.version<>OLD.version+1)
    OR NEW.version NOT IN(OLD.version,OLD.version+1) THEN RAISE EXCEPTION 'Team edits require a new version' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='agent_group_runs' THEN
   IF (to_jsonb(NEW)-ARRAY['state','revision','error_code','coordinator_task_id','content_state','moderation_version'])
    IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','revision','error_code','coordinator_task_id','content_state','moderation_version'])
    OR (OLD.coordinator_task_id IS NOT NULL AND NEW.coordinator_task_id IS DISTINCT FROM OLD.coordinator_task_id)
    OR (OLD.state<>'running' AND NEW.state IS DISTINCT FROM OLD.state) THEN RAISE EXCEPTION 'Approved team run is immutable' USING ERRCODE='23514'; END IF;
  ELSIF TG_TABLE_NAME='agent_group_nodes' THEN
   IF (to_jsonb(NEW)-ARRAY['state','task_id','error_code']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['state','task_id','error_code'])
    OR (OLD.task_id IS NOT NULL AND NEW.task_id IS DISTINCT FROM OLD.task_id)
    OR (OLD.state IN('succeeded','failed','cancelled') AND NEW.state IS DISTINCT FROM OLD.state) THEN
    RAISE EXCEPTION 'Approved team step is immutable' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['agent_groups','agent_group_versions','agent_group_members','agent_group_preflights','agent_group_runs','agent_group_nodes'] LOOP
  EXECUTE format('CREATE TRIGGER group_history BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_agent_group_history()',tab);
 END LOOP;
END $$;

CREATE FUNCTION check_agent_group_scope() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r agent_group_runs; g agent_groups; v jsonb;
BEGIN
 IF TG_TABLE_NAME='agent_groups' THEN
  IF NOT EXISTS(SELECT 1 FROM cloud_workspaces w JOIN agents a ON a.id=NEW.coordinator_agent_id
    WHERE w.id=NEW.workspace_id AND w.tenant_id=NEW.tenant_id AND w.project_id=NEW.project_id AND w.kind='project' AND w.content_state='active'
    AND a.tenant_id=NEW.tenant_id AND a.project_id=NEW.project_id AND a.content_state='active') THEN
   RAISE EXCEPTION 'Invalid team project scope' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='agent_group_members' THEN
  IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM agents a JOIN agent_versions av ON av.agent_id=a.id AND av.version=NEW.agent_version
   JOIN agent_group_versions gv ON gv.group_id=NEW.group_id AND gv.version=NEW.group_version
   WHERE a.id=NEW.agent_id AND a.tenant_id=NEW.tenant_id AND a.project_id=NEW.project_id AND a.content_state='active'
   AND gv.tenant_id=NEW.tenant_id AND gv.project_id=NEW.project_id
   AND EXISTS(SELECT 1 FROM jsonb_array_elements(gv.body->'bindings') b WHERE b->>'agent_id'=NEW.agent_id::text
    AND (b->>'agent_version')::int=NEW.agent_version AND (b->>'is_coordinator')::boolean=NEW.is_coordinator)
   AND av.body->>'kernel'='codex') THEN RAISE EXCEPTION 'Invalid team member version' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' AND (SELECT count(*) FROM agent_group_members WHERE group_id=NEW.group_id AND group_version=NEW.group_version)>=8 THEN
   RAISE EXCEPTION 'Team member limit' USING ERRCODE='23514'; END IF;
 ELSIF TG_TABLE_NAME='agent_group_runs' AND TG_OP='INSERT' THEN
  SELECT * INTO g FROM agent_groups WHERE id=NEW.group_id;
  IF NEW.state<>'running' OR NEW.coordinator_task_id IS NOT NULL OR NEW.created_by IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'')::uuid
   OR g.state<>'active' OR g.content_state<>'active' OR g.version<>NEW.group_version
   OR NOT EXISTS(SELECT 1 FROM agent_group_preflights p JOIN conversations c ON c.id=NEW.conversation_id
    WHERE p.id=NEW.preflight_id AND p.created_by=NEW.created_by AND p.tenant_id=NEW.tenant_id AND p.project_id=NEW.project_id
    AND p.group_id=NEW.group_id AND p.group_version=NEW.group_version AND p.erased_at IS NULL AND p.expires_at>clock_timestamp()
    AND p.definition=NEW.definition AND p.definition_hash=NEW.definition_hash AND p.approved_budget_micros=NEW.approved_budget_micros
    AND NEW.max_parallelism=(p.definition->>'max_parallelism')::integer
    AND c.created_by=NEW.created_by AND c.tenant_id=NEW.tenant_id AND c.project_id=NEW.project_id AND c.agent_id=g.coordinator_agent_id
    AND c.content_state='active') THEN RAISE EXCEPTION 'An exact current team review and customer approval are required' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION check_agent_group_scope() OWNER TO cp_control;
REVOKE ALL ON FUNCTION check_agent_group_scope() FROM PUBLIC;
CREATE TRIGGER group_scope BEFORE INSERT OR UPDATE ON agent_groups FOR EACH ROW EXECUTE FUNCTION check_agent_group_scope();
CREATE TRIGGER group_member_scope BEFORE INSERT ON agent_group_members FOR EACH ROW EXECUTE FUNCTION check_agent_group_scope();
CREATE TRIGGER group_run_scope BEFORE INSERT ON agent_group_runs FOR EACH ROW EXECUTE FUNCTION check_agent_group_scope();

CREATE FUNCTION check_agent_group_task() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r agent_group_runs; n agent_group_nodes; definition jsonb;
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.agent_group_run_id,NEW.agent_group_node_key) IS DISTINCT FROM ROW(OLD.agent_group_run_id,OLD.agent_group_node_key) THEN
  RAISE EXCEPTION 'Task team binding is immutable' USING ERRCODE='23514'; END IF;
 IF NEW.agent_group_run_id IS NULL THEN
  IF TG_OP='INSERT' AND EXISTS(SELECT 1 FROM agent_group_runs WHERE conversation_id=NEW.conversation_id) THEN
   RAISE EXCEPTION 'Team conversations accept only approved bound team tasks' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF TG_OP='INSERT' THEN SELECT * INTO r FROM agent_group_runs WHERE id=NEW.agent_group_run_id FOR UPDATE;
 ELSE SELECT * INTO r FROM agent_group_runs WHERE id=NEW.agent_group_run_id; END IF;
 IF r.id IS NULL OR ROW(NEW.tenant_id,NEW.project_id,NEW.created_by,NEW.private_owner,NEW.conversation_id)
  IS DISTINCT FROM ROW(r.tenant_id,r.project_id,r.created_by,r.private_owner,r.conversation_id)
  OR NEW.execution_location<>'cloud' OR NEW.mode<>'execute' OR NEW.cloud_workflow_run_id IS NOT NULL OR NEW.desktop_workflow_run_id IS NOT NULL THEN
  RAISE EXCEPTION 'Invalid team task scope' USING ERRCODE='23514'; END IF;
 IF TG_OP='INSERT' THEN
  IF r.state<>'running' OR r.content_state<>'active' OR r.deadline_at<=clock_timestamp() THEN RAISE EXCEPTION 'Team run is not active' USING ERRCODE='23514'; END IF;
  IF NEW.agent_group_node_key='coordinator' THEN
   definition:=r.definition->'coordinator';
   IF NEW.parent_id IS NOT NULL OR NEW.status<>'paused' OR r.coordinator_task_id IS NOT NULL THEN RAISE EXCEPTION 'Coordinator must wait for actual member work' USING ERRCODE='23514'; END IF;
  ELSE
   SELECT * INTO n FROM agent_group_nodes WHERE run_id=r.id AND step_key=NEW.agent_group_node_key;
   definition:=n.body;
   IF n.run_id IS NULL OR n.state<>'pending' OR n.task_id IS NOT NULL OR NEW.parent_id IS DISTINCT FROM r.coordinator_task_id
    OR (SELECT count(*) FROM agent_group_nodes WHERE run_id=r.id AND state='active')>=r.max_parallelism
    OR EXISTS(SELECT 1 FROM unnest(n.depends_on) k LEFT JOIN agent_group_nodes d ON d.run_id=r.id AND d.step_key=k
     LEFT JOIN tasks t ON t.id=d.task_id WHERE d.state IS DISTINCT FROM 'succeeded' OR t.status IS DISTINCT FROM 'succeeded' OR t.content_state IS DISTINCT FROM 'active') THEN
    RAISE EXCEPTION 'Team dependencies are not complete' USING ERRCODE='23514'; END IF;
  END IF;
  IF definition IS NULL OR NEW.role_key IS DISTINCT FROM definition->>'role_key' OR NEW.role_hash IS DISTINCT FROM definition->>'role_hash'
   OR NEW.budget_micros IS DISTINCT FROM (definition->>'budget_micros')::bigint
   OR NEW.input_context IS DISTINCT FROM definition->'context'
   OR NEW.title IS DISTINCT FROM definition->>'title' OR NEW.prompt IS DISTINCT FROM definition->>'prompt' THEN RAISE EXCEPTION 'Task differs from approved team member and budget' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.agent_group_node_key='coordinator' AND NEW.status IN('queued','running') AND (TG_OP='INSERT' OR NEW.status IS DISTINCT FROM OLD.status) AND (
  r.state<>'running' OR (SELECT count(*) FROM agent_group_nodes WHERE run_id=r.id)<>jsonb_array_length(r.definition->'nodes')
  OR EXISTS(SELECT 1 FROM agent_group_nodes member_node LEFT JOIN tasks t ON t.id=member_node.task_id WHERE member_node.run_id=r.id
   AND (member_node.state<>'succeeded' OR t.status IS DISTINCT FROM 'succeeded' OR t.content_state IS DISTINCT FROM 'active'))) THEN
  RAISE EXCEPTION 'Coordinator is waiting for actual member results' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION check_agent_group_task() OWNER TO cp_control;
REVOKE ALL ON FUNCTION check_agent_group_task() FROM PUBLIC;
CREATE TRIGGER task_group_scope BEFORE INSERT OR UPDATE ON tasks FOR EACH ROW EXECUTE FUNCTION check_agent_group_task();

-- Bind the actual task before reservation/source validation in the same transaction.
CREATE FUNCTION bind_actual_group_task() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF NEW.agent_group_run_id IS NOT NULL THEN
  IF NEW.agent_group_node_key='coordinator' THEN
   UPDATE agent_group_runs SET coordinator_task_id=NEW.id WHERE id=NEW.agent_group_run_id AND coordinator_task_id IS NULL;
  ELSE
   UPDATE agent_group_nodes SET task_id=NEW.id,state='active' WHERE run_id=NEW.agent_group_run_id AND step_key=NEW.agent_group_node_key AND task_id IS NULL;
  END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION bind_actual_group_task() OWNER TO cp_control;
REVOKE ALL ON FUNCTION bind_actual_group_task() FROM PUBLIC;
CREATE TRIGGER actual_group_task AFTER INSERT ON tasks FOR EACH ROW EXECUTE FUNCTION bind_actual_group_task();

CREATE FUNCTION check_approved_group_node() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r agent_group_runs; definition jsonb; BEGIN
 SELECT * INTO r FROM agent_group_runs WHERE id=NEW.run_id;
 definition:=r.definition->'nodes'->NEW.position;
 IF definition IS NULL OR r.state<>'running' OR NEW.task_id IS NOT NULL OR NEW.state<>'pending'
  OR ROW(NEW.tenant_id,NEW.project_id) IS DISTINCT FROM ROW(r.tenant_id,r.project_id)
  OR NEW.body IS DISTINCT FROM definition OR NEW.step_key IS DISTINCT FROM definition->>'key'
  OR NEW.agent_id::text IS DISTINCT FROM definition->>'agent_id' OR NEW.agent_version IS DISTINCT FROM (definition->>'agent_version')::integer
  OR NEW.role_key IS DISTINCT FROM definition->>'role_key' OR NEW.role_hash IS DISTINCT FROM definition->>'role_hash'
  OR NEW.budget_micros IS DISTINCT FROM (definition->>'budget_micros')::bigint
  OR to_jsonb(NEW.depends_on) IS DISTINCT FROM definition->'depends_on' THEN RAISE EXCEPTION 'Step differs from approved team graph' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION check_approved_group_node() OWNER TO cp_control;
REVOKE ALL ON FUNCTION check_approved_group_node() FROM PUBLIC;
CREATE TRIGGER approved_group_node BEFORE INSERT ON agent_group_nodes FOR EACH ROW EXECUTE FUNCTION check_approved_group_node();

CREATE FUNCTION check_actual_group_assignment() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF TG_TABLE_NAME='agent_group_runs' THEN
  IF NEW.coordinator_task_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.id=NEW.coordinator_task_id AND t.agent_group_run_id=NEW.id AND t.agent_group_node_key='coordinator') THEN
   RAISE EXCEPTION 'Coordinator requires its actual bound task' USING ERRCODE='23514'; END IF;
  IF NEW.state='succeeded' AND OLD.state<>'succeeded' AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.id=NEW.coordinator_task_id AND t.status='succeeded' AND t.content_state='active') THEN
   RAISE EXCEPTION 'Team completion requires the actual coordinator delivery' USING ERRCODE='23514'; END IF;
 ELSE
  IF NEW.task_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.id=NEW.task_id AND t.agent_group_run_id=NEW.run_id AND t.agent_group_node_key=NEW.step_key) THEN
   RAISE EXCEPTION 'Step requires its actual bound task' USING ERRCODE='23514'; END IF;
  IF NEW.state='succeeded' AND OLD.state<>'succeeded' AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.id=NEW.task_id AND t.status='succeeded' AND t.content_state='active') THEN
   RAISE EXCEPTION 'Step completion requires actual completed work' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION check_actual_group_assignment() OWNER TO cp_control;
REVOKE ALL ON FUNCTION check_actual_group_assignment() FROM PUBLIC;
CREATE TRIGGER actual_group_assignment BEFORE UPDATE ON agent_group_runs FOR EACH ROW EXECUTE FUNCTION check_actual_group_assignment();
CREATE TRIGGER actual_group_assignment BEFORE UPDATE ON agent_group_nodes FOR EACH ROW EXECUTE FUNCTION check_actual_group_assignment();

CREATE FUNCTION agent_group_source_manifest(target tasks) RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE r agent_group_runs; n agent_group_nodes; dependencies uuid[];
BEGIN
 IF target.agent_group_run_id IS NULL THEN RETURN jsonb_build_object('targets','[]'::jsonb,'task_ids','[]'::jsonb); END IF;
 SELECT * INTO r FROM agent_group_runs WHERE id=target.agent_group_run_id;
 IF r.id IS NULL OR r.content_state<>'active' OR r.retention_expires_at<=clock_timestamp()
  OR ROW(r.tenant_id,r.project_id,r.created_by,r.private_owner,r.conversation_id)
   IS DISTINCT FROM ROW(target.tenant_id,target.project_id,target.created_by,target.private_owner,target.conversation_id)
  OR NOT EXISTS(SELECT 1 FROM agent_groups g JOIN agent_group_versions v ON v.group_id=g.id AND v.version=r.group_version
    WHERE g.id=r.group_id AND g.content_state='active' AND v.erased_at IS NULL AND v.sha256=r.definition->>'group_version_hash') THEN RETURN NULL; END IF;
 IF target.agent_group_node_key='coordinator' THEN
  IF target.attempt>0 OR target.status IN('queued','running','succeeded') THEN
   IF EXISTS(SELECT 1 FROM agent_group_nodes x LEFT JOIN tasks t ON t.id=x.task_id WHERE x.run_id=r.id AND
    (x.state<>'succeeded' OR t.status IS DISTINCT FROM 'succeeded' OR t.content_state IS DISTINCT FROM 'active')) THEN RETURN NULL; END IF;
   SELECT array_agg(task_id ORDER BY position) INTO dependencies FROM agent_group_nodes WHERE run_id=r.id;
  END IF;
 ELSE
  SELECT * INTO n FROM agent_group_nodes WHERE run_id=r.id AND step_key=target.agent_group_node_key AND task_id=target.id;
  IF n.run_id IS NULL THEN RETURN NULL; END IF;
  IF EXISTS(SELECT 1 FROM unnest(n.depends_on) k LEFT JOIN agent_group_nodes d ON d.run_id=r.id AND d.step_key=k
    LEFT JOIN tasks t ON t.id=d.task_id WHERE d.state IS DISTINCT FROM 'succeeded' OR t.status IS DISTINCT FROM 'succeeded' OR t.content_state IS DISTINCT FROM 'active') THEN RETURN NULL; END IF;
  SELECT array_agg(d.task_id ORDER BY d.position) INTO dependencies FROM agent_group_nodes d WHERE d.run_id=r.id AND d.step_key=ANY(n.depends_on);
 END IF;
 RETURN jsonb_build_object('targets',jsonb_build_array(jsonb_build_object('kind','agent_groups','id',r.group_id),jsonb_build_object('kind','agent_group_runs','id',r.id)),
  'task_ids',to_jsonb(coalesce(dependencies,'{}'::uuid[])));
END $$;
ALTER FUNCTION agent_group_source_manifest(tasks) OWNER TO cp_control;
REVOKE ALL ON FUNCTION agent_group_source_manifest(tasks) FROM PUBLIC;

DO $$ DECLARE definition text; anchor text; hook text; BEGIN
 definition:=pg_get_functiondef('content_source_manifest_before_creative_feedback(uuid,uuid,uuid[],uuid[])'::regprocedure);
 anchor:='   IF source_task.input_context ? ''agent_id'' THEN';
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Unexpected team source traversal anchor'; END IF;
 hook:=$hook$   DECLARE group_sources jsonb; BEGIN
    group_sources:=agent_group_source_manifest(source_task);
    IF group_sources IS NULL THEN RETURN NULL; END IF;
    targets:=targets||(group_sources->'targets');
    pending_tasks:=pending_tasks||ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(group_sources->'task_ids'));
   END;
$hook$;
 EXECUTE replace(definition,anchor,hook||anchor);
 definition:=pg_get_functiondef('lock_task_content_sources(uuid)'::regprocedure);
 anchor:='''project_configurations'']';
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Missing team source lock anchor'; END IF;
 EXECUTE replace(definition,anchor,'''project_configurations'',''agent_groups'',''agent_group_runs'']');
 definition:=pg_get_functiondef('publication_input_sources(uuid,uuid)'::regprocedure);
 anchor:='   IF task_row.input_context ? ''plan_source_task_id'' THEN';
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Missing team publication traversal anchor'; END IF;
 hook:=$hook$   pending_tasks:=pending_tasks||ARRAY(SELECT value::uuid FROM jsonb_array_elements_text(agent_group_source_manifest(task_row)->'task_ids'));
$hook$;
 EXECUTE replace(definition,anchor,hook||anchor);
END $$;

CREATE FUNCTION withdraw_agent_group_content() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.content_state='active' THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='agent_groups' THEN
  UPDATE agent_group_runs SET content_state=NEW.content_state,moderation_version=moderation_version+1
   WHERE group_id=NEW.id AND content_state<>NEW.content_state AND content_state<>'deleted';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION withdraw_agent_group_content() OWNER TO cp_control;
REVOKE ALL ON FUNCTION withdraw_agent_group_content() FROM PUBLIC;
CREATE TRIGGER group_withdrawal AFTER UPDATE OF content_state ON agent_groups FOR EACH ROW EXECUTE FUNCTION withdraw_agent_group_content();
CREATE TRIGGER group_run_withdrawal AFTER UPDATE OF content_state ON agent_group_runs FOR EACH ROW EXECUTE FUNCTION withdraw_agent_group_content();
CREATE TRIGGER group_erasure BEFORE UPDATE OF content_state ON agent_groups FOR EACH ROW EXECUTE FUNCTION journal_content_erasure('content_state');
CREATE TRIGGER group_run_erasure BEFORE UPDATE OF content_state ON agent_group_runs FOR EACH ROW EXECUTE FUNCTION journal_content_erasure('content_state');
CREATE FUNCTION erase_private_group_run() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$ BEGIN
 IF NEW.content_state='deleted' THEN
  UPDATE agent_group_runs SET content_state='deleted',moderation_version=moderation_version+1 WHERE conversation_id=NEW.id AND content_state<>'deleted';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION erase_private_group_run() OWNER TO cp_control;
REVOKE ALL ON FUNCTION erase_private_group_run() FROM PUBLIC;
CREATE TRIGGER private_group_conversation_erased AFTER UPDATE OF content_state ON conversations FOR EACH ROW EXECUTE FUNCTION erase_private_group_run();
INSERT INTO schema_migrations(version) VALUES(108);
