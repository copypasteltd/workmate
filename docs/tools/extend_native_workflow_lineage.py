"""Copy the last published source traversal into SQL094, extending native reads.

Published SQL085 is read only. The generated new function remains reviewable SQL.
Run once, before SQL094 is published; never use this against an applied version.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
migrations = ROOT / "dev/copypaste-platform/migrations"
target = migrations / "094-desktop-workflow-origin.sql"
original = target.read_text(encoding="utf-8")
marker = "-- Extend SQL085 source traversal with native immutable workflow reads."
assert marker not in original
source = (migrations / "085-publication-input-snapshots.sql").read_text(encoding="utf-8")
start = source.index("CREATE OR REPLACE FUNCTION content_source_manifest(")
end = source.index("END $$;", start) + len("END $$;")
function = source[start:end]
needle = "   IF source_task.id IS NULL OR source_task.content_state<>'active'"
position = function.index(needle)
line_end = function.index("\n", position) + 1
extra = """   FOR r IN SELECT * FROM native_workflow_reads WHERE task_id=source_task.id LOOP
    IF NOT EXISTS(SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workflow_id=w.id AND v.version=r.version
     WHERE w.id=r.workflow_id AND w.tenant_id=scope_tenant AND w.project_id=scope_project
      AND w.private_owner=source_task.private_owner AND w.content_state='active') THEN RETURN NULL; END IF;
    targets:=targets||jsonb_build_array(jsonb_build_object('kind','workflows','id',r.workflow_id));
   END LOOP;
   FOR r IN SELECT * FROM workflow_runs WHERE execution_location='desktop'
    AND (origin_task_id=source_task.id OR id=source_task.desktop_workflow_run_id) LOOP
    IF r.tenant_id<>scope_tenant OR r.project_id<>scope_project OR r.private_owner IS DISTINCT FROM source_task.private_owner
     OR r.content_state<>'active' OR NOT EXISTS(SELECT 1 FROM workflows w JOIN workflow_versions v ON v.workflow_id=w.id AND v.version=r.workflow_version
       WHERE w.id=r.workflow_id AND w.content_state='active' AND w.private_owner=r.private_owner AND v.published_at IS NOT NULL
        AND v.definition=r.definition AND v.role_hashes=r.role_hashes) THEN RETURN NULL; END IF;
    targets:=targets||jsonb_build_array(jsonb_build_object('kind','workflows','id',r.workflow_id),jsonb_build_object('kind','workflow_runs','id',r.id));
    SELECT coalesce(array_agg(x.id),'{}') INTO more FROM tasks x WHERE x.desktop_workflow_run_id=r.id;
    pending_tasks:=pending_tasks||more||ARRAY[r.origin_task_id];
   END LOOP;
"""
function = function[:line_end] + extra + function[line_end:]
lock_start = source.index("CREATE FUNCTION lock_task_content_sources(")
lock_end = source.index("END $$;", lock_start) + len("END $$;")
locks = source[lock_start:lock_end].replace("CREATE FUNCTION", "CREATE OR REPLACE FUNCTION", 1)
locks = locks.replace("ARRAY['assets','connections'", "ARRAY['workflows','workflow_runs','assets','connections'", 1)
assert locks != source[lock_start:lock_end]
tail = "INSERT INTO schema_migrations(version) VALUES(94);"
assert original.count(tail) == 1
original = original.replace(tail, marker + "\n" + function + "\n\n" + locks + "\n\n" + tail)
target.write_text(original, encoding="utf-8", newline="\n")
print("SQL094: immutable native workflow lineage and NOWAIT source locks generated")
