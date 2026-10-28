ALTER TABLE agents ADD COLUMN builtin_default boolean NOT NULL DEFAULT false;
ALTER TABLE agents ADD CONSTRAINT builtin_default_role CHECK(NOT builtin_default OR role_key='assistant');
CREATE UNIQUE INDEX one_default_assistant_per_project ON agents(project_id) WHERE builtin_default;
CREATE FUNCTION guard_default_assistant() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='DELETE' THEN
  IF OLD.builtin_default AND current_user='cp_app' THEN RAISE EXCEPTION 'DEFAULT_ASSISTANT_IMMUTABLE' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF OLD.builtin_default<>NEW.builtin_default THEN RAISE EXCEPTION 'DEFAULT_ASSISTANT_IMMUTABLE' USING ERRCODE='23514'; END IF;
 IF OLD.builtin_default AND current_user='cp_app' AND (
  (to_jsonb(NEW)-'version'-'updated_at') IS DISTINCT FROM (to_jsonb(OLD)-'version'-'updated_at')
  OR NEW.version<>OLD.version+1
 ) THEN RAISE EXCEPTION 'DEFAULT_ASSISTANT_IMMUTABLE' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER guard_default_assistant BEFORE UPDATE OR DELETE ON agents FOR EACH ROW EXECUTE FUNCTION guard_default_assistant();
INSERT INTO schema_migrations(version) VALUES(27);
