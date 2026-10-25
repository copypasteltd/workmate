"""Bind committed component versions and bounded stage-88 evidence for ordinary push."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

from finalize_desktop_browser_manifest import committed_blobs
from finalize_desktop_company_tool_manifest import MAP, git, digest, read

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"


def ref(file):
    return {"path": file.relative_to(ROOT).as_posix(), "sha256": digest(file)}


def main():
    checkpoint_file = ROOT / "docs/quality/local-programs-checkpoint.json"
    checkpoint = read(checkpoint_file)
    assert checkpoint["status"] == "verified_native_programs_and_browser_resources"
    for name, expected in checkpoint["source_files"].items(): assert digest(ROOT / name) == expected, name
    audit_file = ROOT / "docs/quality/local-programs-docs-audit-02.json"
    audit = read(audit_file)
    assert audit["status"] == "passed" and audit["bilingual_readmes"] == 14 and audit["original_requirement_records_unchanged"] == 102
    assert audit["checkpoint"]["sha256"] == digest(checkpoint_file)
    assert audit["verifier_sha256"] == digest(ROOT / "docs/tools/audit_local_program_docs_final.py")
    reports = {}
    for name, verifier in [("desktop-browser-staged-credentials-19.json", "scan_desktop_browser_staged_credentials.py"),
                           ("desktop-browser-whitespace-18.json", "record_desktop_browser_whitespace.py"),
                           ("archive-link-audit-08.json", "audit_archive_links.py"),
                           ("local-programs-media-review-01.json", "inspect_local_program_media.py")]:
        file = ROOT / "docs/quality" / name
        value = read(file)
        assert value["status"] == "passed" and value["verifier_sha256"] == digest(ROOT / "docs/tools" / verifier)
        reports[name] = ref(file)
    components, normalizations, cache = [], [], {}
    checked = 0
    for component, branch in MAP.items():
        repo = DEV / ("copypaste-" + component)
        assert not git(repo, "status", "--porcelain"), component
        local = git(repo, "branch", "--show-current").decode().strip()
        assert local in (branch, "codex/" + branch)
        names = [name.decode("utf-8") for name in git(repo, "diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "HEAD").split(b"\0") if name]
        blobs = committed_blobs(repo, names, cache)
        for name in names:
            blob, disk = blobs[name], (repo / name).read_bytes()
            if blob != disk:
                values = git(repo, "check-attr", "-z", "text", "eol", "filter", "--", name).split(b"\0")
                attrs = {values[i + 1].decode(): values[i + 2].decode() for i in range(0, len(values) - 1, 3)}
                assert attrs["text"] in ("set", "auto") and attrs["eol"] == "lf" and attrs["filter"] == "unspecified"
                assert b"\0" not in disk and b"\r\n" in disk and blob == disk.replace(b"\r\n", b"\n"), name
                normalizations.append({"path": (repo / name).relative_to(DEV).as_posix(), "transformation": "declared_git_crlf_to_lf_only",
                    "qualified_working_sha256": sha256(disk).hexdigest(), "committed_blob_sha256": sha256(blob).hexdigest()})
            checked += 1
        components.append({"component": component, "branch": branch, "local_branch": local,
            "directory": repo.relative_to(ROOT).as_posix(), "commit": git(repo, "rev-parse", "HEAD").decode().strip(),
            "tree": git(repo, "rev-parse", "HEAD^{tree}").decode().strip(),
            "readmes": [{"path": name, "sha256": digest(repo / name)} for name in ("README.md", "README.en.md")],
            "branch_url": "https://github.com/copypasteltd/workmate/tree/" + branch})
    output = ROOT / "docs/quality/workmate-publication.json"
    previous = ROOT / "docs/quality/history/stage88-previous-publication.json"
    assert not previous.exists()
    old = read(output)
    proofs = {(row["repository"], row["path"]): row for row in old["proofs"]}
    patterns = ["desktop-program-policy-01*", "desktop-execution-control-41*"]
    patterns += [Path(value).stem + "*" for value in checkpoint["selected"].values()]
    patterns += ["desktop-local-ui-70*"]
    selected_attempt = int(Path(checkpoint["selected"]["desktop_ui"]).stem.rsplit("-", 1)[1])
    patterns += [f"desktop-local-ui-{attempt:02}*" for attempt in range(71, selected_attempt)]
    for pattern in patterns:
        for file in (DELIVERY / "evidence").glob(pattern):
            if file.is_file():
                name = file.relative_to(DELIVERY).as_posix()
                proofs[("delivery", name)] = {"repository": "delivery", "path": name, "sha256": digest(file),
                    "url": "https://github.com/copypasteltd/workmate/blob/delivery/" + name}
    progress = read(ROOT / "docs/quality/requirements-alignment-progress.json")
    assert len(progress["requirements"]) == 102 and progress["summary"] == {"partial_verified": 86, "completion_not_proven": 16}
    assert progress["fully_accepted_requirements"] == progress["qualified_live_roles"] == 0
    result = {**old, "at": datetime.now(timezone.utc).isoformat(), "previous_plan_sha256": digest(output),
        "scope": checkpoint["scope"], "components": components,
        "source_bindings_checked": {"current_files": len(checkpoint["source_files"]), "qualification_scopes": checkpoint["qualification_scopes"]},
        "latest_component_committed_files_checked": checked, "latest_component_committed_files_equal_disk": checked - len(normalizations),
        "declared_git_line_ending_normalizations": normalizations, "unique_committed_blobs_read": len(cache),
        "committed_blob_read_mode": "Exact disk bytes or explicitly declared CRLF-to-LF transformation only",
        "current_full_platform_regression_rerun": False,
        "full_regression_scope": "Historical stage86 full platform; stage88 related backend and native/client scopes are separately bound",
        "recording_scope": "Stage88 actual packaged customer-local Desktop programs, browser quotas and retained folder restart journey; other client media remains historical with unchanged product sources. Synthetic provider/dialog content is explicit.",
        "local_programs": {"checkpoint": ref(checkpoint_file), "documentation_audit": ref(audit_file), "reviews": reports,
            "selected": checkpoint["selected"], "desktop_checks": checkpoint["desktop_ui_checks"],
            "desktop_unit_tests": checkpoint["desktop_unit_tests"]["tests"], "native_codex_tests": checkpoint["native_codex_tests"]["tests"],
            "client_unit_tests": checkpoint["client_unit_tests"], "related_backend_tests": checkpoint["server_checks"]["tests"],
            "recordings": len(checkpoint["recordings"]), "screenshots": len(checkpoint["screenshots"]), "packaging": checkpoint["packaging"],
            "original_complete_acceptance": "not_proven", "complete_Desktop_parity": "not_qualified"},
        "folder_work": {**old["folder_work"], "evidence_scope": "Historical stage87; current retained native folder journey is bound by stage88"},
        "client_direction": {**old["client_direction"], "stage88_native_programs": {"customer_local_only": True,
            "full_access_customer_revocable": True, "default_cancel_native_approval": True, "exact_structured_argv": True,
            "owned_job_object_tree": True, "no_inference_credentials_in_child": True, "no_unknown_replay": True,
            "browser_pages_per_task": 3, "active_contexts_per_executor": 2, "compact_questions_and_stop_access": True},
            "complete_Desktop_operation_parity": "pending"},
        "acceptance_baseline": {**old["acceptance_baseline"], "requirements": 102, "acceptance_cases": 102,
            "partial": 86, "unproven": 16, "fully_accepted": 0, "qualified_roles": 0, "G01_G10": "not_proven"},
        "proofs": list(proofs.values()), "verifier_sha256": digest(Path(__file__))}
    previous.write_bytes(output.read_bytes())
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": result["status"], "components": len(components), "committed_files": checked,
                      "sources": len(checkpoint["source_files"]), "proofs": len(proofs)}))


if __name__ == "__main__": main()
