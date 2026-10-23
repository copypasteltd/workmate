"""Extend unpublished SQL094's publication snapshots without editing SQL085/086."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
migrations = ROOT / "dev/copypaste-platform/migrations"
target = migrations / "094-desktop-workflow-origin.sql"
text = target.read_text(encoding="utf-8")
marker = "-- Retain native workflow provenance across explicit and nested publication."
assert marker not in text
source = (migrations / "086-nested-publication-sources.sql").read_text(encoding="utf-8")
start = source.index("CREATE OR REPLACE FUNCTION publication_input_sources(")
end = source.index("END $$;", start) + len("END $$;")
function = source[start:end]
function = function.replace("'cloud_references','[]'::jsonb)", "'cloud_references','[]'::jsonb,'workflows','[]'::jsonb)", 1)
needle = "   FOR item IN SELECT * FROM task_source_reads WHERE task_id=task_row.id LOOP"
extra = """   FOR item IN SELECT x.workflow_id,x.version,w.private_owner,v.definition_hash FROM native_workflow_reads x
    JOIN workflows w ON w.id=x.workflow_id JOIN workflow_versions v ON v.workflow_id=x.workflow_id AND v.version=x.version
    WHERE x.task_id=task_row.id LOOP
    refs:=jsonb_set(refs,'{workflows}',refs->'workflows'||jsonb_build_array(to_jsonb(item)));
   END LOOP;
   FOR item IN SELECT r.workflow_id,r.workflow_version AS version,r.private_owner,v.definition_hash,r.id AS run_id,r.origin_task_id FROM workflow_runs r
    JOIN workflow_versions v ON v.workflow_id=r.workflow_id AND v.version=r.workflow_version
    WHERE r.execution_location='desktop' AND (r.origin_task_id=task_row.id OR r.id=task_row.desktop_workflow_run_id) LOOP
    refs:=jsonb_set(refs,'{workflows}',refs->'workflows'||jsonb_build_array(to_jsonb(item)-'origin_task_id'));
    SELECT coalesce(array_agg(x.id),'{}') INTO extra FROM tasks x WHERE x.desktop_workflow_run_id=item.run_id;
    pending_tasks:=pending_tasks||extra||ARRAY[item.origin_task_id];
   END LOOP;
"""
assert function.count(needle) == 1
function = function.replace(needle, extra + needle)
function = function.replace("'connections','cloud_references']", "'connections','cloud_references','workflows']")
function = function.replace("(file_row.metadata->'publication_sources'->bucket)", "coalesce(file_row.metadata->'publication_sources'->bucket,'[]'::jsonb)")
assert "'workflows','[]'::jsonb" in function and "'cloud_references','workflows']" in function

needle = "   IF source_version.metadata ? 'task_id' THEN"
assert text.count(needle) == 1
validation = """   FOR r IN SELECT * FROM jsonb_to_recordset(coalesce(source_version.metadata->'publication_sources'->'workflows','[]'))
    AS ref(workflow_id uuid,version int,private_owner uuid,definition_hash text,run_id uuid) LOOP
    IF NOT EXISTS(SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workflow_id=w.id AND v.version=r.version
      JOIN users u ON u.id=w.private_owner AND u.status='active' JOIN memberships mm ON mm.user_id=u.id AND mm.tenant_id=w.tenant_id AND mm.status='active'
      WHERE w.id=r.workflow_id AND w.tenant_id=scope_tenant AND w.project_id=scope_project AND w.content_state='active'
       AND w.private_owner=r.private_owner AND v.definition_hash=r.definition_hash
       AND (mm.role IN('owner','admin') OR EXISTS(SELECT 1 FROM project_members pm WHERE pm.user_id=u.id AND pm.project_id=w.project_id))) THEN RETURN NULL; END IF;
    IF r.run_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM workflow_runs wr WHERE wr.id=r.run_id AND wr.workflow_id=r.workflow_id
     AND wr.workflow_version=r.version AND wr.private_owner=r.private_owner AND wr.content_state='active') THEN RETURN NULL; END IF;
    targets:=targets||jsonb_build_array(jsonb_build_object('kind','workflows','id',r.workflow_id));
    IF r.run_id IS NOT NULL THEN targets:=targets||jsonb_build_array(jsonb_build_object('kind','workflow_runs','id',r.run_id)); END IF;
   END LOOP;
"""
text = text.replace(needle, validation + needle)
tail = "INSERT INTO schema_migrations(version) VALUES(94);"
assert text.count(tail) == 1
text = text.replace(tail, marker + "\n" + function + "\n\n" + tail)
target.write_text(text, encoding="utf-8", newline="\n")
print("SQL094: native workflow references retained across original and nested publication")
