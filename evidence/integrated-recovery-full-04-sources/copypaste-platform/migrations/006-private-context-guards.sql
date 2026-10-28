-- PostgreSQL also checks SELECT policies on rows returned by UPDATE. The
-- transaction-local erasure flag permits only the scrubbed deleted rows during
-- the explicit erasure operation; normal reads still see active content only.
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['tasks','conversations','memories'] LOOP
  EXECUTE format('ALTER POLICY content_visibility ON %I USING(content_state=''active'' OR (content_state=''deleted'' AND current_setting(''app.erasing_content'',true)=''true'')) WITH CHECK(true)',t);
 END LOOP;
END $$;
CREATE POLICY conversation_memory_parent ON memories AS RESTRICTIVE FOR ALL TO cp_app
 USING(conversation_id IS NULL OR EXISTS(SELECT 1 FROM conversations c WHERE c.id=conversation_id))
 WITH CHECK(conversation_id IS NULL OR EXISTS(SELECT 1 FROM conversations c WHERE c.id=conversation_id));
-- A project-shared task must not silently consume its owner's private files.
-- Private task outputs inherit the private owner in saveAsset().
CREATE POLICY asset_task_scope ON assets AS RESTRICTIVE FOR ALL TO cp_app
 USING(private_owner IS NULL OR nullif(current_setting('app.task_id',true),'') IS NULL
  OR EXISTS(SELECT 1 FROM tasks t WHERE t.id=nullif(current_setting('app.task_id',true),'')::uuid AND t.private_owner=assets.private_owner))
 WITH CHECK(private_owner IS NULL OR nullif(current_setting('app.task_id',true),'') IS NULL
  OR EXISTS(SELECT 1 FROM tasks t WHERE t.id=nullif(current_setting('app.task_id',true),'')::uuid AND t.private_owner=assets.private_owner));
INSERT INTO schema_migrations(version) VALUES(6);
