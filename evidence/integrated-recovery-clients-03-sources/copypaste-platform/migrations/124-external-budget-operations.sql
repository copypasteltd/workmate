-- Parameter-bound Google Ads budget changes. Existing connector and AI ledgers are unchanged.
CREATE TABLE external_budget_policies (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 connection_id uuid NOT NULL, account_id text NOT NULL CHECK(account_id~'^[1-9][0-9]{0,19}$'),
 version integer NOT NULL CHECK(version>0), body jsonb NOT NULL CHECK(jsonb_typeof(body)='object'),
 payload_sha256 text NOT NULL CHECK(payload_sha256~'^[a-f0-9]{64}$'),
 data_mode text NOT NULL CHECK(data_mode IN('simulated','configured_services')),
 created_by uuid NOT NULL, created_by_audience text NOT NULL CHECK(created_by_audience IN('user','admin')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY(tenant_id,connection_id) REFERENCES connector_profiles(tenant_id,connection_id),
 UNIQUE(connection_id,project_id,account_id,version), UNIQUE(tenant_id,id)
);
CREATE TABLE external_budget_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 connection_id uuid NOT NULL, account_id text NOT NULL, actor_id uuid NOT NULL REFERENCES users(id), actor_auth_version integer NOT NULL,
 body jsonb NOT NULL, body_sha256 text NOT NULL CHECK(body_sha256~'^[a-f0-9]{64}$'),
 data_mode text NOT NULL CHECK(data_mode IN('simulated','configured_services')),
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY(tenant_id,connection_id) REFERENCES connector_profiles(tenant_id,connection_id)
);
CREATE TABLE external_budget_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 connection_id uuid NOT NULL, account_id text NOT NULL, budget_id text NOT NULL,
 policy_id uuid NOT NULL, policy_version integer NOT NULL, specification jsonb NOT NULL,
 payload_sha256 text NOT NULL CHECK(payload_sha256~'^[a-f0-9]{64}$'),
 data_mode text NOT NULL CHECK(data_mode IN('simulated','configured_services')),
 actor_id uuid NOT NULL REFERENCES users(id), actor_auth_version integer NOT NULL, task_id uuid REFERENCES tasks(id),
 state text NOT NULL CHECK(state IN('awaiting_confirmation','queued','checking','dispatched','succeeded','failed','cancelled','expired','unknown','closed_unknown','no_change')),
 version integer NOT NULL DEFAULT 1 CHECK(version>0),
 confirmed_by uuid REFERENCES users(id), confirmed_auth_version integer,
 lease_token uuid, lease_until timestamptz, request_sha256 text CHECK(request_sha256~'^[a-f0-9]{64}$'),
 observation jsonb, error_code text, resolution jsonb,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), finished_at timestamptz,
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY(tenant_id,connection_id) REFERENCES connector_profiles(tenant_id,connection_id),
 FOREIGN KEY(tenant_id,policy_id) REFERENCES external_budget_policies(tenant_id,id),
 UNIQUE(tenant_id,id), CHECK((confirmed_by IS NULL)=(confirmed_auth_version IS NULL)),
 CHECK(state NOT IN('queued','checking','dispatched','succeeded') OR confirmed_by IS NOT NULL)
);
CREATE UNIQUE INDEX external_budget_unresolved_target ON external_budget_operations(tenant_id,account_id,budget_id)
 WHERE state IN('awaiting_confirmation','queued','checking','dispatched','unknown');
CREATE INDEX external_budget_due ON external_budget_operations(state,created_at);
CREATE TABLE external_budget_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, operation_id uuid NOT NULL,
 outcome text NOT NULL CHECK(outcome IN('applied','rejected','unknown')), body jsonb NOT NULL,
 body_sha256 text NOT NULL CHECK(body_sha256~'^[a-f0-9]{64}$'), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,operation_id) REFERENCES external_budget_operations(tenant_id,id),
 UNIQUE(operation_id,body_sha256)
);
CREATE TABLE external_budget_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id uuid NOT NULL, operation_id uuid NOT NULL,
 version integer NOT NULL, state text NOT NULL, actor_id text, details jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(tenant_id,operation_id) REFERENCES external_budget_operations(tenant_id,id), UNIQUE(operation_id,version)
);
CREATE FUNCTION immutable_external_budget_record() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'External budget evidence is append-only' USING ERRCODE='23514'; END $$;
CREATE TRIGGER external_budget_policy_immutable BEFORE UPDATE OR DELETE ON external_budget_policies FOR EACH ROW EXECUTE FUNCTION immutable_external_budget_record();
CREATE TRIGGER external_budget_preview_immutable BEFORE UPDATE ON external_budget_previews FOR EACH ROW EXECUTE FUNCTION immutable_external_budget_record();
CREATE TRIGGER external_budget_receipt_immutable BEFORE UPDATE OR DELETE ON external_budget_receipts FOR EACH ROW EXECUTE FUNCTION immutable_external_budget_record();
CREATE TRIGGER external_budget_event_immutable BEFORE UPDATE OR DELETE ON external_budget_events FOR EACH ROW EXECUTE FUNCTION immutable_external_budget_record();
CREATE FUNCTION guard_external_budget_operation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'External budget intent cannot be deleted' USING ERRCODE='23514'; END IF;
 IF NEW.version<>OLD.version+1 OR
  (to_jsonb(NEW)-ARRAY['state','version','confirmed_by','confirmed_auth_version','lease_token','lease_until','request_sha256','observation','error_code','resolution','finished_at']) IS DISTINCT FROM
  (to_jsonb(OLD)-ARRAY['state','version','confirmed_by','confirmed_auth_version','lease_token','lease_until','request_sha256','observation','error_code','resolution','finished_at']) OR
  (OLD.confirmed_by IS NOT NULL AND (NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by OR NEW.confirmed_auth_version IS DISTINCT FROM OLD.confirmed_auth_version)) OR
  (OLD.request_sha256 IS NOT NULL AND NEW.request_sha256 IS DISTINCT FROM OLD.request_sha256) THEN
  RAISE EXCEPTION 'Frozen budget identity or revision changed' USING ERRCODE='23514'; END IF;
 IF NEW.state<>OLD.state AND NOT (
  (OLD.state='awaiting_confirmation' AND NEW.state IN('queued','cancelled','expired','failed')) OR
  (OLD.state='queued' AND NEW.state IN('checking','cancelled','expired','failed')) OR
  (OLD.state='checking' AND NEW.state IN('dispatched','cancelled','expired','failed','no_change')) OR
  (OLD.state='dispatched' AND NEW.state IN('succeeded','failed','unknown')) OR
  (OLD.state='unknown' AND NEW.state IN('succeeded','failed','closed_unknown'))
 ) THEN RAISE EXCEPTION 'Invalid external budget transition' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER external_budget_operation_guard BEFORE UPDATE OR DELETE ON external_budget_operations FOR EACH ROW EXECUTE FUNCTION guard_external_budget_operation();
CREATE FUNCTION record_external_budget_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO external_budget_events(tenant_id,operation_id,version,state,actor_id,details)
 VALUES(NEW.tenant_id,NEW.id,NEW.version,NEW.state,nullif(current_setting('app.actor_id',true),''),
 jsonb_build_object('payload_sha256',NEW.payload_sha256,'policy_id',NEW.policy_id,'error_code',NEW.error_code,'request_sha256',NEW.request_sha256,'observation',NEW.observation,'resolution',NEW.resolution));
 RETURN NEW;
END $$;
CREATE TRIGGER external_budget_operation_event AFTER INSERT OR UPDATE ON external_budget_operations FOR EACH ROW EXECUTE FUNCTION record_external_budget_event();
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['external_budget_policies','external_budget_previews','external_budget_operations','external_budget_receipts','external_budget_events'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY external_budget_tenant_scope ON %I USING(current_user=''cp_control'' OR (tenant_id=nullif(current_setting(''app.tenant_id'',true),'''')::uuid AND EXISTS(SELECT 1 FROM tenants et WHERE et.id=%I.tenant_id AND et.data_mode=current_setting(''app.data_mode'',true)))) WITH CHECK(current_user=''cp_control'')',t,t);
 END LOOP;
END $$;
GRANT SELECT ON external_budget_policies,external_budget_operations,external_budget_receipts,external_budget_events TO cp_app;
GRANT SELECT,INSERT,DELETE ON external_budget_previews TO cp_control;
GRANT SELECT,INSERT ON external_budget_policies,external_budget_receipts,external_budget_events TO cp_control;
GRANT SELECT,INSERT,UPDATE ON external_budget_operations TO cp_control;
GRANT USAGE,SELECT ON SEQUENCE external_budget_events_id_seq TO cp_control;
