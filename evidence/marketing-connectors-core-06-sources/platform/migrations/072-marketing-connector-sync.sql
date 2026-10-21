-- Additive account-scoped, read-only marketing connectors; SQL001-071 are unchanged.
CREATE TABLE connector_profiles (
 connection_id uuid PRIMARY KEY, tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 auth_version integer NOT NULL DEFAULT 0 CHECK(auth_version>=0), version integer NOT NULL DEFAULT 0 CHECK(version>=0),
 account_ids text[] NOT NULL DEFAULT '{}', project_ids uuid[] NOT NULL DEFAULT '{}',
 data_mode text NOT NULL CHECK(data_mode IN('simulated','configured_services')),
 api_version text NOT NULL, configuration_hash text NOT NULL CHECK(configuration_hash~'^[a-f0-9]{64}$'),
 catalog_state text NOT NULL DEFAULT 'pending' CHECK(catalog_state IN('pending','discovering','complete','partial','failed')),
 catalog_limits text[] NOT NULL DEFAULT '{}', last_sync_at timestamptz, data_as_of timestamptz,
 FOREIGN KEY(tenant_id,connection_id) REFERENCES connections(tenant_id,id),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 CHECK(cardinality(account_ids)<=20 AND cardinality(project_ids)<=20), UNIQUE(tenant_id,connection_id)
);
CREATE TABLE connector_oauth_states (
 digest text PRIMARY KEY CHECK(digest~'^[a-f0-9]{64}$'), tenant_id uuid NOT NULL, connection_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id), actor_auth_version integer NOT NULL,
 session_id uuid NOT NULL REFERENCES sessions(id), encrypted_verifier text NOT NULL, encrypted_state text NOT NULL,
 configuration_hash text NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz,
 FOREIGN KEY(tenant_id,connection_id) REFERENCES connector_profiles(tenant_id,connection_id)
);
CREATE TABLE connector_accounts (
 connection_id uuid NOT NULL, tenant_id uuid NOT NULL, auth_version integer NOT NULL, account_id text NOT NULL,
 body jsonb NOT NULL CHECK(jsonb_typeof(body)='object'), discovered_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(connection_id,auth_version,account_id),
 FOREIGN KEY(tenant_id,connection_id) REFERENCES connector_profiles(tenant_id,connection_id)
);
CREATE TABLE connector_jobs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL, connection_id uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN('discover','sync')), state text NOT NULL DEFAULT 'queued' CHECK(state IN('queued','running','complete','partial','failed','cancelled')),
 actor_id uuid NOT NULL REFERENCES users(id), actor_auth_version integer NOT NULL, connection_auth_version integer NOT NULL, binding_version integer NOT NULL,
 data_mode text NOT NULL CHECK(data_mode IN('simulated','configured_services')),
 specification jsonb NOT NULL CHECK(jsonb_typeof(specification)='object'), spec_hash text NOT NULL CHECK(spec_hash~'^[a-f0-9]{64}$'),
 segment integer NOT NULL DEFAULT 0 CHECK(segment>=0), ordinal integer NOT NULL DEFAULT 0 CHECK(ordinal>=0),
 encrypted_cursor text, cursor_hashes text[] NOT NULL DEFAULT '{}',
 page_count integer NOT NULL DEFAULT 0 CHECK(page_count BETWEEN 0 AND 250), row_count integer NOT NULL DEFAULT 0 CHECK(row_count BETWEEN 0 AND 100000),
 raw_bytes bigint NOT NULL DEFAULT 0 CHECK(raw_bytes BETWEEN 0 AND 50000000), attempts integer NOT NULL DEFAULT 0 CHECK(attempts BETWEEN 0 AND 5),
 revision integer NOT NULL DEFAULT 0 CHECK(revision>=0), lease_token uuid, lease_until timestamptz,
 next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(), error_code text, limitations text[] NOT NULL DEFAULT '{}',
 retry_of uuid REFERENCES connector_jobs(id), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 started_at timestamptz, finished_at timestamptz, expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '6 hours',
 FOREIGN KEY(tenant_id,connection_id) REFERENCES connector_profiles(tenant_id,connection_id),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id), UNIQUE(tenant_id,id),
 CHECK((state IN('queued','running'))=(finished_at IS NULL)),
 CHECK((lease_token IS NULL)=(lease_until IS NULL))
);
CREATE UNIQUE INDEX connector_one_active ON connector_jobs(connection_id) WHERE state IN('queued','running');
CREATE INDEX connector_due ON connector_jobs(next_attempt_at,created_at,id) WHERE state IN('queued','running');
CREATE TABLE connector_pages (
 job_id uuid NOT NULL, tenant_id uuid NOT NULL, ordinal integer NOT NULL, segment integer NOT NULL,
 asset_id uuid NOT NULL, asset_version integer NOT NULL, sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),
 provider_sha256 text NOT NULL CHECK(provider_sha256~'^[a-f0-9]{64}$'), row_count integer NOT NULL CHECK(row_count>=0),
 query_hash text NOT NULL CHECK(query_hash~'^[a-f0-9]{64}$'), captured_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(job_id,ordinal), FOREIGN KEY(tenant_id,job_id) REFERENCES connector_jobs(tenant_id,id),
 FOREIGN KEY(tenant_id,asset_id) REFERENCES assets(tenant_id,id), FOREIGN KEY(asset_id,asset_version) REFERENCES asset_versions(asset_id,version)
);
CREATE TABLE connector_snapshots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL, job_id uuid NOT NULL,
 source text NOT NULL CHECK(source IN('google_ads','meta_ads','ga4','search_console')), state text NOT NULL CHECK(state IN('complete','partial')),
 asset_id uuid NOT NULL, asset_version integer NOT NULL, sha256 text NOT NULL CHECK(sha256~'^[a-f0-9]{64}$'),
 row_count integer NOT NULL CHECK(row_count>=0), spec_hash text NOT NULL CHECK(spec_hash~'^[a-f0-9]{64}$'), data_as_of timestamptz,
 captured_at timestamptz NOT NULL DEFAULT clock_timestamp(), data_mode text NOT NULL CHECK(data_mode IN('simulated','configured_services')),
 limitations text[] NOT NULL DEFAULT '{}', dataset_ids uuid[] NOT NULL DEFAULT '{}',
 FOREIGN KEY(tenant_id,job_id) REFERENCES connector_jobs(tenant_id,id), FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY(tenant_id,asset_id) REFERENCES assets(tenant_id,id), FOREIGN KEY(asset_id,asset_version) REFERENCES asset_versions(asset_id,version),
 UNIQUE(job_id,project_id), UNIQUE(tenant_id,id)
);
CREATE FUNCTION guard_connector_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Connector page/snapshot history is immutable' USING ERRCODE='23514'; END $$;
CREATE TRIGGER connector_page_history BEFORE UPDATE OR DELETE ON connector_pages FOR EACH ROW EXECUTE FUNCTION guard_connector_history();
CREATE TRIGGER connector_snapshot_history BEFORE UPDATE OR DELETE ON connector_snapshots FOR EACH ROW EXECUTE FUNCTION guard_connector_history();
CREATE FUNCTION guard_connector_job() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' OR OLD.state NOT IN('queued','running') THEN RAISE EXCEPTION 'Finished connector jobs are immutable' USING ERRCODE='23514'; END IF;
 IF NEW.revision<>OLD.revision+1 OR
  (to_jsonb(NEW)-ARRAY['state','segment','ordinal','encrypted_cursor','cursor_hashes','page_count','row_count','raw_bytes','attempts','revision','lease_token','lease_until','next_attempt_at','error_code','limitations','started_at','finished_at']) IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['state','segment','ordinal','encrypted_cursor','cursor_hashes','page_count','row_count','raw_bytes','attempts','revision','lease_token','lease_until','next_attempt_at','error_code','limitations','started_at','finished_at']) THEN
  RAISE EXCEPTION 'Connector query identity or revision changed' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER connector_job_identity BEFORE UPDATE OR DELETE ON connector_jobs FOR EACH ROW EXECUTE FUNCTION guard_connector_job();
CREATE FUNCTION check_connector_asset_binding() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE j connector_jobs; a assets; v asset_versions;
BEGIN
 SELECT * INTO j FROM connector_jobs WHERE id=NEW.job_id AND tenant_id=NEW.tenant_id;
 SELECT * INTO a FROM assets WHERE id=NEW.asset_id;
 SELECT * INTO v FROM asset_versions WHERE asset_id=NEW.asset_id AND version=NEW.asset_version;
 IF j.id IS NULL OR j.kind<>'sync' OR j.state<>'running' OR a.id IS NULL OR a.tenant_id<>j.tenant_id OR a.private_owner IS NOT NULL OR a.state<>'active'
  OR v.id IS NULL OR v.erased_at IS NOT NULL OR v.sha256<>NEW.sha256 OR v.mime_type<>'application/json' THEN
  RAISE EXCEPTION 'Connector content binding is invalid' USING ERRCODE='23514'; END IF;
 IF TG_TABLE_NAME='connector_pages' THEN
  IF a.project_id<>j.project_id OR NEW.ordinal<>j.ordinal OR NEW.segment<>j.segment THEN RAISE EXCEPTION 'Connector page scope mismatch' USING ERRCODE='23514'; END IF;
 ELSE
  IF a.project_id<>NEW.project_id OR NOT(j.specification->'project_ids' ? NEW.project_id::text) OR NEW.spec_hash<>j.spec_hash OR NEW.data_mode<>j.data_mode THEN
   RAISE EXCEPTION 'Connector snapshot scope mismatch' USING ERRCODE='23514'; END IF;
 END IF; RETURN NEW;
END $$;
ALTER FUNCTION check_connector_asset_binding() OWNER TO cp_control;
REVOKE ALL ON FUNCTION check_connector_asset_binding() FROM PUBLIC;
CREATE TRIGGER connector_page_binding BEFORE INSERT ON connector_pages FOR EACH ROW EXECUTE FUNCTION check_connector_asset_binding();
CREATE TRIGGER connector_snapshot_binding BEFORE INSERT ON connector_snapshots FOR EACH ROW EXECUTE FUNCTION check_connector_asset_binding();
CREATE FUNCTION fence_connector_revoke() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.state='revoked' AND OLD.state<>'revoked' THEN
  NEW.encrypted_secret=NULL;
  UPDATE connector_profiles SET auth_version=auth_version+1,version=version+1,account_ids='{}',project_ids='{}' WHERE connection_id=NEW.id;
  UPDATE connector_jobs SET state='cancelled',finished_at=clock_timestamp(),lease_token=NULL,lease_until=NULL,revision=revision+1,error_code='CONNECTOR_REVOKED',encrypted_cursor=NULL
   WHERE connection_id=NEW.id AND state IN('queued','running');
  UPDATE connector_oauth_states SET consumed_at=coalesce(consumed_at,clock_timestamp()) WHERE connection_id=NEW.id;
 END IF; RETURN NEW;
END $$;
ALTER FUNCTION fence_connector_revoke() OWNER TO cp_control;
REVOKE ALL ON FUNCTION fence_connector_revoke() FROM PUBLIC;
CREATE TRIGGER connector_revoke_fence BEFORE UPDATE OF state ON connections FOR EACH ROW EXECUTE FUNCTION fence_connector_revoke();
-- Published snapshots survive OAuth revocation, but not removal/expiry of their retained source content.
CREATE FUNCTION connector_asset_available(asset uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog,public AS $$
 SELECT NOT EXISTS(SELECT 1 FROM connector_snapshots s JOIN connector_jobs j ON j.id=s.job_id
  WHERE s.asset_id=asset AND EXISTS(SELECT 1 FROM connector_pages p JOIN assets a ON a.id=p.asset_id
   JOIN asset_versions v ON v.asset_id=a.id AND v.version=p.asset_version
   WHERE p.job_id=j.id AND (a.state<>'active' OR a.retention_expires_at<=clock_timestamp() OR v.erased_at IS NOT NULL OR v.sha256<>p.sha256)))
$$;
ALTER FUNCTION connector_asset_available(uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION connector_asset_available(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION connector_asset_available(uuid) TO cp_app,cp_control;
CREATE POLICY connector_snapshot_asset_scope ON assets AS RESTRICTIVE FOR SELECT TO cp_app USING(connector_asset_available(id));
CREATE FUNCTION erase_connector_dependants() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE dependants uuid[];
BEGIN
 IF NEW.state='active' OR NEW.state IS NOT DISTINCT FROM OLD.state THEN RETURN NEW; END IF;
 UPDATE connector_jobs j SET state='cancelled',finished_at=clock_timestamp(),lease_token=NULL,lease_until=NULL,revision=revision+1,error_code='CONNECTOR_SOURCE_REMOVED',encrypted_cursor=NULL
  WHERE j.state IN('queued','running') AND EXISTS(SELECT 1 FROM connector_pages p WHERE p.job_id=j.id AND p.asset_id=NEW.id);
 IF NEW.state<>'deleted' OR OLD.state='deleted' THEN RETURN NEW; END IF;
 SELECT array_agg(s.asset_id) INTO dependants FROM connector_snapshots s JOIN connector_pages p ON p.job_id=s.job_id WHERE p.asset_id=NEW.id AND s.asset_id<>NEW.id;
 IF dependants IS NOT NULL THEN
  UPDATE assets SET state='deleted',moderation_version=moderation_version+1 WHERE id=ANY(dependants) AND state<>'deleted';
  INSERT INTO deletion_dependencies(job_id,child_job_id) SELECT p.id,c.id FROM deletion_jobs p JOIN deletion_jobs c ON c.target_type='assets' AND c.target_id=ANY(dependants)
   WHERE p.target_type='assets' AND p.target_id=NEW.id ON CONFLICT DO NOTHING;
 END IF; RETURN NEW;
END $$;
ALTER FUNCTION erase_connector_dependants() OWNER TO cp_control;
REVOKE ALL ON FUNCTION erase_connector_dependants() FROM PUBLIC;
CREATE TRIGGER z_erase_connector_dependants AFTER UPDATE OF state ON assets FOR EACH ROW EXECUTE FUNCTION erase_connector_dependants();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['connector_profiles','connector_oauth_states','connector_accounts','connector_jobs','connector_pages','connector_snapshots'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY connector_tenant_scope ON %I USING(current_user=''cp_control'' OR tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK(current_user=''cp_control'' OR tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
 END LOOP;
END $$;
GRANT SELECT ON connector_profiles,connector_accounts,connector_jobs,connector_pages,connector_snapshots TO cp_app;
GRANT SELECT,INSERT,UPDATE ON connector_profiles,connector_oauth_states,connector_accounts,connector_jobs TO cp_control;
GRANT SELECT,INSERT ON connector_pages,connector_snapshots TO cp_control;
INSERT INTO schema_migrations(version) VALUES(72);
