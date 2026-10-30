-- Append-only control-plane edits for specialists, brands and all memory scopes.
-- SQL001-130 and their already published evidence remain unchanged.
CREATE TABLE admin_profile_revisions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 kind text NOT NULL CHECK(kind IN('agents','brand_profiles','memories')),
 source_id uuid NOT NULL,target_id uuid NOT NULL,
 tenant_id uuid NOT NULL REFERENCES tenants(id),project_id uuid,
 source_version integer NOT NULL CHECK(source_version>0),
 source_moderation_version integer NOT NULL CHECK(source_moderation_version>=0),
 target_version integer NOT NULL CHECK(target_version=source_version+1),
 before_sha256 text NOT NULL CHECK(before_sha256 ~ '^[a-f0-9]{64}$'),
 after_sha256 text NOT NULL CHECK(after_sha256 ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL REFERENCES admin_principals(id),
 reason text NOT NULL CHECK(length(btrim(reason)) BETWEEN 3 AND 2000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 CHECK(source_id=target_id AND (project_id IS NOT NULL OR kind='memories')),
 UNIQUE(id,actor_id),UNIQUE(kind,target_id,target_version)
);
ALTER TABLE admin_profile_revisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_profile_revisions FORCE ROW LEVEL SECURITY;
CREATE POLICY profile_revision_control ON admin_profile_revisions TO cp_control USING(true) WITH CHECK(true);
REVOKE ALL ON admin_profile_revisions FROM PUBLIC,cp_app,cp_queue;
GRANT SELECT,INSERT ON admin_profile_revisions TO cp_control;
CREATE INDEX profile_revision_history ON admin_profile_revisions(kind,source_id,created_at DESC,id DESC);
CREATE TRIGGER profile_revision_immutable BEFORE UPDATE OR DELETE ON admin_profile_revisions
 FOR EACH ROW EXECUTE FUNCTION immutable_admin_content_revision();

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['agent_versions','memory_versions','brand_profile_versions'] LOOP
  EXECUTE format('ALTER TABLE %I ALTER COLUMN created_by DROP NOT NULL',tab);
  EXECUTE format('ALTER TABLE %I ADD COLUMN created_by_admin uuid REFERENCES admin_principals(id), ADD COLUMN admin_revision_id uuid',tab);
  -- Legacy unattributed brand snapshots remain unattributed; never invent a creator.
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT profile_revision_creator CHECK((created_by_admin IS NULL AND admin_revision_id IS NULL) OR (created_by IS NULL AND created_by_admin IS NOT NULL AND admin_revision_id IS NOT NULL))',tab);
  IF tab<>'brand_profile_versions' THEN
   EXECUTE format('ALTER TABLE %I ADD CONSTRAINT profile_revision_known_creator CHECK(created_by IS NOT NULL OR created_by_admin IS NOT NULL)',tab);
  END IF;
  EXECUTE format('ALTER TABLE %I ADD CONSTRAINT profile_revision_actor FOREIGN KEY(admin_revision_id,created_by_admin) REFERENCES admin_profile_revisions(id,actor_id)',tab);
 END LOOP;
END $$;
ALTER TABLE agent_versions ADD COLUMN revision_sha256 text CHECK(revision_sha256 ~ '^[a-f0-9]{64}$');
ALTER TABLE memory_versions ADD COLUMN revision_sha256 text CHECK(revision_sha256 ~ '^[a-f0-9]{64}$'),ADD COLUMN definition jsonb;

CREATE FUNCTION guard_profile_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE fact admin_profile_revisions; parent record; actual_kind text; actual_id uuid; actual_project uuid; actual_hash text;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(NEW.created_by,NEW.created_by_admin,NEW.admin_revision_id) IS DISTINCT FROM ROW(OLD.created_by,OLD.created_by_admin,OLD.admin_revision_id) THEN
   RAISE EXCEPTION 'Revision provenance is immutable' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='memory_versions' THEN
   IF NEW.content IS NULL AND current_setting('app.erasing_content',true)='true'
    AND (to_jsonb(NEW)-ARRAY['content','definition'])=(to_jsonb(OLD)-ARRAY['content','definition']) THEN
    NEW.definition:=NULL; RETURN NEW;
   END IF;
   RAISE EXCEPTION 'Memory versions are immutable except explicit erasure' USING ERRCODE='23514';
  END IF;
  IF TG_TABLE_NAME='agent_versions' AND to_jsonb(NEW) IS DISTINCT FROM to_jsonb(OLD) THEN
   IF NEW.body='{}'::jsonb AND current_setting('app.erasing_content',true)='true'
    AND (to_jsonb(NEW)-'body')=(to_jsonb(OLD)-'body') THEN RETURN NEW; END IF;
   RAISE EXCEPTION 'Specialist versions are immutable except explicit erasure' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
 END IF;
 IF TG_TABLE_NAME='agent_versions' THEN
  actual_kind:='agents';actual_id:=NEW.agent_id;
  SELECT * INTO parent FROM agents WHERE id=NEW.agent_id;
  actual_project:=parent.project_id;
  NEW.revision_sha256:=encode(digest(NEW.body::text,'sha256'),'hex');actual_hash:=NEW.revision_sha256;
 ELSIF TG_TABLE_NAME='memory_versions' THEN
  actual_kind:='memories';actual_id:=NEW.memory_id;
  SELECT * INTO parent FROM memories WHERE id=NEW.memory_id;
  actual_project:=parent.project_id;
  NEW.definition:=jsonb_build_object('name',parent.name,'content',NEW.content,
   'expires_at',CASE WHEN parent.expires_at IS NULL THEN NULL ELSE to_char(parent.expires_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
   'scope',parent.scope,'project_id',parent.project_id,'brand_id',parent.brand_id,
   'conversation_id',parent.conversation_id,'private_owner',parent.private_owner);
  NEW.revision_sha256:=encode(digest(NEW.definition::text,'sha256'),'hex');actual_hash:=NEW.revision_sha256;
 ELSE
  actual_kind:='brand_profiles';actual_id:=NEW.brand_id;actual_project:=NEW.project_id;actual_hash:=NEW.sha256;
 END IF;
 IF NEW.created_by_admin IS NULL THEN RETURN NEW; END IF;
 IF current_user<>'cp_control' THEN RAISE EXCEPTION 'Only the admin control plane creates administrator revisions' USING ERRCODE='42501'; END IF;
 SELECT * INTO fact FROM admin_profile_revisions WHERE id=NEW.admin_revision_id AND actor_id=NEW.created_by_admin;
 IF fact.id IS NULL OR ROW(fact.kind,fact.target_id,fact.target_version,fact.tenant_id,fact.project_id,fact.after_sha256)
  IS DISTINCT FROM ROW(actual_kind,actual_id,NEW.version,NEW.tenant_id,actual_project,actual_hash) THEN
  RAISE EXCEPTION 'An exact administrator profile revision fact is required' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['agent_versions','memory_versions','brand_profile_versions'] LOOP
  EXECUTE format('CREATE TRIGGER profile_revision_provenance BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION guard_profile_revision()',tab);
 END LOOP;
END $$;

-- Keep the existing automatic snapshot/source validation, adding a separately
-- attributed administrator path. Untrusted application GUCs cannot select it.
CREATE OR REPLACE FUNCTION snapshot_brand_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE r record; source asset_versions; asset assets; admin_fact admin_profile_revisions; revision_id uuid;
BEGIN
 IF TG_OP='UPDATE' AND NEW.content_state='deleted' THEN
  PERFORM set_config('app.erasing_brand','true',true);
  UPDATE brand_profile_versions SET body='{}',name='[deleted]',erased_at=clock_timestamp() WHERE brand_id=NEW.id AND erased_at IS NULL;
  PERFORM set_config('app.erasing_brand','false',true); RETURN NEW;
 END IF;
 IF TG_OP='UPDATE' AND NEW.version=OLD.version THEN
  IF ROW(NEW.body,NEW.name) IS DISTINCT FROM ROW(OLD.body,OLD.name) THEN RAISE EXCEPTION 'Publish a new brand version' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF (TG_OP='UPDATE' AND (NEW.version<>OLD.version+1 OR OLD.content_state<>'active')) OR (TG_OP='INSERT' AND NEW.version<>1) THEN
  RAISE EXCEPTION 'Brand versions must be consecutive publications' USING ERRCODE='23514'; END IF;
 IF session_user='cp_control' OR current_setting('role',true)='cp_control' THEN
  revision_id:=nullif(current_setting('app.admin_profile_revision_id',true),'')::uuid;
 END IF;
 IF revision_id IS NOT NULL THEN
  SELECT * INTO admin_fact FROM admin_profile_revisions WHERE id=revision_id AND kind='brand_profiles'
   AND target_id=NEW.id AND target_version=NEW.version AND tenant_id=NEW.tenant_id AND project_id=NEW.project_id;
  IF admin_fact.id IS NULL THEN RAISE EXCEPTION 'Brand administrator revision context mismatch' USING ERRCODE='23514'; END IF;
 END IF;
 INSERT INTO brand_profile_versions(brand_id,version,tenant_id,project_id,name,body,sha256,created_by,created_by_admin,admin_revision_id)
 VALUES(NEW.id,NEW.version,NEW.tenant_id,NEW.project_id,NEW.name,NEW.body,
  encode(digest(jsonb_build_object('name',NEW.name,'body',NEW.body)::text,'sha256'),'hex'),
  CASE WHEN revision_id IS NULL THEN nullif(current_setting('app.actor_id',true),'')::uuid ELSE NULL END,
  admin_fact.actor_id,revision_id);
 IF NEW.body->>'schema_version'='2' THEN
  FOR r IN SELECT 'logo' AS kind,x->>'key' AS source_key,x AS source FROM jsonb_array_elements(NEW.body->'logos') x
   UNION ALL SELECT 'font',x->>'key',x->'source' FROM jsonb_array_elements(NEW.body->'font_bindings') x WHERE x->'source' ? 'asset_id' LOOP
   SELECT * INTO source FROM asset_versions v WHERE v.asset_id=(r.source->>'asset_id')::uuid AND v.version=(r.source->>'version')::int;
   SELECT * INTO asset FROM assets a WHERE a.id=source.asset_id FOR SHARE;
   IF asset.id IS NULL OR asset.tenant_id<>NEW.tenant_id OR asset.project_id<>NEW.project_id OR asset.private_owner IS NOT NULL OR asset.state<>'active' OR source.erased_at IS NOT NULL OR asset.retention_expires_at<=clock_timestamp() THEN
    RAISE EXCEPTION 'Brand sources must be active shared project versions' USING ERRCODE='23514'; END IF;
   INSERT INTO brand_version_assets(brand_id,version,tenant_id,project_id,kind,source_key,asset_version_id)
    VALUES(NEW.id,NEW.version,NEW.tenant_id,NEW.project_id,r.kind,r.source_key,source.id);
  END LOOP;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION snapshot_brand_version() OWNER TO cp_control;
REVOKE ALL ON FUNCTION snapshot_brand_version() FROM PUBLIC;

CREATE FUNCTION verify_admin_profile_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE found boolean;
BEGIN
 IF NEW.kind='agents' THEN
  SELECT EXISTS(SELECT 1 FROM agent_versions v JOIN agents p ON p.id=v.agent_id
   WHERE v.agent_id=NEW.target_id AND v.version=NEW.target_version AND v.admin_revision_id=NEW.id AND v.created_by_admin=NEW.actor_id
   AND v.revision_sha256=NEW.after_sha256 AND v.tenant_id=NEW.tenant_id AND p.project_id=NEW.project_id) INTO found;
 ELSIF NEW.kind='memories' THEN
  SELECT EXISTS(SELECT 1 FROM memory_versions v JOIN memories p ON p.id=v.memory_id
   WHERE v.memory_id=NEW.target_id AND v.version=NEW.target_version AND v.admin_revision_id=NEW.id AND v.created_by_admin=NEW.actor_id
   AND v.revision_sha256=NEW.after_sha256 AND v.tenant_id=NEW.tenant_id AND p.project_id IS NOT DISTINCT FROM NEW.project_id) INTO found;
 ELSE
  SELECT EXISTS(SELECT 1 FROM brand_profile_versions v WHERE v.brand_id=NEW.target_id AND v.version=NEW.target_version
   AND v.admin_revision_id=NEW.id AND v.created_by_admin=NEW.actor_id AND v.sha256=NEW.after_sha256
   AND v.tenant_id=NEW.tenant_id AND v.project_id=NEW.project_id) INTO found;
 END IF;
 IF NOT found OR NOT EXISTS(SELECT 1 FROM audit_log a WHERE a.actor_kind='admin' AND a.principal_id=NEW.actor_id
  AND a.action='admin.content.revision.create' AND a.target=NEW.id::text AND a.outcome='succeeded') THEN
  RAISE EXCEPTION 'A committed profile version and matching audit are required' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER profile_revision_requires_version AFTER INSERT ON admin_profile_revisions
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION verify_admin_profile_revision();

INSERT INTO schema_migrations(version) VALUES(131);
