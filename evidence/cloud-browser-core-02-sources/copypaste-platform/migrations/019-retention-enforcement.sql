-- Default online retention is executable policy, separate from financial/audit
-- preservation and from rolling backups. Version writes renew their object.
ALTER TABLE assets ADD COLUMN retention_expires_at timestamptz NOT NULL DEFAULT now()+interval '90 days';
UPDATE assets a SET retention_expires_at=coalesce((SELECT max(created_at) FROM asset_versions v WHERE v.asset_id=a.id),a.created_at)+interval '90 days';
ALTER TABLE creative_projects ADD COLUMN retention_expires_at timestamptz NOT NULL DEFAULT now()+interval '90 days';
UPDATE creative_projects SET retention_expires_at=created_at+interval '90 days';
ALTER TABLE analytics_datasets ADD COLUMN retention_expires_at timestamptz NOT NULL DEFAULT now()+interval '90 days';
UPDATE analytics_datasets SET retention_expires_at=created_at+interval '90 days';
ALTER TABLE tasks ADD COLUMN retention_expires_at timestamptz NOT NULL DEFAULT now()+interval '90 days';
UPDATE tasks SET retention_expires_at=updated_at+interval '90 days';
CREATE INDEX assets_retention_due ON assets(retention_expires_at) WHERE state<>'deleted';
CREATE INDEX creative_retention_due ON creative_projects(retention_expires_at) WHERE content_state<>'deleted';
CREATE INDEX datasets_retention_due ON analytics_datasets(retention_expires_at) WHERE content_state<>'deleted';
CREATE INDEX tasks_retention_due ON tasks(retention_expires_at) WHERE content_state<>'deleted' AND status IN ('succeeded','failed','cancelled');
CREATE INDEX task_events_retention ON task_events(created_at,id);
CREATE INDEX request_replays_retention ON request_replays(created_at) WHERE revoked_at IS NULL;
CREATE FUNCTION renew_content_retention() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF TG_TABLE_NAME='asset_versions' THEN
  UPDATE assets SET retention_expires_at=greatest(retention_expires_at,now()+interval '90 days') WHERE id=NEW.asset_id AND state='active';
 ELSIF TG_TABLE_NAME='creative_projects' AND NEW.content_state='active' AND NEW.body IS DISTINCT FROM OLD.body THEN
  NEW.retention_expires_at=now()+interval '90 days';
 ELSIF TG_TABLE_NAME='tasks' AND NEW.status IN ('succeeded','failed','cancelled') AND NEW.status IS DISTINCT FROM OLD.status THEN
  NEW.retention_expires_at=now()+interval '90 days';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION renew_content_retention() OWNER TO cp_control;
REVOKE ALL ON FUNCTION renew_content_retention() FROM PUBLIC;
CREATE TRIGGER renew_asset_retention AFTER INSERT ON asset_versions FOR EACH ROW EXECUTE FUNCTION renew_content_retention();
CREATE TRIGGER renew_creative_retention BEFORE UPDATE OF body ON creative_projects FOR EACH ROW EXECUTE FUNCTION renew_content_retention();
CREATE TRIGGER renew_task_retention BEFORE UPDATE OF status ON tasks FOR EACH ROW EXECUTE FUNCTION renew_content_retention();

CREATE TABLE runtime_cache_purges (
 task_id uuid PRIMARY KEY REFERENCES tasks(id), tenant_id uuid NOT NULL REFERENCES tenants(id),
 state text NOT NULL DEFAULT 'queued' CHECK(state IN ('queued','completed','failed')),
 attempts integer NOT NULL DEFAULT 0, next_attempt_at timestamptz NOT NULL DEFAULT now(),
 error_code text, completed_at timestamptz
);
ALTER TABLE runtime_cache_purges ENABLE ROW LEVEL SECURITY;
ALTER TABLE runtime_cache_purges FORCE ROW LEVEL SECURITY;
CREATE POLICY runtime_purge_control ON runtime_cache_purges TO cp_control USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON runtime_cache_purges TO cp_control;
CREATE INDEX runtime_purge_due ON runtime_cache_purges(next_attempt_at) WHERE state='queued';
CREATE FUNCTION queue_runtime_cache_purge() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 IF NEW.status IN ('succeeded','failed','cancelled') THEN
  INSERT INTO runtime_cache_purges(task_id,tenant_id) VALUES(NEW.id,NEW.tenant_id) ON CONFLICT DO NOTHING;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION queue_runtime_cache_purge() OWNER TO cp_control;
REVOKE ALL ON FUNCTION queue_runtime_cache_purge() FROM PUBLIC;
CREATE TRIGGER queue_runtime_cache_purge AFTER INSERT OR UPDATE OF status ON tasks FOR EACH ROW EXECUTE FUNCTION queue_runtime_cache_purge();
INSERT INTO runtime_cache_purges(task_id,tenant_id) SELECT id,tenant_id FROM tasks WHERE status IN ('succeeded','failed','cancelled') ON CONFLICT DO NOTHING;
CREATE TABLE task_event_retention (
 task_id uuid PRIMARY KEY REFERENCES tasks(id),tenant_id uuid NOT NULL REFERENCES tenants(id),
 pruned_through bigint NOT NULL,updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE task_event_retention ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_event_retention FORCE ROW LEVEL SECURITY;
CREATE POLICY event_retention_control ON task_event_retention TO cp_control USING(true) WITH CHECK(true);
GRANT SELECT,INSERT,UPDATE ON task_event_retention TO cp_control;
INSERT INTO schema_migrations(version) VALUES(19);
