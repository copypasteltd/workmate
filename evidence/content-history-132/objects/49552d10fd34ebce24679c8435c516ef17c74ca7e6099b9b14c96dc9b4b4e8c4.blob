CREATE TABLE notifications (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL,
 recipient_id uuid NOT NULL REFERENCES users(id), task_id uuid NOT NULL, conversation_id uuid,
 kind text NOT NULL CHECK(kind IN ('running','needs_input','waiting_approval','succeeded','partially_succeeded','failed','cancelled','reconciling')),
 attempt integer NOT NULL, read boolean NOT NULL DEFAULT false, created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id) REFERENCES projects(tenant_id,id),
 FOREIGN KEY(tenant_id,task_id) REFERENCES tasks(tenant_id,id),
 FOREIGN KEY(tenant_id,conversation_id) REFERENCES conversations(tenant_id,id), UNIQUE(task_id,attempt,kind)
);
CREATE INDEX notifications_inbox ON notifications(tenant_id,recipient_id,created_at DESC,id DESC);
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE notifications FORCE ROW LEVEL SECURITY;
CREATE POLICY notification_tenant ON notifications USING(current_user='cp_control' OR tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid) WITH CHECK(current_user='cp_control' OR tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid);
CREATE POLICY notification_recipient ON notifications AS RESTRICTIVE FOR ALL TO cp_app
 USING(recipient_id=nullif(current_setting('app.actor_id',true),'')::uuid AND EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id AND t.content_state='active'))
 WITH CHECK(recipient_id=nullif(current_setting('app.actor_id',true),'')::uuid);
GRANT SELECT ON notifications TO cp_app;
GRANT UPDATE(read) ON notifications TO cp_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON notifications TO cp_control;
CREATE FUNCTION record_task_notification() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
DECLARE live tasks; notification_kind text;
BEGIN
 SELECT * INTO live FROM tasks WHERE id=NEW.id;
 IF live.content_state='deleted' THEN DELETE FROM notifications WHERE task_id=NEW.id; RETURN NEW; END IF;
 IF live.content_state<>'active' OR live.status<>NEW.status OR live.attempt<>NEW.attempt THEN RETURN NEW; END IF;
 notification_kind:=CASE live.status WHEN 'awaiting_approval' THEN 'waiting_approval' ELSE live.status END;
 IF notification_kind NOT IN ('running','needs_input','waiting_approval','succeeded','partially_succeeded','failed','cancelled','reconciling') THEN RETURN NEW; END IF;
 INSERT INTO notifications(tenant_id,project_id,recipient_id,task_id,conversation_id,kind,attempt)
 VALUES(live.tenant_id,live.project_id,live.created_by,live.id,live.conversation_id,notification_kind,live.attempt) ON CONFLICT DO NOTHING;
 RETURN NEW;
END $$;
ALTER FUNCTION record_task_notification() OWNER TO cp_control;
REVOKE ALL ON FUNCTION record_task_notification() FROM PUBLIC;
-- Only the final committed state may notify: settlement can change a tentative
-- success into reconciling within the same transaction.
CREATE CONSTRAINT TRIGGER task_notification AFTER INSERT OR UPDATE ON tasks DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION record_task_notification();
INSERT INTO schema_migrations(version) VALUES(26);
