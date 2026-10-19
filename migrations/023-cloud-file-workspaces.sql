-- Persistent cloud metadata is independent of short-lived Codex processes.
CREATE TABLE cloud_workspaces (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 conversation_id uuid, kind text NOT NULL CHECK(kind IN ('project','conversation')),
 private_owner uuid REFERENCES users(id), version integer NOT NULL DEFAULT 1,
 content_state text NOT NULL DEFAULT 'active' CHECK(content_state IN ('active','quarantined','deleted')),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,id),
 CHECK((kind='project' AND conversation_id IS NULL AND private_owner IS NULL) OR
       (kind='conversation' AND conversation_id IS NOT NULL AND private_owner IS NOT NULL)),
 UNIQUE(tenant_id,id)
);
CREATE UNIQUE INDEX cloud_project_workspace ON cloud_workspaces(project_id) WHERE kind='project';
CREATE UNIQUE INDEX cloud_conversation_workspace ON cloud_workspaces(conversation_id) WHERE kind='conversation';
CREATE TABLE workspace_nodes (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 workspace_id uuid NOT NULL, parent_id uuid, name text NOT NULL, kind text NOT NULL CHECK(kind IN ('directory','file')),
 asset_version_id uuid REFERENCES asset_versions(id), root_kind text CHECK(root_kind IN ('attachments','working_files','project_materials','deliverables')),
 version integer NOT NULL DEFAULT 1, content_state text NOT NULL DEFAULT 'active' CHECK(content_state IN ('active','quarantined','deleted')),
 reference_state text NOT NULL DEFAULT 'ready' CHECK(reference_state IN ('ready','unavailable','deleted')),
 moderation_version integer NOT NULL DEFAULT 1, private_owner uuid REFERENCES users(id), created_by uuid REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,workspace_id) REFERENCES cloud_workspaces(tenant_id,id),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 UNIQUE(workspace_id,id), UNIQUE(tenant_id,id),
 FOREIGN KEY(workspace_id,parent_id) REFERENCES workspace_nodes(workspace_id,id),
 CHECK((root_kind IS NULL) OR (parent_id IS NULL AND kind='directory')),
 CHECK(kind='file' OR asset_version_id IS NULL)
);
CREATE UNIQUE INDEX workspace_node_name ON workspace_nodes(workspace_id,parent_id,lower(name)) NULLS NOT DISTINCT WHERE content_state<>'deleted';
CREATE UNIQUE INDEX workspace_system_root ON workspace_nodes(workspace_id,root_kind) WHERE root_kind IS NOT NULL;
CREATE INDEX workspace_node_browse ON workspace_nodes(workspace_id,parent_id,updated_at,id);
CREATE INDEX workspace_node_reference ON workspace_nodes(asset_version_id) WHERE asset_version_id IS NOT NULL;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['cloud_workspaces','workspace_nodes'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING(current_user=''cp_control'' OR tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(current_user=''cp_control'' OR tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
  EXECUTE format('CREATE POLICY private_visibility ON %I AS RESTRICTIVE FOR ALL TO cp_app USING(private_owner IS NULL OR private_owner=nullif(current_setting(''app.actor_id'',true),'''')::uuid) WITH CHECK(private_owner IS NULL OR private_owner=nullif(current_setting(''app.actor_id'',true),'''')::uuid)',t);
  EXECUTE format('CREATE POLICY content_visibility ON %I AS RESTRICTIVE FOR ALL TO cp_app USING(content_state=''active'' OR (content_state=''deleted'' AND current_setting(''app.erasing_content'',true)=''true'')) WITH CHECK(true)',t);
 END LOOP;
END $$;
CREATE POLICY workspace_parent ON workspace_nodes AS RESTRICTIVE FOR ALL TO cp_app
 USING(EXISTS(SELECT 1 FROM cloud_workspaces w WHERE w.id=workspace_id))
 WITH CHECK(EXISTS(SELECT 1 FROM cloud_workspaces w WHERE w.id=workspace_id));
GRANT SELECT ON cloud_workspaces TO cp_app;
GRANT SELECT,INSERT,UPDATE ON workspace_nodes TO cp_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON cloud_workspaces,workspace_nodes TO cp_control;

CREATE FUNCTION guard_workspace_node() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w cloud_workspaces; p workspace_nodes; a assets; depth integer; height integer; circular boolean;
BEGIN
 SELECT * INTO w FROM cloud_workspaces WHERE id=NEW.workspace_id;
 IF w.id IS NULL OR w.tenant_id<>NEW.tenant_id OR w.project_id<>NEW.project_id OR NEW.private_owner IS DISTINCT FROM w.private_owner THEN
  RAISE EXCEPTION 'WORKSPACE_SCOPE_INVALID' USING ERRCODE='23514';
 END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('cloudtree:'||w.project_id,0));
 IF TG_OP='UPDATE' THEN
  IF OLD.content_state='deleted' AND NEW.content_state<>'deleted' THEN RAISE EXCEPTION 'Permanent deletion cannot be restored' USING ERRCODE='23514'; END IF;
  IF NEW.workspace_id<>OLD.workspace_id OR NEW.kind<>OLD.kind OR NEW.root_kind IS DISTINCT FROM OLD.root_kind OR NEW.private_owner IS DISTINCT FROM OLD.private_owner THEN
   RAISE EXCEPTION 'WORKSPACE_SCOPE_IMMUTABLE' USING ERRCODE='23514';
  END IF;
  IF OLD.root_kind IS NOT NULL AND NEW.content_state<>'deleted' AND (NEW.name<>OLD.name OR NEW.parent_id IS DISTINCT FROM OLD.parent_id) THEN
   RAISE EXCEPTION 'WORKSPACE_ROOT_PROTECTED' USING ERRCODE='23514';
  END IF;
 END IF;
 IF NEW.content_state='deleted' THEN RETURN NEW; END IF;
 IF w.content_state<>'active' OR NEW.name<>normalize(NEW.name,NFC) OR char_length(NEW.name) NOT BETWEEN 1 AND 180 OR
  NEW.name IN ('.','..') OR NEW.name ~ '[[:cntrl:]/\\]' OR NEW.name ~ '^[[:space:]]|[[:space:]]$' THEN
  RAISE EXCEPTION 'WORKSPACE_NAME_INVALID' USING ERRCODE='23514';
 END IF;
 IF NEW.parent_id IS NOT NULL THEN
  SELECT * INTO p FROM workspace_nodes WHERE id=NEW.parent_id AND workspace_id=NEW.workspace_id;
  IF p.id IS NULL OR p.kind<>'directory' OR p.content_state<>'active' THEN RAISE EXCEPTION 'WORKSPACE_PARENT_INVALID' USING ERRCODE='23514'; END IF;
  WITH RECURSIVE ancestors AS (
   SELECT id,parent_id,1 AS n FROM workspace_nodes WHERE id=NEW.parent_id
   UNION ALL SELECT x.id,x.parent_id,c.n+1 FROM workspace_nodes x JOIN ancestors c ON x.id=c.parent_id WHERE c.n<=20
  ) SELECT coalesce(max(n),0),coalesce(bool_or(id=NEW.id),false) INTO depth,circular FROM ancestors;
  IF circular OR depth>=20 THEN RAISE EXCEPTION 'WORKSPACE_CYCLE_OR_DEPTH' USING ERRCODE='23514'; END IF;
 ELSE depth:=0;
 END IF;
 IF TG_OP='UPDATE' AND NEW.parent_id IS DISTINCT FROM OLD.parent_id THEN
  WITH RECURSIVE descendants AS (
   SELECT id,1 AS n FROM workspace_nodes WHERE parent_id=NEW.id AND content_state<>'deleted'
   UNION ALL SELECT x.id,c.n+1 FROM workspace_nodes x JOIN descendants c ON x.parent_id=c.id WHERE x.content_state<>'deleted' AND c.n<=20
  ) SELECT coalesce(max(n),0) INTO height FROM descendants;
  IF depth+height>=20 THEN RAISE EXCEPTION 'WORKSPACE_CYCLE_OR_DEPTH' USING ERRCODE='23514'; END IF;
 END IF;
 IF NEW.kind='file' AND (TG_OP='INSERT' OR NEW.asset_version_id IS DISTINCT FROM OLD.asset_version_id) THEN
  SELECT x.* INTO a FROM assets x JOIN asset_versions v ON v.asset_id=x.id WHERE v.id=NEW.asset_version_id AND v.erased_at IS NULL;
  IF a.id IS NULL OR a.state<>'active' OR a.tenant_id<>w.tenant_id OR a.project_id<>w.project_id OR
   (a.private_owner IS NOT NULL AND a.private_owner IS DISTINCT FROM w.private_owner) THEN
   RAISE EXCEPTION 'WORKSPACE_REFERENCE_DENIED' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_workspace_node() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_workspace_node() FROM PUBLIC;
CREATE TRIGGER workspace_node_guard BEFORE INSERT OR UPDATE ON workspace_nodes FOR EACH ROW EXECUTE FUNCTION guard_workspace_node();
CREATE TRIGGER workspace_node_erasure AFTER UPDATE OF content_state ON workspace_nodes FOR EACH ROW EXECUTE FUNCTION journal_content_erasure('content_state');
CREATE FUNCTION version_cloud_workspace() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN UPDATE cloud_workspaces SET version=version+1 WHERE id=NEW.workspace_id; RETURN NEW; END $$;
ALTER FUNCTION version_cloud_workspace() OWNER TO cp_control;
REVOKE ALL ON FUNCTION version_cloud_workspace() FROM PUBLIC;
CREATE TRIGGER cloud_workspace_version AFTER INSERT OR UPDATE ON workspace_nodes FOR EACH ROW EXECUTE FUNCTION version_cloud_workspace();

CREATE FUNCTION provision_cloud_workspace(t uuid,p uuid,c uuid,u uuid) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w uuid; k text;
BEGIN
 IF c IS NULL THEN
  INSERT INTO cloud_workspaces(tenant_id,project_id,kind) VALUES(t,p,'project') ON CONFLICT(project_id) WHERE kind='project' DO NOTHING;
  SELECT id INTO w FROM cloud_workspaces WHERE project_id=p AND kind='project';
 ELSE
  INSERT INTO cloud_workspaces(tenant_id,project_id,conversation_id,kind,private_owner) VALUES(t,p,c,'conversation',u) ON CONFLICT(conversation_id) WHERE kind='conversation' DO NOTHING;
  SELECT id INTO w FROM cloud_workspaces WHERE conversation_id=c AND kind='conversation';
 END IF;
 FOREACH k IN ARRAY CASE WHEN c IS NULL THEN ARRAY['project_materials','deliverables'] ELSE ARRAY['attachments','working_files','deliverables'] END LOOP
  INSERT INTO workspace_nodes(tenant_id,project_id,workspace_id,name,kind,root_kind,private_owner,created_by)
  VALUES(t,p,w,CASE k WHEN 'project_materials' THEN 'Project materials' WHEN 'attachments' THEN 'Attachments' WHEN 'working_files' THEN 'Working files' ELSE 'Deliverables' END,'directory',k,u,u)
  ON CONFLICT(workspace_id,root_kind) WHERE root_kind IS NOT NULL DO NOTHING;
 END LOOP;
 RETURN w;
END $$;
ALTER FUNCTION provision_cloud_workspace(uuid,uuid,uuid,uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION provision_cloud_workspace(uuid,uuid,uuid,uuid) FROM PUBLIC;
CREATE FUNCTION provision_cloud_workspace_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_TABLE_NAME='projects' THEN PERFORM provision_cloud_workspace(NEW.tenant_id,NEW.id,NULL,NULL);
 ELSE PERFORM provision_cloud_workspace(NEW.tenant_id,NEW.project_id,NEW.id,NEW.created_by); END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION provision_cloud_workspace_trigger() OWNER TO cp_control;
REVOKE ALL ON FUNCTION provision_cloud_workspace_trigger() FROM PUBLIC;
CREATE TRIGGER project_cloud_workspace AFTER INSERT ON projects FOR EACH ROW EXECUTE FUNCTION provision_cloud_workspace_trigger();
CREATE TRIGGER conversation_cloud_workspace AFTER INSERT ON conversations FOR EACH ROW EXECUTE FUNCTION provision_cloud_workspace_trigger();
DO $$ DECLARE r record; BEGIN
 FOR r IN SELECT * FROM projects WHERE NOT archived LOOP PERFORM provision_cloud_workspace(r.tenant_id,r.id,NULL,NULL); END LOOP;
 FOR r IN SELECT * FROM conversations WHERE content_state='active' LOOP PERFORM provision_cloud_workspace(r.tenant_id,r.project_id,r.id,r.created_by); END LOOP;
END $$;

CREATE FUNCTION index_cloud_asset_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE a assets; w uuid; folder uuid; c uuid; k text; existing uuid; candidate text;
BEGIN
 SELECT * INTO a FROM assets WHERE id=NEW.asset_id;
 IF a.state<>'active' OR NEW.erased_at IS NOT NULL THEN RETURN NEW; END IF;
 IF a.private_owner IS NOT NULL THEN
  SELECT id INTO c FROM conversations WHERE id::text=NEW.metadata->>'conversation_id' AND created_by=a.private_owner AND content_state='active' AND project_id=a.project_id;
  IF c IS NULL THEN RETURN NEW; END IF;
  SELECT id INTO w FROM cloud_workspaces WHERE conversation_id=c AND content_state='active';
 ELSE SELECT id INTO w FROM cloud_workspaces WHERE project_id=a.project_id AND kind='project' AND content_state='active'; END IF;
 IF w IS NULL THEN RETURN NEW; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('cloudtree:'||a.project_id,0));
 -- Existing references keep their pinned version. Index a new asset once.
 SELECT id INTO existing FROM workspace_nodes WHERE workspace_id=w AND content_state='active' AND id IN
  (SELECT n.id FROM workspace_nodes n JOIN asset_versions v ON v.id=n.asset_version_id WHERE v.asset_id=a.id) ORDER BY created_at,id LIMIT 1;
 IF existing IS NOT NULL THEN RETURN NEW; END IF;
 k:=CASE WHEN NEW.metadata ? 'task_id' OR a.kind='published_deliverable' THEN 'deliverables' ELSE 'project_materials' END;
 IF c IS NOT NULL AND k='project_materials' THEN k:='attachments'; END IF;
 SELECT id INTO folder FROM workspace_nodes WHERE workspace_id=w AND root_kind=k;
 candidate:=left(normalize(regexp_replace(a.name,'[[:cntrl:]/\\]','_','g'),NFC),130);
 candidate:=trim(candidate); IF candidate='' OR candidate IN ('.','..') THEN candidate:='File'; END IF;
 IF EXISTS(SELECT 1 FROM workspace_nodes WHERE workspace_id=w AND parent_id=folder AND lower(name)=lower(candidate) AND content_state<>'deleted') THEN candidate:=candidate||' · '||a.id; END IF;
 INSERT INTO workspace_nodes(tenant_id,project_id,workspace_id,parent_id,name,kind,asset_version_id,private_owner,created_by)
 VALUES(a.tenant_id,a.project_id,w,folder,candidate,'file',NEW.id,a.private_owner,a.created_by);
 RETURN NEW;
END $$;
ALTER FUNCTION index_cloud_asset_version() OWNER TO cp_control;
REVOKE ALL ON FUNCTION index_cloud_asset_version() FROM PUBLIC;
CREATE TRIGGER cloud_asset_index AFTER INSERT ON asset_versions FOR EACH ROW EXECUTE FUNCTION index_cloud_asset_version();
DO $$ DECLARE r record; BEGIN
 -- The trigger cannot be called directly; seed equivalent pinned references.
 FOR r IN SELECT a.*,v.id AS vid,v.metadata FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version WHERE a.state='active' AND v.erased_at IS NULL LOOP
  INSERT INTO workspace_nodes(tenant_id,project_id,workspace_id,parent_id,name,kind,asset_version_id,private_owner,created_by)
  SELECT r.tenant_id,r.project_id,w.id,n.id,left(trim(normalize(regexp_replace(r.name,'[[:cntrl:]/\\]','_','g'),NFC)),125)||' · '||r.id,'file',r.vid,w.private_owner,r.created_by
  FROM cloud_workspaces w JOIN workspace_nodes n ON n.workspace_id=w.id
  WHERE w.project_id=r.project_id AND w.content_state='active' AND
   ((r.private_owner IS NULL AND w.kind='project') OR (w.kind='conversation' AND w.private_owner=r.private_owner AND w.conversation_id::text=r.metadata->>'conversation_id')) AND
   n.root_kind=CASE WHEN r.metadata ? 'task_id' OR r.kind='published_deliverable' THEN 'deliverables' WHEN w.kind='conversation' THEN 'attachments' ELSE 'project_materials' END;
 END LOOP;
END $$;

CREATE FUNCTION cloud_node_ancestors_visible(n uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 WITH RECURSIVE ancestors AS (
  SELECT id,parent_id,content_state,1 AS depth FROM workspace_nodes WHERE id=n
  UNION ALL SELECT x.id,x.parent_id,x.content_state,a.depth+1 FROM workspace_nodes x JOIN ancestors a ON x.id=a.parent_id WHERE a.depth<=20
 ) SELECT coalesce(bool_and(content_state='active'),true) FROM ancestors
$$;
ALTER FUNCTION cloud_node_ancestors_visible(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION cloud_node_ancestors_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION cloud_node_ancestors_visible(uuid) TO cp_app;
CREATE POLICY workspace_ancestor_visibility ON workspace_nodes AS RESTRICTIVE FOR ALL TO cp_app
 USING(cloud_node_ancestors_visible(parent_id) OR (content_state='deleted' AND current_setting('app.erasing_content',true)='true')) WITH CHECK(true);
CREATE FUNCTION cloud_asset_state_trigger() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('cloudtree:'||NEW.project_id,0));
 UPDATE workspace_nodes SET reference_state=CASE NEW.state WHEN 'active' THEN 'ready' WHEN 'deleted' THEN 'deleted' ELSE 'unavailable' END,
  version=version+1,updated_at=now()
 WHERE asset_version_id IN (SELECT id FROM asset_versions WHERE asset_id=NEW.id) AND content_state<>'deleted';
 RETURN NEW;
END $$;
ALTER FUNCTION cloud_asset_state_trigger() OWNER TO cp_control;
REVOKE ALL ON FUNCTION cloud_asset_state_trigger() FROM PUBLIC;
CREATE TRIGGER cloud_asset_state AFTER UPDATE OF state ON assets FOR EACH ROW WHEN(OLD.state IS DISTINCT FROM NEW.state) EXECUTE FUNCTION cloud_asset_state_trigger();
CREATE FUNCTION cloud_node_link_deletions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 INSERT INTO deletion_dependencies(job_id,child_job_id)
 SELECT p.id,c.id FROM workspace_nodes n JOIN deletion_jobs c ON c.target_type='workspace_nodes' AND c.target_id=n.id
 JOIN deletion_jobs p ON p.target_type='workspace_nodes' AND p.target_id=n.parent_id
 WHERE n.content_state='deleted' ON CONFLICT DO NOTHING;
 RETURN NULL;
END $$;
ALTER FUNCTION cloud_node_link_deletions() OWNER TO cp_control;
REVOKE ALL ON FUNCTION cloud_node_link_deletions() FROM PUBLIC;
CREATE TRIGGER zz_cloud_node_dependencies AFTER UPDATE OF content_state ON workspace_nodes FOR EACH STATEMENT EXECUTE FUNCTION cloud_node_link_deletions();
CREATE FUNCTION cloud_conversation_erasure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w uuid; j uuid;
BEGIN
 IF NEW.content_state<>'deleted' THEN RETURN NEW; END IF;
 SELECT id INTO w FROM cloud_workspaces WHERE conversation_id=NEW.id;
 IF w IS NULL THEN RETURN NEW; END IF;
 UPDATE workspace_nodes SET content_state='deleted',version=version+1,moderation_version=moderation_version+1,updated_at=now() WHERE workspace_id=w AND content_state<>'deleted';
 UPDATE cloud_workspaces SET content_state='deleted' WHERE id=w;
 SELECT id INTO j FROM deletion_jobs WHERE target_type='conversations' AND target_id=NEW.id;
 INSERT INTO deletion_dependencies(job_id,child_job_id) SELECT j,d.id FROM deletion_jobs d JOIN workspace_nodes n ON n.id=d.target_id AND d.target_type='workspace_nodes' WHERE n.workspace_id=w ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
ALTER FUNCTION cloud_conversation_erasure() OWNER TO cp_control;
REVOKE ALL ON FUNCTION cloud_conversation_erasure() FROM PUBLIC;
CREATE TRIGGER zz_cloud_conversation_erasure AFTER UPDATE OF content_state ON conversations FOR EACH ROW EXECUTE FUNCTION cloud_conversation_erasure();
INSERT INTO schema_migrations(version) VALUES(23);
