-- Additive deterministic design matrices. SQL001-068 are unchanged.
ALTER TABLE creative_projects DROP CONSTRAINT creative_projects_kind_check;
ALTER TABLE creative_projects ADD CONSTRAINT creative_projects_kind_check CHECK(kind IN ('poster','video','creative_matrix'));
ALTER TABLE creative_projects ADD CONSTRAINT creative_matrix_parent_identity UNIQUE(id,tenant_id,project_id);
CREATE TABLE creative_matrix_units (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL, batch_id uuid NOT NULL,
 creative_key text NOT NULL, locale text NOT NULL CHECK(locale IN ('zh-HK','en')), size_key text NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','rendering','succeeded','failed','cancelled')),
 actor_id uuid NOT NULL REFERENCES users(id), actor_auth_version integer NOT NULL CHECK(actor_auth_version>0),
 current_attempt uuid, error_code text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(batch_id,creative_key,locale,size_key), UNIQUE(id,tenant_id,project_id),
 FOREIGN KEY(batch_id,tenant_id,project_id) REFERENCES creative_projects(id,tenant_id,project_id)
);
CREATE TABLE creative_matrix_revisions (
 tenant_id uuid NOT NULL, project_id uuid NOT NULL, unit_id uuid NOT NULL, revision integer NOT NULL CHECK(revision>0),
 input jsonb NOT NULL CHECK(jsonb_typeof(input)='object'), input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
 actor_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(unit_id,revision), FOREIGN KEY(unit_id,tenant_id,project_id) REFERENCES creative_matrix_units(id,tenant_id,project_id)
);
CREATE TABLE creative_matrix_attempts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL, unit_id uuid NOT NULL, revision integer NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id), state text NOT NULL CHECK(state IN ('rendering','succeeded','failed','cancelled')),
 lease_token uuid NOT NULL UNIQUE, lease_until timestamptz NOT NULL,
 input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'), error_code text,
 png_asset_id uuid REFERENCES assets(id), svg_asset_id uuid REFERENCES assets(id), source_asset_id uuid REFERENCES assets(id),
 ai_cost_micros bigint NOT NULL DEFAULT 0 CHECK(ai_cost_micros=0), cost_source text NOT NULL DEFAULT 'local_composition_no_ai' CHECK(cost_source='local_composition_no_ai'),
 elapsed_ms integer CHECK(elapsed_ms>=0), output_bytes bigint CHECK(output_bytes>=0),
 started_at timestamptz NOT NULL DEFAULT clock_timestamp(), finished_at timestamptz,
 FOREIGN KEY(unit_id,tenant_id,project_id) REFERENCES creative_matrix_units(id,tenant_id,project_id),
 FOREIGN KEY(unit_id,revision) REFERENCES creative_matrix_revisions(unit_id,revision),
 CHECK((state='rendering')=(finished_at IS NULL)),
 CHECK((state='succeeded')=(num_nonnulls(png_asset_id,svg_asset_id,source_asset_id)=3))
);
ALTER TABLE creative_matrix_units ADD CONSTRAINT matrix_current_attempt FOREIGN KEY(current_attempt) REFERENCES creative_matrix_attempts(id);
CREATE UNIQUE INDEX matrix_one_active_attempt ON creative_matrix_attempts(unit_id) WHERE state='rendering';
CREATE INDEX matrix_queued ON creative_matrix_units(created_at,id) WHERE state='queued';
CREATE INDEX matrix_expired ON creative_matrix_attempts(lease_until) WHERE state='rendering';
CREATE INDEX matrix_png_output ON creative_matrix_attempts(png_asset_id) WHERE png_asset_id IS NOT NULL;
CREATE INDEX matrix_svg_output ON creative_matrix_attempts(svg_asset_id) WHERE svg_asset_id IS NOT NULL;
CREATE INDEX matrix_source_output ON creative_matrix_attempts(source_asset_id) WHERE source_asset_id IS NOT NULL;
CREATE FUNCTION guard_matrix_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='creative_matrix_revisions' THEN
  IF current_user='cp_control' AND current_setting('app.erasing_content',true)='true'
   AND EXISTS(SELECT 1 FROM creative_matrix_units u JOIN creative_projects p ON p.id=u.batch_id WHERE u.id=OLD.unit_id AND p.content_state='deleted') THEN
   IF TG_OP='UPDATE' AND NEW.input='{}'::jsonb AND (to_jsonb(NEW)-'input')=(to_jsonb(OLD)-'input') THEN RETURN NEW; END IF;
  END IF;
  RAISE EXCEPTION 'Matrix input revisions are immutable' USING ERRCODE='23514';
 END IF;
 IF TG_OP='DELETE' OR OLD.state<>'rendering' THEN
  RAISE EXCEPTION 'Finished matrix attempts are immutable' USING ERRCODE='23514';
 END IF;
 IF (to_jsonb(NEW)-ARRAY['state','error_code','png_asset_id','svg_asset_id','source_asset_id','elapsed_ms','output_bytes','finished_at']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['state','error_code','png_asset_id','svg_asset_id','source_asset_id','elapsed_ms','output_bytes','finished_at']) THEN
  RAISE EXCEPTION 'Matrix attempt identity is immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER matrix_revision_history BEFORE UPDATE OR DELETE ON creative_matrix_revisions FOR EACH ROW EXECUTE FUNCTION guard_matrix_history();
CREATE TRIGGER matrix_attempt_history BEFORE UPDATE OR DELETE ON creative_matrix_attempts FOR EACH ROW EXECUTE FUNCTION guard_matrix_history();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['creative_matrix_units','creative_matrix_revisions','creative_matrix_attempts'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY matrix_tenant_scope ON %I USING(current_user=''cp_control'' OR tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(current_user=''cp_control'' OR tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
 END LOOP;
END $$;
GRANT SELECT,INSERT ON creative_matrix_units,creative_matrix_revisions TO cp_app;
GRANT SELECT ON creative_matrix_attempts TO cp_app;
GRANT UPDATE(revision,state,actor_id,actor_auth_version,current_attempt,error_code,updated_at) ON creative_matrix_units TO cp_app;
GRANT SELECT,INSERT,UPDATE ON creative_matrix_units,creative_matrix_revisions,creative_matrix_attempts TO cp_control;

CREATE FUNCTION matrix_asset_available(asset uuid) RETURNS boolean
 LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT NOT EXISTS(
  SELECT 1 FROM creative_matrix_attempts a JOIN creative_matrix_units u ON u.id=a.unit_id
   JOIN creative_projects p ON p.id=u.batch_id JOIN creative_matrix_revisions r ON r.unit_id=a.unit_id AND r.revision=a.revision
  WHERE asset IN(a.png_asset_id,a.svg_asset_id,a.source_asset_id) AND
   (p.content_state<>'active' OR r.input='{}'::jsonb OR
    (r.input->'image'<>'null'::jsonb AND NOT EXISTS(SELECT 1 FROM assets source
     WHERE source.id=(r.input->'image'->>'asset_id')::uuid AND source.project_id=p.project_id AND source.tenant_id=p.tenant_id AND source.state='active' AND source.private_owner IS NULL
      AND matrix_asset_available(source.id) AND analysis_asset_available(source.id))))
 );
$$;
ALTER FUNCTION matrix_asset_available(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION matrix_asset_available(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION matrix_asset_available(uuid) TO cp_app,cp_control;
-- The worker must apply the existing analysis-source restriction too.
GRANT EXECUTE ON FUNCTION analysis_asset_available(uuid) TO cp_control;
CREATE POLICY matrix_output_scope ON assets AS RESTRICTIVE FOR SELECT TO cp_app USING(matrix_asset_available(id));

CREATE FUNCTION stop_removed_matrix() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.kind='creative_matrix' AND NEW.content_state<>'active' AND NEW.content_state IS DISTINCT FROM OLD.content_state THEN
  UPDATE creative_matrix_attempts SET state='cancelled',error_code='BATCH_UNAVAILABLE',finished_at=clock_timestamp()
   WHERE state='rendering' AND unit_id IN(SELECT id FROM creative_matrix_units WHERE batch_id=NEW.id);
  UPDATE creative_matrix_units SET state='cancelled',error_code='BATCH_UNAVAILABLE',updated_at=clock_timestamp()
   WHERE batch_id=NEW.id AND state IN('queued','rendering');
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION stop_removed_matrix() OWNER TO cp_control;
REVOKE ALL ON FUNCTION stop_removed_matrix() FROM PUBLIC;
CREATE TRIGGER stop_removed_matrix AFTER UPDATE OF content_state ON creative_projects FOR EACH ROW EXECUTE FUNCTION stop_removed_matrix();

-- Derived SVGs contain source pixels. A source erasure must clean those objects,
-- including later matrices that used a delivered PNG as a reference.
CREATE FUNCTION erase_matrix_source_copies() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE outputs uuid[];
BEGIN
 IF NEW.state<>'deleted' OR OLD.state='deleted' THEN RETURN NEW; END IF;
 SELECT array_agg(DISTINCT output.id) INTO outputs FROM creative_matrix_revisions r
  JOIN creative_matrix_attempts a ON a.unit_id=r.unit_id AND a.revision=r.revision
  CROSS JOIN LATERAL unnest(ARRAY[a.png_asset_id,a.svg_asset_id,a.source_asset_id]) AS output(id)
  WHERE r.input->'image'->>'asset_id'=NEW.id::text AND output.id IS NOT NULL;
 IF outputs IS NOT NULL THEN
  UPDATE assets SET state='deleted',moderation_version=moderation_version+1 WHERE id=ANY(outputs) AND state<>'deleted';
  INSERT INTO deletion_dependencies(job_id,child_job_id)
   SELECT parent.id,child.id FROM deletion_jobs parent JOIN deletion_jobs child
    ON child.target_type='assets' AND child.target_id=ANY(outputs)
   WHERE parent.target_type='assets' AND parent.target_id=NEW.id ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION erase_matrix_source_copies() OWNER TO cp_control;
REVOKE ALL ON FUNCTION erase_matrix_source_copies() FROM PUBLIC;
CREATE TRIGGER z_erase_matrix_source_copies AFTER UPDATE OF state ON assets FOR EACH ROW EXECUTE FUNCTION erase_matrix_source_copies();

INSERT INTO schema_migrations(version) VALUES(69);
