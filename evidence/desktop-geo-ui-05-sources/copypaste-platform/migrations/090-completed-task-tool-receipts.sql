CREATE TABLE task_tool_receipts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, project_id uuid NOT NULL, task_id uuid NOT NULL,
 attempt integer NOT NULL CHECK(attempt>0), fencing_token uuid NOT NULL, call_id text NOT NULL,
 tool_name text NOT NULL CHECK(tool_name IN('deliver_text','code_write','code_package','design_render','video_project_queue')),
 input_hash text NOT NULL CHECK(input_hash~'^[a-f0-9]{64}$'), result jsonb NOT NULL,
 output_version_ids uuid[] NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(tenant_id,project_id,task_id) REFERENCES tasks(tenant_id,project_id,id), UNIQUE(task_id,call_id)
);
CREATE INDEX completed_task_tool_reuse ON task_tool_receipts(task_id,tool_name,input_hash,attempt);
ALTER TABLE task_tool_receipts ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_tool_receipts FORCE ROW LEVEL SECURITY;
CREATE POLICY task_tool_receipt_control ON task_tool_receipts TO cp_control USING(true) WITH CHECK(true);
CREATE POLICY task_tool_receipt_app ON task_tool_receipts TO cp_app
 USING(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND task_id=nullif(current_setting('app.task_id',true),'')::uuid
  AND EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id AND t.content_state='active'))
 WITH CHECK(tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid
  AND task_id=nullif(current_setting('app.task_id',true),'')::uuid
  AND EXISTS(SELECT 1 FROM tasks t WHERE t.id=task_id AND t.content_state='active'));
GRANT SELECT,INSERT ON task_tool_receipts TO cp_app;
GRANT SELECT,DELETE ON task_tool_receipts TO cp_control;
CREATE FUNCTION guard_task_tool_receipt() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE t tasks;
BEGIN
 SELECT * INTO t FROM tasks WHERE id=coalesce(NEW.task_id,OLD.task_id);
 IF TG_OP='DELETE' AND t.content_state='deleted' AND coalesce(current_setting('app.erasing_content',true),'false')='true' THEN
  RETURN OLD;
 ELSIF TG_OP<>'INSERT' THEN
  RAISE EXCEPTION 'Completed tool receipts are immutable' USING ERRCODE='23514';
 END IF;
 IF t.tenant_id IS DISTINCT FROM NEW.tenant_id OR t.project_id IS DISTINCT FROM NEW.project_id
  OR t.status<>'running' OR t.content_state<>'active' OR t.cancel_requested OR t.lease_until IS NULL OR t.lease_until<=now()
  OR t.attempt IS DISTINCT FROM NEW.attempt OR t.fencing_token IS DISTINCT FROM NEW.fencing_token
  OR nullif(current_setting('app.task_id',true),'')::uuid IS DISTINCT FROM t.id
  OR nullif(current_setting('app.actor_id',true),'')::uuid IS DISTINCT FROM t.created_by
  OR EXISTS(SELECT 1 FROM unnest(NEW.output_version_ids) x(id) LEFT JOIN asset_versions v ON v.id=x.id
   LEFT JOIN assets a ON a.id=v.asset_id WHERE v.id IS NULL OR a.tenant_id<>t.tenant_id OR a.project_id<>t.project_id
    OR v.metadata->>'task_id' IS DISTINCT FROM t.id::text) THEN
  RAISE EXCEPTION 'A completed tool must retain its model task scope and actual outputs' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_task_tool_receipt() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_task_tool_receipt() FROM PUBLIC,cp_app,cp_queue;
CREATE TRIGGER task_tool_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON task_tool_receipts FOR EACH ROW EXECUTE FUNCTION guard_task_tool_receipt();
INSERT INTO schema_migrations(version) VALUES(90);
