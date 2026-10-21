-- A deleted private conversation invalidates its completed attachments as well
-- as pending transfers. This is a controlled, irreversible erasure transition,
-- not a reservation restart. Preserve 058 and the original deletion contract.
CREATE OR REPLACE FUNCTION guard_upload_resource_capacity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE deleted_private_attachment boolean:=false;
BEGIN
 IF TG_OP='UPDATE' THEN
  deleted_private_attachment:=NEW.state='cancelled' AND NEW.filename='[deleted]' AND NEW.result IS NULL
   AND OLD.conversation_id IS NOT NULL
   AND EXISTS(SELECT 1 FROM conversations WHERE id=OLD.conversation_id AND tenant_id=OLD.tenant_id AND content_state='deleted');
  IF ROW(NEW.id,NEW.tenant_id,NEW.project_id,NEW.created_by,NEW.mime_type,NEW.size_bytes,NEW.sha256,NEW.part_size,NEW.asset_id,NEW.expected_version,NEW.conversation_id,NEW.created_at)
   IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.project_id,OLD.created_by,OLD.mime_type,OLD.size_bytes,OLD.sha256,OLD.part_size,OLD.asset_id,OLD.expected_version,OLD.conversation_id,OLD.created_at)
   OR NEW.expires_at>OLD.expires_at OR (OLD.state<>'pending' AND NEW.state<>OLD.state AND NOT deleted_private_attachment) THEN
   RAISE EXCEPTION 'RESOURCE_IDENTITY_IMMUTABLE' USING ERRCODE='23514';
  END IF;
 ELSIF NEW.state<>'pending' OR NEW.expires_at<=clock_timestamp() THEN
  RAISE EXCEPTION 'UPLOAD_RESERVATION_INVALID' USING ERRCODE='23514';
 ELSE
  PERFORM assert_tenant_storage_capacity(NEW.tenant_id,NEW.size_bytes);
 END IF;
 RETURN NEW;
END $$;
INSERT INTO schema_migrations(version) VALUES(59);
