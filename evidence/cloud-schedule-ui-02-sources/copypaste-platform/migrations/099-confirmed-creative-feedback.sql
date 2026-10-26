-- SQL001-098 remain immutable. Identity assertions and measured ad facts are
-- separate: no candidate/name match is an allocation of campaign performance.
CREATE TABLE creative_mappings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL REFERENCES tenants(id),project_id uuid NOT NULL REFERENCES projects(id),
 name text NOT NULL,body jsonb NOT NULL,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 asset_version_id uuid NOT NULL REFERENCES asset_versions(id),dataset_id uuid NOT NULL REFERENCES analytics_datasets(id),
 platform text NOT NULL CHECK(platform IN('google_ads','meta_ads')),account_id text NOT NULL,
 channel text NOT NULL,ad_id text NOT NULL,creative_id text NOT NULL,date_from date NOT NULL,date_to date NOT NULL CHECK(date_to>=date_from),
 state text NOT NULL DEFAULT 'candidate' CHECK(state IN('candidate','confirmed','withdrawn')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),created_by uuid NOT NULL REFERENCES users(id),
 confirmed_by uuid REFERENCES users(id),confirmed_at timestamptz,withdrawn_by uuid REFERENCES users(id),withdrawn_at timestamptz,withdrawal_reason text,
 content_state text NOT NULL DEFAULT 'active' CHECK(content_state IN('active','quarantined','deleted')),
 moderation_version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 retention_expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '90 days',
 UNIQUE(id,tenant_id,project_id),FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 CHECK((confirmed_by IS NULL)=(confirmed_at IS NULL)),CHECK((withdrawn_by IS NULL)=(withdrawn_at IS NULL)),
 CHECK(state<>'confirmed' OR confirmed_at IS NOT NULL),CHECK((state='withdrawn')=(withdrawn_at IS NOT NULL))
);
CREATE INDEX creative_mapping_scope ON creative_mappings(project_id,created_at DESC,id);
CREATE INDEX creative_mapping_identity ON creative_mappings(project_id,platform,account_id,channel,ad_id,date_from,date_to) WHERE state='confirmed' AND content_state='active';
CREATE TABLE creative_feedback_reports (
 id uuid PRIMARY KEY,tenant_id uuid NOT NULL REFERENCES tenants(id),project_id uuid NOT NULL REFERENCES projects(id),
 name text NOT NULL,body jsonb NOT NULL,sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),
 asset_version_id uuid NOT NULL UNIQUE REFERENCES asset_versions(id),created_by uuid NOT NULL REFERENCES users(id),
 content_state text NOT NULL DEFAULT 'active' CHECK(content_state IN('active','quarantined','deleted')),
 moderation_version integer NOT NULL DEFAULT 1,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 retention_expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '90 days',
 UNIQUE(id,tenant_id,project_id),FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
CREATE TABLE creative_feedback_mappings (
 report_id uuid NOT NULL,mapping_id uuid NOT NULL,tenant_id uuid NOT NULL,project_id uuid NOT NULL,mapping_version integer NOT NULL,
 PRIMARY KEY(report_id,mapping_id),
 FOREIGN KEY(report_id,tenant_id,project_id) REFERENCES creative_feedback_reports(id,tenant_id,project_id),
 FOREIGN KEY(mapping_id,tenant_id,project_id) REFERENCES creative_mappings(id,tenant_id,project_id)
);
CREATE INDEX creative_feedback_mapping_lookup ON creative_feedback_mappings(mapping_id,report_id);
CREATE INDEX creative_mapping_retention ON creative_mappings(retention_expires_at) WHERE content_state<>'deleted';
CREATE INDEX creative_feedback_retention ON creative_feedback_reports(retention_expires_at) WHERE content_state<>'deleted';

CREATE FUNCTION creative_feedback_project_access(tenant uuid,project uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT tenant=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(
  SELECT 1 FROM memberships m JOIN users u ON u.id=m.user_id JOIN tenants t ON t.id=m.tenant_id JOIN projects p ON p.id=project AND p.tenant_id=t.id
  WHERE m.tenant_id=tenant AND m.user_id=nullif(current_setting('app.actor_id',true),'')::uuid
   AND m.status='active' AND u.status='active' AND t.status='active' AND NOT p.archived
   AND (m.role IN('owner','admin') OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.project_id=p.id AND pm.user_id=m.user_id)))
$$;
ALTER FUNCTION creative_feedback_project_access(uuid,uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION creative_feedback_project_access(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION creative_feedback_project_access(uuid,uuid) TO cp_app,cp_control;

CREATE FUNCTION creative_mapping_sources_available(mapping uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT EXISTS(SELECT 1 FROM creative_mappings m JOIN asset_versions v ON v.id=m.asset_version_id JOIN assets a ON a.id=v.asset_id
  JOIN analytics_datasets d ON d.id=m.dataset_id
  WHERE m.id=mapping AND m.content_state='active' AND m.retention_expires_at>clock_timestamp() AND a.tenant_id=m.tenant_id AND a.project_id=m.project_id AND a.private_owner IS NULL
   AND a.state='active' AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL AND v.sha256=m.body->'asset'->>'sha256'
   AND d.tenant_id=m.tenant_id AND d.project_id=m.project_id AND d.content_state='active' AND d.source_state='active'
   AND d.retention_expires_at>clock_timestamp() AND d.source_sha256=m.body->'dataset'->>'source_sha256' AND d.spec_hash=m.body->'dataset'->>'spec_hash'
   AND (d.source_asset_version_id IS NOT NULL OR d.raw_csv IS NOT NULL)
   AND content_source_manifest(m.tenant_id,m.project_id,'{}',ARRAY[v.id]) IS NOT NULL
   AND (d.source_asset_version_id IS NULL OR EXISTS(SELECT 1 FROM asset_versions x JOIN assets f ON f.id=x.asset_id
    WHERE x.id=d.source_asset_version_id AND x.erased_at IS NULL AND f.state='active' AND f.private_owner IS NULL
     AND f.tenant_id=m.tenant_id AND f.project_id=m.project_id AND f.retention_expires_at>clock_timestamp()
     AND x.sha256=d.source_sha256 AND content_source_manifest(m.tenant_id,m.project_id,'{}',ARRAY[x.id]) IS NOT NULL)))
$$;
ALTER FUNCTION creative_mapping_sources_available(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION creative_mapping_sources_available(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION creative_mapping_sources_available(uuid) TO cp_app,cp_control;

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['creative_mappings','creative_feedback_reports','creative_feedback_mappings'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY creative_control ON %I TO cp_control USING(true) WITH CHECK(true)',tab);
  EXECUTE format('REVOKE ALL ON %I FROM PUBLIC,cp_app,cp_queue',tab);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO cp_control',tab);
 END LOOP;
END $$;
CREATE POLICY creative_mapping_read ON creative_mappings FOR SELECT TO cp_app USING(
 creative_feedback_project_access(tenant_id,project_id) AND creative_mapping_sources_available(id));
CREATE POLICY creative_feedback_read ON creative_feedback_reports FOR SELECT TO cp_app USING(
 content_state='active' AND retention_expires_at>clock_timestamp() AND creative_feedback_project_access(tenant_id,project_id) AND EXISTS(
  SELECT 1 FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=asset_version_id AND a.state='active'
   AND a.retention_expires_at>clock_timestamp() AND v.erased_at IS NULL
   AND task_asset_version_sources_available(v.id)));
GRANT SELECT ON creative_mappings,creative_feedback_reports TO cp_app;

CREATE FUNCTION guard_creative_feedback_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR TG_TABLE_NAME='creative_feedback_mappings' THEN
  RAISE EXCEPTION 'Creative feedback bindings are immutable' USING ERRCODE='23514'; END IF;
 IF NEW.content_state='deleted' THEN NEW.body:='{}'::jsonb; END IF;
 IF (to_jsonb(NEW)-ARRAY['name','content_state','moderation_version','retention_expires_at','body','state','version','confirmed_by','confirmed_at','withdrawn_by','withdrawn_at','withdrawal_reason'])
  IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['name','content_state','moderation_version','retention_expires_at','body','state','version','confirmed_by','confirmed_at','withdrawn_by','withdrawn_at','withdrawal_reason'])
  OR (NEW.body IS DISTINCT FROM OLD.body AND NOT(NEW.content_state='deleted' AND NEW.body='{}'::jsonb)) THEN
  RAISE EXCEPTION 'Frozen creative feedback content cannot be rewritten' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='creative_mappings' THEN
  IF OLD.content_state='deleted' AND NEW.content_state<>'deleted' THEN RAISE EXCEPTION 'Deleted mapping' USING ERRCODE='23514'; END IF;
  IF ROW(NEW.state,NEW.version,NEW.confirmed_by,NEW.confirmed_at,NEW.withdrawn_by,NEW.withdrawn_at,NEW.withdrawal_reason)
   IS DISTINCT FROM ROW(OLD.state,OLD.version,OLD.confirmed_by,OLD.confirmed_at,OLD.withdrawn_by,OLD.withdrawn_at,OLD.withdrawal_reason) THEN
   IF NEW.version<>OLD.version+1 OR OLD.state='withdrawn' OR NEW.state=OLD.state
    OR NOT((OLD.state='candidate' AND NEW.state='confirmed' AND NEW.confirmed_by IS NOT NULL AND NEW.confirmed_at IS NOT NULL
      AND NEW.withdrawn_by IS NULL AND NEW.withdrawn_at IS NULL AND NEW.withdrawal_reason IS NULL)
     OR (NEW.state='withdrawn' AND NEW.withdrawn_by IS NOT NULL AND NEW.withdrawn_at IS NOT NULL AND length(NEW.withdrawal_reason)>=5
      AND ROW(NEW.confirmed_by,NEW.confirmed_at) IS NOT DISTINCT FROM ROW(OLD.confirmed_by,OLD.confirmed_at))) THEN
    RAISE EXCEPTION 'Invalid creative mapping transition' USING ERRCODE='23514'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER creative_mapping_history BEFORE UPDATE OR DELETE ON creative_mappings FOR EACH ROW EXECUTE FUNCTION guard_creative_feedback_history();
CREATE TRIGGER creative_feedback_history BEFORE UPDATE OR DELETE ON creative_feedback_reports FOR EACH ROW EXECUTE FUNCTION guard_creative_feedback_history();
CREATE TRIGGER creative_feedback_binding_history BEFORE UPDATE OR DELETE ON creative_feedback_mappings FOR EACH ROW EXECUTE FUNCTION guard_creative_feedback_history();

-- Mapping withdrawal also fences the already-created report asset. Existing
-- publication_sources transitively protects downloads, model reads and outputs.
-- A restore never silently republishes a report that was invalidated earlier.
CREATE FUNCTION fence_creative_feedback_assets() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
BEGIN
 IF TG_TABLE_NAME='creative_mappings' AND (to_jsonb(NEW)->>'state'='withdrawn' OR NEW.content_state<>'active') THEN
  UPDATE assets a SET state=CASE WHEN a.state='deleted' THEN 'deleted' ELSE 'quarantined' END,moderation_version=a.moderation_version+1
   FROM asset_versions v JOIN creative_feedback_reports r ON r.asset_version_id=v.id
   JOIN creative_feedback_mappings x ON x.report_id=r.id WHERE x.mapping_id=NEW.id AND a.id=v.asset_id AND a.state='active';
  IF NEW.content_state='deleted' THEN
   UPDATE creative_feedback_reports r SET content_state='deleted',moderation_version=r.moderation_version+1
    WHERE r.content_state<>'deleted' AND EXISTS(SELECT 1 FROM creative_feedback_mappings x WHERE x.report_id=r.id AND x.mapping_id=NEW.id);
  END IF;
 ELSIF TG_TABLE_NAME='creative_feedback_reports' AND NEW.content_state<>'active' THEN
  UPDATE assets a SET state=CASE WHEN NEW.content_state='deleted' THEN 'deleted' ELSE 'quarantined' END,moderation_version=a.moderation_version+1
   FROM asset_versions v WHERE v.id=NEW.asset_version_id AND a.id=v.asset_id AND a.state<>'deleted';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION fence_creative_feedback_assets() OWNER TO cp_control;
REVOKE ALL ON FUNCTION fence_creative_feedback_assets() FROM PUBLIC;
CREATE TRIGGER creative_mapping_asset_fence AFTER UPDATE ON creative_mappings FOR EACH ROW EXECUTE FUNCTION fence_creative_feedback_assets();
CREATE TRIGGER creative_report_asset_fence AFTER UPDATE ON creative_feedback_reports FOR EACH ROW EXECUTE FUNCTION fence_creative_feedback_assets();
CREATE TRIGGER creative_mapping_erasure BEFORE UPDATE ON creative_mappings FOR EACH ROW EXECUTE FUNCTION journal_content_erasure('content_state');
CREATE TRIGGER creative_feedback_erasure BEFORE UPDATE ON creative_feedback_reports FOR EACH ROW EXECUTE FUNCTION journal_content_erasure('content_state');

-- Preserve every existing lineage branch and the public function OID used by
-- prepared readers. Extend the returned lock manifest for confirmed mappings.
DO $$ DECLARE definition text; BEGIN
 definition:=pg_get_functiondef('content_source_manifest(uuid,uuid,uuid[],uuid[])'::regprocedure);
 IF position('FUNCTION public.content_source_manifest(' IN definition)=0 THEN RAISE EXCEPTION 'Unexpected source manifest definition'; END IF;
 EXECUTE replace(definition,'FUNCTION public.content_source_manifest(','FUNCTION public.content_source_manifest_before_creative_feedback(');
END $$;
ALTER FUNCTION content_source_manifest_before_creative_feedback(uuid,uuid,uuid[],uuid[]) OWNER TO cp_control;
REVOKE ALL ON FUNCTION content_source_manifest_before_creative_feedback(uuid,uuid,uuid[],uuid[]) FROM PUBLIC,cp_app,cp_queue;
CREATE OR REPLACE FUNCTION content_source_manifest(scope_tenant uuid,scope_project uuid,task_ids uuid[],version_ids uuid[]) RETURNS jsonb
 LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE refs jsonb; more jsonb; report record; binding record; source_version uuid;
BEGIN
 refs:=content_source_manifest_before_creative_feedback(scope_tenant,scope_project,task_ids,version_ids);
 IF refs IS NULL THEN RETURN NULL; END IF;
 FOR report IN SELECT DISTINCT r.* FROM creative_feedback_reports r JOIN asset_versions v ON v.id=r.asset_version_id
  JOIN jsonb_to_recordset(refs) AS x(kind text,id uuid) ON x.kind='assets' AND x.id=v.asset_id LOOP
  IF report.tenant_id<>scope_tenant OR report.project_id<>scope_project OR report.content_state<>'active' OR report.retention_expires_at<=clock_timestamp()
   OR NOT EXISTS(SELECT 1 FROM creative_feedback_mappings WHERE report_id=report.id) THEN RETURN NULL; END IF;
  refs:=refs||jsonb_build_array(jsonb_build_object('kind','creative_feedback_reports','id',report.id));
  FOR binding IN SELECT x.mapping_version,m.* FROM creative_feedback_mappings x JOIN creative_mappings m ON m.id=x.mapping_id WHERE x.report_id=report.id LOOP
   IF binding.state<>'confirmed' OR binding.version<>binding.mapping_version OR binding.content_state<>'active'
    OR NOT creative_mapping_sources_available(binding.id) THEN RETURN NULL; END IF;
   refs:=refs||jsonb_build_array(jsonb_build_object('kind','creative_mappings','id',binding.id));
   refs:=refs||jsonb_build_array(jsonb_build_object('kind','analytics_datasets','id',binding.dataset_id));
   SELECT source_asset_version_id INTO source_version FROM analytics_datasets WHERE id=binding.dataset_id;
   more:=content_source_manifest_before_creative_feedback(scope_tenant,scope_project,'{}',
    CASE WHEN source_version IS NULL THEN ARRAY[binding.asset_version_id] ELSE ARRAY[binding.asset_version_id,source_version] END);
   IF more IS NULL THEN RETURN NULL; END IF;
   refs:=refs||more;
  END LOOP;
 END LOOP;
 RETURN refs;
END $$;

CREATE OR REPLACE FUNCTION task_asset_sources_available(asset uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT NOT EXISTS(SELECT 1 FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version WHERE a.id=asset
  AND (v.metadata ? 'task_id' OR v.metadata ? 'publication_source_version_id' OR v.metadata ? 'publication_sources' OR v.metadata ? 'brand_reference' OR v.metadata ? 'creative_feedback_id')
  AND content_source_manifest(a.tenant_id,a.project_id,'{}',ARRAY[v.id]) IS NULL)
$$;
CREATE OR REPLACE FUNCTION task_asset_version_sources_available(p_version uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT NOT EXISTS(SELECT 1 FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=p_version
  AND (v.metadata ? 'task_id' OR v.metadata ? 'publication_source_version_id' OR v.metadata ? 'publication_sources' OR v.metadata ? 'brand_reference' OR v.metadata ? 'creative_feedback_id')
  AND content_source_manifest(a.tenant_id,a.project_id,'{}',ARRAY[v.id]) IS NULL)
$$;

-- The report, immutable file and mapping bindings are committed atomically.
-- A deferred guard permits file creation first, but never a forged or orphan
-- feedback locator. The original publication provenance trigger stays intact.
CREATE FUNCTION guard_creative_feedback_export() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE file asset_versions; report creative_feedback_reports; asset assets;
BEGIN
 IF TG_TABLE_NAME='asset_versions' THEN
  IF NOT NEW.metadata ? 'creative_feedback_id' THEN RETURN NULL; END IF;
  SELECT * INTO file FROM asset_versions WHERE id=NEW.id;
  SELECT * INTO report FROM creative_feedback_reports WHERE asset_version_id=NEW.id;
 ELSE
  SELECT * INTO report FROM creative_feedback_reports WHERE id=NEW.id;
  SELECT * INTO file FROM asset_versions WHERE id=report.asset_version_id;
 END IF;
 SELECT * INTO asset FROM assets WHERE id=file.asset_id;
 IF report.id IS NULL OR file.id IS NULL OR asset.id IS NULL OR file.metadata->>'creative_feedback_id' IS DISTINCT FROM report.id::text
  OR asset.tenant_id<>report.tenant_id OR asset.project_id<>report.project_id OR asset.created_by<>report.created_by
  OR asset.private_owner IS NOT NULL OR file.mime_type<>'application/json' OR asset.kind<>'report'
  OR NOT EXISTS(SELECT 1 FROM creative_feedback_mappings WHERE report_id=report.id) THEN
  RAISE EXCEPTION 'Creative feedback export scope mismatch' USING ERRCODE='23514'; END IF;
 RETURN NULL;
END $$;
ALTER FUNCTION guard_creative_feedback_export() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_creative_feedback_export() FROM PUBLIC;
CREATE CONSTRAINT TRIGGER creative_feedback_export_file AFTER INSERT ON asset_versions DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION guard_creative_feedback_export();
CREATE CONSTRAINT TRIGGER creative_feedback_export_report AFTER INSERT ON creative_feedback_reports DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION guard_creative_feedback_export();
CREATE FUNCTION guard_creative_feedback_locator() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.metadata->'creative_feedback_id' IS DISTINCT FROM NEW.metadata->'creative_feedback_id'
  AND NOT(NEW.erased_at IS NOT NULL AND coalesce(current_setting('app.erasing_content',true),'false')='true') THEN
  RAISE EXCEPTION 'Creative feedback source locator is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER creative_feedback_locator BEFORE UPDATE OF metadata ON asset_versions FOR EACH ROW EXECUTE FUNCTION guard_creative_feedback_locator();
CREATE OR REPLACE FUNCTION lock_task_content_sources(task uuid) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE refs jsonb; source_table text; ids uuid[];
BEGIN
 refs:=task_content_source_manifest(task); IF refs IS NULL THEN RETURN false; END IF;
 FOREACH source_table IN ARRAY ARRAY['workflows','workflow_runs','assets','connections','analytics_datasets','cloud_workspaces','workspace_nodes','agents','brand_profiles','memories','conversations','creative_mappings','creative_feedback_reports'] LOOP
  SELECT array_agg(x.id ORDER BY x.id) INTO ids FROM (SELECT DISTINCT r.id FROM jsonb_to_recordset(refs) AS r(kind text,id uuid) WHERE r.kind=source_table) x;
  IF cardinality(ids)>0 THEN EXECUTE format('SELECT id FROM %I WHERE id=ANY($1) ORDER BY id FOR SHARE%s',source_table,CASE WHEN source_table='conversations' THEN '' ELSE ' NOWAIT' END) USING ids; END IF;
 END LOOP;
 RETURN task_content_sources_available(task);
END $$;

INSERT INTO schema_migrations(version) VALUES(99);
