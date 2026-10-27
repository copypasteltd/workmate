ALTER TABLE tasks ADD COLUMN initial_attempt_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE tasks ADD COLUMN last_event_seq bigint NOT NULL DEFAULT 0;
ALTER TABLE task_events ADD COLUMN event_id uuid NOT NULL DEFAULT gen_random_uuid();
ALTER TABLE task_events ADD COLUMN attempt_id uuid;
ALTER TABLE task_events ADD COLUMN seq bigint;
-- Historical global IDs remain stable; all future IDs are task-local counters.
UPDATE task_events e SET seq=e.id,attempt_id=coalesce(t.fencing_token,t.initial_attempt_id) FROM tasks t WHERE t.id=e.task_id;
ALTER TABLE task_events ALTER COLUMN seq SET NOT NULL;
ALTER TABLE task_events ALTER COLUMN attempt_id SET NOT NULL;
ALTER TABLE task_events ADD CONSTRAINT event_sequence_positive CHECK(seq>0);
CREATE UNIQUE INDEX task_event_seq ON task_events(task_id,seq);
CREATE UNIQUE INDEX task_event_identity ON task_events(event_id);
UPDATE tasks t SET last_event_seq=greatest(coalesce((SELECT max(seq) FROM task_events e WHERE e.task_id=t.id),0),coalesce((SELECT pruned_through FROM task_event_retention r WHERE r.task_id=t.id),0));
CREATE FUNCTION assign_task_event_sequence() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $$
BEGIN
 UPDATE tasks SET last_event_seq=last_event_seq+1 WHERE id=NEW.task_id AND tenant_id=NEW.tenant_id
 RETURNING last_event_seq,coalesce(fencing_token,initial_attempt_id) INTO NEW.seq,NEW.attempt_id;
 IF NOT FOUND THEN RAISE EXCEPTION 'Event task missing' USING ERRCODE='23503'; END IF;
 NEW.event_id=gen_random_uuid();
 RETURN NEW;
END $$;
ALTER FUNCTION assign_task_event_sequence() OWNER TO cp_control;
REVOKE ALL ON FUNCTION assign_task_event_sequence() FROM PUBLIC;
CREATE TRIGGER assign_task_event_sequence BEFORE INSERT ON task_events FOR EACH ROW EXECUTE FUNCTION assign_task_event_sequence();
INSERT INTO schema_migrations(version) VALUES(20);
