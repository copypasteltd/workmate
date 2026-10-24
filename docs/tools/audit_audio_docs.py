"""Audit current audio docs, exact media and unchanged original acceptance."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
from urllib.parse import unquote

from audit_workmate_publication import BASE, MAP

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"


def read(file):
    return json.loads(file.read_text(encoding="utf-8"))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    output = ROOT / "docs/quality/audio-production-docs-audit-01.json"
    assert not output.exists()
    checkpoint_file = ROOT / "docs/quality/audio-production-checkpoint.json"
    proof = read(checkpoint_file)
    assert proof["status"] == "verified_internal_audio_subflow"
    assert proof["verifier_sha256"] == digest(ROOT / "docs/tools/record_audio_production.py")
    for name, value in proof["source_files"].items():
        assert digest(ROOT / name) == value, name
    for field in ["baseline", "contract_validation", "complete_route_inventory", "visual_review", "media_review", "capture_review", "legacy_test_review", "skill_test_review"]:
        row = proof[field]
        assert digest(ROOT / row["path"]) == row["sha256"], field
    baseline = read(ROOT / proof["baseline"]["path"])
    for row in baseline["files"]:
        assert digest(ROOT / row["archive"]) == row["sha256"]
    before_progress = next(row for row in baseline["files"] if row["source"] == "docs/quality/requirements-alignment-progress.json")
    before = read(ROOT / before_progress["archive"])
    after = read(ROOT / "docs/quality/requirements-alignment-progress.json")
    assert len(before["requirements"]) == len(after["requirements"]) == 102
    for old, new in zip(before["requirements"], after["requirements"], strict=True):
        for field in ["requirement_id", "priority", "requirement", "acceptance_case", "acceptance_conditions", "acceptance_case_execution", "assessment"]:
            assert old[field] == new[field], (old["requirement_id"], field)
    assert before["gates"] == after["gates"] and before["nfr_full_acceptance"] == after["nfr_full_acceptance"]
    assert after["summary"] == {"partial_verified": 83, "completion_not_proven": 19} and after["fully_accepted_requirements"] == 0
    assert after["audio_production_repair"]["checkpoint_sha256"] == digest(checkpoint_file)
    manifest_file = ROOT / "docs/quality/audio-production-documentation-refresh.json"
    manifest = read(manifest_file)
    assert manifest["verifier_sha256"] == digest(ROOT / "docs/tools/sync_audio_docs.py")
    assert len(manifest["readmes"]) == 14
    for row in manifest["readmes"]:
        assert digest(ROOT / row["path"]) == row["after_sha256"]
    for row in manifest["copied_actual_media"]:
        assert digest(DEV / row["source"]) == digest(ROOT / row["target"]) == row["sha256"]
    project_file = ROOT / "docs/quality/audio-production-project-docs.json"
    project = read(project_file)
    assert project["verifier_sha256"] == digest(ROOT / "docs/tools/sync_audio_project_docs.py")
    for row in project["documents"]:
        assert digest(ROOT / row["path"]) == row["after_sha256"]
    media_hashes = {row["sha256"] for row in proof["documentation_media"]}
    for row in proof["documentation_media"]:
        assert digest(DEV / row["source"]) == digest(ROOT / row["path"]) == row["sha256"]
    media_review = read(ROOT / proof["media_review"]["path"])
    assert media_review["status"] == "passed" and not media_review["raw_media_modified"]
    assert media_review["verifier_sha256"] == digest(ROOT / "docs/tools/inspect_audio_media.py")
    assert len(media_review["recordings"]) == 4
    links = current_media = visual_links = 0
    visual_file = ROOT / proof["visual_review"]["path"]
    for target in re.findall(r"!?\[[^\]]*\]\(([^)\n]+\.png)\)", visual_file.read_text(encoding="utf-8")):
        assert digest((visual_file.parent / target).resolve()) in media_hashes
        visual_links += 1
    assert visual_links >= 4
    for branch, repo in MAP.items():
        for name in ["README.md", "README.en.md"]:
            file = (repo / "docs" if branch == "docs" else repo) / name
            text = file.read_text(encoding="utf-8")
            assert len(text) > 2500 and "\ufffd" not in text and text.count("<!-- audio-production-stage84 -->") == 1
            top = text.split("<details>", 1)[0]
            assert all(value in top for value in ["SQL101", "Codex", "83", "19", "102", str(proof["platform_tests"]["tests"])])
            for target in re.findall(r"!?\[[^\]]*\]\(([^)\n]+)\)", re.sub(r"`{3}.*?`{3}", "", text, flags=re.S)):
                target = target.strip("<>")
                if target.startswith(BASE):
                    rest = target[len(BASE):]
                    if rest.startswith("tree/"):
                        assert rest[5:] in {*MAP, "main"}
                        continue
                    assert rest.startswith("blob/"), target
                    target_branch, destination = rest[5:].split("/", 1)
                    assert target_branch in {*MAP, "main"}
                    actual = MAP.get(target_branch, ROOT) / unquote(destination.split("#")[0])
                elif re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", target):
                    continue
                else:
                    actual = (file.parent / unquote(target.split("#")[0])).resolve()
                    assert actual.is_relative_to(repo)
                assert actual.is_file(), (branch, name, target)
                links += 1
            for target in re.findall(r"!?\[[^\]]*\]\(([^)\n]+)\)", top):
                if target.endswith((".png", ".gif", ".mp4")):
                    assert digest((file.parent / target).resolve()) in media_hashes
                    current_media += 1
    assert current_media == 56
    result = {"at": datetime.now(timezone.utc).isoformat(), "status": "passed", "bilingual_readmes": 14,
        "readme_links_checked": links, "current_media_links_checked": current_media, "visual_review_links_checked": visual_links,
        "original_requirement_records_unchanged": 102, "original_acceptance_case_definitions_unchanged": True,
        "original_nfr_and_gate_records_unchanged": True, "source_bindings_checked": len(proof["source_files"]),
        "checkpoint": {"path": checkpoint_file.relative_to(ROOT).as_posix(), "sha256": digest(checkpoint_file)},
        "documentation_refresh": {"path": manifest_file.relative_to(ROOT).as_posix(), "sha256": digest(manifest_file)},
        "project_documentation": {"path": project_file.relative_to(ROOT).as_posix(), "sha256": digest(project_file)},
        "scope": proof["scope"], "verifier_sha256": digest(Path(__file__))}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({key: result[key] for key in ["status", "bilingual_readmes", "readme_links_checked", "current_media_links_checked"]}))


if __name__ == "__main__":
    main()
