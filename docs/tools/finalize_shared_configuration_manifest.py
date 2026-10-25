"""Bind qualified stage-86 sources to committed component heads before push."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

from finalize_desktop_browser_manifest import committed_blobs
from finalize_desktop_company_tool_manifest import MAP, git, digest, read

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"


def main():
    checkpoint_file = ROOT / "docs/quality/shared-project-checkpoint.json"
    checkpoint = read(checkpoint_file)
    assert checkpoint["status"] == "verified_shared_project_guidance_and_private_chat"
    for name, value in checkpoint["source_files"].items():
        assert digest(ROOT / name) == value, name
    audit_file = ROOT / "docs/quality/shared-project-docs-audit-01.json"
    audit = read(audit_file)
    assert audit["status"] == "passed" and audit["original_requirement_records_unchanged"] == 102
    assert audit["checkpoint"]["sha256"] == digest(checkpoint_file)
    assert audit["verifier_sha256"] == digest(ROOT / "docs/tools/audit_shared_configuration_docs.py")
    credential_file = ROOT / "docs/quality/desktop-browser-staged-credentials-14.json"
    credential = read(credential_file)
    assert credential["status"] == "passed" and credential["staged_files_checked"] > 0
    assert credential["verifier_sha256"] == digest(ROOT / "docs/tools/scan_desktop_browser_staged_credentials.py")
    whitespace_file = ROOT / "docs/quality/desktop-browser-whitespace-14.json"
    whitespace = read(whitespace_file)
    assert whitespace["status"] == "passed" and whitespace["source_and_readme_whitespace_issues"] == 0 and not whitespace["raw_bytes_changed"]
    assert whitespace["verifier_sha256"] == digest(ROOT / "docs/tools/record_desktop_browser_whitespace.py")
    components, normalizations, cache = [], [], {}
    checked = 0
    for component, branch in MAP.items():
        repo = DEV / ("copypaste-" + component)
        assert not git(repo, "status", "--porcelain"), component
        local = git(repo, "branch", "--show-current").decode().strip()
        assert local in [branch, "codex/" + branch]
        names = [name.decode("utf-8") for name in git(repo, "diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "HEAD").split(b"\0") if name]
        blobs = committed_blobs(repo, names, cache)
        for name in names:
            blob, disk = blobs[name], (repo / name).read_bytes()
            if blob != disk:
                values = git(repo, "check-attr", "-z", "text", "eol", "filter", "--", name).split(b"\0")
                attrs = {values[i + 1].decode(): values[i + 2].decode() for i in range(0, len(values) - 1, 3)}
                assert attrs["text"] in ["set", "auto"] and attrs["eol"] == "lf" and attrs["filter"] == "unspecified"
                assert b"\0" not in disk and b"\r\n" in disk and blob == disk.replace(b"\r\n", b"\n"), name
                normalizations.append({"path": (repo / name).relative_to(DEV).as_posix(), "transformation": "declared_git_crlf_to_lf_only",
                                       "qualified_working_sha256": sha256(disk).hexdigest(), "committed_blob_sha256": sha256(blob).hexdigest()})
            checked += 1
        components.append({"component": component, "branch": branch, "local_branch": local, "directory": repo.relative_to(ROOT).as_posix(),
            "commit": git(repo, "rev-parse", "HEAD").decode().strip(), "tree": git(repo, "rev-parse", "HEAD^{tree}").decode().strip(),
            "readmes": [{"path": name, "sha256": digest(repo / name)} for name in ["README.md", "README.en.md"]],
            "branch_url": "https://github.com/copypasteltd/workmate/tree/" + branch})
    output = ROOT / "docs/quality/workmate-publication.json"
    archive = ROOT / "docs/quality/history/stage86-previous-publication.json"
    assert not archive.exists()
    old = read(output)
    proofs = {(item["repository"], item["path"]): item for item in old["proofs"]}
    names = set(checkpoint["selected"].values())
    current_patterns = [Path(name).stem + "*" for name in checkpoint["selected"].values()]
    for pattern in [*current_patterns, "project-configuration-*", "project-guidance-*-failure.json", "desktop-local-ui-55*", "desktop-local-ui-56*", "desktop-local-ui-57*", "desktop-local-ui-58*", "desktop-local-ui-59*", "desktop-local-ui-60*", "desktop-local-ui-61*", "desktop-local-ui-62*", "desktop-local-ui-63*", "desktop-execution-control-39*", "history-source-clients-13*", "history-source-clients-14*", "history-source-clients-15*", "history-source-clients-16*", "history-source-clients-17*", "history-source-clients-18*", "private-chat-upload-unit-01.tap"]:
        names.update(file.relative_to(DELIVERY).as_posix() for file in (DELIVERY / "evidence").glob(pattern) if file.is_file())
    for name in sorted(names):
        proofs[("delivery", name)] = {"repository": "delivery", "path": name, "sha256": digest(DELIVERY / name),
            "url": "https://github.com/copypasteltd/workmate/blob/delivery/" + name}
    progress = read(ROOT / "docs/quality/requirements-alignment-progress.json")
    assert len(progress["requirements"]) == 102 and progress["fully_accepted_requirements"] == 0
    result = {**old, "at": datetime.now(timezone.utc).isoformat(), "previous_plan_sha256": digest(output), "scope": checkpoint["scope"],
        "components": components, "source_bindings_checked": {"current_files": len(checkpoint["source_files"]), "qualification_scopes": checkpoint["qualification_scopes"]},
        "latest_component_committed_files_checked": checked, "latest_component_committed_files_equal_disk": checked - len(normalizations),
        "declared_git_line_ending_normalizations": normalizations, "unique_committed_blobs_read": len(cache),
        "committed_blob_read_mode": "Exact disk bytes or explicitly declared CRLF-to-LF transformation only",
        "preserved_regression_cases": 1001, "full_regression_cases": checkpoint["platform_tests"]["tests"],
        "recording_scope": "Stage-86 actual Web/Admin/native right Side Panel and packaged customer-local Desktop guidance screenshots/GIF/MP4. Model replies and native-dialog decisions are fixtures; earlier media retains historical scopes.",
        "shared_project_guidance": {"checkpoint": checkpoint_file.relative_to(ROOT).as_posix(), "checkpoint_sha256": digest(checkpoint_file),
            "documentation_audit": {"path": audit_file.relative_to(ROOT).as_posix(), "sha256": digest(audit_file)},
            "precommit_credentials": {"path": credential_file.relative_to(ROOT).as_posix(), "sha256": digest(credential_file)},
            "raw_whitespace": {"path": whitespace_file.relative_to(ROOT).as_posix(), "sha256": digest(whitespace_file)},
            "selected": checkpoint["selected"], "screenshots": len(checkpoint["screenshots"]), "recordings": len(checkpoint["recordings"]),
            "original_complete_acceptance": "not_proven", "private_chat_upload": "actual_owner_bytes_and_same_project_peer_denials",
            "local_codex_guidance": "actual_v3_v3_v4_and_separate_settlements", "complete_Desktop_parity": "not_qualified"},
        "audio_authorizations": {**old["audio_authorizations"], "evidence_scope": "historical_stage85_superseded_by_shared_project_guidance_sources"},
        "client_direction": {**old["client_direction"], "stage86_native_layout": {"desktop_checks": checkpoint["desktop_ui_checks"],
            "side_panel_checks": checkpoint["web_admin_sidepanel_checks"], "no_desktop_scrollbar_rails": True,
            "actual_wheel_keyboard_focus": True, "native_compact_chat_actions_visible_and_hit_tested": True,
            "truthful_progress_retained": True}, "complete_Desktop_operation_parity": "pending"},
        "acceptance_baseline": {**old["acceptance_baseline"], "requirements": 102, "acceptance_cases": 102,
            "partial": progress["summary"]["partial_verified"], "unproven": progress["summary"]["completion_not_proven"],
            "fully_accepted": 0, "G01_G10": "not_proven"},
        "proofs": list(proofs.values()), "verifier_sha256": digest(Path(__file__))}
    archive.write_bytes(output.read_bytes())
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": result["status"], "components": len(components), "committed_files": checked, "sources": len(checkpoint["source_files"]), "proofs": len(proofs)}))


if __name__ == "__main__":
    main()
