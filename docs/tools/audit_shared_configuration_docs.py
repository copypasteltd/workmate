"""Check qualified stage-86 documentation without weakening original acceptance."""
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]


def read(file):
    return json.loads(file.read_text(encoding="utf-8"))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def ref(file):
    return {"path": file.relative_to(ROOT).as_posix(), "sha256": digest(file)}


def main():
    output = ROOT / "docs/quality/shared-project-docs-audit-01.json"
    assert not output.exists()
    checkpoint_file = ROOT / "docs/quality/shared-project-checkpoint.json"
    checkpoint = read(checkpoint_file)
    assert checkpoint["status"] == "verified_shared_project_guidance_and_private_chat"
    for name, value in checkpoint["source_files"].items():
        assert digest(ROOT / name) == value, name
    baseline = read(ROOT / "docs/quality/history/stage86-before-shared-configuration/receipt.json")
    originals = {row["source"]: row for row in baseline["files"]}
    progress_file = ROOT / "docs/quality/requirements-alignment-progress.json"
    previous = read(ROOT / originals[progress_file.relative_to(ROOT).as_posix()]["archive"])
    progress = read(progress_file)
    keys = ["requirement_id", "priority", "requirement", "acceptance_case", "acceptance_conditions"]
    assert len(previous["requirements"]) == len(progress["requirements"]) == 102
    assert [{k: row[k] for k in keys} for row in previous["requirements"]] == [{k: row[k] for k in keys} for row in progress["requirements"]]
    assert Counter(row["assessment"] for row in progress["requirements"]) == progress["summary"]
    assert progress["summary"] == {"partial_verified": 84, "completion_not_proven": 18}
    assert progress["fully_accepted_requirements"] == progress["qualified_live_roles"] == 0
    assert progress["gates"] == previous["gates"] and progress["nfr_full_acceptance"] == "not_proven"
    requirement = next(row for row in progress["requirements"] if row["requirement_id"] == "REQ-065")
    assert requirement["assessment"] == "partial_verified" and requirement["acceptance_case_execution"] == "not_completed"
    assert requirement["verified_repairs"] and requirement["remaining_complete_acceptance_conditions"]
    assessment_file = ROOT / "docs/quality/2026-10-25-goal-gap-assessment.md"
    assessment = assessment_file.read_text(encoding="utf-8")
    mapped = {identity: state for identity, state in re.findall(r"^\| (REQ-\d{3}) \| P[012] \| ([^|]+) \|", assessment, re.M)}
    assert len(mapped) == 102
    for row in progress["requirements"]:
        assert mapped[row["requirement_id"]].strip() == ("部分" if row["assessment"] == "partial_verified" else "未证明完整")
    refresh_file = ROOT / "docs/quality/shared-project-documentation-refresh.json"
    refresh = read(refresh_file)
    assert refresh["status"] == "refreshed_bilingual_shared_project_guidance" and len(refresh["files"]) == 14
    assert refresh["checkpoint"] == ref(checkpoint_file)
    for row in refresh["files"]:
        file = ROOT / row["path"]
        assert digest(file) == row["after_sha256"]
        assert digest(ROOT / row["archive"]) == row["before_sha256"]
        text = file.read_text(encoding="utf-8")
        assert "<!-- shared-project-stage86 -->" in text and "~~~mermaid" in text
        assert "SQL103" in text and "102" in text and "26" in text
        assert ".gif)" in text and ".mp4)" in text
    for row in refresh["media_copies"]:
        assert digest(ROOT / row["target"]) == row["sha256"]
    media_file = ROOT / "docs/quality/shared-project-media-review-01.json"
    media = read(media_file)
    assert media["status"] == "passed" and not media["raw_media_modified"]
    assert media["checkpoint"] == ref(checkpoint_file) and len(media["recordings"]) == 5
    assert all(row["fully_decoded"] for capture in media["recordings"] for row in capture["files"])
    links_file = ROOT / "docs/quality/archive-aware-links-04.json"
    links = read(links_file)
    assert links["status"] == "passed" and not links["issues"]
    assert links["all_read_inputs_unchanged"] and not links["old_archives_modified"]
    assert links["verifier_sha256"] == digest(ROOT / "docs/tools/audit_archive_links.py")
    for row in links["documents"]:
        assert digest(ROOT / row["file"]) == row["sha256"]
    assert (ROOT / "docs/quality/shared-project-visual-review-01.md").exists()
    result = {"at": datetime.now(timezone.utc).isoformat(), "status": "passed", "checkpoint": ref(checkpoint_file),
        "original_requirement_records_unchanged": 102, "acceptance_summary": progress["summary"],
        "fully_accepted_requirements": 0, "qualified_live_roles": 0, "original_complete_gates_unchanged": True,
        "bilingual_readmes": 14, "refresh": ref(refresh_file), "media": ref(media_file), "links": ref(links_file),
        "visual_review": ref(ROOT / "docs/quality/shared-project-visual-review-01.md"),
        "scope": "Exact current guidance sources, bilingual workflows/actual media, all local Markdown/registered-archive links, unchanged original 102 requirement and acceptance descriptions. No complete product or live-provider qualification.",
        "verifier_sha256": digest(Path(__file__))}
    with output.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": "passed", "original_requirements_preserved": 102, "readmes": 14, "complete_acceptance": 0}))


if __name__ == "__main__":
    main()
