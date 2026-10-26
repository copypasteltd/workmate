-- Ephemeral comparisons contain hashes and capability metadata, not proposal text.
-- Prior configuration, task bindings and publication history are not rewritten.
CREATE TABLE agent_adoption_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tenant_id uuid NOT NULL,
 project_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id),
 session_id uuid NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
 auth_version integer NOT NULL CHECK(auth_version>0),
 kind text NOT NULL CHECK(kind IN ('default_assistant','specialist','conversation')),
 resource_id uuid NOT NULL,
 agent_id uuid NOT NULL,
 conversation_id uuid,
 expected_version integer NOT NULL CHECK(expected_version>0),
 source_hash text NOT NULL CHECK(source_hash ~ '^[a-f0-9]{64}$'),
 proposal_hash text NOT NULL CHECK(proposal_hash ~ '^[a-f0-9]{64}$'),
 context_hash text NOT NULL CHECK(context_hash ~ '^[a-f0-9]{64}$'),
 preview_hash text NOT NULL CHECK(preview_hash ~ '^[a-f0-9]{64}$'),
 comparison jsonb NOT NULL CHECK(jsonb_typeof(comparison)='object'),
 guards jsonb NOT NULL CHECK(jsonb_typeof(guards)='object'),
 created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 consumed_at timestamptz,
 result jsonb,
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY(tenant_id,agent_id) REFERENCES agents(tenant_id,id),
 FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,id),
 CHECK((kind='conversation' AND conversation_id IS NOT NULL AND resource_id=conversation_id)
  OR (kind<>'conversation' AND conversation_id IS NULL AND resource_id=agent_id)),
 CHECK(expires_at>created_at AND expires_at<=created_at+interval '5 minutes'),
 CHECK((consumed_at IS NULL AND result IS NULL) OR
  (consumed_at IS NOT NULL AND jsonb_typeof(result)='object'))
);
CREATE INDEX agent_adoption_preview_owner ON agent_adoption_previews(tenant_id,actor_id,session_id,expires_at);
CREATE INDEX agent_adoption_preview_expiry ON agent_adoption_previews(expires_at);

CREATE FUNCTION guard_agent_adoption_preview() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.expires_at>clock_timestamp() THEN
   RAISE EXCEPTION 'A live adoption comparison cannot be removed' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
 END IF;
 IF (to_jsonb(NEW)-'consumed_at'-'result')<>(to_jsonb(OLD)-'consumed_at'-'result')
  OR OLD.consumed_at IS NOT NULL OR NEW.consumed_at IS NULL OR NEW.result IS NULL
  OR OLD.expires_at<=clock_timestamp() OR NEW.result->>'resource_id' IS DISTINCT FROM OLD.resource_id::text THEN
  RAISE EXCEPTION 'Immutable or already consumed adoption comparison' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_agent_adoption_preview BEFORE UPDATE OR DELETE ON agent_adoption_previews
 FOR EACH ROW EXECUTE FUNCTION guard_agent_adoption_preview();
ALTER TABLE agent_adoption_previews ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_adoption_previews FORCE ROW LEVEL SECURITY;
CREATE POLICY adoption_preview_scope ON agent_adoption_previews
 USING(current_user='cp_control' OR
  (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
   AND actor_id=nullif(current_setting('app.actor_id',true),'')::uuid))
 WITH CHECK(current_user='cp_control' OR
  (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
   AND actor_id=nullif(current_setting('app.actor_id',true),'')::uuid));
GRANT SELECT,INSERT ON agent_adoption_previews TO cp_app,cp_control;
GRANT UPDATE(consumed_at,result) ON agent_adoption_previews TO cp_app,cp_control;
GRANT DELETE ON agent_adoption_previews TO cp_control;

-- Bounded row locks only. Application identities cannot change global Skills.
CREATE FUNCTION lock_adoption_skill_versions(skill_ids uuid[]) RETURNS void
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF skill_ids IS NULL OR cardinality(skill_ids)>40 OR array_position(skill_ids,NULL) IS NOT NULL THEN
  RAISE EXCEPTION 'Invalid bounded adoption Skill lock' USING ERRCODE='23514';
 END IF;
 PERFORM id FROM public.skill_versions WHERE id=ANY(skill_ids) ORDER BY id FOR SHARE;
END $$;
REVOKE ALL ON FUNCTION lock_adoption_skill_versions(uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION lock_adoption_skill_versions(uuid[]) TO cp_app,cp_control;
INSERT INTO schema_migrations(version) VALUES(65);
