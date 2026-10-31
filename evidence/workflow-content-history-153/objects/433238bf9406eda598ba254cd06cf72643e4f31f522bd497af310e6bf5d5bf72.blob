-- Prior migrations and the first frozen release remain immutable.
ALTER TABLE workflows ADD COLUMN history_revision bigint NOT NULL DEFAULT 1 CHECK(history_revision>0);
CREATE TRIGGER business_history_revision_guard BEFORE INSERT OR UPDATE ON workflows
 FOR EACH ROW EXECUTE FUNCTION guard_business_history_fence();

CREATE TABLE workflow_shared_versions (
 workflow_id uuid NOT NULL REFERENCES workflows(id),version integer NOT NULL CHECK(version>0),
 tenant_id uuid NOT NULL,project_id uuid NOT NULL,name text NOT NULL,definition jsonb NOT NULL,
 created_by uuid REFERENCES users(id),origin text NOT NULL CHECK(origin IN('customer','retained_current','system_snapshot')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(workflow_id,version),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
-- No unsaved former definitions or former operators are invented.
INSERT INTO workflow_shared_versions(workflow_id,version,tenant_id,project_id,name,definition,origin)
 SELECT id,version,tenant_id,project_id,name,definition,'retained_current'
 FROM workflows WHERE private_owner IS NULL AND content_state<>'deleted';
ALTER TABLE workflow_shared_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_shared_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY shared_workflow_history_control ON workflow_shared_versions TO cp_control USING(true) WITH CHECK(true);
CREATE POLICY shared_workflow_history_customer ON workflow_shared_versions TO cp_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(
  SELECT 1 FROM workflows w WHERE w.id=workflow_id AND w.private_owner IS NULL AND w.content_state='active'));
GRANT SELECT ON workflow_shared_versions TO cp_app;
GRANT ALL ON workflow_shared_versions TO cp_control;
CREATE FUNCTION guard_shared_workflow_history_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM workflows w WHERE w.id=NEW.workflow_id AND w.private_owner IS NULL
  AND w.tenant_id=NEW.tenant_id AND w.project_id=NEW.project_id AND w.content_state<>'deleted'
  AND w.version=NEW.version AND w.definition=NEW.definition AND w.name=NEW.name) THEN
  RAISE EXCEPTION 'Shared workflow history must match its saved parent version' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER shared_workflow_history_scope BEFORE INSERT ON workflow_shared_versions
 FOR EACH ROW EXECUTE FUNCTION guard_shared_workflow_history_scope();

CREATE FUNCTION immutable_shared_workflow_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND current_user='cp_control' AND current_setting('app.erasing_content',true)='true' THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Saved workflow history is immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER shared_workflow_history_immutable BEFORE UPDATE OR DELETE ON workflow_shared_versions
 FOR EACH ROW EXECUTE FUNCTION immutable_shared_workflow_history();
CREATE FUNCTION snapshot_shared_workflow_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public AS $$ DECLARE actor uuid; BEGIN
 IF NEW.private_owner IS NOT NULL OR NEW.content_state='deleted' OR current_setting('app.erasing_content',true)='true' THEN RETURN NULL; END IF;
 IF TG_OP='UPDATE' AND NEW.version=OLD.version THEN
  IF NEW.definition IS DISTINCT FROM OLD.definition THEN RAISE EXCEPTION 'Workflow edits require a new saved version' USING ERRCODE='23514'; END IF;
  RETURN NULL;
 END IF;
 IF TG_OP='UPDATE' AND NEW.version<=OLD.version THEN RAISE EXCEPTION 'Workflow saved versions must advance' USING ERRCODE='23514'; END IF;
 actor:=CASE WHEN TG_OP='INSERT' THEN NEW.created_by ELSE nullif(current_setting('app.actor_id',true),'')::uuid END;
 INSERT INTO workflow_shared_versions(workflow_id,version,tenant_id,project_id,name,definition,created_by,origin)
 VALUES(NEW.id,NEW.version,NEW.tenant_id,NEW.project_id,NEW.name,NEW.definition,actor,
  CASE WHEN actor IS NULL THEN 'system_snapshot' ELSE 'customer' END);
 RETURN NULL;
END $$;
ALTER FUNCTION snapshot_shared_workflow_history() OWNER TO cp_control;
REVOKE ALL ON FUNCTION snapshot_shared_workflow_history() FROM PUBLIC;
CREATE TRIGGER shared_workflow_history_snapshot AFTER INSERT OR UPDATE OF version,definition ON workflows
 FOR EACH ROW EXECUTE FUNCTION snapshot_shared_workflow_history();
CREATE TRIGGER workflow_history_fence AFTER INSERT OR UPDATE OR DELETE ON workflow_versions
 FOR EACH ROW EXECUTE FUNCTION advance_business_history('workflows','workflow_id');
CREATE TRIGGER workflow_history_fence AFTER INSERT OR UPDATE OR DELETE ON workflow_shared_versions
 FOR EACH ROW EXECUTE FUNCTION advance_business_history('workflows','workflow_id');

-- Use the exact installed lineage walker, including nested publications, brand
-- revisions and GEO sources. This is a separate, control-only reader: execution
-- and customer source checks are unchanged. Start from the saved source snapshot,
-- never an expired creation task. An investigated root may itself be quarantined.
DO $$ DECLARE definition text; anchor text; BEGIN
 definition:=pg_get_functiondef('public.content_source_manifest_before_creative_feedback(uuid,uuid,uuid[],uuid[])'::regprocedure);
 anchor:='CREATE OR REPLACE FUNCTION public.content_source_manifest_before_creative_feedback';
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Missing installed lineage walker'; END IF;
 definition:=regexp_replace(definition,'CREATE OR REPLACE FUNCTION public.content_source_manifest_before_creative_feedback\([^)]*\)',
  'CREATE FUNCTION public.admin_workflow_saved_source_walk(scope_tenant uuid, scope_project uuid, publication_refs jsonb, root_workflow uuid)');
 FOREACH anchor IN ARRAY ARRAY['pending_tasks uuid[]:=task_ids','pending_versions uuid[]:=version_ids',
  'pending_sources jsonb[]:=''{}''',
  'WHERE w.id=r.workflow_id AND w.tenant_id=scope_tenant AND w.project_id=scope_project AND w.content_state=''active'''] LOOP
  IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Missing installed lineage anchor: %',anchor; END IF;
 END LOOP;
 definition:=replace(definition,'pending_tasks uuid[]:=task_ids','pending_tasks uuid[]:=''{}''');
 definition:=replace(definition,'pending_versions uuid[]:=version_ids','pending_versions uuid[]:=''{}''');
 definition:=replace(definition,'pending_sources jsonb[]:=''{}''','pending_sources jsonb[]:=ARRAY[publication_refs]');
 definition:=replace(definition,
  'WHERE w.id=r.workflow_id AND w.tenant_id=scope_tenant AND w.project_id=scope_project AND w.content_state=''active''',
  'WHERE w.id=r.workflow_id AND w.tenant_id=scope_tenant AND w.project_id=scope_project AND (w.content_state=''active'' OR w.id=root_workflow)');
 EXECUTE definition;
END $$;
ALTER FUNCTION admin_workflow_saved_source_walk(uuid,uuid,jsonb,uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION admin_workflow_saved_source_walk(uuid,uuid,jsonb,uuid) FROM PUBLIC;

CREATE FUNCTION admin_workflow_source_versions(scope_tenant uuid,scope_project uuid,root_workflow uuid,versions uuid[])
 RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT admin_workflow_saved_source_walk(scope_tenant,scope_project,jsonb_build_object('schema',1,
  'versions',to_jsonb(versions),'datasets','[]'::jsonb,'memories','[]'::jsonb,'brands','[]'::jsonb,
  'connections','[]'::jsonb,'cloud_references','[]'::jsonb,'workflows','[]'::jsonb),root_workflow)
$$;
ALTER FUNCTION admin_workflow_source_versions(uuid,uuid,uuid,uuid[]) OWNER TO cp_control;
REVOKE ALL ON FUNCTION admin_workflow_source_versions(uuid,uuid,uuid,uuid[]) FROM PUBLIC;

-- Preserve the public walker's outer confirmed-feedback checks too; the base
-- traversal alone is deliberately not considered complete source qualification.
DO $$ DECLARE definition text; anchor text; BEGIN
 definition:=pg_get_functiondef('public.content_source_manifest(uuid,uuid,uuid[],uuid[])'::regprocedure);
 anchor:='CREATE OR REPLACE FUNCTION public.content_source_manifest';
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Missing installed source wrapper'; END IF;
 definition:=regexp_replace(definition,'CREATE OR REPLACE FUNCTION public.content_source_manifest\([^)]*\)',
  'CREATE FUNCTION public.admin_workflow_source_manifest(scope_tenant uuid, scope_project uuid, publication_refs jsonb, root_workflow uuid)');
 anchor:='refs:=content_source_manifest_before_creative_feedback(scope_tenant,scope_project,task_ids,version_ids);';
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Missing outer source wrapper anchor'; END IF;
 definition:=replace(definition,anchor,'refs:=admin_workflow_saved_source_walk(scope_tenant,scope_project,publication_refs,root_workflow);');
 anchor:='more:=content_source_manifest_before_creative_feedback(scope_tenant,scope_project,''{}'',';
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Missing nested feedback source anchor'; END IF;
 definition:=replace(definition,anchor,'more:=admin_workflow_source_versions(scope_tenant,scope_project,root_workflow,');
 EXECUTE definition;
END $$;
ALTER FUNCTION admin_workflow_source_manifest(uuid,uuid,jsonb,uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION admin_workflow_source_manifest(uuid,uuid,jsonb,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admin_workflow_source_manifest(uuid,uuid,jsonb,uuid) TO cp_control;

CREATE FUNCTION shared_workflow_version_available(workflow uuid, saved_version integer) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
 SELECT EXISTS(SELECT 1 FROM workflows w JOIN workflow_shared_versions v ON v.workflow_id=w.id
  WHERE w.id=workflow AND v.version=saved_version AND w.private_owner IS NULL AND w.content_state='active'
  AND w.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND admin_workflow_source_manifest(w.tenant_id,w.project_id,jsonb_build_object('schema',1,
    'versions','[]'::jsonb,'datasets',(SELECT coalesce(jsonb_agg(step->>'dataset_id'),'[]'::jsonb)
      FROM jsonb_array_elements(coalesce(v.definition->'steps','[]'::jsonb)) step WHERE step->>'kind'='analytics.summary'),
    'memories','[]'::jsonb,'brands','[]'::jsonb,'connections','[]'::jsonb,
    'cloud_references','[]'::jsonb,'workflows','[]'::jsonb),w.id) IS NOT NULL)
$$;
ALTER FUNCTION shared_workflow_version_available(uuid,integer) OWNER TO cp_control;
REVOKE ALL ON FUNCTION shared_workflow_version_available(uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION shared_workflow_version_available(uuid,integer) TO cp_app,cp_control;

-- Use the same permanent scope admission guard as other retained business rows.
CREATE TRIGGER scope_erasure_admission BEFORE INSERT OR UPDATE ON workflow_shared_versions
 FOR EACH ROW EXECUTE FUNCTION guard_scope_erasure_admission('name,definition');
