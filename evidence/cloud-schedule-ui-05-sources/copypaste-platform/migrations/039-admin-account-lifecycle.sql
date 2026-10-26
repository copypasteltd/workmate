-- Forward-only metadata. Closing an account is distinct from privacy erasure.
ALTER TABLE users ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE users ADD COLUMN labels jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(labels)='array');
ALTER TABLE users ADD COLUMN admin_closed_at timestamptz;
ALTER TABLE users ADD CONSTRAINT users_closed_inactive CHECK(admin_closed_at IS NULL OR status='suspended');
ALTER TABLE tenants ADD COLUMN version integer NOT NULL DEFAULT 1 CHECK(version>0);
ALTER TABLE tenants ADD COLUMN admin_closed_at timestamptz;
ALTER TABLE tenants ADD CONSTRAINT tenants_closed_inactive CHECK(admin_closed_at IS NULL OR status='suspended');

-- Self-service edits, federation revocations and admin commands share revisions.
CREATE FUNCTION advance_user_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (OLD.name,OLD.locale,OLD.status,OLD.auth_version,OLD.labels,OLD.admin_closed_at)
    IS DISTINCT FROM (NEW.name,NEW.locale,NEW.status,NEW.auth_version,NEW.labels,NEW.admin_closed_at) THEN
   NEW.version=OLD.version+1;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER user_revision BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION advance_user_revision();
CREATE FUNCTION advance_tenant_revision() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (OLD.name,OLD.status,OLD.admin_closed_at) IS DISTINCT FROM (NEW.name,NEW.status,NEW.admin_closed_at) THEN
   NEW.version=OLD.version+1;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER tenant_revision BEFORE UPDATE ON tenants FOR EACH ROW EXECUTE FUNCTION advance_tenant_revision();
