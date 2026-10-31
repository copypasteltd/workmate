-- Complete the precise investigated-root exception through saved publication
-- chains too. Ordinary customer functions and applied migrations150/151 remain.
DO $$ DECLARE definition text; anchor text; BEGIN
 definition:=pg_get_functiondef('public.admin_workflow_run_source_walk(uuid,uuid,uuid[],uuid[],uuid,uuid)'::regprocedure);
 anchor:='WHERE w.id=r.workflow_id AND w.tenant_id=scope_tenant AND w.project_id=scope_project AND w.content_state=''active''';
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Missing saved workflow investigation anchor'; END IF;
 definition:=replace(definition,anchor,'WHERE w.id=r.workflow_id AND w.tenant_id=scope_tenant AND w.project_id=scope_project AND (w.content_state=''active'' OR (w.id=root_workflow AND w.content_state=''quarantined''))');
 anchor:='AND wr.workflow_version=r.version AND wr.private_owner=r.private_owner AND wr.content_state=''active''';
 IF position(anchor IN definition)=0 THEN RAISE EXCEPTION 'Missing saved run investigation anchor'; END IF;
 definition:=replace(definition,anchor,'AND wr.workflow_version=r.version AND wr.private_owner=r.private_owner AND (wr.content_state=''active'' OR (wr.id=root_run AND wr.workflow_id=root_workflow AND wr.content_state=''quarantined''))');
 EXECUTE definition;
END $$;
