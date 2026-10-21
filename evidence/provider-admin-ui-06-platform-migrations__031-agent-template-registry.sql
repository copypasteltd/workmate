-- Database identities for reviewed preset versions and their Codex-only profile.
CREATE TABLE codex_runtime_profiles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), fingerprint text NOT NULL UNIQUE,
 profile_key text NOT NULL, kernel text NOT NULL CHECK(kernel='codex'),
 pinned_version text NOT NULL, transport text NOT NULL CHECK(transport='stdio'),
 gateway_policy text NOT NULL CHECK(gateway_policy='company_internal_only'),
 automatic_fallback boolean NOT NULL DEFAULT false CHECK(NOT automatic_fallback),
 state text NOT NULL DEFAULT 'enabled' CHECK(state IN ('enabled','revoked')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION guard_codex_profile() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-'state')<>(to_jsonb(OLD)-'state') OR (OLD.state='revoked' AND NEW.state<>'revoked') THEN
  RAISE EXCEPTION 'Immutable Codex profile or irreversible revocation' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_codex_profile BEFORE UPDATE ON codex_runtime_profiles FOR EACH ROW EXECUTE FUNCTION guard_codex_profile();
CREATE TABLE internal_capability_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), fingerprint text NOT NULL UNIQUE,
 profile_key text NOT NULL, data_mode text NOT NULL CHECK(data_mode IN ('simulated','configured_services')),
 body jsonb NOT NULL, ready boolean NOT NULL, revoked boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE FUNCTION guard_capability_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (to_jsonb(NEW)-'revoked')<>(to_jsonb(OLD)-'revoked') OR (OLD.revoked AND NOT NEW.revoked) THEN
  RAISE EXCEPTION 'Immutable capability version or irreversible revocation' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER immutable_capability_version BEFORE UPDATE ON internal_capability_versions FOR EACH ROW EXECUTE FUNCTION guard_capability_version();
CREATE TABLE agent_templates (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), role_key text NOT NULL UNIQUE,
 current_version integer NOT NULL DEFAULT 1 CHECK(current_version>0),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE agent_template_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), template_id uuid NOT NULL REFERENCES agent_templates(id),
 version integer NOT NULL CHECK(version>0), definition_hash text NOT NULL,
 runtime_profile_id uuid NOT NULL REFERENCES codex_runtime_profiles(id),
 body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(template_id,version),UNIQUE(template_id,definition_hash)
);
CREATE FUNCTION guard_template_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 RAISE EXCEPTION 'Immutable reviewed template version' USING ERRCODE='23514';
END $$;
CREATE TRIGGER immutable_template_version BEFORE UPDATE OR DELETE ON agent_template_versions FOR EACH ROW EXECUTE FUNCTION guard_template_version();
CREATE TABLE agent_template_preflights (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id), template_version_id uuid NOT NULL REFERENCES agent_template_versions(id),
 request_hash text NOT NULL, result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL,
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
CREATE INDEX agent_template_preflights_scope ON agent_template_preflights(tenant_id,actor_id,expires_at);
ALTER TABLE agent_template_preflights ENABLE ROW LEVEL SECURITY;
ALTER TABLE agent_template_preflights FORCE ROW LEVEL SECURITY;
CREATE POLICY template_preflight_scope ON agent_template_preflights USING (
 current_user='cp_control' OR (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND actor_id=nullif(current_setting('app.actor_id',true),'')::uuid)
);
ALTER TABLE agent_versions ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE;
ALTER TABLE agent_versions ADD COLUMN template_version_id uuid REFERENCES agent_template_versions(id);
ALTER TABLE agent_versions ADD COLUMN runtime_profile_id uuid REFERENCES codex_runtime_profiles(id);
CREATE FUNCTION bind_agent_template_runtime() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE profile codex_runtime_profiles;
BEGIN
 IF NEW.body->>'kernel' IS DISTINCT FROM 'codex' OR NEW.body->>'runtime_profile_id' IS NULL THEN
  RAISE EXCEPTION 'A new specialist version requires a pinned Codex profile' USING ERRCODE='23514';
 END IF;
 NEW.runtime_profile_id:=(NEW.body->>'runtime_profile_id')::uuid;
 SELECT * INTO profile FROM codex_runtime_profiles WHERE id=NEW.runtime_profile_id;
 IF profile.state IS DISTINCT FROM 'enabled' OR profile.pinned_version IS DISTINCT FROM NEW.body->>'runtime_version' THEN
  RAISE EXCEPTION 'Unavailable or mismatched Codex profile' USING ERRCODE='23514';
 END IF;
 NEW.template_version_id:=nullif(NEW.body->>'template_version_id','')::uuid;
 RETURN NEW;
END $$;
CREATE TRIGGER bind_agent_template_runtime BEFORE INSERT ON agent_versions FOR EACH ROW EXECUTE FUNCTION bind_agent_template_runtime();
GRANT SELECT ON codex_runtime_profiles,agent_templates,agent_template_versions TO cp_app,cp_control;
GRANT SELECT,INSERT ON agent_template_preflights TO cp_app,cp_control;
GRANT INSERT,UPDATE ON codex_runtime_profiles,agent_templates TO cp_control;
GRANT INSERT ON agent_template_versions TO cp_control;
GRANT SELECT ON internal_capability_versions TO cp_app,cp_control;
GRANT INSERT,UPDATE ON internal_capability_versions TO cp_control;
