CREATE TABLE agents (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 name text NOT NULL, role_key text NOT NULL, version integer NOT NULL DEFAULT 1,
 enabled boolean NOT NULL DEFAULT true, created_by uuid NOT NULL REFERENCES users(id),
 content_state text NOT NULL DEFAULT 'active' CHECK(content_state IN ('active','quarantined','deleted')),
 moderation_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(),
 updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id), UNIQUE(tenant_id,id)
);
CREATE TABLE agent_versions (
 tenant_id uuid NOT NULL, agent_id uuid NOT NULL, version integer NOT NULL,
 body jsonb NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(agent_id,version), FOREIGN KEY(tenant_id,agent_id) REFERENCES agents(tenant_id,id)
);
CREATE TABLE conversations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 agent_id uuid NOT NULL, agent_version integer NOT NULL, created_by uuid NOT NULL REFERENCES users(id),
 name text NOT NULL, pinned boolean NOT NULL DEFAULT false, archived boolean NOT NULL DEFAULT false,
 version integer NOT NULL DEFAULT 1,
 content_state text NOT NULL DEFAULT 'active' CHECK(content_state IN ('active','quarantined','deleted')),
 moderation_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY(tenant_id,agent_id) REFERENCES agents(tenant_id,id),
 FOREIGN KEY(agent_id,agent_version) REFERENCES agent_versions(agent_id,version), UNIQUE(tenant_id,id)
);
CREATE INDEX conversations_owner ON conversations(tenant_id,project_id,created_by,archived,pinned,updated_at);
ALTER TABLE tasks ADD COLUMN conversation_id uuid;
ALTER TABLE tasks ADD COLUMN private_owner uuid REFERENCES users(id);
ALTER TABLE tasks ADD COLUMN mode text NOT NULL DEFAULT 'execute' CHECK(mode IN ('execute','ask','plan'));
ALTER TABLE tasks ADD COLUMN input_context jsonb NOT NULL DEFAULT '{}';
ALTER TABLE tasks ADD FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,id);
CREATE UNIQUE INDEX conversation_one_active_task ON tasks(conversation_id)
 WHERE conversation_id IS NOT NULL AND status IN ('queued','running','awaiting_approval','paused','reconciling');
CREATE TABLE conversation_messages (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 conversation_id uuid NOT NULL, client_message_id uuid NOT NULL,
 role text NOT NULL CHECK(role IN ('user','assistant')), intent text NOT NULL CHECK(intent IN ('note','delegate','result')),
 body text NOT NULL, task_id uuid REFERENCES tasks(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,id), UNIQUE(conversation_id,client_message_id)
);
CREATE INDEX conversation_message_order ON conversation_messages(conversation_id,created_at,id);
CREATE TABLE memories (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), project_id uuid,
 brand_id uuid, conversation_id uuid, private_owner uuid REFERENCES users(id),
 scope text NOT NULL CHECK(scope IN ('tenant','brand','project','conversation','personal')),
 name text NOT NULL, version integer NOT NULL DEFAULT 1, expires_at timestamptz,
 created_by uuid NOT NULL REFERENCES users(id),
 content_state text NOT NULL DEFAULT 'active' CHECK(content_state IN ('active','quarantined','deleted')),
 moderation_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY(tenant_id,brand_id) REFERENCES brand_profiles(tenant_id,id),
 FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,id), UNIQUE(tenant_id,id),
 CHECK((scope='tenant' AND project_id IS NULL AND brand_id IS NULL AND conversation_id IS NULL AND private_owner IS NULL)
 OR (scope='personal' AND project_id IS NULL AND brand_id IS NULL AND conversation_id IS NULL AND private_owner IS NOT NULL)
 OR (scope='project' AND project_id IS NOT NULL AND brand_id IS NULL AND conversation_id IS NULL AND private_owner IS NULL)
 OR (scope='brand' AND project_id IS NOT NULL AND brand_id IS NOT NULL AND conversation_id IS NULL AND private_owner IS NULL)
 OR (scope='conversation' AND project_id IS NOT NULL AND brand_id IS NULL AND conversation_id IS NOT NULL AND private_owner IS NOT NULL))
);
CREATE TABLE memory_versions (
 tenant_id uuid NOT NULL, memory_id uuid NOT NULL, version integer NOT NULL,
 content text, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(memory_id,version), FOREIGN KEY(tenant_id,memory_id) REFERENCES memories(tenant_id,id)
);
CREATE TABLE task_plans (
 task_id uuid PRIMARY KEY REFERENCES tasks(id), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 version integer NOT NULL DEFAULT 1, input_hash text NOT NULL, body text NOT NULL,
 conversation_version integer, approval_hash text,
 approved_task_id uuid REFERENCES tasks(id), approved_by uuid REFERENCES users(id), approved_at timestamptz,
 FOREIGN KEY(tenant_id,task_id) REFERENCES tasks(tenant_id,id)
);
ALTER TABLE assets ADD COLUMN private_owner uuid REFERENCES users(id);
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['agents','agent_versions','conversations','conversation_messages','memories','memory_versions','task_plans'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (current_user=''cp_control'' OR tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (current_user=''cp_control'' OR tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['agents','conversations','memories'] LOOP
  EXECUTE format('CREATE POLICY content_visibility ON %I AS RESTRICTIVE FOR ALL TO cp_app USING(content_state=''active'') WITH CHECK(true)',t);
 END LOOP;
 FOREACH t IN ARRAY ARRAY['tasks','assets','memories'] LOOP
  EXECUTE format('CREATE POLICY private_visibility ON %I AS RESTRICTIVE FOR ALL TO cp_app USING(private_owner IS NULL OR private_owner=nullif(current_setting(''app.actor_id'',true),'''')::uuid) WITH CHECK(private_owner IS NULL OR private_owner=nullif(current_setting(''app.actor_id'',true),'''')::uuid)',t);
 END LOOP;
END $$;
CREATE POLICY conversation_owner ON conversations AS RESTRICTIVE FOR ALL TO cp_app
 USING(created_by=nullif(current_setting('app.actor_id',true),'')::uuid)
 WITH CHECK(created_by=nullif(current_setting('app.actor_id',true),'')::uuid);
CREATE POLICY message_owner ON conversation_messages AS RESTRICTIVE FOR ALL TO cp_app
 USING(EXISTS(SELECT 1 FROM conversations c WHERE c.id=conversation_id))
 WITH CHECK(EXISTS(SELECT 1 FROM conversations c WHERE c.id=conversation_id));
CREATE POLICY memory_parent ON memory_versions AS RESTRICTIVE FOR ALL TO cp_app
 USING(EXISTS(SELECT 1 FROM memories m WHERE m.id=memory_id))
 WITH CHECK(EXISTS(SELECT 1 FROM memories m WHERE m.id=memory_id));
CREATE POLICY agent_parent ON agent_versions AS RESTRICTIVE FOR ALL TO cp_app
 USING(EXISTS(SELECT 1 FROM agents a WHERE a.id=agent_id))
 WITH CHECK(EXISTS(SELECT 1 FROM agents a WHERE a.id=agent_id));
CREATE POLICY task_event_parent ON task_events AS RESTRICTIVE FOR ALL TO cp_app
 USING(EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id))
 WITH CHECK(EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id));
CREATE POLICY task_plan_parent ON task_plans AS RESTRICTIVE FOR ALL TO cp_app
 USING(EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id))
 WITH CHECK(EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id));
CREATE POLICY asset_version_parent ON asset_versions AS RESTRICTIVE FOR ALL TO cp_app
 USING(EXISTS(SELECT 1 FROM assets a WHERE a.id=asset_id))
 WITH CHECK(EXISTS(SELECT 1 FROM assets a WHERE a.id=asset_id));
CREATE POLICY task_operation_parent ON tool_operations AS RESTRICTIVE FOR ALL TO cp_app
 USING(EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id))
 WITH CHECK(EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id));
GRANT SELECT,INSERT,UPDATE,DELETE ON agents,conversations,conversation_messages,memories,task_plans TO cp_app;
ALTER POLICY content_visibility ON tasks WITH CHECK(true);
GRANT DELETE ON task_events TO cp_app;
GRANT SELECT,INSERT ON agent_versions,memory_versions TO cp_app;
GRANT UPDATE(content) ON memory_versions TO cp_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON agents,agent_versions,conversations,conversation_messages,memories,memory_versions,task_plans TO cp_control;
INSERT INTO schema_migrations(version) VALUES(5);
