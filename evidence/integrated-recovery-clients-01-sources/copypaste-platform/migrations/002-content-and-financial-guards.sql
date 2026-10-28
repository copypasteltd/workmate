CREATE UNIQUE INDEX ledger_confirmed_reference ON ledger(kind,reference) WHERE kind IN ('top_up','refund') AND reference IS NOT NULL;
DO $$ DECLARE t text; BEGIN
 FOREACH t IN ARRAY ARRAY['tasks','brand_profiles','analytics_datasets','workflows','workflow_runs','creative_projects'] LOOP
  EXECUTE format('ALTER TABLE %I ADD COLUMN content_state text NOT NULL DEFAULT ''active'' CHECK(content_state IN (''active'',''quarantined'',''deleted''))',t);
  EXECUTE format('ALTER TABLE %I ADD COLUMN moderation_version integer NOT NULL DEFAULT 1',t);
  EXECUTE format('CREATE POLICY content_visibility ON %I AS RESTRICTIVE FOR ALL TO cp_app USING (content_state=''active'') WITH CHECK (content_state=''active'')',t);
 END LOOP;
END $$;
INSERT INTO schema_migrations(version) VALUES(2);
