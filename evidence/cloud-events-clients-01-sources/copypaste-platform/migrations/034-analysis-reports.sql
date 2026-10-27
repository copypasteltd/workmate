-- Durable AnalysisSpec reports inherit their real Codex task and source lifecycle.
ALTER TABLE analytics_datasets ADD CONSTRAINT analytics_dataset_scope UNIQUE(tenant_id,project_id,id);
CREATE TABLE analysis_report_specialists (
 tenant_id uuid NOT NULL,project_id uuid NOT NULL,created_by uuid NOT NULL REFERENCES users(id),agent_id uuid NOT NULL REFERENCES agents(id),
 PRIMARY KEY(project_id,created_by), FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
ALTER TABLE analysis_report_specialists ENABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_report_specialists FORCE ROW LEVEL SECURITY;
CREATE POLICY report_specialist_scope ON analysis_report_specialists USING(current_user='cp_control' OR
 (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND created_by=nullif(current_setting('app.actor_id',true),'')::uuid))
 WITH CHECK(current_user='cp_control' OR (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND created_by=nullif(current_setting('app.actor_id',true),'')::uuid));
GRANT SELECT,INSERT ON analysis_report_specialists TO cp_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON analysis_report_specialists TO cp_control;
CREATE TABLE dataset_evidence (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL, dataset_id uuid NOT NULL, body jsonb NOT NULL,
 FOREIGN KEY(tenant_id,project_id,dataset_id) REFERENCES analytics_datasets(tenant_id,project_id,id)
);
CREATE INDEX dataset_evidence_snapshot ON dataset_evidence(dataset_id);
ALTER TABLE dataset_evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE dataset_evidence FORCE ROW LEVEL SECURITY;
CREATE POLICY evidence_tenant ON dataset_evidence USING(current_user='cp_control' OR tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(current_user='cp_control' OR tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY evidence_source ON dataset_evidence AS RESTRICTIVE FOR ALL TO cp_app
 USING(EXISTS(SELECT 1 FROM analytics_datasets d WHERE d.id=dataset_id AND d.content_state='active'))
 WITH CHECK(EXISTS(SELECT 1 FROM analytics_datasets d WHERE d.id=dataset_id AND d.content_state='active'));
GRANT SELECT,INSERT ON dataset_evidence TO cp_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON dataset_evidence TO cp_control;
-- Index already frozen dataset references without recomputing their metrics.
INSERT INTO dataset_evidence(id,tenant_id,project_id,dataset_id,body)
 SELECT eid.id,d.tenant_id,d.project_id,d.id,jsonb_build_object(
  'id',eid.id,'snapshot_id',d.id,'metric_id',m.key,'value',m.value,
  'unit',CASE WHEN m.key IN('spend','conversion_value','cpc','cpm','cpa') THEN d.currency WHEN m.key IN('ctr','cvr','roas') THEN 'ratio' ELSE 'count' END,
  'formula_version',d.metric_snapshot#>>'{summary,calculation,formula_version}',
  'scope','{"currency":'||to_jsonb(d.currency)::text||',"project_id":'||to_jsonb(d.project_id::text)::text||',"spec_hash":'||coalesce(to_jsonb(d.spec_hash)::text,'null')||',"timezone":'||to_jsonb(d.timezone)::text||'}',
  'null_reason',(d.metric_snapshot#>'{summary,null_reasons}')->m.key)
 FROM analytics_datasets d CROSS JOIN LATERAL jsonb_each(d.metric_snapshot#>'{summary,exact}') m
 CROSS JOIN LATERAL (SELECT encode(sha256(convert_to('{"formula":'||to_jsonb(d.metric_snapshot#>>'{summary,calculation,formula_version}')::text||',"metric_id":'||to_jsonb(m.key)::text||',"snapshot":'||to_jsonb(d.id::text)::text||'}','UTF8')),'hex') h) digest
 CROSS JOIN LATERAL (SELECT (substr(digest.h,1,8)||'-'||substr(digest.h,9,4)||'-8'||substr(digest.h,14,3)||'-a'||substr(digest.h,18,3)||'-'||substr(digest.h,21,12))::uuid id) eid
 WHERE d.metric_snapshot IS NOT NULL AND d.content_state<>'deleted';
CREATE TABLE analysis_reports (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 task_id uuid NOT NULL UNIQUE, created_by uuid NOT NULL REFERENCES users(id),
 private_owner uuid NOT NULL REFERENCES users(id), source_count integer NOT NULL CHECK(source_count BETWEEN 1 AND 10),
 spec jsonb NOT NULL, spec_hash text NOT NULL CHECK(spec_hash ~ '^[a-f0-9]{64}$'), calculation jsonb NOT NULL,
 narrative jsonb, validation jsonb NOT NULL DEFAULT '{"state":"pending"}',
 asset_version_id uuid REFERENCES asset_versions(id), invalidated_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY(tenant_id,task_id) REFERENCES tasks(tenant_id,id),
 UNIQUE(tenant_id,project_id,id)
);
CREATE TABLE analysis_report_sources (
 tenant_id uuid NOT NULL, project_id uuid NOT NULL, report_id uuid NOT NULL, dataset_id uuid NOT NULL,
 PRIMARY KEY(report_id,dataset_id),
 FOREIGN KEY(tenant_id,project_id,report_id) REFERENCES analysis_reports(tenant_id,project_id,id),
 FOREIGN KEY(tenant_id,project_id,dataset_id) REFERENCES analytics_datasets(tenant_id,project_id,id)
);
CREATE INDEX analysis_source_dependents ON analysis_report_sources(dataset_id,report_id);
CREATE TABLE analysis_snapshots (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL, report_id uuid NOT NULL, body jsonb NOT NULL,
 FOREIGN KEY(tenant_id,project_id,report_id) REFERENCES analysis_reports(tenant_id,project_id,id),
 UNIQUE(tenant_id,project_id,report_id,id)
);
CREATE TABLE analysis_evidence (
 id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL, report_id uuid NOT NULL,
 snapshot_id uuid NOT NULL, body jsonb NOT NULL,
 FOREIGN KEY(tenant_id,project_id,report_id,snapshot_id) REFERENCES analysis_snapshots(tenant_id,project_id,report_id,id),
 FOREIGN KEY(tenant_id,project_id,report_id) REFERENCES analysis_reports(tenant_id,project_id,id)
);
CREATE INDEX analysis_report_project ON analysis_reports(project_id,created_at DESC,id);
CREATE INDEX analysis_snapshot_report ON analysis_snapshots(report_id);
CREATE INDEX analysis_evidence_report ON analysis_evidence(report_id);

-- Definer functions read lifecycle metadata without RLS recursion. They return
-- only a boolean and still bind every app call to the transaction-local actor.
CREATE FUNCTION analysis_report_owned(report uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
 SELECT EXISTS(SELECT 1 FROM analysis_reports r JOIN tasks t ON t.id=r.task_id
  WHERE r.id=report AND r.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND r.private_owner=nullif(current_setting('app.actor_id',true),'')::uuid
  AND r.project_id=t.project_id AND r.tenant_id=t.tenant_id AND r.private_owner=t.private_owner
  AND t.content_state='active' AND r.invalidated_at IS NULL)
$$;
CREATE FUNCTION analysis_report_available(report uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
 SELECT analysis_report_owned(report) AND EXISTS(
  SELECT 1 FROM analysis_reports r WHERE r.id=report AND r.source_count=(
   SELECT count(*) FROM analysis_report_sources s JOIN analytics_datasets d ON d.id=s.dataset_id
   WHERE s.report_id=r.id AND d.content_state='active'))
$$;
REVOKE ALL ON FUNCTION analysis_report_owned(uuid),analysis_report_available(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analysis_report_owned(uuid),analysis_report_available(uuid) TO cp_app,cp_control;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['analysis_reports','analysis_report_sources','analysis_snapshots','analysis_evidence'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY control_scope ON %I FOR ALL TO cp_control USING(true) WITH CHECK(true)',t);
  EXECUTE format('CREATE POLICY app_read ON %I FOR SELECT TO cp_app USING(analysis_report_available(%I))',t,CASE WHEN t='analysis_reports' THEN 'id' ELSE 'report_id' END);
 END LOOP;
END $$;
CREATE POLICY report_insert ON analysis_reports FOR INSERT TO cp_app WITH CHECK(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND
 private_owner=nullif(current_setting('app.actor_id',true),'')::uuid AND created_by=private_owner AND
 EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id AND t.project_id=analysis_reports.project_id AND t.private_owner=analysis_reports.private_owner));
CREATE POLICY report_update ON analysis_reports FOR UPDATE TO cp_app USING(analysis_report_available(id)) WITH CHECK(analysis_report_available(id));
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['analysis_report_sources','analysis_snapshots','analysis_evidence'] LOOP
  EXECUTE format('CREATE POLICY app_insert ON %I FOR INSERT TO cp_app WITH CHECK(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND analysis_report_owned(report_id))',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT ON analysis_reports,analysis_report_sources,analysis_snapshots,analysis_evidence TO cp_app;
GRANT UPDATE(narrative,validation,asset_version_id) ON analysis_reports TO cp_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON analysis_reports,analysis_report_sources,analysis_snapshots,analysis_evidence TO cp_control;

CREATE FUNCTION guard_analysis_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Analysis provenance cannot be physically deleted' USING ERRCODE='23514'; END IF;
 IF pg_trigger_depth()>1 THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='analysis_reports' THEN
  IF (to_jsonb(NEW)-ARRAY['narrative','validation','asset_version_id']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['narrative','validation','asset_version_id']) OR
     (OLD.narrative IS NOT NULL AND NEW.narrative IS DISTINCT FROM OLD.narrative) OR
     (OLD.asset_version_id IS NOT NULL AND NEW.asset_version_id IS DISTINCT FROM OLD.asset_version_id) THEN
   RAISE EXCEPTION 'Frozen analysis cannot be rewritten' USING ERRCODE='23514';
  END IF;
 ELSE
  RAISE EXCEPTION 'Frozen analysis cannot be rewritten' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['dataset_evidence','analysis_reports','analysis_report_sources','analysis_snapshots','analysis_evidence'] LOOP
  EXECUTE format('CREATE TRIGGER immutable_analysis BEFORE UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION guard_analysis_immutable()',t);
 END LOOP;
END $$;

CREATE FUNCTION analysis_asset_available(asset uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
 SELECT NOT EXISTS(SELECT 1 FROM analysis_reports r JOIN asset_versions v ON v.id=r.asset_version_id
  WHERE v.asset_id=asset AND NOT analysis_report_available(r.id))
$$;
REVOKE ALL ON FUNCTION analysis_asset_available(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION analysis_asset_available(uuid) TO cp_app;
CREATE POLICY analysis_artifact_scope ON assets AS RESTRICTIVE FOR ALL TO cp_app
 USING(analysis_asset_available(id)) WITH CHECK(analysis_asset_available(id));

-- Permanent source/task deletion invalidates and scrubs its derivatives. The
-- existing task/asset erasure journal then owns runtime and object cleanup.
CREATE FUNCTION invalidate_analysis_reports() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE ids uuid[];
BEGIN
 IF NEW.content_state<>'deleted' OR OLD.content_state='deleted' THEN RETURN NEW; END IF;
 IF TG_TABLE_NAME='tasks' THEN
  SELECT array_agg(id) INTO ids FROM analysis_reports WHERE task_id=NEW.id AND invalidated_at IS NULL;
 ELSE
  UPDATE dataset_evidence SET body='{}' WHERE dataset_id=NEW.id;
  SELECT array_agg(r.id) INTO ids FROM analysis_reports r JOIN analysis_report_sources s ON s.report_id=r.id
   WHERE s.dataset_id=NEW.id AND r.invalidated_at IS NULL;
 END IF;
 IF ids IS NULL THEN RETURN NEW; END IF;
 UPDATE analysis_reports SET invalidated_at=now(),spec='{}',calculation='{}',narrative=NULL,validation='{"state":"source_removed"}' WHERE id=ANY(ids);
 UPDATE analysis_snapshots SET body='{}' WHERE report_id=ANY(ids);
 UPDATE analysis_evidence SET body='{}' WHERE report_id=ANY(ids);
 UPDATE assets SET state='deleted',moderation_version=moderation_version+1 WHERE state<>'deleted'
  AND id IN(SELECT v.asset_id FROM asset_versions v JOIN analysis_reports r ON r.asset_version_id=v.id WHERE r.id=ANY(ids));
 IF TG_TABLE_NAME='analytics_datasets' THEN
  UPDATE tasks SET content_state='deleted',cancel_requested=true,output=NULL,moderation_version=moderation_version+1
   WHERE content_state<>'deleted' AND id IN(SELECT task_id FROM analysis_reports WHERE id=ANY(ids));
  INSERT INTO deletion_dependencies(job_id,child_job_id)
   SELECT parent.id,child.id FROM deletion_jobs parent JOIN analysis_reports r ON r.id=ANY(ids)
   JOIN deletion_jobs child ON child.target_type='tasks' AND child.target_id=r.task_id
   WHERE parent.target_type='analytics_datasets' AND parent.target_id=NEW.id ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_analysis_source_erasure AFTER UPDATE OF content_state ON analytics_datasets
 FOR EACH ROW EXECUTE FUNCTION invalidate_analysis_reports();
CREATE TRIGGER zz_analysis_task_erasure AFTER UPDATE OF content_state ON tasks
 FOR EACH ROW EXECUTE FUNCTION invalidate_analysis_reports();
CREATE FUNCTION guard_analysis_task_binding() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=off AS $$
BEGIN
 IF NEW.content_state<>'deleted' AND EXISTS(SELECT 1 FROM analysis_reports r WHERE r.task_id=NEW.id
  AND NEW.input_context->>'analysis_report_id' IS DISTINCT FROM r.id::text) THEN
  RAISE EXCEPTION 'Analysis task binding cannot be removed' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER analysis_task_binding BEFORE UPDATE OF input_context ON tasks
 FOR EACH ROW EXECUTE FUNCTION guard_analysis_task_binding();
INSERT INTO schema_migrations(version) VALUES(34);
