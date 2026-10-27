ALTER TABLE wallets ADD COLUMN id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE wallets ADD CONSTRAINT wallets_account_id_unique UNIQUE(id);
ALTER TABLE users ADD COLUMN last_login_at timestamptz;
UPDATE users u SET last_login_at=s.last_login_at
FROM (SELECT user_id,max(created_at) AS last_login_at FROM sessions WHERE audience='user' GROUP BY user_id) s
WHERE u.id=s.user_id;
CREATE INDEX admin_users_directory_order ON users(created_at DESC,id DESC);
CREATE INDEX admin_tenants_directory_order ON tenants(created_at DESC,id DESC);
CREATE INDEX admin_user_confirmed_charges ON ledger(user_id,created_at) WHERE kind='charge';
