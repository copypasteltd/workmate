"""Bind committed repositories to the qualified native-input increment."""
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
    checkpoint = read(ROOT / "docs/quality/desktop-native-input-checkpoint.json")
    assert checkpoint["status"] == "verified_native_input_subset"
    metadata_path = ROOT / "docs/quality/desktop-native-input-renderer-manifest-01.json"
    metadata = read(metadata_path)
    assert metadata["status"] == "passed_runtime_unchanged_metadata_refreshed"
    allowed = metadata["allowed_difference"]
    assert allowed["path"] == "copypaste-desktop/renderer-source.json" and digest(DEV / allowed["path"]) == allowed["after_sha256"]
    assert digest(ROOT / metadata["previous_manifest"]["path"]) == allowed["before_sha256"] == metadata["previous_manifest"]["sha256"]
    assert digest(ROOT / "docs/tools/record_desktop_input_renderer_manifest.py") == metadata["verifier_sha256"]
    whitespace_path = ROOT / "docs/quality/desktop-native-input-whitespace-01.json"
    whitespace = read(whitespace_path)
    assert whitespace["status"] == "passed" and whitespace["source_and_readme_whitespace_issues"] == 0 and not whitespace["raw_bytes_changed"]
    for item in whitespace["raw_files"]:
        assert item["staged_bytes_equal_disk"] and digest(DELIVERY / item["path"]) == item["sha256"]
    selected = checkpoint["selected"]
    names = [f"local-codex-native-{selected['native']}.json", f"desktop-local-ui-{selected['ui']}.json", f"desktop-local-ui-{selected['ui']}-journey.json"]
    bindings, metadata_differences = {}, []
    for index, name in enumerate(names[:2]):
        report = read(DELIVERY / "evidence" / name)
        assert report["status"] == "passed" and report["source_unchanged"]
        for source, expected in report["source_files"].items():
            relative = "copypaste-desktop/" + source if index == 0 else source
            if digest(DEV / relative) != expected:
                assert index == 1 and relative == allowed["path"] and expected == allowed["before_sha256"], relative
                metadata_differences.append(relative)
        bindings[name] = len(report["source_files"])
    assert metadata_differences == [allowed["path"]]
    assert digest(ROOT / metadata["qualification_report"]["path"]) == metadata["qualification_report"]["sha256"]
    assert metadata["qualified_package"] == checkpoint["packaged"]
    candidate = (DELIVERY / checkpoint["packaged"]["executable"]).resolve()
    assert digest(candidate.parent / "resources/app.asar") == checkpoint["packaged"]["app_asar_sha256"]
    for item in checkpoint["screenshots"] + checkpoint["media"]["files"]:
        assert digest(DEV / item["path"]) == item["sha256"]
    for item in checkpoint["documentation_media"]:
        assert digest(ROOT / item["source"]) == digest(ROOT / item["path"]) == item["sha256"]
    components, checked, normalizations = [], 0, []
    for component, branch in MAP.items():
        repo = DEV / ("copypaste-" + component)
        assert git(repo, "status", "--porcelain") == b"", component
        local = git(repo, "branch", "--show-current").decode().strip()
        assert local in (branch, "codex/" + branch)
        head = git(repo, "rev-parse", "HEAD").decode().strip()
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
            "commit": head, "tree": git(repo, "rev-parse", "HEAD^{tree}").decode().strip(),
            "readmes": [{"path": name, "sha256": digest(repo / name)} for name in ("README.md", "README.en.md")],
            "branch_url": "https://github.com/copypasteltd/workmate/tree/" + branch})
    result = {**old, "at": datetime.now(timezone.utc).isoformat(), "previous_plan_sha256": digest(output),
        "scope": "Native Desktop user questions, explicit option/free-text answers in the original task/thread/turn, waiting stop/revocation, current packaged UI and unchanged backend complete regression scope. Full professional/production acceptance remains pending.",
        "components": components, "source_bindings_checked": bindings, "latest_component_committed_files_checked": checked,
        "latest_component_committed_files_equal_disk": checked - len(normalizations), "declared_git_line_ending_normalizations": normalizations,
        "desktop_native_input": {"checkpoint": "docs/quality/desktop-native-input-checkpoint.json", "selected": selected,
            "native_tests": 17, "unit_tests": 47, "native_ui_checks": 12, "unchanged_backend_tests": 818},
        "desktop_native_input_raw_log_whitespace": {"path": whitespace_path.relative_to(ROOT).as_posix(), "sha256": digest(whitespace_path),
            "source_and_readme_issues": 0, "preserved_raw_diagnostics": len(whitespace["raw_log_exceptions"]), "raw_files": len(whitespace["raw_files"]), "raw_bytes_changed": False},
        "unbundled_renderer_metadata_recheck": {"path": metadata_path.relative_to(ROOT).as_posix(), "sha256": digest(metadata_path),
            "allowed_difference": allowed, "qualified_runtime_and_package_unchanged": True, "is_additional_native_or_ui_test": False},
        "client_direction": {**old["client_direction"], "native_supervisor": "docs/quality/desktop-native-input-checkpoint.json", "native_counts": checkpoint["native_tests"],
            "desktop_native_input_subset": "verified_with_synthetic_provider_and_native_dialog_decisions", "complete_Desktop_and_Extension_acceptance": "pending"},
        "recording_scope": "Current packaged native-input captures bind desktop-native-input-checkpoint.json. Earlier client captures and the unchanged backend full regression retain their original source scopes.",
        "proofs": old["proofs"] + [{"repository": "delivery", "path": "evidence/" + name, "sha256": digest(DELIVERY / "evidence" / name),
            "url": "https://github.com/copypasteltd/workmate/blob/delivery/evidence/" + name} for name in names],
        "verifier_sha256": digest(Path(__file__)),
    }
    archive = ROOT / "docs/quality/history/stage74-previous-publication.json"
    with archive.open("xb") as stream:
        stream.write(output.read_bytes())
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": result["status"], "components": len(components), "source_bindings": bindings, "committed_files": checked, "line_ending_normalizations": len(normalizations)}))


if __name__ == "__main__":
    main()
