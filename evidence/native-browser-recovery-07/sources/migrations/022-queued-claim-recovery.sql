ALTER TABLE outbox ADD COLUMN queue_job_id uuid;
ALTER TABLE tasks ADD COLUMN claim_retry_count integer NOT NULL DEFAULT 0 CHECK(claim_retry_count>=0);
ALTER TABLE tasks ADD COLUMN next_claim_retry_at timestamptz NOT NULL DEFAULT now()+interval '1 minute';
CREATE INDEX task_claim_recovery ON tasks(next_claim_retry_at) WHERE status='queued';
CREATE INDEX outbox_task_lookup ON outbox((payload->>'task_id'),created_at DESC) WHERE topic='task.run';
INSERT INTO schema_migrations(version) VALUES(22);
