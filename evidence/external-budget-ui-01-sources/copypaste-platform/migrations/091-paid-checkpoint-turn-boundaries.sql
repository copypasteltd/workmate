-- Preserve SQL088 and tighten lease and native turn-boundary checks.
CREATE OR REPLACE FUNCTION guard_paid_input_checkpoint() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE t tasks;
BEGIN
 SELECT * INTO t FROM tasks WHERE id=coalesce(NEW.task_id,OLD.task_id);
 IF TG_OP='DELETE' THEN
  IF t.content_state<>'deleted' OR coalesce(current_setting('app.erasing_content',true),'false')<>'true' THEN
   RAISE EXCEPTION 'Input checkpoints are immutable execution facts' USING ERRCODE='23514'; END IF;
  RETURN OLD;
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.state<>'requested' OR NEW.input_tokens<>0 OR NEW.output_tokens<>0 OR NEW.accrued_micros<>0
   OR NEW.ready_at IS NOT NULL OR NEW.resumed_at IS NOT NULL
   OR t.tenant_id IS DISTINCT FROM NEW.tenant_id OR t.project_id IS DISTINCT FROM NEW.project_id
   OR t.status<>'running' OR t.mode<>'execute' OR t.content_state<>'active' OR t.cancel_requested OR t.lease_until IS NULL OR t.lease_until<=now()
   OR t.attempt IS DISTINCT FROM NEW.attempt OR t.fencing_token IS DISTINCT FROM NEW.fencing_token
   OR t.runtime_thread IS DISTINCT FROM NEW.runtime_thread OR t.runtime_turn IS DISTINCT FROM NEW.runtime_turn
   OR nullif(current_setting('app.task_id',true),'')::uuid IS DISTINCT FROM t.id
   OR nullif(current_setting('app.actor_id',true),'')::uuid IS DISTINCT FROM t.created_by THEN
   RAISE EXCEPTION 'An active model turn must own the input request' USING ERRCODE='23514'; END IF;
 ELSIF ROW(OLD.id,OLD.tenant_id,OLD.project_id,OLD.task_id,OLD.attempt,OLD.fencing_token,OLD.call_id,OLD.requests,
   OLD.runtime_thread,OLD.runtime_turn,OLD.created_at) IS DISTINCT FROM
   ROW(NEW.id,NEW.tenant_id,NEW.project_id,NEW.task_id,NEW.attempt,NEW.fencing_token,NEW.call_id,NEW.requests,
   NEW.runtime_thread,NEW.runtime_turn,NEW.created_at) THEN
  RAISE EXCEPTION 'Input request scope and native turn are immutable' USING ERRCODE='23514';
 ELSIF OLD.state='requested' AND NEW.state='waiting' THEN
  IF t.status<>'running' OR t.fencing_token IS DISTINCT FROM NEW.fencing_token OR t.attempt<>NEW.attempt
   OR t.content_state<>'active' OR t.cancel_requested OR NEW.ready_at IS NULL OR NEW.resumed_at IS NOT NULL
   OR t.lease_until IS NULL OR t.lease_until<=now()
   OR t.runtime_thread IS DISTINCT FROM NEW.runtime_thread OR t.runtime_turn IS DISTINCT FROM NEW.runtime_turn
   OR NEW.accrued_micros>t.budget_micros OR NEW.input_tokens<t.input_tokens OR NEW.output_tokens<t.output_tokens
   OR NOT EXISTS(SELECT 1 FROM reservations r WHERE r.task_id=t.id AND r.status='reserved' AND r.amount_micros=t.budget_micros) THEN
   RAISE EXCEPTION 'A completed measured turn and its original hold are required' USING ERRCODE='23514'; END IF;
 ELSIF ROW(OLD.input_tokens,OLD.output_tokens,OLD.accrued_micros,OLD.ready_at) IS DISTINCT FROM
   ROW(NEW.input_tokens,NEW.output_tokens,NEW.accrued_micros,NEW.ready_at) THEN
  RAISE EXCEPTION 'Measured checkpoint costs are immutable' USING ERRCODE='23514';
 ELSIF OLD.state='waiting' AND NEW.state='queued' THEN
  IF t.status<>'needs_input' OR t.attempt<>NEW.attempt OR t.runtime_thread IS DISTINCT FROM NEW.runtime_thread
   OR t.runtime_turn IS DISTINCT FROM NEW.runtime_turn OR NEW.resumed_at IS NOT NULL
   OR EXISTS(SELECT 1 FROM task_dependencies d WHERE d.task_id=t.id AND d.state<>'resolved') THEN
   RAISE EXCEPTION 'All input requests must be resolved on the original waiting task' USING ERRCODE='23514'; END IF;
 ELSIF OLD.state='queued' AND NEW.state='consumed' THEN
  IF t.status<>'running' OR t.attempt<>NEW.attempt+1 OR t.fencing_token=NEW.fencing_token OR NEW.resumed_at IS NULL THEN
   RAISE EXCEPTION 'A new fenced attempt must consume the checkpoint once' USING ERRCODE='23514'; END IF;
 ELSIF NEW.state IN('closed','invalid') AND t.status IN('succeeded','failed','cancelled','reconciling') THEN
  NULL;
 ELSIF NEW.state IS DISTINCT FROM OLD.state OR NEW.resumed_at IS DISTINCT FROM OLD.resumed_at THEN
  RAISE EXCEPTION 'Invalid paid checkpoint transition' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
INSERT INTO schema_migrations(version) VALUES(91);
