-- Preserve private local-step inputs even when the original task has no chat.
-- Existing uploads retain their original project/conversation behavior.
ALTER TABLE upload_sessions ADD COLUMN source_task_id uuid REFERENCES tasks(id);
CREATE INDEX upload_source_task ON upload_sessions(source_task_id) WHERE source_task_id IS NOT NULL;

CREATE FUNCTION guard_task_upload_scope() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE source tasks;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF ROW(OLD.source_task_id,OLD.tenant_id,OLD.project_id,OLD.created_by,OLD.conversation_id,OLD.asset_id)
   IS DISTINCT FROM ROW(NEW.source_task_id,NEW.tenant_id,NEW.project_id,NEW.created_by,NEW.conversation_id,NEW.asset_id)
   AND (OLD.source_task_id IS NOT NULL OR NEW.source_task_id IS NOT NULL) THEN
   RAISE EXCEPTION 'The accepted task upload scope is immutable' USING ERRCODE='23514'; END IF;
  RETURN NEW;
 END IF;
 IF NEW.source_task_id IS NULL THEN RETURN NEW; END IF;
 SELECT * INTO source FROM tasks WHERE id=NEW.source_task_id;
 IF source.id IS NULL OR source.tenant_id<>NEW.tenant_id OR source.project_id<>NEW.project_id
  OR source.created_by<>NEW.created_by OR source.execution_location<>'cloud' OR source.mode<>'execute'
  OR source.content_state<>'active' OR source.cancel_requested OR source.status<>'needs_input'
  OR source.retention_expires_at<=clock_timestamp() OR NEW.asset_id IS NOT NULL
  OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=source.created_by AND u.status='active' AND u.auth_version=source.actor_auth_version)
  OR NEW.conversation_id IS DISTINCT FROM source.conversation_id
  OR NOT EXISTS(SELECT 1 FROM task_local_handoffs h
    JOIN task_dependencies d ON d.id=h.dependency_id AND d.state='pending' AND d.version=h.dependency_version
    JOIN tasks n ON n.id=h.native_task_id JOIN desktop_executions e ON e.task_id=n.id
    JOIN reservations r ON r.task_id=n.id
    WHERE h.source_task_id=source.id AND h.created_by=NEW.created_by AND h.state='working'
    AND n.status='succeeded' AND NOT n.cancel_requested AND e.state='finished' AND r.status IN('settled','released')) THEN
  RAISE EXCEPTION 'Task uploads require the current reviewed local preparation' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_task_upload_scope() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_task_upload_scope() FROM PUBLIC;
CREATE TRIGGER task_upload_scope BEFORE INSERT OR UPDATE ON upload_sessions FOR EACH ROW EXECUTE FUNCTION guard_task_upload_scope();

CREATE FUNCTION guard_task_upload_result() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE source tasks; target assets;
BEGIN
 IF NEW.source_task_id IS NULL OR NEW.state<>'completed' THEN RETURN NEW; END IF;
 SELECT * INTO source FROM tasks WHERE id=NEW.source_task_id;
 SELECT * INTO target FROM assets WHERE id=(NEW.result->>'id')::uuid;
 IF source.id IS NULL OR target.id IS NULL OR target.tenant_id<>NEW.tenant_id OR target.project_id<>NEW.project_id
  OR target.created_by<>NEW.created_by OR target.private_owner IS DISTINCT FROM source.private_owner
  OR NOT EXISTS(SELECT 1 FROM asset_versions v WHERE v.asset_id=target.id AND v.upload_session_id=NEW.id
    AND v.metadata->>'input_task_id'=source.id::text AND NOT(v.metadata ? 'task_id')) THEN
  RAISE EXCEPTION 'Task input uploads must retain the original private scope' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_task_upload_result() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_task_upload_result() FROM PUBLIC;
CREATE TRIGGER task_upload_result AFTER INSERT OR UPDATE OF state,result ON upload_sessions FOR EACH ROW EXECUTE FUNCTION guard_task_upload_result();

CREATE FUNCTION erase_task_upload_sessions() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
BEGIN
 IF NEW.content_state<>'deleted' THEN RETURN NEW; END IF;
 UPDATE upload_sessions SET state='cancelled',filename='[deleted]',result=NULL WHERE source_task_id=NEW.id;
 INSERT INTO deletion_items(job_id,kind,locator)
  SELECT j.id,'upload',s.id::text FROM deletion_jobs j JOIN upload_sessions s ON s.source_task_id=NEW.id
  WHERE j.target_type='tasks' AND j.target_id=NEW.id ON CONFLICT DO NOTHING;
 UPDATE assets SET state='deleted',moderation_version=moderation_version+1 WHERE private_owner IS NOT NULL AND state<>'deleted'
  AND id IN(SELECT v.asset_id FROM asset_versions v JOIN upload_sessions s ON s.id=v.upload_session_id WHERE s.source_task_id=NEW.id);
 INSERT INTO deletion_dependencies(job_id,child_job_id)
  SELECT parent.id,child.id FROM deletion_jobs parent JOIN upload_sessions s ON s.source_task_id=NEW.id
   JOIN asset_versions v ON v.upload_session_id=s.id JOIN deletion_jobs child ON child.target_type='assets' AND child.target_id=v.asset_id
  WHERE parent.target_type='tasks' AND parent.target_id=NEW.id ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
ALTER FUNCTION erase_task_upload_sessions() OWNER TO cp_control;
REVOKE ALL ON FUNCTION erase_task_upload_sessions() FROM PUBLIC;
CREATE TRIGGER task_upload_erasure AFTER UPDATE OF content_state ON tasks FOR EACH ROW EXECUTE FUNCTION erase_task_upload_sessions();
-- A fresh login never re-authorizes a previously revoked cloud task. Enforce
-- this in the shared source manifest as well as the request/admission gates.
DO $$ DECLARE definition text; anchor text:='OR parent.content_state<>''active'''; BEGIN
 definition:=pg_get_functiondef('local_handoff_source_tasks(tasks)'::regprocedure);
 IF (length(definition)-length(replace(definition,anchor,'')))/length(anchor)<>1 THEN RAISE EXCEPTION 'Missing local handoff authorization anchor'; END IF;
 EXECUTE replace(definition,anchor,'OR NOT EXISTS(SELECT 1 FROM users u WHERE u.id=parent.created_by AND u.status=''active'' AND u.auth_version=parent.actor_auth_version) '||anchor);
END $$;
INSERT INTO schema_migrations(version) VALUES(143);
