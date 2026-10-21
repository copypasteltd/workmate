-- Scoped cleanup-journal pages and deterministic newest-first ordering.
-- Existing migration bytes remain immutable; no content or credential columns
-- are added to the administrative collection.
CREATE INDEX deletion_jobs_admin_created ON deletion_jobs(created_at DESC,id DESC);
CREATE INDEX deletion_jobs_admin_state ON deletion_jobs(state,created_at DESC,id DESC);
CREATE INDEX deletion_jobs_admin_target ON deletion_jobs(target_type,created_at DESC,id DESC);
CREATE INDEX deletion_jobs_admin_project ON deletion_jobs(project_id,created_at DESC,id DESC);
