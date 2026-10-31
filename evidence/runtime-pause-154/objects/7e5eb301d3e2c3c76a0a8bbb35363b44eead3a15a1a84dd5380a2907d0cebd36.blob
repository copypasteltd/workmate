-- A pause intent is not a completed checkpoint or authority to replay work.
ALTER TABLE tasks ADD COLUMN pause_requested boolean NOT NULL DEFAULT false;
CREATE FUNCTION normalize_task_pause_intent() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.execution_location<>'cloud' OR NEW.cancel_requested OR NEW.content_state<>'active'
  OR NEW.status NOT IN('queued','running','paused','needs_input') THEN NEW.pause_requested:=false; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task_pause_intent BEFORE INSERT OR UPDATE OF status,cancel_requested,content_state ON tasks
 FOR EACH ROW EXECUTE FUNCTION normalize_task_pause_intent();
CREATE TABLE task_pause_checkpoints (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid NOT NULL,project_id uuid NOT NULL,task_id uuid NOT NULL,
 attempt integer NOT NULL CHECK(attempt>0),fencing_token uuid NOT NULL,
 runtime_thread text NOT NULL CHECK(length(runtime_thread)>0),runtime_turn text NOT NULL CHECK(length(runtime_turn)>0),
 input_tokens bigint NOT NULL CHECK(input_tokens>=0),output_tokens bigint NOT NULL CHECK(output_tokens>=0),
 accrued_micros bigint NOT NULL CHECK(accrued_micros>=0),
 state text NOT NULL DEFAULT 'waiting' CHECK(state IN('waiting','queued','consumed','closed')),
 created_at timestamptz NOT NULL DEFAULT now(),ready_at timestamptz NOT NULL DEFAULT now(),resumed_at timestamptz,
 FOREIGN KEY(tenant_id,project_id,task_id) REFERENCES tasks(tenant_id,project_id,id),
 UNIQUE(task_id,attempt),UNIQUE(task_id,fencing_token)
);
ALTER TABLE task_pause_checkpoints ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_pause_checkpoints FORCE ROW LEVEL SECURITY;
CREATE POLICY task_pause_checkpoint_control ON task_pause_checkpoints TO cp_control USING(true) WITH CHECK(true);
CREATE POLICY task_pause_checkpoint_customer ON task_pause_checkpoints TO cp_app
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND EXISTS(
  SELECT 1 FROM tasks t WHERE t.id=task_id AND t.project_id=task_pause_checkpoints.project_id AND t.content_state='active'));
GRANT SELECT ON task_pause_checkpoints TO cp_app;
GRANT UPDATE(state,resumed_at) ON task_pause_checkpoints TO cp_app;
GRANT ALL ON task_pause_checkpoints TO cp_control;
CREATE FUNCTION guard_task_pause_checkpoint() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE t tasks; BEGIN
 SELECT * INTO t FROM tasks WHERE id=coalesce(NEW.task_id,OLD.task_id);
 IF TG_OP='DELETE' THEN
  IF t.content_state IS DISTINCT FROM 'deleted' OR current_setting('app.erasing_content',true) IS DISTINCT FROM 'true' THEN
   RAISE EXCEPTION 'Pause checkpoints are immutable execution facts' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='INSERT' THEN
  IF t.execution_location IS DISTINCT FROM 'cloud' OR t.status IS DISTINCT FROM 'running' OR NOT t.pause_requested
   OR t.content_state IS DISTINCT FROM 'active' OR t.cancel_requested
   OR ROW(NEW.tenant_id,NEW.project_id,NEW.attempt,NEW.fencing_token,NEW.runtime_thread,NEW.runtime_turn)
    IS DISTINCT FROM ROW(t.tenant_id,t.project_id,t.attempt,t.fencing_token,t.runtime_thread,t.runtime_turn)
   OR NEW.state<>'waiting' OR NEW.resumed_at IS NOT NULL OR NEW.accrued_micros>t.budget_micros
   OR NEW.input_tokens<t.input_tokens OR NEW.output_tokens<t.output_tokens
   OR NOT EXISTS(SELECT 1 FROM reservations r WHERE r.task_id=t.id AND r.status='reserved' AND r.amount_micros=t.budget_micros) THEN
   RAISE EXCEPTION 'A completed measured cloud turn and its original hold are required' USING ERRCODE='23514'; END IF;
 ELSIF ROW(NEW.id,NEW.tenant_id,NEW.project_id,NEW.task_id,NEW.attempt,NEW.fencing_token,
   NEW.runtime_thread,NEW.runtime_turn,NEW.input_tokens,NEW.output_tokens,NEW.accrued_micros,NEW.created_at,NEW.ready_at)
  IS DISTINCT FROM ROW(OLD.id,OLD.tenant_id,OLD.project_id,OLD.task_id,OLD.attempt,OLD.fencing_token,
   OLD.runtime_thread,OLD.runtime_turn,OLD.input_tokens,OLD.output_tokens,OLD.accrued_micros,OLD.created_at,OLD.ready_at) THEN
  RAISE EXCEPTION 'Measured pause scope and usage are immutable' USING ERRCODE='23514';
 ELSIF OLD.state='waiting' AND NEW.state='queued' THEN
  IF t.status<>'paused' OR t.attempt<>NEW.attempt OR t.runtime_thread IS DISTINCT FROM NEW.runtime_thread
   OR t.runtime_turn IS DISTINCT FROM NEW.runtime_turn OR t.cancel_requested OR t.content_state<>'active'
   OR EXISTS(SELECT 1 FROM task_dependencies d WHERE d.task_id=t.id AND d.state<>'resolved') THEN
   RAISE EXCEPTION 'Only the original paused checkpoint can be queued' USING ERRCODE='23514'; END IF;
 ELSIF OLD.state='queued' AND NEW.state='consumed' THEN
  IF t.status<>'running' OR t.attempt<>NEW.attempt+1 OR t.fencing_token=NEW.fencing_token OR NEW.resumed_at IS NULL THEN
   RAISE EXCEPTION 'A new fenced attempt must consume the pause once' USING ERRCODE='23514'; END IF;
 ELSIF NEW.state='closed' AND t.status IN('succeeded','failed','cancelled','reconciling') THEN NULL;
 ELSIF NEW.state IS DISTINCT FROM OLD.state OR NEW.resumed_at IS DISTINCT FROM OLD.resumed_at THEN
  RAISE EXCEPTION 'Invalid pause checkpoint transition' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_task_pause_checkpoint() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_task_pause_checkpoint() FROM PUBLIC,cp_app,cp_queue;
CREATE TRIGGER task_pause_checkpoint_guard BEFORE INSERT OR UPDATE OR DELETE ON task_pause_checkpoints
 FOR EACH ROW EXECUTE FUNCTION guard_task_pause_checkpoint();
CREATE FUNCTION close_task_pause_checkpoints() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public AS $$ BEGIN
 IF NEW.status IN('succeeded','failed','cancelled','reconciling') THEN
  UPDATE task_pause_checkpoints SET state='closed' WHERE task_id=NEW.id AND state<>'closed';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION close_task_pause_checkpoints() OWNER TO cp_control;
REVOKE ALL ON FUNCTION close_task_pause_checkpoints() FROM PUBLIC,cp_app,cp_queue;
CREATE TRIGGER task_pause_checkpoints_closed AFTER UPDATE OF status ON tasks
 FOR EACH ROW EXECUTE FUNCTION close_task_pause_checkpoints();
DO $$ DECLARE definition text; anchor text; BEGIN
 definition:=pg_get_functiondef('guard_paid_input_checkpoint()'::regprocedure);
 anchor:='IF t.status<>''needs_input'' OR t.attempt<>NEW.attempt';
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Missing paid input resume anchor'; END IF;
 EXECUTE replace(definition,anchor,'IF t.status NOT IN(''needs_input'',''paused'') OR t.attempt<>NEW.attempt');
END $$;
