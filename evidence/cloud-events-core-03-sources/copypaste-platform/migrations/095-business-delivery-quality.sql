-- Published SQL001-094 are immutable. Reviews are customer facts, never task success.
ALTER TABLE tasks DROP CONSTRAINT tasks_acceptance_check;
ALTER TABLE tasks ADD CONSTRAINT tasks_acceptance_check CHECK(acceptance IN('pending','accepted','changes_requested','discarded'));

CREATE TABLE delivery_reviews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,project_id uuid NOT NULL,task_id uuid NOT NULL,
 reviewer_id uuid NOT NULL REFERENCES users(id),task_version integer NOT NULL CHECK(task_version>0),
 decision text NOT NULL CHECK(decision IN('accepted','changes_requested','discarded')),
 comment text NOT NULL DEFAULT '' CHECK(length(comment)<=5000),delivery_snapshot jsonb,
 artifact_ids uuid[] NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),erased_at timestamptz,
 FOREIGN KEY(tenant_id,project_id,task_id) REFERENCES tasks(tenant_id,project_id,id),UNIQUE(task_id,task_version)
);
CREATE INDEX delivery_reviews_task ON delivery_reviews(task_id,task_version DESC);
CREATE TABLE task_quality_measurements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,project_id uuid NOT NULL,task_id uuid NOT NULL,
 reporter_id uuid NOT NULL REFERENCES users(id),task_version integer NOT NULL CHECK(task_version>0),
 baseline_minutes integer CHECK(baseline_minutes BETWEEN 0 AND 525600),
 human_minutes integer CHECK(human_minutes BETWEEN 0 AND 525600),manual_revisions integer CHECK(manual_revisions BETWEEN 0 AND 10000),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),erased_at timestamptz,
 FOREIGN KEY(tenant_id,project_id,task_id) REFERENCES tasks(tenant_id,project_id,id),UNIQUE(task_id,task_version)
);

-- The same ordered JSONB snapshot is used by writes and reads. A new asset,
-- removal, moderation or version cannot inherit a prior delivery's acceptance.
-- Control aggregates have no customer session context. Validate lineage using
-- each task's recorded tenant/project; cp_app retains its existing actor scope.
CREATE FUNCTION business_quality_sources_available(target uuid) RETURNS boolean LANGUAGE plpgsql STABLE AS $$
BEGIN
 IF current_user='cp_control' THEN
  RETURN EXISTS(SELECT 1 FROM tasks t WHERE t.id=target
   AND content_source_manifest(t.tenant_id,t.project_id,ARRAY[t.id],'{}') IS NOT NULL);
 END IF;
 RETURN task_content_sources_available(target);
END
$$;
REVOKE ALL ON FUNCTION business_quality_sources_available(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business_quality_sources_available(uuid) TO cp_app,cp_control;
CREATE FUNCTION business_delivery_snapshot(target uuid) RETURNS jsonb LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('output_sha256',CASE WHEN t.output IS NULL OR t.output='' THEN NULL ELSE encode(digest(t.output,'sha256'),'hex') END,
 'artifacts',coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'version_id',v.id,'version',v.version,'sha256',v.sha256) ORDER BY a.id)
 FROM assets a JOIN asset_versions v ON v.asset_id=a.id AND v.version=a.current_version
 WHERE a.tenant_id=t.tenant_id AND a.project_id=t.project_id AND a.state='active'
 AND a.retention_expires_at>statement_timestamp() AND v.erased_at IS NULL AND v.metadata->>'task_id'=t.id::text),'[]'::jsonb))
 FROM tasks t WHERE t.id=target AND t.content_state='active' AND business_quality_sources_available(t.id)
$$;
CREATE FUNCTION business_review_state(target uuid) RETURNS text LANGUAGE sql STABLE AS $$
 WITH snapshot AS (SELECT business_delivery_snapshot(target) AS value),
 targets AS (SELECT a.item->>'id' AS id FROM snapshot s,jsonb_array_elements(s.value->'artifacts') AS a(item)
 UNION ALL SELECT 'output' FROM snapshot WHERE snapshot.value->'artifacts'='[]'::jsonb AND snapshot.value->>'output_sha256' IS NOT NULL),
 decisions AS (SELECT (SELECT r.decision FROM delivery_reviews r,snapshot s WHERE r.task_id=target AND r.erased_at IS NULL
 AND r.delivery_snapshot=s.value AND (targets.id='output' OR targets.id=ANY(r.artifact_ids::text[]))
 ORDER BY r.task_version DESC LIMIT 1) AS decision FROM targets)
 SELECT CASE WHEN count(*)=0 THEN 'pending_review' WHEN bool_or(decision='changes_requested') THEN 'changes_requested'
 WHEN count(decision)<count(*) THEN 'pending_review' WHEN bool_or(decision='discarded') THEN 'discarded' ELSE 'accepted' END FROM decisions
$$;
REVOKE ALL ON FUNCTION business_delivery_snapshot(uuid),business_review_state(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION business_delivery_snapshot(uuid),business_review_state(uuid) TO cp_app,cp_control;

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['delivery_reviews','task_quality_measurements'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',tab);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',tab);
  EXECUTE format('CREATE POLICY quality_control ON %I TO cp_control USING(true) WITH CHECK(true)',tab);
  EXECUTE format('CREATE POLICY quality_app ON %I TO cp_app USING(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id AND task_content_sources_available(t.id))) WITH CHECK(tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id AND t.tenant_id=%I.tenant_id AND t.project_id=%I.project_id AND task_content_sources_available(t.id)))',tab,tab,tab);
  EXECUTE format('GRANT SELECT,INSERT ON %I TO cp_app',tab);
  EXECUTE format('GRANT SELECT,INSERT,UPDATE ON %I TO cp_control',tab);
 END LOOP;
END $$;

CREATE FUNCTION immutable_business_quality() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='UPDATE' AND current_user='cp_control' AND current_setting('app.erasing_quality',true)='true'
 AND OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL THEN
  IF TG_TABLE_NAME='delivery_reviews' THEN
   IF NEW.comment='' AND NEW.delivery_snapshot IS NULL AND NEW.artifact_ids='{}'::uuid[]
   AND (to_jsonb(OLD)-ARRAY['comment','delivery_snapshot','artifact_ids','erased_at'])=(to_jsonb(NEW)-ARRAY['comment','delivery_snapshot','artifact_ids','erased_at']) THEN RETURN NEW; END IF;
  ELSE
   IF NEW.baseline_minutes IS NULL AND NEW.human_minutes IS NULL AND NEW.manual_revisions IS NULL
   AND (to_jsonb(OLD)-ARRAY['baseline_minutes','human_minutes','manual_revisions','erased_at'])=(to_jsonb(NEW)-ARRAY['baseline_minutes','human_minutes','manual_revisions','erased_at']) THEN RETURN NEW; END IF;
  END IF;
 END IF;
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Business quality records are append-only' USING ERRCODE='42501'; END IF;
 IF TG_TABLE_NAME='delivery_reviews' THEN
  IF NOT EXISTS(SELECT 1 FROM tasks t WHERE t.id=NEW.task_id AND t.tenant_id=NEW.tenant_id AND t.project_id=NEW.project_id
 AND t.version=NEW.task_version AND t.status='succeeded' AND t.mode<>'plan' AND t.content_state='active')
   OR NEW.reviewer_id IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'')::uuid
   OR NEW.delivery_snapshot IS NULL OR NEW.delivery_snapshot IS DISTINCT FROM business_delivery_snapshot(NEW.task_id) THEN
   RAISE EXCEPTION 'Review must identify a current completed delivery and customer' USING ERRCODE='23514'; END IF;
  IF cardinality(NEW.artifact_ids)<>(SELECT count(DISTINCT a) FROM unnest(NEW.artifact_ids) a)
   OR EXISTS(SELECT 1 FROM unnest(NEW.artifact_ids) selected WHERE NOT EXISTS(
    SELECT 1 FROM jsonb_array_elements(NEW.delivery_snapshot->'artifacts') a WHERE a->>'id'=selected::text))
   OR (jsonb_array_length(NEW.delivery_snapshot->'artifacts')>0 AND cardinality(NEW.artifact_ids)=0)
   OR (NEW.delivery_snapshot->'artifacts'='[]'::jsonb AND NEW.delivery_snapshot->>'output_sha256' IS NULL) THEN
   RAISE EXCEPTION 'Review must cover current delivery targets without duplicates' USING ERRCODE='23514'; END IF;
 ELSE
  IF NOT EXISTS(SELECT 1 FROM tasks t WHERE t.id=NEW.task_id AND t.tenant_id=NEW.tenant_id AND t.project_id=NEW.project_id
   AND t.version=NEW.task_version AND t.status IN('succeeded','failed','cancelled') AND t.content_state='active')
   OR NEW.reporter_id IS DISTINCT FROM nullif(current_setting('app.actor_id',true),'')::uuid THEN
   RAISE EXCEPTION 'Measurement must identify a current terminal task and customer' USING ERRCODE='23514'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER business_review_immutable BEFORE INSERT OR UPDATE OR DELETE ON delivery_reviews FOR EACH ROW EXECUTE FUNCTION immutable_business_quality();
CREATE TRIGGER business_measurement_immutable BEFORE INSERT OR UPDATE OR DELETE ON task_quality_measurements FOR EACH ROW EXECUTE FUNCTION immutable_business_quality();

CREATE FUNCTION erase_business_quality() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE should_erase boolean;
BEGIN
 IF TG_TABLE_NAME='tasks' THEN should_erase=NEW.content_state='deleted' AND OLD.content_state<>'deleted';
 ELSE should_erase=NEW.state='deleted' AND OLD.state<>'deleted'; END IF;
 IF should_erase THEN
  PERFORM set_config('app.erasing_quality','true',true);
  IF TG_TABLE_NAME='tasks' THEN
   UPDATE delivery_reviews SET comment='',delivery_snapshot=NULL,artifact_ids='{}',erased_at=clock_timestamp() WHERE task_id=NEW.id AND erased_at IS NULL;
   UPDATE task_quality_measurements SET baseline_minutes=NULL,human_minutes=NULL,manual_revisions=NULL,erased_at=clock_timestamp() WHERE task_id=NEW.id AND erased_at IS NULL;
  ELSE
   UPDATE delivery_reviews SET comment='',delivery_snapshot=NULL,artifact_ids='{}',erased_at=clock_timestamp()
   WHERE erased_at IS NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(delivery_snapshot->'artifacts') a WHERE a->>'id'=NEW.id::text);
  END IF;
  PERFORM set_config('app.erasing_quality','false',true);
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION erase_business_quality() OWNER TO cp_control;
REVOKE ALL ON FUNCTION erase_business_quality() FROM PUBLIC;
CREATE TRIGGER task_quality_erasure AFTER UPDATE OF content_state ON tasks FOR EACH ROW EXECUTE FUNCTION erase_business_quality();
CREATE TRIGGER asset_quality_erasure AFTER UPDATE OF state ON assets FOR EACH ROW EXECUTE FUNCTION erase_business_quality();
INSERT INTO schema_migrations(version) VALUES(95);
