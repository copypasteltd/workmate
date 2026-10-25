"""Read-only, source-bound review of the stage-87 documentation and media."""
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

from markdown_it import MarkdownIt
from record_folder_work import ROOT, DEV, DELIVERY, digest, read, ref, source, passing


FIELDS = ("requirement_id", "priority", "requirement", "acceptance_case", "acceptance_conditions")
BRANCHES = {"backend": "platform", **{name: name for name in ("web", "admin", "desktop", "extension", "delivery")}}


def targets(tokens):
    for token in tokens:
        if token.type in ("link_open", "image"):
            yield token.attrGet("href" if token.type == "link_open" else "src")
        if token.children:
            yield from targets(token.children)


def main():
    output = ROOT / "docs/quality/folder-work-docs-audit-01.json"
    assert not output.exists(), "Preserve every audit receipt"
    checkpoint_file = ROOT / "docs/quality/folder-work-checkpoint.json"
    checkpoint = read(checkpoint_file)
    assert checkpoint["status"] == "verified_local_folder_work_and_native_navigation"
    for name, expected in checkpoint["source_files"].items():
        assert digest(ROOT / name) == expected, name
    assert len(checkpoint["source_files"]) == 1530
    assert checkpoint["original_desktop_50_checks_preserved"] and checkpoint["original_desktop_69_unit_cases_preserved"]
    passing(checkpoint["desktop_unit_tests"])
    assert checkpoint["desktop_ui_checks"] == 57 and checkpoint["desktop_unit_tests"]["tests"] == 91 and checkpoint["client_unit_tests"] == 161
    assert checkpoint["verifier_sha256"] == digest(ROOT / "docs/tools/record_folder_work.py")
    for row in checkpoint["qualification_scopes"]:
        file = DELIVERY / row["report"]
        assert digest(file) == row["sha256"] and read(file)["status"] == "passed", row["report"]

    refresh_file = ROOT / "docs/quality/folder-work-documentation-refresh.json"
    refresh = read(refresh_file)
    assert refresh["checkpoint"]["sha256"] == digest(checkpoint_file)
    assert refresh["verifier_sha256"] == digest(ROOT / "docs/tools/sync_folder_work_docs.py")
    assert refresh["readmes"] == 14 and len(refresh["files"]) == 37
    for row in refresh["files"]:
        assert digest(ROOT / row["path"]) == row["after_sha256"], row["path"]
        assert digest(ROOT / row["archive"]) == row["before_sha256"], row["archive"]
    refresh_archive = ROOT / "docs/quality/history/stage87-current-documents/receipt.json"
    assert read(refresh_archive)["files"] == refresh["files"]
    baseline_file = ROOT / "docs/quality/history/stage87-before-folder-work/receipt.json"
    baseline = read(baseline_file)
    assert digest(baseline_file) == checkpoint["preserved_baseline"]["receipt"]["sha256"]
    for row in baseline["files"]:
        assert digest(ROOT / row["archive"]) == row["sha256"], row["archive"]
    assert len(baseline["files"]) == 43
    for key, count in (("published_migrations", 103), ("published_contracts", 532)):
        assert len(baseline[key]) == count
        for name, expected in baseline[key].items():
            assert digest(ROOT / name) == expected, name
    progress = read(ROOT / "docs/quality/requirements-alignment-progress.json")
    original = [{key: row[key] for key in FIELDS} for row in progress["requirements"]]
    assert original == baseline["original_requirements"] and len(original) == 102
    assert original == [{key: row[key] for key in FIELDS} for row in read(ROOT / "docs/quality/requirements-alignment-baseline.json")["requirements"]]
    assert progress["summary"] == {"partial_verified": 86, "completion_not_proven": 16}
    assert dict(Counter(row["assessment"] for row in progress["requirements"])) == progress["summary"]
    assert progress["fully_accepted_requirements"] == progress["qualified_live_roles"] == 0
    assert len(progress["gates"]) == 10 and all(row["full_acceptance"] == "not_proven" for row in progress["gates"])
    by_id = {row["requirement_id"]: row for row in progress["requirements"]}
    assert all(by_id[name]["assessment"] == "partial_verified" for name in ("REQ-040", "REQ-042"))

    media_file = ROOT / "docs/quality/folder-work-media-review-01.json"
    media = read(media_file)
    assert media["status"] == "passed" and media["checkpoint"]["sha256"] == digest(checkpoint_file)
    assert media["verifier_sha256"] == digest(ROOT / "docs/tools/inspect_folder_work_media.py")
    assert len(media["recordings"]) == len(checkpoint["recordings"]) == 9
    raw_media = {}
    for row in checkpoint["recordings"]:
        for file in row["files"]:
            raw_media[file["path"]] = file["sha256"]
    for row in media["recordings"]:
        assert len(row["files"]) == 2 and row["observed_frames"] > 0
        for file in row["files"]:
            assert file["fully_decoded"] and file["decoded_frames"] > 0 and file["seconds"] > 0
            assert digest(source(file["path"])) == raw_media[file["path"]] == file["sha256"]
    assert len(raw_media) == 18
    for row in checkpoint["screenshots"]:
        assert digest(source(row["path"])) == row["sha256"], row["path"]
    assert len(checkpoint["screenshots"]) == 84
    for row in refresh["media_copies"]:
        assert digest(source(row["source"])) == digest(ROOT / row["target"]) == row["sha256"]
    assert len(refresh["media_copies"]) == 16

    old_review = ROOT / "docs/quality/history/goal-gap-review-08/archive.json"
    old = read(old_review)
    protected = 0
    for row in old["files"]:
        assert digest(ROOT / row["archive_path"]) == row["sha256"]
        if row["kind"] == "evidence":
            assert digest(ROOT / row["source_path"]) == row["sha256"]
            protected += 1
    for attempt in (65, 66, 67, 68):
        assert read(DELIVERY / f"evidence/desktop-local-ui-{attempt}.json")["status"] == "failed"

    assessment_file = ROOT / "docs/quality/2026-10-25-goal-gap-assessment.md"
    assessment = assessment_file.read_text(encoding="utf-8-sig")
    assert set(re.findall(r"^\| (GAP-\d{2}) \|", assessment, re.M)) == {f"GAP-{i:02}" for i in range(1, 27)}
    assert set(re.findall(r"^\| (REQ-\d{3}) \|", assessment, re.M)) == set(by_id)
    summary_file = ROOT / "docs/quality/2026-10-25-goal-gap-summary.md"
    assert set(re.findall(r"^\| (GAP-\d{2}) \|", summary_file.read_text(encoding="utf-8"), re.M)) == {f"GAP-{i:02}" for i in range(1, 27)}
    visual = ROOT / "docs/design/implementation/folder-work-visual-review.md"
    assert visual.is_file()
    parser = MarkdownIt("commonmark")
    readmes = [ROOT / "docs" / name for name in ("README.md", "README.en.md")]
    readmes += [DEV / ("copypaste-" + component) / name for component in BRANCHES.values() for name in ("README.md", "README.en.md")]
    links = Counter()
    for file in readmes:
        text = file.read_text(encoding="utf-8-sig")
        assert len(text) >= 2500 and "```mermaid" in text and all(value in text for value in ("57", "91", "161", "1023")), str(file)
        assert re.search(r"[\u4e00-\u9fff]", text) if file.name == "README.md" else len(re.findall(r"[A-Za-z]{3,}", text)) > 200
        repo = ROOT if file.parent == ROOT / "docs" else file.parent
        for target in targets(parser.parse(text)):
            parsed = urlsplit(target)
            if parsed.netloc == "github.com" and parsed.path.startswith("/copypasteltd/workmate/"):
                parts = unquote(parsed.path).split("/")
                if len(parts) > 5 and parts[3] in ("tree", "blob") and parts[4] in BRANCHES:
                    destination = DEV / ("copypaste-" + BRANCHES[parts[4]]) / "/".join(parts[5:])
                    assert destination.exists(), (str(file), target)
                    links["mapped_github_targets_resolved_locally"] += 1
                else:
                    links["external_not_fetched"] += 1
            elif parsed.scheme or parsed.netloc:
                links["external_not_fetched"] += 1
            elif parsed.path:
                destination = (file.parent / unquote(parsed.path)).resolve()
                assert destination.is_relative_to(repo) and destination.exists(), (str(file), target)
                links["independent_repository_local_targets"] += 1
    result = {"at": datetime.now(timezone.utc).isoformat(), "status": "passed", "checkpoint": ref(checkpoint_file),
        "scope": "Read-only review of current source/checkpoint, exact preimages, bilingual independent READMEs and decoded actual media; no product tests rerun and no external links or fragment anchors fetched.",
        "source_files_checked": len(checkpoint["source_files"]), "bilingual_readmes": len(readmes),
        "readmes": [ref(file) for file in readmes], "documentation_refresh": ref(refresh_file),
        "refreshed_files_exact": len(refresh["files"]), "baseline_preimages_exact": len(baseline["files"]),
        "refreshed_preimages_exact": len(refresh["files"]), "migrations_byte_preserved": 103, "contracts_byte_preserved": 532,
        "original_requirement_records_unchanged": len(original), "acceptance": progress["summary"],
        "fully_accepted": 0, "qualified_roles": 0, "G01_G10": "not_proven", "gap_groups": 26,
        "current_numbered_assessment": ref(summary_file), "complete_requirement_mapping": ref(assessment_file),
        "visual_review": ref(visual), "media_review": ref(media_file), "screenshots_checked": 84,
        "recordings_fully_decoded": 9, "media_files_fully_decoded": 18, "media_copies_exact": 16,
        "historical_failed_evidence_preserved": protected, "old_failed_attempts_still_failed": [65, 66, 67, 68],
        "links": dict(links), "product_inputs_modified": False, "verifier_sha256": digest(Path(__file__))}
    with output.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print(json.dumps({"status": result["status"], "sources": result["source_files_checked"], "readmes": len(readmes), "original_requirements": len(original), "links": result["links"]}))


if __name__ == "__main__":
    main()
