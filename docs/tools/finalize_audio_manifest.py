"""Bind committed component heads to the bounded audio and native UI repair."""
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
    checkpoint_file = ROOT / "docs/quality/audio-production-checkpoint.json"
    checkpoint = read(checkpoint_file)
    assert checkpoint["status"] == "verified_internal_audio_subflow"
    for name, value in checkpoint["source_files"].items():
        assert digest(ROOT / name) == value, name
    audit_file = ROOT / "docs/quality/audio-production-docs-audit-01.json"
    audit = read(audit_file)
    assert audit["status"] == "passed" and audit["original_requirement_records_unchanged"] == 102
    assert audit["checkpoint"]["sha256"] == digest(checkpoint_file)
    assert audit["verifier_sha256"] == digest(ROOT / "docs/tools/audit_audio_docs.py")
    credential_file = ROOT / "docs/quality/desktop-browser-staged-credentials-12.json"
    credential = read(credential_file)
    assert credential["status"] == "passed" and credential["staged_files_checked"] > 0
    assert credential["verifier_sha256"] == digest(ROOT / "docs/tools/scan_desktop_browser_staged_credentials.py")
    whitespace_file = ROOT / "docs/quality/desktop-browser-whitespace-12.json"
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
    archive = ROOT / "docs/quality/history/stage84-previous-publication.json"
    assert not archive.exists()
    old = read(output)
    proofs = {(item["repository"], item["path"]): item for item in old["proofs"]}
    names = set(checkpoint["selected"].values())
    for pattern in ["audio-production-*", "desktop-local-ui-49*", "desktop-local-ui-50*", "desktop-local-ui-51*", "desktop-local-ui-52*", "desktop-execution-control-35*", "desktop-execution-control-36*", "history-source-clients-09*", "history-source-clients-10*"]:
        names.update(file.relative_to(DELIVERY).as_posix() for file in (DELIVERY / "evidence").glob(pattern) if file.is_file())
    for name in sorted(names):
        proofs[("delivery", name)] = {"repository": "delivery", "path": name, "sha256": digest(DELIVERY / name),
            "url": "https://github.com/copypasteltd/workmate/blob/delivery/" + name}
    result = {**old, "at": datetime.now(timezone.utc).isoformat(), "previous_plan_sha256": digest(output), "scope": checkpoint["scope"],
        "components": components, "source_bindings_checked": {"current_files": len(checkpoint["source_files"]), "qualification_scopes": checkpoint["qualification_scopes"]},
        "latest_component_committed_files_checked": checked, "latest_component_committed_files_equal_disk": checked - len(normalizations),
        "declared_git_line_ending_normalizations": normalizations, "unique_committed_blobs_read": len(cache),
        "committed_blob_read_mode": "Batch Git verification with exact disk bytes or declared CRLF-to-LF transformation only",
        "preserved_regression_cases": 968, "full_regression_cases": checkpoint["platform_tests"]["tests"],
        "recording_scope": "Stage-84 actual Web/Admin/native Side Panel and packaged local Desktop audio screenshots/GIF/MP4 are current and source-bound. Tone, ASR, reasoning and native-dialog decisions are explicit fixtures. Earlier media keep historical scopes.",
        "audio_production": {"checkpoint": checkpoint_file.relative_to(ROOT).as_posix(), "checkpoint_sha256": digest(checkpoint_file),
            "documentation_audit": {"path": audit_file.relative_to(ROOT).as_posix(), "sha256": digest(audit_file)},
            "precommit_credentials": {"path": credential_file.relative_to(ROOT).as_posix(), "sha256": digest(credential_file)},
            "raw_whitespace": {"path": whitespace_file.relative_to(ROOT).as_posix(), "sha256": digest(whitespace_file)},
            "selected": checkpoint["selected"], "screenshots": len(checkpoint["screenshots"]), "recordings": len(checkpoint["recordings"]),
            "original_complete_acceptance": "not_proven", "live_voice_quality": "not_qualified", "managed_audio_publication": "not_implemented",
            "independent_human_rights_confirmation": "not_implemented", "unknown_POST_evidence_and_recovery_delivery": "not_implemented"},
        "client_direction": {**old["client_direction"], "stage84_native_layout": {"desktop_checks": checkpoint["desktop_ui_checks"],
            "no_visible_scrollbar_rails": True, "actual_wheel_keyboard_focus": True, "focused_control_preserved_on_resize": True, "truthful_progress_retained": True},
            "complete_Desktop_operation_parity": "pending"},
        "acceptance_baseline": {**old["acceptance_baseline"], "requirements": 102, "acceptance_cases": 102,
            "partial": 83, "unproven": 19, "fully_accepted": 0, "G01_G10": "not_proven"},
        "proofs": list(proofs.values()), "verifier_sha256": digest(Path(__file__))}
    archive.write_bytes(output.read_bytes())
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": result["status"], "components": len(components), "committed_files": checked, "sources": len(checkpoint["source_files"]), "proofs": len(proofs)}))


if __name__ == "__main__":
    main()
