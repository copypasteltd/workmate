-- Refresh the trigger body and link every previously deleted private derivative.
CREATE OR REPLACE FUNCTION journal_content_erasure() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE old_state text; new_state text; j uuid; private_id uuid;
BEGIN
 old_state := to_jsonb(OLD)->>TG_ARGV[0]; new_state := to_jsonb(NEW)->>TG_ARGV[0];
 IF old_state='deleted' AND new_state<>'deleted' THEN
  RAISE EXCEPTION 'Permanent deletion cannot be restored' USING ERRCODE='23514';
 END IF;
 IF new_state<>'deleted' THEN RETURN NEW; END IF;
 private_id := nullif(to_jsonb(NEW)->>'private_owner','')::uuid;
 IF TG_TABLE_NAME='conversations' THEN private_id:=NEW.created_by; END IF;
 INSERT INTO deletion_jobs(tenant_id,project_id,target_type,target_id,private_owner,created_by)
 VALUES(NEW.tenant_id,nullif(to_jsonb(NEW)->>'project_id','')::uuid,TG_TABLE_NAME,NEW.id,private_id,nullif(to_jsonb(NEW)->>'created_by','')::uuid)
 ON CONFLICT(target_type,target_id) DO UPDATE SET target_id=excluded.target_id RETURNING id INTO j;
 IF TG_TABLE_NAME='assets' THEN
  INSERT INTO deletion_items(job_id,kind,locator) SELECT j,'object',storage_key FROM asset_versions WHERE asset_id=NEW.id ON CONFLICT DO NOTHING;
  UPDATE shares SET revoked_at=now() WHERE asset_id=NEW.id AND revoked_at IS NULL;
 ELSIF TG_TABLE_NAME='tasks' THEN
  INSERT INTO deletion_items(job_id,kind,locator) VALUES(j,'runtime',NEW.id::text) ON CONFLICT DO NOTHING;
 ELSIF TG_TABLE_NAME='conversations' THEN
  INSERT INTO deletion_dependencies(job_id,child_job_id)
   SELECT j,d.id FROM deletion_jobs d WHERE
    (d.target_type='tasks' AND d.target_id IN (SELECT id FROM tasks WHERE conversation_id=NEW.id)) OR
    (d.target_type='memories' AND d.target_id IN (SELECT id FROM memories WHERE conversation_id=NEW.id)) OR
    (d.target_type='assets' AND d.target_id IN (SELECT a.id FROM assets a JOIN asset_versions v ON v.asset_id=a.id WHERE a.private_owner=NEW.created_by AND v.metadata->>'conversation_id'=NEW.id::text))
   ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;

INSERT INTO deletion_dependencies(job_id,child_job_id)
SELECT p.id,c.id FROM deletion_jobs p JOIN memories m ON m.conversation_id=p.target_id
JOIN deletion_jobs c ON c.target_type='memories' AND c.target_id=m.id WHERE p.target_type='conversations'
ON CONFLICT DO NOTHING;
INSERT INTO deletion_dependencies(job_id,child_job_id)
SELECT p.id,c.id FROM deletion_jobs p JOIN conversations co ON co.id=p.target_id
JOIN asset_versions v ON v.metadata->>'conversation_id'=co.id::text
JOIN assets a ON a.id=v.asset_id AND a.private_owner=co.created_by
JOIN deletion_jobs c ON c.target_type='assets' AND c.target_id=a.id WHERE p.target_type='conversations'
ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations(version) VALUES(15);
