-- Account deletion preserves reference IDs for immutable billing/audit facts.
ALTER TABLE users ADD COLUMN deleted_at timestamptz;
ALTER TABLE users DROP CONSTRAINT users_registration_source_check;
ALTER TABLE users ADD CONSTRAINT users_registration_source_check CHECK(registration_source IS NULL OR registration_source IN('email_otp','admin'));
CREATE INDEX users_live_directory ON users(created_at DESC,id DESC) WHERE deleted_at IS NULL;
CREATE FUNCTION protect_deleted_account() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.deleted_at IS NOT NULL AND (NEW.deleted_at IS DISTINCT FROM OLD.deleted_at OR NEW.status<>'suspended'
   OR NEW.admin_closed_at IS NULL OR NEW.name<>'[deleted]' OR NEW.email<>'deleted+'||NEW.id::text||'@account.invalid'
   OR NEW.labels<>'[]'::jsonb) THEN
  RAISE EXCEPTION 'Deleted accounts cannot be restored or reused' USING ERRCODE='23514';
 END IF;
 IF NEW.deleted_at IS NOT NULL AND (NEW.status<>'suspended' OR NEW.admin_closed_at IS NULL
   OR NEW.name<>'[deleted]' OR NEW.email<>'deleted+'||NEW.id::text||'@account.invalid' OR NEW.labels<>'[]'::jsonb) THEN
  RAISE EXCEPTION 'Account deletion requires a scrubbed terminal identity' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER protect_deleted_account BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION protect_deleted_account();
-- New destructive grants are deliberately limited to the installed highest role.
-- Other roles can receive each explicit permission through normal access control.
UPDATE admin_roles SET permissions=permissions||'["admin.users.create","admin.users.delete","admin.tenants.create","admin.tenants.delete"]'::jsonb
 WHERE key='super_admin' AND builtin;
