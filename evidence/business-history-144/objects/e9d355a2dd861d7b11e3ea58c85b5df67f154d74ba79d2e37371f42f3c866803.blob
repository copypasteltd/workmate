-- Append-only history for ordinary canvases, and change fences for business readers.
-- Earlier, unsaved canvas bodies cannot be reconstructed: retain only the current one.
CREATE TABLE poster_project_versions (
 creative_id uuid NOT NULL REFERENCES creative_projects(id),version integer NOT NULL CHECK(version>0),
 tenant_id uuid NOT NULL REFERENCES tenants(id),project_id uuid NOT NULL REFERENCES projects(id),
 name text NOT NULL,body jsonb NOT NULL,created_by uuid REFERENCES users(id),
 origin text NOT NULL CHECK(origin IN('customer','retained_current','system_snapshot')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(creative_id,version)
);
INSERT INTO poster_project_versions(creative_id,version,tenant_id,project_id,name,body,origin,created_at)
 SELECT id,version,tenant_id,project_id,name,body,'retained_current',clock_timestamp()
 FROM creative_projects WHERE kind='poster' AND content_state<>'deleted';
ALTER TABLE poster_project_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE poster_project_versions FORCE ROW LEVEL SECURITY;
CREATE POLICY poster_history_control ON poster_project_versions TO cp_control USING(true) WITH CHECK(true);
CREATE POLICY poster_history_scope ON poster_project_versions TO cp_app
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
GRANT SELECT ON poster_project_versions TO cp_app;
GRANT ALL ON poster_project_versions TO cp_control;

CREATE FUNCTION immutable_poster_history() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' AND current_setting('app.erasing_content',true)='true' THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Saved canvas history is immutable' USING ERRCODE='23514';
END $$;
CREATE TRIGGER poster_history_immutable BEFORE UPDATE OR DELETE ON poster_project_versions
 FOR EACH ROW EXECUTE FUNCTION immutable_poster_history();
CREATE FUNCTION snapshot_poster_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public AS $$ DECLARE actor uuid; BEGIN
 IF NEW.kind<>'poster' OR NEW.content_state='deleted' OR current_setting('app.erasing_content',true)='true' THEN RETURN NEW; END IF;
 IF TG_OP='UPDATE' AND NEW.version=OLD.version THEN RETURN NEW; END IF;
 actor:=CASE WHEN TG_OP='INSERT' THEN NEW.created_by ELSE nullif(current_setting('app.poster_actor_id',true),'')::uuid END;
 INSERT INTO poster_project_versions(creative_id,version,tenant_id,project_id,name,body,created_by,origin)
 VALUES(NEW.id,NEW.version,NEW.tenant_id,NEW.project_id,NEW.name,NEW.body,actor,
  CASE WHEN actor IS NULL THEN 'system_snapshot' ELSE 'customer' END);
 RETURN NEW;
END $$;
ALTER FUNCTION snapshot_poster_history() OWNER TO cp_control;
REVOKE ALL ON FUNCTION snapshot_poster_history() FROM PUBLIC;
CREATE TRIGGER poster_history_snapshot AFTER INSERT OR UPDATE ON creative_projects
 FOR EACH ROW EXECUTE FUNCTION snapshot_poster_history();

DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['brand_profiles','agent_groups','project_configurations','workflow_schedules','creative_projects'] LOOP
  EXECUTE format('ALTER TABLE %I ADD COLUMN history_revision bigint NOT NULL DEFAULT 1 CHECK(history_revision>0)',tab);
 END LOOP;
END $$;
CREATE FUNCTION advance_business_history() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public AS $$ DECLARE parent uuid; BEGIN
 IF current_setting('app.erasing_content',true)='true' OR current_setting('app.erasing_brand',true)='true' THEN RETURN NULL; END IF;
 IF TG_OP='DELETE' THEN parent:=(to_jsonb(OLD)->>TG_ARGV[1])::uuid;
 ELSE parent:=(to_jsonb(NEW)->>TG_ARGV[1])::uuid; END IF;
 IF TG_ARGV[0]='creative_matrix_units' THEN
  SELECT batch_id INTO parent FROM creative_matrix_units WHERE id=parent;
  UPDATE creative_projects SET history_revision=history_revision+1 WHERE id=parent;
 ELSE
  EXECUTE format('UPDATE %I SET history_revision=history_revision+1 WHERE id=$1',TG_ARGV[0]) USING parent;
 END IF;
 RETURN NULL;
END $$;
CREATE FUNCTION guard_business_history_fence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (TG_OP='INSERT' AND NEW.history_revision<>1) OR
  (TG_OP='UPDATE' AND NEW.history_revision IS DISTINCT FROM OLD.history_revision
   AND (pg_trigger_depth()<2 OR NEW.history_revision<>OLD.history_revision+1)) THEN
  RAISE EXCEPTION 'Business history revision is managed by saved versions' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
DO $$ DECLARE tab text; BEGIN
 FOREACH tab IN ARRAY ARRAY['brand_profiles','agent_groups','project_configurations','workflow_schedules','creative_projects'] LOOP
  EXECUTE format('CREATE TRIGGER business_history_revision_guard BEFORE INSERT OR UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION guard_business_history_fence()',tab);
 END LOOP;
END $$;
ALTER FUNCTION advance_business_history() OWNER TO cp_control;
REVOKE ALL ON FUNCTION advance_business_history() FROM PUBLIC;
DO $$ DECLARE spec text[]; BEGIN
 FOREACH spec SLICE 1 IN ARRAY ARRAY[
  ['brand_profile_versions','brand_profiles','brand_id'],
  ['agent_group_versions','agent_groups','group_id'],
  ['project_configuration_versions','project_configurations','configuration_id'],
  ['workflow_schedule_versions','workflow_schedules','schedule_id'],
  ['poster_project_versions','creative_projects','creative_id'],
  ['video_project_versions','creative_projects','video_id'],
  ['editable_project_versions','creative_projects','creative_id'],
  ['creative_matrix_revisions','creative_matrix_units','unit_id']
 ] LOOP
  EXECUTE format('CREATE TRIGGER business_history_fence AFTER INSERT OR UPDATE OR DELETE ON %I FOR EACH ROW EXECUTE FUNCTION advance_business_history(%L,%L)',spec[1],spec[2],spec[3]);
 END LOOP;
END $$;
