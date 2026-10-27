CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE TABLE IF NOT EXISTS schema_migrations(version integer PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now());
CREATE TABLE users (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, name text NOT NULL DEFAULT '',
 locale text NOT NULL DEFAULT 'zh-HK' CHECK(locale IN ('zh-HK','en')), status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
 auth_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE admin_principals (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL UNIQUE, name text NOT NULL,
 totp_secret text NOT NULL, last_totp_step bigint NOT NULL DEFAULT -1, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
 auth_version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE auth_challenges (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), email text NOT NULL, audience text NOT NULL CHECK(audience IN ('user','admin')),
 digest text NOT NULL, attempts integer NOT NULL DEFAULT 0, expires_at timestamptz NOT NULL, consumed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON auth_challenges(email,audience,created_at);
CREATE TABLE sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), token_hash text NOT NULL UNIQUE,
 user_id uuid REFERENCES users(id), admin_id uuid REFERENCES admin_principals(id), audience text NOT NULL CHECK(audience IN ('user','admin','native')),
 auth_version integer NOT NULL, expires_at timestamptz NOT NULL, mfa_at timestamptz, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now(), CHECK ((user_id IS NOT NULL) <> (admin_id IS NOT NULL))
);
CREATE TABLE native_auth_codes (
 digest text PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), challenge text NOT NULL,
 client_id text NOT NULL CHECK(client_id IN ('desktop','extension')), redirect_uri text NOT NULL,
 expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE TABLE refresh_tokens (
 digest text PRIMARY KEY, family_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id), session_id uuid NOT NULL REFERENCES sessions(id),
 client_id text NOT NULL, auth_version integer NOT NULL, expires_at timestamptz NOT NULL, used_at timestamptz, revoked_at timestamptz
);
CREATE TABLE tenants (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), name text NOT NULL, status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','suspended')),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE memberships (
 tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL REFERENCES users(id),
 role text NOT NULL CHECK(role IN ('owner','admin','member','approver','viewer')), status text NOT NULL DEFAULT 'active' CHECK(status IN ('active','removed')),
 version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(tenant_id,user_id)
);
CREATE TABLE projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), name text NOT NULL,
 description text NOT NULL DEFAULT '', archived boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE TABLE project_members (
 tenant_id uuid NOT NULL, project_id uuid NOT NULL, user_id uuid NOT NULL REFERENCES users(id),
 role text NOT NULL CHECK(role IN ('editor','approver','viewer')), PRIMARY KEY(project_id,user_id),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id), FOREIGN KEY(tenant_id,user_id) REFERENCES memberships(tenant_id,user_id)
);
CREATE TABLE invites (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), email text NOT NULL,
 digest text NOT NULL UNIQUE, role text NOT NULL CHECK(role IN ('admin','member','approver','viewer')),
 project_ids uuid[] NOT NULL DEFAULT '{}', expires_at timestamptz NOT NULL, consumed_at timestamptz, revoked_at timestamptz,
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE brand_profiles (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 name text NOT NULL, version integer NOT NULL DEFAULT 1, body jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id), UNIQUE(tenant_id,id)
);
CREATE TABLE assets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL, name text NOT NULL,
 kind text NOT NULL, state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','quarantined','deleted')),
 current_version integer NOT NULL DEFAULT 1, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id), UNIQUE(tenant_id,id)
);
CREATE TABLE asset_versions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, asset_id uuid NOT NULL, version integer NOT NULL,
 storage_key text NOT NULL, mime_type text NOT NULL, bytes bigint NOT NULL CHECK(bytes>=0), sha256 text NOT NULL,
 metadata jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,asset_id) REFERENCES assets(tenant_id,id), UNIQUE(asset_id,version)
);
CREATE TABLE wallets (
 tenant_id uuid PRIMARY KEY REFERENCES tenants(id), balance_micros bigint NOT NULL DEFAULT 0,
 reserved_micros bigint NOT NULL DEFAULT 0 CHECK(reserved_micros>=0), credit_limit_micros bigint NOT NULL DEFAULT 0 CHECK(credit_limit_micros>=0),
 spent_micros bigint NOT NULL DEFAULT 0 CHECK(spent_micros>=0), version integer NOT NULL DEFAULT 1,
 CHECK(balance_micros>=-credit_limit_micros), CHECK(reserved_micros<=balance_micros+credit_limit_micros)
);
CREATE TABLE tasks (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL, created_by uuid NOT NULL REFERENCES users(id),
 title text NOT NULL, prompt text NOT NULL, role_key text NOT NULL, role_hash text NOT NULL, kernel text NOT NULL DEFAULT 'codex' CHECK(kernel='codex'),
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','awaiting_approval','succeeded','failed','cancelled','paused','reconciling')),
 acceptance text NOT NULL DEFAULT 'pending' CHECK(acceptance IN ('pending','accepted','changes_requested')),
 output text, error_code text, budget_micros bigint NOT NULL CHECK(budget_micros>0), charged_micros bigint NOT NULL DEFAULT 0,
 input_tokens bigint NOT NULL DEFAULT 0, output_tokens bigint NOT NULL DEFAULT 0, actor_auth_version integer NOT NULL DEFAULT 1, cancel_requested boolean NOT NULL DEFAULT false,
 attempt integer NOT NULL DEFAULT 0, fencing_token uuid, lease_until timestamptz, runtime_thread text, runtime_turn text,
 parent_id uuid, idempotency_key text NOT NULL, version integer NOT NULL DEFAULT 1, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id), UNIQUE(tenant_id,id), UNIQUE(tenant_id,created_by,idempotency_key),
 FOREIGN KEY(tenant_id,parent_id) REFERENCES tasks(tenant_id,id)
);
CREATE TABLE task_events (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tenant_id uuid NOT NULL, task_id uuid NOT NULL,
 kind text NOT NULL, body jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,task_id) REFERENCES tasks(tenant_id,id)
);
CREATE TABLE tool_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, task_id uuid NOT NULL, call_id text NOT NULL,
 action text NOT NULL, state text NOT NULL CHECK(state IN ('prepared','accepted','succeeded','failed','reconciling')),
 input_hash text NOT NULL, charge_micros bigint NOT NULL DEFAULT 0 CHECK(charge_micros>=0), result jsonb,
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,task_id) REFERENCES tasks(tenant_id,id), UNIQUE(task_id,call_id)
);
CREATE TABLE ledger (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid REFERENCES users(id), task_id uuid,
 kind text NOT NULL CHECK(kind IN ('top_up','gift','debit','refund','charge','gift_expiry','adjustment')),
 amount_micros bigint NOT NULL CHECK(amount_micros<>0), reference text, source_id uuid REFERENCES ledger(id),
 expires_at timestamptz, idempotency_key text NOT NULL, reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,task_id) REFERENCES tasks(tenant_id,id), UNIQUE(tenant_id,idempotency_key)
);
CREATE TABLE funding_lots (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), ledger_id uuid NOT NULL REFERENCES ledger(id),
 kind text NOT NULL CHECK(kind IN ('paid','gift')), remaining_micros bigint NOT NULL CHECK(remaining_micros>=0), reserved_micros bigint NOT NULL DEFAULT 0 CHECK(reserved_micros>=0 AND reserved_micros<=remaining_micros),
 expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(ledger_id)
);
CREATE TABLE reservations (
 task_id uuid PRIMARY KEY REFERENCES tasks(id), tenant_id uuid NOT NULL REFERENCES tenants(id), amount_micros bigint NOT NULL CHECK(amount_micros>0),
 status text NOT NULL DEFAULT 'reserved' CHECK(status IN ('reserved','settled','released','reconciling')), created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE reservation_allocations (
 tenant_id uuid NOT NULL REFERENCES tenants(id), task_id uuid NOT NULL REFERENCES tasks(id), lot_id uuid NOT NULL REFERENCES funding_lots(id),
 amount_micros bigint NOT NULL CHECK(amount_micros>0), PRIMARY KEY(task_id,lot_id)
);
CREATE TABLE entitlements (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid REFERENCES tenants(id), user_id uuid REFERENCES users(id),
 plan text NOT NULL CHECK(plan IN ('starter','pro','business')), starts_at timestamptz NOT NULL, ends_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','suspended','revoked')), auto_renew boolean NOT NULL DEFAULT false CHECK(auto_renew=false),
 reason text NOT NULL, created_by uuid REFERENCES admin_principals(id), created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((tenant_id IS NOT NULL) <> (user_id IS NOT NULL)), CHECK(ends_at>starts_at)
);
CREATE TABLE connections (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL, provider text NOT NULL,
 name text NOT NULL, state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','connected','revoked','error')),
 encrypted_secret text, scopes text[] NOT NULL DEFAULT '{}', created_by uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id), UNIQUE(tenant_id,id)
);
CREATE TABLE analytics_datasets (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL, name text NOT NULL,
 currency text NOT NULL DEFAULT 'HKD', timezone text NOT NULL DEFAULT 'Asia/Hong_Kong', rows jsonb NOT NULL,
 source text NOT NULL, created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
CREATE TABLE workflows (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL, name text NOT NULL,
 definition jsonb NOT NULL, version integer NOT NULL DEFAULT 1, state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','paused')),
 created_by uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(), FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
CREATE TABLE workflow_runs (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,project_id uuid NOT NULL,workflow_id uuid NOT NULL REFERENCES workflows(id),
 created_by uuid NOT NULL REFERENCES users(id),actor_auth_version integer NOT NULL,definition jsonb NOT NULL,
 state text NOT NULL DEFAULT 'running' CHECK(state IN ('running','awaiting_approval','succeeded','failed','cancelled')),
 cursor integer NOT NULL DEFAULT 0,results jsonb NOT NULL DEFAULT '[]',active_task uuid REFERENCES tasks(id),error_code text,
 created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
CREATE TABLE creative_projects (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,project_id uuid NOT NULL,name text NOT NULL,
 kind text NOT NULL CHECK(kind IN ('poster','video')),body jsonb NOT NULL,version integer NOT NULL DEFAULT 1,
 created_by uuid NOT NULL REFERENCES users(id),created_at timestamptz NOT NULL DEFAULT now(),FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
CREATE TABLE oauth_states (
 digest text PRIMARY KEY,user_id uuid NOT NULL REFERENCES users(id),tenant_id uuid NOT NULL,project_id uuid NOT NULL,
 provider text NOT NULL,encrypted_verifier text NOT NULL,expires_at timestamptz NOT NULL,consumed_at timestamptz,
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id)
);
CREATE TABLE devices (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), user_id uuid NOT NULL REFERENCES users(id),
 name text NOT NULL, client text NOT NULL CHECK(client IN ('desktop','extension')), state text NOT NULL DEFAULT 'active' CHECK(state IN ('active','revoked')),
 public_key text NOT NULL, grants jsonb NOT NULL DEFAULT '[]', last_seen_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(tenant_id,id)
);
CREATE TABLE device_commands (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, device_id uuid NOT NULL, task_id uuid,
 operation text NOT NULL CHECK(operation IN ('file.list','file.read','file.write')), payload jsonb NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','claimed','succeeded','failed','cancelled','expired')),
 result jsonb, nonce text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,device_id) REFERENCES devices(tenant_id,id), FOREIGN KEY(tenant_id,task_id) REFERENCES tasks(tenant_id,id)
);
CREATE TABLE shares (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, asset_id uuid NOT NULL, digest text NOT NULL UNIQUE,
 expires_at timestamptz NOT NULL, revoked_at timestamptz, created_by uuid NOT NULL REFERENCES users(id),
 FOREIGN KEY(tenant_id,asset_id) REFERENCES assets(tenant_id,id)
);
CREATE TABLE outbox (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL REFERENCES tenants(id), topic text NOT NULL, payload jsonb NOT NULL,
 dispatched_at timestamptz, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ON outbox(created_at) WHERE dispatched_at IS NULL;
CREATE TABLE admin_roles (key text PRIMARY KEY, name text NOT NULL, permissions jsonb NOT NULL, version integer NOT NULL DEFAULT 1, builtin boolean NOT NULL DEFAULT false);
CREATE TABLE admin_bindings (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), principal_id uuid NOT NULL REFERENCES admin_principals(id), role_key text NOT NULL REFERENCES admin_roles(key),
 scope_kind text NOT NULL CHECK(scope_kind IN ('global','tenant','project')), scope_id uuid, effect text NOT NULL DEFAULT 'allow' CHECK(effect IN ('allow','deny')),
 limits jsonb NOT NULL DEFAULT '{}', expires_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 CHECK((scope_kind='global' AND scope_id IS NULL) OR (scope_kind<>'global' AND scope_id IS NOT NULL))
);
CREATE TABLE audit_log (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, principal_id uuid, actor_kind text NOT NULL, action text NOT NULL,
 tenant_id uuid, target text, outcome text NOT NULL, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE admin_previews (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), principal_id uuid NOT NULL REFERENCES admin_principals(id), action text NOT NULL,
 payload jsonb NOT NULL, payload_hash text NOT NULL, expires_at timestamptz NOT NULL, consumed_at timestamptz
);
CREATE TABLE admin_operations (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), principal_id uuid NOT NULL REFERENCES admin_principals(id),
 action text NOT NULL, tenant_id uuid, payload_hash text NOT NULL, payload jsonb NOT NULL, idempotency_key text NOT NULL,
 state text NOT NULL CHECK(state IN ('pending_approval','queued','running','succeeded','partially_succeeded','failed','cancelled','reconciling')),
 result jsonb, approved_by uuid REFERENCES admin_principals(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(principal_id,idempotency_key)
);
CREATE TABLE catalog_entries (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), kind text NOT NULL CHECK(kind IN ('role','skill','help','announcement','navigation','plan','policy')),
 key text NOT NULL, version integer NOT NULL, state text NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','published','retired')),
 body jsonb NOT NULL, created_by uuid REFERENCES admin_principals(id), created_at timestamptz NOT NULL DEFAULT now(), UNIQUE(kind,key,version)
);
CREATE UNIQUE INDEX catalog_one_published ON catalog_entries(kind,key) WHERE state='published';
CREATE TABLE support_sessions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), principal_id uuid NOT NULL REFERENCES admin_principals(id), tenant_id uuid NOT NULL REFERENCES tenants(id),
 reason text NOT NULL, expires_at timestamptz NOT NULL, revoked_at timestamptz, body_granted boolean NOT NULL DEFAULT false
);
CREATE TABLE exports (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), principal_id uuid NOT NULL REFERENCES admin_principals(id), source text NOT NULL,
 permission text NOT NULL, scope jsonb NOT NULL, state text NOT NULL DEFAULT 'queued', storage_key text, expires_at timestamptz NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE request_replays (
 actor_id uuid NOT NULL, action text NOT NULL, key text NOT NULL, input_hash text NOT NULL, response jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(actor_id,action,key)
);

DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['projects','project_members','invites','brand_profiles','assets','asset_versions','wallets','tasks','task_events','tool_operations','ledger','funding_lots','reservations','reservation_allocations','connections','analytics_datasets','workflows','workflow_runs','creative_projects','oauth_states','devices','device_commands','shares'] LOOP
  EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY',t);
  EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (current_user = ''cp_control'' OR tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid) WITH CHECK (current_user = ''cp_control'' OR tenant_id = nullif(current_setting(''app.tenant_id'',true),'''')::uuid)',t);
 END LOOP;
END $$;
GRANT USAGE ON SCHEMA public TO cp_app,cp_control,cp_queue;
GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA public TO cp_control;
REVOKE UPDATE,DELETE ON audit_log,ledger,asset_versions FROM cp_control;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO cp_control;
GRANT SELECT,INSERT,UPDATE ON users,auth_challenges,sessions,native_auth_codes,refresh_tokens,tenants,memberships TO cp_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON projects,project_members,invites,brand_profiles,assets,connections,analytics_datasets,workflows,devices,device_commands,shares TO cp_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON workflow_runs,creative_projects,oauth_states TO cp_app;
GRANT SELECT,INSERT ON asset_versions,ledger,task_events,audit_log,outbox TO cp_app;
GRANT SELECT,INSERT,UPDATE ON wallets,tasks,funding_lots,reservations,reservation_allocations,tool_operations TO cp_app;
GRANT SELECT,INSERT ON request_replays TO cp_app;
GRANT SELECT ON entitlements,catalog_entries TO cp_app;
GRANT USAGE,SELECT ON ALL SEQUENCES IN SCHEMA public TO cp_app;
GRANT SELECT,UPDATE ON outbox TO cp_queue;
INSERT INTO schema_migrations(version) VALUES(1);
