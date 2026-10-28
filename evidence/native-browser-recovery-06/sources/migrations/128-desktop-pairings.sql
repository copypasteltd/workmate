-- An unacknowledged create and its retirement serialize on the credential owner.
-- A retired intent survives retries even if its create never reached the server.
-- tenant_id has no FK: a private cancellation must not reveal tenant existence.
CREATE TABLE desktop_pairings (
 user_id uuid NOT NULL REFERENCES users(id), id uuid NOT NULL, tenant_id uuid NOT NULL,
 family_id uuid NOT NULL, input_hash text NOT NULL CHECK(input_hash~'^[a-f0-9]{64}$'),
 public_key text NOT NULL, device_id uuid REFERENCES devices(id),
 state text NOT NULL CHECK(state IN ('paired','retired')),
 created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,id), CHECK(state='retired' OR device_id IS NOT NULL)
);
ALTER TABLE desktop_pairings ENABLE ROW LEVEL SECURITY;
ALTER TABLE desktop_pairings FORCE ROW LEVEL SECURITY;
CREATE POLICY pairing_private ON desktop_pairings USING (
 current_user='cp_control' OR (user_id=nullif(current_setting('app.actor_id',true),'')::uuid AND tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
) WITH CHECK (
 current_user='cp_control' OR (user_id=nullif(current_setting('app.actor_id',true),'')::uuid AND tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid)
);
GRANT SELECT,INSERT,UPDATE ON desktop_pairings TO cp_control;
-- Application SQL cannot forge, delete or reactivate native pairing facts.
GRANT SELECT ON desktop_pairings TO cp_app;
CREATE FUNCTION guard_desktop_pairing() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.user_id,NEW.id,NEW.tenant_id,NEW.family_id,NEW.input_hash,NEW.public_key,NEW.device_id,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.user_id,OLD.id,OLD.tenant_id,OLD.family_id,OLD.input_hash,OLD.public_key,OLD.device_id,OLD.created_at)
   OR OLD.state='retired' AND NEW.state<>'retired' THEN
   RAISE EXCEPTION 'Native pairing identity and retirement are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER desktop_pairing_guard BEFORE UPDATE ON desktop_pairings FOR EACH ROW EXECUTE FUNCTION guard_desktop_pairing();
INSERT INTO schema_migrations(version) VALUES(128);
