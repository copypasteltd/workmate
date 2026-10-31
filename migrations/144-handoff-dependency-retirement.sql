-- A handoff is a retained financial/execution receipt. Its original input UUID
-- survives erasure, while the input's description/answers must be deleted by
-- the existing task-retirement trigger. Do not cascade-delete the receipt or
-- detach the native task from its revoked original source.
ALTER TABLE task_local_handoffs DROP CONSTRAINT task_local_handoffs_dependency_id_fkey;
COMMENT ON COLUMN task_local_handoffs.dependency_id IS
 'Immutable original input identity; live existence is checked on admission, and its content row retires only with the original task.';

CREATE FUNCTION guard_handoff_dependency_retirement() RETURNS trigger
 LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
BEGIN
 IF EXISTS(SELECT 1 FROM task_local_handoffs h WHERE h.dependency_id=OLD.id)
  AND NOT EXISTS(SELECT 1 FROM tasks t WHERE t.id=OLD.task_id AND t.content_state='deleted') THEN
  RAISE EXCEPTION 'A retained local step requires its original active input' USING ERRCODE='23514';
 END IF;
 RETURN OLD;
END $$;
ALTER FUNCTION guard_handoff_dependency_retirement() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_handoff_dependency_retirement() FROM PUBLIC,cp_app,cp_queue;
CREATE TRIGGER handoff_dependency_retirement BEFORE DELETE ON task_dependencies
 FOR EACH ROW EXECUTE FUNCTION guard_handoff_dependency_retirement();

INSERT INTO schema_migrations(version) VALUES(144);
