"""Bind committed components and current folder evidence before ordinary push."""
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
    checkpoint_file = ROOT / "docs/quality/folder-work-checkpoint.json"
    checkpoint = read(checkpoint_file)
    assert checkpoint["status"] == "verified_local_folder_work_and_native_navigation"
    for name, expected in checkpoint["source_files"].items():
        assert digest(ROOT / name) == expected, name
    audit_file = ROOT / "docs/quality/folder-work-docs-audit-01.json"
    audit = read(audit_file)
    assert audit["status"] == "passed" and audit["bilingual_readmes"] == 14
    assert audit["original_requirement_records_unchanged"] == 102
    assert audit["checkpoint"]["sha256"] == digest(checkpoint_file)
    for file, verifier in [
        (ROOT / "docs/quality/desktop-browser-staged-credentials-17.json", "scan_desktop_browser_staged_credentials.py"),
        (ROOT / "docs/quality/desktop-browser-whitespace-17.json", "record_desktop_browser_whitespace.py"),
    ]:
        value = read(file)
        assert value["status"] == "passed" and value["verifier_sha256"] == digest(ROOT / "docs/tools" / verifier)
    media_file = ROOT / "docs/quality/folder-work-media-review-01.json"
    media = read(media_file)
    assert media["status"] == "passed" and media["checkpoint"]["sha256"] == digest(checkpoint_file)
    archive_audit_file = ROOT / "docs/quality/archive-link-audit-06.json"
    archive_audit = read(archive_audit_file)
    assert archive_audit["status"] == "passed" and not archive_audit["issues"]
    assert archive_audit["verifier_sha256"] == digest(ROOT / "docs/tools/audit_archive_links.py")
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
    previous_file = ROOT / "docs/quality/history/stage87-previous-publication.json"
    assert not previous_file.exists()
    old = read(output)
    proofs = {(item["repository"], item["path"]): item for item in old["proofs"]}
    for pattern in ("desktop-local-ui-65*", "desktop-local-ui-66*", "desktop-local-ui-67*", "desktop-local-ui-68*", "desktop-local-ui-69*", "history-source-clients-20*"):
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
        "latest_component_committed_files_checked": checked,
        "latest_component_committed_files_equal_disk": checked - len(normalizations),
        "declared_git_line_ending_normalizations": normalizations, "unique_committed_blobs_read": len(cache),
        "committed_blob_read_mode": "Exact disk bytes or explicitly declared CRLF-to-LF transformation only",
        "full_regression_cases": 1023,
        "full_regression_scope": "Historical stage86; unchanged Backend/Web/Admin/Extension product sources; not rerun in stage87",
        "current_full_platform_regression_rerun": False,
        "recording_scope": "Stage87 actual packaged customer-local Desktop and folder watch/restart; other client recordings retain their historical source scopes. Synthetic provider content and native-dialog decisions remain explicit.",
        "folder_work": {"checkpoint": ref(checkpoint_file), "documentation_audit": ref(audit_file), "media_review": ref(media_file),
            "archive_link_audit": ref(archive_audit_file),
            "precommit_credentials": ref(ROOT / "docs/quality/desktop-browser-staged-credentials-17.json"),
            "raw_whitespace": ref(ROOT / "docs/quality/desktop-browser-whitespace-17.json"),
            "selected": checkpoint["selected"], "desktop_checks": 57, "desktop_unit_tests": 91, "client_unit_tests": 161,
            "recordings": len(checkpoint["recordings"]), "screenshots": len(checkpoint["screenshots"]),
            "retained_stage86": checkpoint["retained_stage86"], "packaging": checkpoint["packaging"],
            "original_complete_acceptance": "not_proven", "complete_Desktop_parity": "not_qualified"},
        "shared_project_guidance": {**old["shared_project_guidance"], "evidence_scope": "Historical stage86; current native coverage is separately bound by stage87"},
        "client_direction": {**old["client_direction"], "stage87_native_layout": {
            "desktop_checks": 57, "no_native_frame_or_menu": True, "no_visible_scrollbar_rails": True,
            "actual_wheel_keyboard_focus": True, "text_field_caret_preserved": True,
            "compact_guidance_readable": True, "truthful_progress_retained": True},
            "complete_Desktop_operation_parity": "pending"},
        "acceptance_baseline": {**old["acceptance_baseline"], "requirements": 102, "acceptance_cases": 102,
            "partial": 86, "unproven": 16, "fully_accepted": 0, "qualified_roles": 0, "G01_G10": "not_proven"},
        "proofs": list(proofs.values()), "verifier_sha256": digest(Path(__file__))}
    previous_file.write_bytes(output.read_bytes())
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": result["status"], "components": len(components), "committed_files": checked,
                      "sources": len(checkpoint["source_files"]), "proofs": len(proofs)}))


if __name__ == "__main__":
    main()
