-- Preserve the existing resource identity, quota and conversation rules.
-- A task-bound completed upload may retire only with its authoritative deleted
-- source task, or with its own actual deleted asset and fixed upload version.
CREATE OR REPLACE FUNCTION guard_upload_resource_capacity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE deleted_attachment boolean:=false;
BEGIN
 IF TG_OP='UPDATE' THEN
  deleted_attachment:=NEW.state='cancelled' AND NEW.filename='[deleted]' AND NEW.result IS NULL AND (
   (OLD.conversation_id IS NOT NULL AND EXISTS(
     SELECT 1 FROM conversations WHERE id=OLD.conversation_id AND tenant_id=OLD.tenant_id AND content_state='deleted'))
   OR (OLD.source_task_id IS NOT NULL AND (
    EXISTS(SELECT 1 FROM tasks t JOIN deletion_jobs j ON j.target_type='tasks' AND j.target_id=t.id
      AND j.tenant_id=t.tenant_id AND j.project_id=t.project_id
     WHERE t.id=OLD.source_task_id AND t.tenant_id=OLD.tenant_id AND t.project_id=OLD.project_id
      AND t.created_by=OLD.created_by AND t.execution_location='cloud' AND t.mode='execute' AND t.content_state='deleted')
    OR (OLD.state='completed' AND EXISTS(
     SELECT 1 FROM asset_versions v JOIN assets a ON a.id=v.asset_id
      JOIN deletion_jobs j ON j.target_type='assets' AND j.target_id=a.id AND j.tenant_id=a.tenant_id AND j.project_id=a.project_id
     WHERE v.upload_session_id=OLD.id AND a.tenant_id=OLD.tenant_id AND a.project_id=OLD.project_id
      AND a.created_by=OLD.created_by AND a.state='deleted'
      AND OLD.result->>'id'=a.id::text AND OLD.result#>>'{version,id}'=v.id::text))
   )));
  IF ROW(NEW.id,NEW.tenant_id,NEW.project_id,NEW.created_by,NEW.mime_type,NEW.size_bytes,NEW.sha256,NEW.part_size,NEW.asset_id,NEW.expected_version,NEW.conversation_id,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.project_id,OLD.created_by,OLD.mime_type,OLD.size_bytes,OLD.sha256,OLD.part_size,OLD.asset_id,OLD.expected_version,OLD.conversation_id,OLD.created_at)
   OR NEW.expires_at>OLD.expires_at OR (OLD.state<>'pending' AND NEW.state<>OLD.state AND NOT deleted_attachment) THEN
   RAISE EXCEPTION 'RESOURCE_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
 ELSIF NEW.state<>'pending' OR NEW.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'UPLOAD_RESERVATION_INVALID' USING ERRCODE='23514';
 ELSE
  PERFORM assert_tenant_storage_capacity(NEW.tenant_id,NEW.size_bytes);
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_upload_resource_capacity() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_upload_resource_capacity() FROM PUBLIC,cp_app,cp_queue;
INSERT INTO schema_migrations(version) VALUES(145);
