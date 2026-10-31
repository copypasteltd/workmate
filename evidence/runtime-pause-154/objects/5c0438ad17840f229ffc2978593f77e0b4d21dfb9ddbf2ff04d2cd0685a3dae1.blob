-- Extend the existing measured continuation gate, preserving every capacity,
-- original hold, side-effect, source and desktop ownership fence.
DO $$ DECLARE definition text; anchor text; replacement text; BEGIN
 definition:=pg_get_functiondef('claim_execution_capacity_v89(uuid,text,integer,uuid)'::regprocedure);
 anchor:='FROM public.task_input_checkpoints c JOIN public.reservations r';
 replacement:='FROM (
  SELECT task_id,attempt,state,fencing_token,runtime_thread,runtime_turn,ready_at,input_tokens,output_tokens,accrued_micros
   FROM public.task_input_checkpoints
  UNION ALL
  SELECT task_id,attempt,state,fencing_token,runtime_thread,runtime_turn,ready_at,input_tokens,output_tokens,accrued_micros
   FROM public.task_pause_checkpoints
 ) c JOIN public.reservations r';
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Missing measured capacity checkpoint anchor'; END IF;
 EXECUTE replace(definition,anchor,replacement);
END $$;
