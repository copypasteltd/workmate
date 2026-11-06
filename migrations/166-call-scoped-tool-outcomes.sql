-- Durable, metadata-only obligations. Activity pruning cannot turn a failed
-- delivery into success. Existing terminal task states and charges are untouched.
CREATE TABLE task_tool_outcomes (
 tenant_id uuid NOT NULL, task_id uuid NOT NULL, failure_ref text NOT NULL CHECK(failure_ref ~ '^[a-f0-9]{16}$'),
 tool text NOT NULL CHECK(tool ~ '^[a-z][a-z0-9_]{0,63}$'), call_ref text NOT NULL CHECK(call_ref ~ '^[a-f0-9]{16}$'),
 arguments_sha256 text NOT NULL CHECK(arguments_sha256 ~ '^[a-f0-9]{64}$'),
 code text NOT NULL CHECK(code ~ '^[A-Z][A-Z0-9_]{2,79}$'),
 category text NOT NULL CHECK(category IN ('validation','source','permission','execution')),
 operation_outcome text NOT NULL CHECK(operation_outcome IN ('not_performed','unverified')),
 can_correct_arguments boolean NOT NULL, resolved_by text CHECK(resolved_by ~ '^[a-f0-9]{16}$'),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(task_id,failure_ref), FOREIGN KEY(tenant_id,task_id) REFERENCES tasks(tenant_id,id) ON DELETE CASCADE,
 CHECK(NOT can_correct_arguments OR operation_outcome='not_performed')
);
ALTER TABLE task_tool_outcomes ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_tool_outcomes FORCE ROW LEVEL SECURITY;
CREATE POLICY tool_outcomes_control ON task_tool_outcomes TO cp_control USING(true) WITH CHECK(true);
CREATE POLICY tool_outcomes_read ON task_tool_outcomes TO cp_app USING(
 tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
 AND EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id AND t.content_state='active'));
REVOKE ALL ON task_tool_outcomes FROM PUBLIC,cp_app,cp_queue;
GRANT SELECT ON task_tool_outcomes TO cp_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON task_tool_outcomes TO cp_control;

-- Legacy outcomes retain their original tool-level interpretation at upgrade.
-- Import only the last unresolved failure; never rewrite historical statuses.
INSERT INTO task_tool_outcomes(tenant_id,task_id,failure_ref,tool,call_ref,arguments_sha256,code,category,operation_outcome,can_correct_arguments,created_at)
SELECT tenant_id,task_id,ref,tool,ref,digest,code,category,outcome,correctable,created_at FROM (
 SELECT DISTINCT ON(task_id,body->>'tool') tenant_id,task_id,kind,created_at,body->>'tool' AS tool,
  CASE WHEN body->>'call_ref' ~ '^[a-f0-9]{16}$' THEN body->>'call_ref' ELSE substr(md5(task_id::text||':'||id::text),1,16) END AS ref,
  CASE WHEN body->>'arguments_sha256' ~ '^[a-f0-9]{64}$' THEN body->>'arguments_sha256' ELSE repeat('0',64) END AS digest,
  CASE WHEN body->>'code' ~ '^[A-Z][A-Z0-9_]{2,79}$' THEN body->>'code' ELSE 'TOOL_EXECUTION_FAILED' END AS code,
  CASE WHEN body->>'category' IN('validation','source','permission','execution') THEN body->>'category' ELSE 'execution' END AS category,
  CASE WHEN body->>'operation_outcome'='not_performed' THEN 'not_performed' ELSE 'unverified' END AS outcome,
  coalesce(body->>'operation_outcome'='not_performed' AND body->>'can_correct_arguments'='true',false) AS correctable
 FROM task_events WHERE kind IN('runtime.tool.failed','runtime.tool.completed','runtime.tool.recovered')
 AND body->>'tool' IN('image2_generate','image2_edit','effect_render','vector_render','slides_build','slides_render','chart_render','deliver_text','audio_produce','generated_video_create','code_package','design_render')
 ORDER BY task_id,body->>'tool',id DESC
) old WHERE kind='runtime.tool.failed';

CREATE FUNCTION persist_call_tool_outcome() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public AS $$
DECLARE b jsonb:=NEW.body; root text; old public.task_tool_outcomes; fixed integer;
BEGIN
 IF NEW.kind NOT IN('runtime.tool.failed','runtime.tool.completed','runtime.tool.recovered') OR b->>'outcome_version' IS DISTINCT FROM '2' THEN RETURN NEW; END IF;
 IF NOT coalesce(b->>'tool' ~ '^[a-z][a-z0-9_]{0,63}$',false)
  OR NOT coalesce(b->>'call_ref' ~ '^[a-f0-9]{16}$',false)
  OR NOT coalesce(b->>'arguments_sha256' ~ '^[a-f0-9]{64}$',false) THEN
  RAISE EXCEPTION 'Invalid call outcome identity' USING ERRCODE='23514';
 END IF;
 IF b ? 'repair_of' THEN
  IF NOT coalesce(b->>'repair_of' ~ '^[a-f0-9]{16}$',false) THEN RAISE EXCEPTION 'Invalid repair reference' USING ERRCODE='23514'; END IF;
  root:=b->>'repair_of';
  SELECT * INTO old FROM public.task_tool_outcomes WHERE task_id=NEW.task_id AND failure_ref=root FOR UPDATE;
  IF NOT FOUND OR old.tenant_id<>NEW.tenant_id OR old.tool<>b->>'tool' THEN RAISE EXCEPTION 'Repair scope mismatch' USING ERRCODE='23514'; END IF;
  IF NEW.kind='runtime.tool.recovered' AND old.resolved_by=b->>'call_ref' THEN RETURN NEW; END IF;
  IF old.resolved_by IS NOT NULL OR old.operation_outcome<>'not_performed' OR NOT old.can_correct_arguments THEN
   RAISE EXCEPTION 'Unverified operations cannot be repaired by replay' USING ERRCODE='23514';
  END IF;
 ELSE root:=b->>'call_ref'; END IF;
 IF NEW.kind='runtime.tool.failed' THEN
  IF b->>'failure_ref' IS DISTINCT FROM root THEN RAISE EXCEPTION 'Invalid failure identity' USING ERRCODE='23514'; END IF;
  IF b ? 'repair_of' THEN
   UPDATE public.task_tool_outcomes SET call_ref=b->>'call_ref',arguments_sha256=b->>'arguments_sha256',code=b->>'code',category=b->>'category',
    operation_outcome=b->>'operation_outcome',can_correct_arguments=(b->>'can_correct_arguments')::boolean,updated_at=clock_timestamp()
    WHERE task_id=NEW.task_id AND failure_ref=root;
  ELSE
   INSERT INTO public.task_tool_outcomes(tenant_id,task_id,failure_ref,tool,call_ref,arguments_sha256,code,category,operation_outcome,can_correct_arguments)
    VALUES(NEW.tenant_id,NEW.task_id,root,b->>'tool',b->>'call_ref',b->>'arguments_sha256',b->>'code',b->>'category',b->>'operation_outcome',(b->>'can_correct_arguments')::boolean)
    ON CONFLICT(task_id,failure_ref) DO NOTHING;
  END IF;
 ELSIF b ? 'repair_of' AND NEW.kind='runtime.tool.completed' THEN
  UPDATE public.task_tool_outcomes SET resolved_by=b->>'call_ref',updated_at=clock_timestamp() WHERE task_id=NEW.task_id AND failure_ref=root;
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION persist_call_tool_outcome() OWNER TO cp_control;
REVOKE ALL ON FUNCTION persist_call_tool_outcome() FROM PUBLIC,cp_app,cp_queue;
CREATE TRIGGER persist_call_tool_outcome AFTER INSERT ON task_events FOR EACH ROW EXECUTE FUNCTION persist_call_tool_outcome();
INSERT INTO schema_migrations(version) VALUES(166);
