"""Bind final component commits to the current private native video subset."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

from finalize_desktop_company_tool_manifest import git, digest, read, MAP

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"


def main():
    output = ROOT / "docs/quality/workmate-publication.json"
    old = read(output)
    path = ROOT / "docs/quality/desktop-video-checkpoint.json"
    checkpoint = read(path)
    assert checkpoint["status"] == "verified_native_private_video_subset" and checkpoint["platform_tests"]["tests"] == 830
    assert digest(ROOT / "docs/tools/record_desktop_video.py") == checkpoint["verifier_sha256"]
    assert len(checkpoint["qualification_scopes"]) == 4
    docs_audit_path = ROOT / "docs/quality/desktop-video-docs-audit-01.json"
    docs_audit = read(docs_audit_path)
    assert docs_audit["status"] == "passed" and docs_audit["bilingual_readmes"] == 14 and docs_audit["original_requirement_records_unchanged"] == 102
    direction_path = ROOT / "docs/quality/client-direction-source-review-75.json"
    direction = read(direction_path)
    assert direction["status"] == "reviewed_direction_with_scoped_runtime_evidence"
    assert direction["desktop"]["checkpoint_sha256"] == digest(path)
    assert len(direction["extension"]["unchanged_product_sources"]) == 31
    assert len(direction["extension"]["unchanged_journey_verifier_sources"]) == 3
    assert digest(ROOT / "docs/tools/record_client_direction_source_review.py") == direction["verifier_sha256"]
    for name, expected in {**direction["extension"]["unchanged_product_sources"], **direction["extension"]["unchanged_journey_verifier_sources"]}.items():
        assert digest(DEV / name) == expected
    for name, expected in checkpoint["source_files"].items():
        assert digest(DEV / name) == expected, name
    for item in checkpoint["source_archives"]:
        assert digest(ROOT / item["archive"]) == item["sha256"]
    for item in checkpoint["screenshots"] + checkpoint["media"]["files"]:
        assert digest(DEV / item["path"]) == item["sha256"]
    for item in checkpoint["documentation_media"]:
        assert digest(ROOT / item["source"]) == digest(ROOT / item["path"]) == item["sha256"]
    candidate = (DELIVERY / checkpoint["packaged"]["executable"]).resolve()
    assert digest(candidate.parent / "resources/app.asar") == checkpoint["packaged"]["app_asar_sha256"]
    assert digest(candidate.parent / "resources/local-codex/codex.exe") == checkpoint["packaged"]["native_binary_sha256"]
    whitespace_path = ROOT / "docs/quality/desktop-video-whitespace-01.json"
    whitespace = read(whitespace_path)
    assert whitespace["status"] == "passed" and whitespace["source_and_readme_whitespace_issues"] == 0 and not whitespace["raw_bytes_changed"]
    for item in whitespace["raw_files"]:
        repo = ROOT if item["repository"] == "docs" else DEV / ("copypaste-" + item["repository"])
        assert digest(repo / item["path"]) == item["sha256"] and item["staged_bytes_equal_disk"]
    components, normalizations, checked = [], [], 0
    for component, branch in MAP.items():
        repo = DEV / ("copypaste-" + component)
        assert git(repo, "status", "--porcelain") == b"", component
        local = git(repo, "branch", "--show-current").decode().strip()
        assert local in (branch, "codex/" + branch)
        for raw in git(repo, "diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "HEAD").split(b"\0"):
            if not raw:
                continue
            name = raw.decode()
            blob, disk = git(repo, "show", "HEAD:" + name), (repo / name).read_bytes()
            if blob != disk:
                attributes_raw = git(repo, "check-attr", "-z", "text", "eol", "filter", "--", name).split(b"\0")
                attributes = {attributes_raw[i + 1].decode(): attributes_raw[i + 2].decode() for i in range(0, len(attributes_raw) - 1, 3)}
                assert attributes["text"] in ("set", "auto") and attributes["eol"] == "lf" and attributes["filter"] == "unspecified", name
                assert b"\0" not in disk and b"\r\n" in disk and blob == disk.replace(b"\r\n", b"\n"), name
                normalizations.append({"path": (repo / name).relative_to(DEV).as_posix(), "transformation": "declared_git_crlf_to_lf_only",
                    "qualified_working_sha256": sha256(disk).hexdigest(), "committed_blob_sha256": sha256(blob).hexdigest()})
            checked += 1
        components.append({"component": component, "branch": branch, "local_branch": local, "directory": repo.relative_to(ROOT).as_posix(),
            "commit": git(repo, "rev-parse", "HEAD").decode().strip(), "tree": git(repo, "rev-parse", "HEAD^{tree}").decode().strip(),
            "readmes": [{"path": name, "sha256": digest(repo / name)} for name in ("README.md", "README.en.md")],
            "branch_url": "https://github.com/copypasteltd/workmate/tree/" + branch})
    selected = checkpoint["selected"]
    names = [f"desktop-execution-control-{selected['control']}.json", f"desktop-video-{selected['focused']}.json", f"local-codex-native-{selected['native']}.json", f"desktop-local-ui-{selected['ui']}.json", f"desktop-local-ui-{selected['ui']}-journey.json"]
    result = {**old, "at": datetime.now(timezone.utc).isoformat(), "previous_plan_sha256": digest(output),
        "scope": "Native Desktop private video engineering and actual company composition, playback, native saves, revisions and task/OS permission lifecycles. Complete backend/native-main regression plus explicit later UI-only qualification. Full professional and production acceptance remains pending.",
        "components": components, "source_bindings_checked": {"current_files": len(checkpoint["source_files"]), "qualification_scopes": checkpoint["qualification_scopes"]},
        "latest_component_committed_files_checked": checked, "latest_component_committed_files_equal_disk": checked - len(normalizations),
        "declared_git_line_ending_normalizations": normalizations, "preserved_regression_cases": 818, "full_regression_cases": 830,
        "desktop_private_video": {"checkpoint": path.relative_to(ROOT).as_posix(), "checkpoint_sha256": digest(path), "selected": selected,
            "documentation_audit": {"path": docs_audit_path.relative_to(ROOT).as_posix(), "sha256": digest(docs_audit_path)},
            "platform_tests": 830, "focused_overlapping_tests": 58, "native_tests": 17, "client_tests": 47, "packaged_journeys": 18, "native_roles_admitted": 17,
            "required_roles": 18, "required_skills": 29, "complete_professional_acceptance": "pending"},
        "desktop_private_video_raw_whitespace": {"path": whitespace_path.relative_to(ROOT).as_posix(), "sha256": digest(whitespace_path),
            "source_and_readme_issues": 0, "preserved_diagnostics": len(whitespace["raw_log_exceptions"]), "raw_files": len(whitespace["raw_files"]), "raw_bytes_changed": False},
        "desktop_company_tools": {**old["desktop_company_tools"], "source_scope": "historical_stage73"},
        "desktop_native_input": {**old["desktop_native_input"], "source_scope": "historical_stage74"},
        "client_direction": {**old["client_direction"], "native_supervisor": path.relative_to(ROOT).as_posix(), "native_counts": checkpoint["native_tests"],
            "current_direction_review": {"path": direction_path.relative_to(ROOT).as_posix(), "sha256": digest(direction_path), "extension_product_sources_unchanged": 31, "extension_journey_verifiers_unchanged": 3, "new_extension_ui_run": False},
            "desktop_private_video_subset": "verified_with_synthetic_provider_and_native_dialog_decisions", "complete_Desktop_and_Extension_acceptance": "pending"},
        "recording_scope": "Current actual packaged private-video media binds desktop-video-checkpoint.json. Earlier Desktop and Extension captures retain their original scopes; five later UI-only changes are explicitly bound to the new package.",
        "proofs": old["proofs"] + [{"repository": "delivery", "path": "evidence/" + name, "sha256": digest(DELIVERY / "evidence" / name),
            "url": "https://github.com/copypasteltd/workmate/blob/delivery/evidence/" + name} for name in names],
        "verifier_sha256": digest(Path(__file__))}
    archive = ROOT / "docs/quality/history/stage75-previous-publication.json"
    with archive.open("xb") as stream:
        stream.write(output.read_bytes())
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": result["status"], "components": len(components), "source_files": len(checkpoint["source_files"]), "committed_files": checked, "line_ending_normalizations": len(normalizations)}))


if __name__ == "__main__":
    main()
