-- Durable erasure journal. Financial and audit records deliberately have no
-- generic erasure trigger. A deletion is irreversible even for control APIs.
CREATE TABLE deletion_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id),
 project_id uuid, target_type text NOT NULL, target_id uuid NOT NULL,
 private_owner uuid, created_by uuid, state text NOT NULL DEFAULT 'queued'
 CHECK(state IN ('queued','cleaning','completed','completed_with_exceptions','failed')),
 exceptions jsonb NOT NULL DEFAULT '[]', attempts integer NOT NULL DEFAULT 0,
 next_attempt_at timestamptz NOT NULL DEFAULT now(), lease_token uuid, lease_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
 UNIQUE(target_type,target_id), FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
CREATE INDEX deletion_jobs_pending ON deletion_jobs(next_attempt_at) WHERE state IN ('queued','cleaning');
CREATE INDEX deletion_jobs_tenant ON deletion_jobs(tenant_id,created_at,id);
CREATE TABLE deletion_items (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), job_id uuid NOT NULL REFERENCES deletion_jobs(id),
 kind text NOT NULL CHECK(kind IN ('object','runtime')), locator text NOT NULL,
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','completed','failed')),
 attempts integer NOT NULL DEFAULT 0, error_code text, completed_at timestamptz,
 UNIQUE(job_id,kind,locator)
);
-- Tombstones survive a backup restore/replay. No deleted immutable key may
-- acquire a new reference after an orphan sweep or partial erasure.
CREATE TABLE object_erasure_tombstones(storage_key text PRIMARY KEY, erased_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE deletion_dependencies (
 job_id uuid NOT NULL REFERENCES deletion_jobs(id), child_job_id uuid NOT NULL REFERENCES deletion_jobs(id),
 PRIMARY KEY(job_id,child_job_id), CHECK(job_id<>child_job_id)
);
ALTER TABLE asset_versions ADD COLUMN erased_at timestamptz;
ALTER TABLE deletion_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE deletion_jobs FORCE ROW LEVEL SECURITY;
CREATE POLICY erasure_scope ON deletion_jobs USING (
 current_user='cp_control' OR (tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND (private_owner IS NULL OR private_owner=nullif(current_setting('app.actor_id',true),'')::uuid))
);
GRANT SELECT ON deletion_jobs TO cp_app;
GRANT SELECT,INSERT,UPDATE ON deletion_jobs,deletion_items,object_erasure_tombstones,deletion_dependencies TO cp_control;
GRANT UPDATE(erased_at,metadata) ON asset_versions TO cp_control;

CREATE FUNCTION guard_immutable_object_reference() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended('object:'||NEW.storage_key,0));
 IF EXISTS(SELECT 1 FROM object_erasure_tombstones WHERE storage_key=NEW.storage_key) THEN
  RAISE EXCEPTION 'Erased immutable object cannot be referenced' USING ERRCODE='23514';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM assets WHERE id=NEW.asset_id AND state='active') THEN
  RAISE EXCEPTION 'Unavailable asset cannot acquire versions' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_immutable_object_reference() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_immutable_object_reference() FROM PUBLIC;
CREATE TRIGGER immutable_object_reference BEFORE INSERT OR UPDATE OF storage_key ON asset_versions FOR EACH ROW EXECUTE FUNCTION guard_immutable_object_reference();

CREATE FUNCTION journal_content_erasure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE old_state text; new_state text; j uuid; private_id uuid;
BEGIN
 old_state := to_jsonb(OLD)->>TG_ARGV[0]; new_state := to_jsonb(NEW)->>TG_ARGV[0];
 IF old_state='deleted' AND new_state<>'deleted' THEN
  RAISE EXCEPTION 'Permanent deletion cannot be restored' USING ERRCODE='23514';
 END IF;
 IF new_state<>'deleted' THEN RETURN NEW; END IF;
 private_id := nullif(to_jsonb(NEW)->>'private_owner','')::uuid;
 IF TG_TABLE_NAME='conversations' THEN private_id:=NEW.created_by; END IF;
 INSERT INTO deletion_jobs(tenant_id,project_id,target_type,target_id,private_owner,created_by)
 VALUES(NEW.tenant_id,nullif(to_jsonb(NEW)->>'project_id','')::uuid,TG_TABLE_NAME,NEW.id,private_id,nullif(to_jsonb(NEW)->>'created_by','')::uuid)
 ON CONFLICT(target_type,target_id) DO UPDATE SET target_id=excluded.target_id RETURNING id INTO j;
 IF TG_TABLE_NAME='assets' THEN
  INSERT INTO deletion_items(job_id,kind,locator) SELECT j,'object',storage_key FROM asset_versions WHERE asset_id=NEW.id ON CONFLICT DO NOTHING;
  UPDATE shares SET revoked_at=now() WHERE asset_id=NEW.id AND revoked_at IS NULL;
 ELSIF TG_TABLE_NAME='tasks' THEN
  INSERT INTO deletion_items(job_id,kind,locator) VALUES(j,'runtime',NEW.id::text) ON CONFLICT DO NOTHING;
 ELSIF TG_TABLE_NAME='conversations' THEN
  INSERT INTO deletion_dependencies(job_id,child_job_id)
   SELECT j,d.id FROM deletion_jobs d WHERE
    (d.target_type='tasks' AND d.target_id IN (SELECT id FROM tasks WHERE conversation_id=NEW.id)) OR
    (d.target_type='memories' AND d.target_id IN (SELECT id FROM memories WHERE conversation_id=NEW.id)) OR
    (d.target_type='assets' AND d.target_id IN (SELECT a.id FROM assets a JOIN asset_versions v ON v.asset_id=a.id WHERE a.private_owner=NEW.created_by AND v.metadata->>'conversation_id'=NEW.id::text))
   ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION journal_content_erasure() OWNER TO cp_control;
REVOKE ALL ON FUNCTION journal_content_erasure() FROM PUBLIC;
DO $$ DECLARE t text; s text; BEGIN
 FOREACH t IN ARRAY ARRAY['assets','tasks','brand_profiles','analytics_datasets','workflows','workflow_runs','workflow_schedules','creative_projects','agents','conversations','memories'] LOOP
  s:=CASE WHEN t='assets' THEN 'state' ELSE 'content_state' END;
  EXECUTE format('CREATE TRIGGER content_erasure_journal AFTER UPDATE OF %I ON %I FOR EACH ROW EXECUTE FUNCTION journal_content_erasure(%L)',s,t,s);
  -- Backfill already deleted rows through the same journal, without changing
  -- state, version, accounting, audit history, or live content.
  EXECUTE format('UPDATE %I SET %I=%I WHERE %I=''deleted''',t,s,s,s);
 END LOOP;
END $$;
INSERT INTO schema_migrations(version) VALUES(11);
