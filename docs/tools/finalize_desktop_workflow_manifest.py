"""Bind the final independent commits to scoped native workflow evidence."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

from finalize_desktop_company_tool_manifest import git, digest, read, MAP

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"


def main():
    path = ROOT / "docs/quality/desktop-workflow-checkpoint.json"
    checkpoint = read(path)
    assert checkpoint["status"] == "verified_bounded_native_workflow_subset"
    assert digest(ROOT / "docs/tools/record_desktop_workflows.py") == checkpoint["verifier_sha256"]
    audit_path = ROOT / "docs/quality/desktop-workflow-docs-audit-01.json"
    audit = read(audit_path)
    assert audit["status"] == "passed" and audit["bilingual_readmes"] == 14 and audit["original_requirement_records_unchanged"] == 102
    assert digest(ROOT / audit["visual_review"]["path"]) == audit["visual_review"]["sha256"]
    credential_path = ROOT / "docs/quality/desktop-workflow-staged-credentials-01.json"
    credential = read(credential_path)
    assert credential["status"] == "passed" and credential["staged_files_checked"] > 0
    assert digest(ROOT / "docs/tools/scan_desktop_workflow_staged_credentials.py") == credential["verifier_sha256"]
    direction_path = ROOT / "docs/quality/client-direction-source-review-76.json"
    direction = read(direction_path)
    assert direction["status"] == "reviewed_direction_with_scoped_runtime_evidence"
    assert direction["desktop"]["checkpoint_sha256"] == digest(path)
    for name, value in {**direction["extension"]["unchanged_product_sources"], **direction["extension"]["unchanged_journey_verifier_sources"]}.items():
        assert digest(DEV / name) == value
    assert len(direction["extension"]["unchanged_product_sources"]) == 31 and len(direction["extension"]["unchanged_journey_verifier_sources"]) == 3
    for name, value in checkpoint["source_files"].items():
        assert digest(DEV / name) == value, name
    for item in checkpoint["source_archives"]:
        assert digest(ROOT / item["archive"]) == item["sha256"]
    for item in checkpoint["screenshots"] + checkpoint["media"]["files"]:
        assert digest(DEV / item["path"]) == item["sha256"]
    for item in checkpoint["documentation_media"]:
        assert digest(ROOT / item["source"]) == digest(ROOT / item["path"]) == item["sha256"]
    candidate = (DELIVERY / checkpoint["packaged"]["executable"]).resolve()
    assert digest(candidate.parent / "resources/app.asar") == checkpoint["packaged"]["app_asar_sha256"]
    assert digest(candidate.parent / "resources/local-codex/codex.exe") == checkpoint["packaged"]["native_binary_sha256"]
    whitespace_path = ROOT / "docs/quality/desktop-workflow-whitespace-01.json"
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
                assert attributes["text"] in ("set", "auto") and attributes["eol"] == "lf" and attributes["filter"] == "unspecified"
                assert b"\0" not in disk and b"\r\n" in disk and blob == disk.replace(b"\r\n", b"\n"), name
                normalizations.append({"path": (repo / name).relative_to(DEV).as_posix(), "transformation": "declared_git_crlf_to_lf_only",
                    "qualified_working_sha256": sha256(disk).hexdigest(), "committed_blob_sha256": sha256(blob).hexdigest()})
            checked += 1
        components.append({"component": component, "branch": branch, "local_branch": local, "directory": repo.relative_to(ROOT).as_posix(),
            "commit": git(repo, "rev-parse", "HEAD").decode().strip(), "tree": git(repo, "rev-parse", "HEAD^{tree}").decode().strip(),
            "readmes": [{"path": name, "sha256": digest(repo / name)} for name in ("README.md", "README.en.md")],
            "branch_url": "https://github.com/copypasteltd/workmate/tree/" + branch})
    output = ROOT / "docs/quality/workmate-publication.json"
    old = read(output)
    previous_hash = digest(output)
    selected = checkpoint["selected"]
    names = [f"evidence/desktop-execution-control-{selected['control']}.json", f"evidence/desktop-workflows-{selected['focused']}.json",
        f"evidence/desktop-workflows-native-{selected['native']}.json", f"evidence/local-codex-native-{selected['supervisor']}.json",
        f"evidence/desktop-local-ui-{selected['ui']}.json", f"evidence/desktop-local-ui-{selected['ui']}-journey.json"]
    platform = read(DELIVERY / names[0])
    index = read(DELIVERY / platform["raw_report"]["path"])
    names += [platform["raw_report"]["path"], platform["verifier"]["path"], index["plan"]["path"], index["setup"]["path"]]
    names += [row["path"] for row in index["batches"]]
    proofs = {(item["repository"], item["path"]): item for item in old["proofs"]}
    for name in names:
        proofs[("delivery", name)] = {"repository": "delivery", "path": name, "sha256": digest(DELIVERY / name),
            "url": "https://github.com/copypasteltd/workmate/blob/delivery/" + name}
    result = {**old, "at": datetime.now(timezone.utc).isoformat(), "previous_plan_sha256": previous_hash,
        "scope": "CLIENT01 native Desktop parent/child workflows, explicit local permission and human fee/step consent, real files/private downloads, company usage, cancellation and content-source governance. Windows native and packaged evidence with synthetic provider/customer decisions; full professional and production acceptance remains pending.",
        "components": components, "source_bindings_checked": {"current_files": len(checkpoint["source_files"]), "qualification_scopes": checkpoint["qualification_scopes"]},
        "latest_component_committed_files_checked": checked, "latest_component_committed_files_equal_disk": checked - len(normalizations),
        "declared_git_line_ending_normalizations": normalizations, "preserved_regression_cases": 830, "full_regression_cases": checkpoint["platform_tests"]["tests"],
        "desktop_native_workflows": {"checkpoint": path.relative_to(ROOT).as_posix(), "checkpoint_sha256": digest(path), "selected": selected,
            "documentation_audit": {"path": audit_path.relative_to(ROOT).as_posix(), "sha256": digest(audit_path)}, "visual_review": audit["visual_review"],
            "platform_tests": checkpoint["platform_tests"]["tests"], "focused_overlapping_tests": checkpoint["focused_overlapping_tests"]["tests"], "native_children": 3,
            "native_supervisor_tests": 17, "client_tests": 56, "packaged_journeys": 19, "native_roles_admitted": 18, "required_roles": 18, "required_skills": 29, "complete_professional_acceptance": "pending"},
        "desktop_native_workflow_raw_whitespace": {"path": whitespace_path.relative_to(ROOT).as_posix(), "sha256": digest(whitespace_path), "raw_files": len(whitespace["raw_files"]), "raw_bytes_changed": False},
        "desktop_native_workflow_precommit_credentials": {"path": credential_path.relative_to(ROOT).as_posix(), "sha256": digest(credential_path), "scope": credential["scope"]},
        "desktop_private_video": {**old["desktop_private_video"], "source_scope": "historical_stage75; current workflow checkpoint rechecks native video and actual packaged playback"},
        "client_direction": {**old["client_direction"], "native_supervisor": path.relative_to(ROOT).as_posix(),
            "current_direction_review": {"path": direction_path.relative_to(ROOT).as_posix(), "sha256": digest(direction_path), "extension_product_sources_unchanged": 31, "extension_journey_verifiers_unchanged": 3, "new_extension_ui_run": False},
            "desktop_native_workflow_subset": "verified_with_synthetic_provider_and_customer_decisions", "complete_Desktop_operation_parity": "pending"},
        "proofs": list(proofs.values()), "verifier_sha256": digest(Path(__file__))}
    saved = ROOT / "docs/quality/history/stage76-previous-publication.json"
    with saved.open("xb") as stream:
        stream.write(output.read_bytes())
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": result["status"], "components": len(components), "source_files": len(checkpoint["source_files"]), "committed_files": checked, "proofs": len(result["proofs"])}))


if __name__ == "__main__":
    main()
