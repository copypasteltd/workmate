-- Preserve SQL001-134. Business questions share the existing measured input
-- checkpoint; they are not resource permissions or spending approval.
ALTER TABLE task_dependencies DROP CONSTRAINT task_dependencies_kind_check;
ALTER TABLE task_dependencies DROP CONSTRAINT task_dependencies_check1;
ALTER TABLE task_dependencies ADD COLUMN question_options text[] NOT NULL DEFAULT '{}';
ALTER TABLE task_dependencies ADD COLUMN answer text;
ALTER TABLE task_dependencies ADD CONSTRAINT task_dependencies_kind_check CHECK(kind IN('file','connection','question'));
CREATE FUNCTION valid_task_question_options(choices text[]) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT cardinality(choices)<=8 AND NOT EXISTS(SELECT 1 FROM unnest(choices) x WHERE x IS NULL OR length(x) NOT BETWEEN 1 AND 240 OR x<>btrim(x))
  AND cardinality(choices)=(SELECT count(DISTINCT x) FROM unnest(choices) x)
$$;
ALTER TABLE task_dependencies ADD CONSTRAINT task_dependencies_answer_check CHECK(
 (kind='question' AND resource_ids='{}' AND required_scope='task.answer' AND valid_task_question_options(question_options)
  AND ((state='resolved')=(answer IS NOT NULL)) AND (answer IS NULL OR (length(answer) BETWEEN 1 AND 4000 AND answer=btrim(answer))))
 OR (kind<>'question' AND question_options='{}' AND answer IS NULL AND ((state='resolved')=(cardinality(resource_ids)>0)))
);
CREATE FUNCTION guard_task_question_answer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.kind='question' AND (
  ROW(OLD.task_id,OLD.tenant_id,OLD.project_id,OLD.step_key,OLD.kind,OLD.description,OLD.required_scope,OLD.question_options,OLD.checkpoint_id)
   IS DISTINCT FROM ROW(NEW.task_id,NEW.tenant_id,NEW.project_id,NEW.step_key,NEW.kind,NEW.description,NEW.required_scope,NEW.question_options,NEW.checkpoint_id)
  OR (OLD.state='resolved' AND ROW(OLD.answer,OLD.state) IS DISTINCT FROM ROW(NEW.answer,NEW.state))) THEN
  RAISE EXCEPTION 'Answered business questions and their definitions are immutable' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER task_question_answer_guard BEFORE UPDATE ON task_dependencies FOR EACH ROW EXECUTE FUNCTION guard_task_question_answer();

-- Later migrations extend these functions. Patch the two exact resource
-- branches in their CURRENT definitions, retaining every intervening control.
DO $$
DECLARE definition text; before_branch text; after_branch text;
BEGIN
 definition:=pg_get_functiondef('content_source_manifest_before_creative_feedback(uuid,uuid,uuid[],uuid[])'::regprocedure);
 before_branch:=E'ELSE\n      IF cardinality(d.resource_ids)<>1';
 after_branch:=E'ELSIF d.kind=''connection'' THEN\n      IF cardinality(d.resource_ids)<>1';
 IF position(before_branch IN definition)=0 OR
  (length(definition)-length(replace(definition,before_branch,'')))/length(before_branch)<>1 THEN
  RAISE EXCEPTION 'Unexpected current input source validation branch'; END IF;
 EXECUTE replace(definition,before_branch,after_branch);
 definition:=pg_get_functiondef('publication_input_sources(uuid,uuid)'::regprocedure);
 before_branch:=E'ELSE refs:=jsonb_set(refs,''{connections}'',refs->''connections''||jsonb_build_array(jsonb_build_object(''id'',item.resource_ids[1],''provider'',item.provider))); END IF;';
 after_branch:=replace(before_branch,'ELSE refs:=','ELSIF item.kind=''connection'' THEN refs:=');
 IF position(before_branch IN definition)=0 OR
  (length(definition)-length(replace(definition,before_branch,'')))/length(before_branch)<>1 THEN
  RAISE EXCEPTION 'Unexpected current publication input branch'; END IF;
 EXECUTE replace(definition,before_branch,after_branch);
END $$;
INSERT INTO schema_migrations(version) VALUES(135);
