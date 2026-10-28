-- Expand installations that ran the initial erasure migration while the
-- development stack was starting. Safe on both previous and final 011 shapes.
CREATE TABLE IF NOT EXISTS deletion_dependencies (
 job_id uuid NOT NULL REFERENCES deletion_jobs(id), child_job_id uuid NOT NULL REFERENCES deletion_jobs(id),
 PRIMARY KEY(job_id,child_job_id), CHECK(job_id<>child_job_id)
);
GRANT SELECT,INSERT,UPDATE ON deletion_dependencies TO cp_control;
INSERT INTO deletion_dependencies(job_id,child_job_id)
 SELECT parent.id,child.id FROM deletion_jobs parent
 JOIN tasks t ON t.conversation_id=parent.target_id
 JOIN deletion_jobs child ON child.target_id=t.id AND child.target_type='tasks'
 WHERE parent.target_type='conversations' ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations(version) VALUES(14);
