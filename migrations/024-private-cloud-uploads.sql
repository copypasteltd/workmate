-- Bind private uploads to the conversation throughout resumable transfer.
ALTER TABLE upload_sessions ADD COLUMN conversation_id uuid;
ALTER TABLE upload_sessions ADD FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,id);
CREATE INDEX upload_conversation ON upload_sessions(conversation_id) WHERE conversation_id IS NOT NULL;
CREATE OR REPLACE FUNCTION index_cloud_asset_version() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
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
 IF c IS NOT NULL AND NEW.metadata->>'workspace_area'='working_files' THEN k:='working_files'; END IF;
 SELECT id INTO folder FROM workspace_nodes WHERE workspace_id=w AND root_kind=k;
 candidate:=left(normalize(regexp_replace(a.name,'[[:cntrl:]/\\]','_','g'),NFC),130);
 candidate:=trim(candidate); IF candidate='' OR candidate IN ('.','..') THEN candidate:='File'; END IF;
 IF EXISTS(SELECT 1 FROM workspace_nodes WHERE workspace_id=w AND parent_id=folder AND lower(name)=lower(candidate) AND content_state<>'deleted') THEN candidate:=candidate||' · '||a.id; END IF;
 INSERT INTO workspace_nodes(tenant_id,project_id,workspace_id,parent_id,name,kind,asset_version_id,private_owner,created_by)
 VALUES(a.tenant_id,a.project_id,w,folder,candidate,'file',NEW.id,a.private_owner,a.created_by);
 RETURN NEW;
END $$;
CREATE OR REPLACE FUNCTION cloud_conversation_erasure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE w uuid; j uuid;
BEGIN
 IF NEW.content_state<>'deleted' THEN RETURN NEW; END IF;
 SELECT id INTO w FROM cloud_workspaces WHERE conversation_id=NEW.id;
 IF w IS NULL THEN RETURN NEW; END IF;
 UPDATE workspace_nodes SET content_state='deleted',version=version+1,moderation_version=moderation_version+1,updated_at=now() WHERE workspace_id=w AND content_state<>'deleted';
 UPDATE cloud_workspaces SET content_state='deleted' WHERE id=w;
 SELECT id INTO j FROM deletion_jobs WHERE target_type='conversations' AND target_id=NEW.id;
 UPDATE upload_sessions SET state='cancelled',filename='[deleted]',result=NULL WHERE conversation_id=NEW.id;
 INSERT INTO deletion_items(job_id,kind,locator) SELECT j,'upload',id::text FROM upload_sessions WHERE conversation_id=NEW.id ON CONFLICT DO NOTHING;
 INSERT INTO deletion_dependencies(job_id,child_job_id) SELECT j,d.id FROM deletion_jobs d JOIN workspace_nodes n ON n.id=d.target_id AND d.target_type='workspace_nodes' WHERE n.workspace_id=w ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;

INSERT INTO schema_migrations(version) VALUES(24);
