"""One-time correction before publishing SQL094; run only after source checks exit."""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PLATFORM = ROOT / "dev/copypaste-platform"
path = PLATFORM / "migrations/094-desktop-workflow-origin.sql"
text = path.read_text(encoding="utf-8")


def change(old, new):
    global text
    assert text.count(old) == 1, old[:120]
    text = text.replace(old, new)


change("role_hashes jsonb NOT NULL,published_at", "role_hashes jsonb NOT NULL,source_refs jsonb NOT NULL CHECK(jsonb_typeof(source_refs)='object'),published_at")
change("AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at AND NEW.definition='{}'::jsonb AND NEW.role_hashes='{}'::jsonb THEN RETURN NEW; END IF;",
       "AND NEW.published_at IS NOT DISTINCT FROM OLD.published_at AND NEW.definition='{}'::jsonb AND NEW.role_hashes='{}'::jsonb AND NEW.source_refs='{}'::jsonb THEN RETURN NEW; END IF;")
change("seen_versions uuid[]:='{}';\n tid uuid;", "seen_versions uuid[]:='{}';\n pending_sources jsonb[]:='{}'; seen_workflows text[]:='{}';\n tid uuid;")
change("WHILE cardinality(pending_tasks)>0 OR cardinality(pending_versions)>0 LOOP\n  IF cardinality(seen_tasks)+cardinality(seen_versions)>4096 THEN RETURN NULL; END IF;\n  IF cardinality(pending_tasks)>0 THEN\n   tid:=",
       "WHILE cardinality(pending_tasks)>0 OR cardinality(pending_versions)>0 OR cardinality(pending_sources)>0 LOOP\n  IF cardinality(seen_tasks)+cardinality(seen_versions)+cardinality(seen_workflows)>4096 THEN RETURN NULL; END IF;\n  IF cardinality(pending_tasks)>0 THEN\n   tid:=")
change("FOR r IN SELECT * FROM native_workflow_reads WHERE task_id=source_task.id LOOP",
       "FOR r IN SELECT x.*,v.source_refs FROM native_workflow_reads x JOIN workflow_versions v ON v.workflow_id=x.workflow_id AND v.version=x.version WHERE x.task_id=source_task.id LOOP")
change("targets:=targets||jsonb_build_array(jsonb_build_object('kind','workflows','id',r.workflow_id));\n   END LOOP;",
       "targets:=targets||jsonb_build_array(jsonb_build_object('kind','workflows','id',r.workflow_id));\n    IF NOT (r.workflow_id::text||':'||r.version::text)=ANY(seen_workflows) THEN\n     seen_workflows:=array_append(seen_workflows,r.workflow_id::text||':'||r.version::text);\n     pending_sources:=array_append(pending_sources,r.source_refs);\n    END IF;\n   END LOOP;")
change("targets:=targets||jsonb_build_array(jsonb_build_object('kind','workflows','id',r.workflow_id),jsonb_build_object('kind','workflow_runs','id',r.id));\n    SELECT",
       "targets:=targets||jsonb_build_array(jsonb_build_object('kind','workflows','id',r.workflow_id),jsonb_build_object('kind','workflow_runs','id',r.id));\n    IF NOT (r.workflow_id::text||':'||r.workflow_version::text)=ANY(seen_workflows) THEN\n     seen_workflows:=array_append(seen_workflows,r.workflow_id::text||':'||r.workflow_version::text);\n     SELECT v.source_refs INTO publication FROM workflow_versions v WHERE v.workflow_id=r.workflow_id AND v.version=r.workflow_version;\n     pending_sources:=array_append(pending_sources,publication);\n    END IF;\n    SELECT")
change("  ELSE\n   vid:=pending_versions[1];", "  ELSIF cardinality(pending_versions)>0 THEN\n   vid:=pending_versions[1];")
# Reuse the existing published-input validator for both artifacts and saved
# workflow versions, without retaining the creator task/conversation lifetime.
start = text.index("   IF source_version.metadata ? 'publication_sources' THEN")
stop = text.index("   IF source_version.metadata ? 'task_id' THEN", start)
validator = text[start:stop]
assert validator.count("   END IF;\n   FOR r") == 1
validator = validator.replace("   IF source_version.metadata ? 'publication_sources' THEN\n    publication:=source_version.metadata->'publication_sources';\n", "")
validator = validator.replace("   END IF;\n   FOR r", "   FOR r")
validator = validator.replace("source_version.metadata->'publication_sources'->'workflows'", "publication->'workflows'")
validator = validator.replace("    targets:=targets||jsonb_build_array(jsonb_build_object('kind','workflows','id',r.workflow_id));\n", "    targets:=targets||jsonb_build_array(jsonb_build_object('kind','workflows','id',r.workflow_id));\n    IF NOT (r.workflow_id::text||':'||r.version::text)=ANY(seen_workflows) THEN\n     seen_workflows:=array_append(seen_workflows,r.workflow_id::text||':'||r.version::text);\n     pending_sources:=array_append(pending_sources,(SELECT v.source_refs FROM workflow_versions v WHERE v.workflow_id=r.workflow_id AND v.version=r.version));\n    END IF;\n")
text = text[:start] + "   IF source_version.metadata ? 'publication_sources' THEN\n    pending_sources:=array_append(pending_sources,source_version.metadata->'publication_sources');\n   END IF;\n" + text[stop:]
change("  END IF;\n END LOOP;\n RETURN targets;", "  ELSE\n   publication:=pending_sources[1]; pending_sources:=pending_sources[2:];\n" + validator + "  END IF;\n END LOOP;\n RETURN targets;")

start = text.index("CREATE OR REPLACE FUNCTION publication_input_sources(source_id uuid)")
end = text.index("\nINSERT INTO schema_migrations(version) VALUES(94);", start)
body = text[start:end]
body = body.replace("publication_input_sources(source_id uuid)", "publication_input_sources(source_id uuid,source_task_id uuid)")
body = body.replace("DECLARE scope_asset assets;", "DECLARE scope_tenant uuid; scope_project uuid;")
body = body.replace("pending_versions uuid[]:=ARRAY[source_id]", "pending_versions uuid[]:='{}'")
init_start = body.index(" SELECT a.* INTO scope_asset")
init_end = body.index(" WHILE cardinality(pending_tasks)", init_start)
body = body[:init_start] + """ IF num_nonnulls(source_id,source_task_id)<>1 THEN RETURN NULL; END IF;
 IF source_id IS NOT NULL THEN
  SELECT a.tenant_id,a.project_id INTO scope_tenant,scope_project FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.id=source_id
   AND a.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND a.private_owner=nullif(current_setting('app.actor_id',true),'')::uuid;
  IF scope_tenant IS NULL OR content_source_manifest(scope_tenant,scope_project,'{}',ARRAY[source_id]) IS NULL THEN RETURN NULL; END IF;
  pending_versions:=ARRAY[source_id];
 ELSE
  SELECT t.tenant_id,t.project_id INTO scope_tenant,scope_project FROM tasks t WHERE t.id=source_task_id
   AND t.id=nullif(current_setting('app.task_id',true),'')::uuid AND t.execution_location='desktop' AND t.role_key='workflow-consultant'
   AND t.desktop_workflow_run_id IS NULL AND t.status='running' AND NOT t.cancel_requested AND t.content_state='active'
   AND t.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND t.private_owner=nullif(current_setting('app.actor_id',true),'')::uuid;
  IF scope_tenant IS NULL OR content_source_manifest(scope_tenant,scope_project,ARRAY[source_task_id],'{}') IS NULL THEN RETURN NULL; END IF;
  pending_tasks:=ARRAY[source_task_id];
 END IF;
""" + body[init_end:]
body = body.replace("scope_asset.tenant_id", "scope_tenant").replace("scope_asset.project_id", "scope_project")
body = body.replace("x.version,w.private_owner,v.definition_hash FROM native_workflow_reads", "x.version,w.private_owner,v.definition_hash,v.source_refs FROM native_workflow_reads")
body = body.replace("r.id AS run_id,r.origin_task_id FROM workflow_runs", "r.id AS run_id,r.origin_task_id,v.source_refs FROM workflow_runs")
for old in ("to_jsonb(item)));\n   END LOOP;\n   FOR item IN SELECT r.workflow_id", "to_jsonb(item)-'origin_task_id'));\n    SELECT"):
    assert old in body, old
merge = """    FOREACH bucket IN ARRAY ARRAY['versions','datasets','memories','brands','connections','cloud_references','workflows'] LOOP
     refs:=jsonb_set(refs,ARRAY[bucket],refs->bucket||coalesce(item.source_refs->bucket,'[]'::jsonb));
    END LOOP;
"""
body = body.replace("to_jsonb(item)));\n   END LOOP;\n   FOR item IN SELECT r.workflow_id", "to_jsonb(item)-'source_refs'));\n" + merge + "   END LOOP;\n   FOR item IN SELECT r.workflow_id")
body = body.replace("to_jsonb(item)-'origin_task_id'));\n    SELECT", "to_jsonb(item)-'origin_task_id'-'source_refs'));\n" + merge + "    SELECT")
body += """
ALTER FUNCTION publication_input_sources(uuid,uuid) OWNER TO cp_control;
REVOKE ALL ON FUNCTION publication_input_sources(uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION publication_input_sources(uuid,uuid) TO cp_app,cp_control;
CREATE OR REPLACE FUNCTION publication_input_sources(source_id uuid) RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$ SELECT publication_input_sources(source_id,NULL); $$;

-- The application supplies no arbitrary provenance: compute it from the live
-- task's immutable read ledgers, including previously reused workflow versions.
CREATE FUNCTION guard_native_workflow_sources() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
 SET search_path=pg_catalog,public SET row_security=on AS $$
DECLARE expected jsonb;
BEGIN
 expected:=publication_input_sources(NULL,nullif(current_setting('app.task_id',true),'')::uuid);
 IF expected IS NULL OR NEW.source_refs IS DISTINCT FROM expected OR NOT EXISTS(
  SELECT 1 FROM workflows w WHERE w.id=NEW.workflow_id AND w.execution_location='desktop'
   AND w.tenant_id=NEW.tenant_id AND w.project_id=NEW.project_id AND w.private_owner=NEW.private_owner
   AND w.private_owner=nullif(current_setting('app.actor_id',true),'')::uuid) THEN
  RAISE EXCEPTION 'Invalid native workflow source snapshot' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END $$;
ALTER FUNCTION guard_native_workflow_sources() OWNER TO cp_control;
REVOKE ALL ON FUNCTION guard_native_workflow_sources() FROM PUBLIC;
CREATE TRIGGER native_workflow_sources BEFORE INSERT ON workflow_versions FOR EACH ROW EXECUTE FUNCTION guard_native_workflow_sources();
"""
text = text[:start] + body + text[end:]
path.write_text(text, encoding="utf-8", newline="\r\n")

path = PLATFORM / "src/desktop-workflows.ts"
text = path.read_text(encoding="utf-8").replace('import { recordTaskSourceRead }', 'import { assertTaskContentSources, recordTaskSourceRead }')
change("[t.id, workflowId, version, t.tenant_id, t.project_id, t.created_by]);\n  }", "[t.id, workflowId, version, t.tenant_id, t.project_id, t.created_by]);\n    await assertTaskContentSources(tx, t);\n  }")
change('"INSERT INTO workflow_versions(workflow_id,version,tenant_id,project_id,private_owner,definition,definition_hash,role_hashes) VALUES($1,$2,$3,$4,$5,$6,$7,$8)"',
       '"INSERT INTO workflow_versions(workflow_id,version,tenant_id,project_id,private_owner,definition,definition_hash,role_hashes,source_refs) VALUES($1,$2,$3,$4,$5,$6,$7,$8,publication_input_sources(NULL,$9))"')
change("validated.definition_hash, JSON.stringify(validated.role_hashes)]);", "validated.definition_hash, JSON.stringify(validated.role_hashes), live.id]);")
path.write_text(text, encoding="utf-8", newline="\r\n")

for name, old, new in (
    ("src/erasure.ts", "SET definition='{}',role_hashes='{}' WHERE workflow_id", "SET definition='{}',role_hashes='{}',source_refs='{}' WHERE workflow_id"),
    ("src/admin-content.ts", "SELECT version,definition,definition_hash,role_hashes,published_at,created_at FROM workflow_versions", "SELECT version,definition,definition_hash,role_hashes,source_refs,published_at,created_at FROM workflow_versions"),
):
    path = PLATFORM / name
    text = path.read_text(encoding="utf-8")
    change(old, new)
    path.write_text(text, encoding="utf-8", newline="\r\n")
print("Added immutable native workflow source snapshots and shared validation; SQL001-093 untouched.")
