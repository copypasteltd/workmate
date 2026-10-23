ALTER TABLE deletion_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE deletion_items FORCE ROW LEVEL SECURITY;
CREATE POLICY erasure_item_scope ON deletion_items USING (
 current_user='cp_control' OR EXISTS(SELECT 1 FROM deletion_jobs j WHERE j.id=job_id)
);
GRANT SELECT ON deletion_items TO cp_app;
INSERT INTO schema_migrations(version) VALUES(12);
