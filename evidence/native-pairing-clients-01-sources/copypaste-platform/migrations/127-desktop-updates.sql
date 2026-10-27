-- Append-only: company release control is separate from customer assets and billing.
CREATE TABLE desktop_update_releases (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),channel text NOT NULL CHECK(channel IN('stable','preview')),
 sequence bigint NOT NULL CHECK(sequence>0),envelope jsonb NOT NULL,envelope_sha256 text NOT NULL CHECK(envelope_sha256 ~ '^[a-f0-9]{64}$'),
 state text NOT NULL CHECK(state IN('uploading','ready','published')),version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_by uuid NOT NULL REFERENCES admin_principals(id),created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(channel,sequence),UNIQUE(envelope_sha256)
);
CREATE TABLE desktop_update_parts (
 release_id uuid NOT NULL REFERENCES desktop_update_releases(id),part integer NOT NULL CHECK(part>=0),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'),bytes integer NOT NULL CHECK(bytes>0 AND bytes<=4194304),
 PRIMARY KEY(release_id,part)
);
CREATE TABLE desktop_update_heads (
 channel text PRIMARY KEY CHECK(channel IN('stable','preview')),revision integer NOT NULL DEFAULT 0,
 release_id uuid REFERENCES desktop_update_releases(id),updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO desktop_update_heads(channel) VALUES('stable'),('preview');
CREATE TABLE desktop_update_publications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),channel text NOT NULL,revision integer NOT NULL,
 release_id uuid NOT NULL REFERENCES desktop_update_releases(id),previous_release_id uuid REFERENCES desktop_update_releases(id),
 published_by uuid NOT NULL REFERENCES admin_principals(id),reason text NOT NULL,created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(channel,revision)
);
ALTER TABLE desktop_update_releases OWNER TO cp_control;
ALTER TABLE desktop_update_parts OWNER TO cp_control;
ALTER TABLE desktop_update_heads OWNER TO cp_control;
ALTER TABLE desktop_update_publications OWNER TO cp_control;
REVOKE ALL ON desktop_update_releases,desktop_update_parts,desktop_update_heads,desktop_update_publications FROM PUBLIC,cp_app,cp_queue;
CREATE FUNCTION immutable_desktop_release_definition() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP='DELETE' OR NEW.id<>OLD.id OR NEW.envelope<>OLD.envelope OR NEW.envelope_sha256<>OLD.envelope_sha256
  OR NEW.channel<>OLD.channel OR NEW.sequence<>OLD.sequence OR NEW.created_by<>OLD.created_by OR NEW.created_at<>OLD.created_at
 THEN RAISE EXCEPTION 'desktop release definitions are immutable'; END IF;
 IF NEW.version<>OLD.version+1 OR NOT ((OLD.state='uploading' AND NEW.state='ready') OR (OLD.state='ready' AND NEW.state='published'))
 THEN RAISE EXCEPTION 'desktop release transition is invalid'; END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION immutable_desktop_release_definition() OWNER TO cp_control;
REVOKE ALL ON FUNCTION immutable_desktop_release_definition() FROM PUBLIC;
CREATE TRIGGER desktop_release_immutable BEFORE UPDATE OR DELETE ON desktop_update_releases FOR EACH ROW EXECUTE FUNCTION immutable_desktop_release_definition();
CREATE FUNCTION immutable_desktop_publication() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'desktop publication history is immutable'; END $$;
ALTER FUNCTION immutable_desktop_publication() OWNER TO cp_control;
REVOKE ALL ON FUNCTION immutable_desktop_publication() FROM PUBLIC;
CREATE TRIGGER desktop_publication_immutable BEFORE UPDATE OR DELETE ON desktop_update_publications FOR EACH ROW EXECUTE FUNCTION immutable_desktop_publication();
