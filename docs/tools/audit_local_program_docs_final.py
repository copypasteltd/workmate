"""Read-only audit of current native-program docs and their original scope."""
from collections import Counter
from datetime import datetime, timezone
import json
from pathlib import Path
import re
from urllib.parse import unquote, urlsplit

from markdown_it import MarkdownIt
from record_folder_work import ROOT, DEV, DELIVERY, read, digest, ref, source, passing
from audit_folder_work_docs import FIELDS, BRANCHES, targets


def main():
    output = ROOT / "docs/quality/local-programs-docs-audit-02.json"
    assert not output.exists()
    file = ROOT / "docs/quality/local-programs-checkpoint.json"
    proof = read(file)
    assert proof["status"] == "verified_native_programs_and_browser_resources"
    assert proof["desktop_ui_checks"] == 68 and proof["client_unit_tests"] == 184
    for name, expected in proof["source_files"].items(): assert digest(ROOT / name) == expected, name
    for key in ("desktop_unit_tests", "native_codex_tests", "server_checks"): passing(proof[key])
    for row in proof["qualification_scopes"]:
        report = DELIVERY / row["report"]
        assert digest(report) == row["sha256"] and read(report)["status"] == "passed"
    refresh_file = ROOT / "docs/quality/local-programs-documentation-refresh.json"
    refresh = read(refresh_file)
    assert refresh["checkpoint"]["sha256"] == digest(file) and refresh["readmes"] == 14
    assert refresh["verifier_sha256"] == digest(ROOT / "docs/tools/sync_local_program_docs.py")
    format_file = ROOT / "docs/quality/local-programs-readme-format-01.json"
    formatting = read(format_file)
    assert formatting["initial_refresh"]["sha256"] == digest(refresh_file)
    assert formatting["verifier_sha256"] == digest(ROOT / "docs/tools/format_local_program_readmes.py")
    final = {row["path"]: row for row in formatting["files"]}
    assert len(final) == 6
    for changed in final.values():
        before = (ROOT / changed["archive"]).read_bytes()
        assert digest(ROOT / changed["archive"]) == changed["before_sha256"]
        assert (ROOT / changed["path"]).read_bytes() == before.rstrip(b"\r\n") + b"\n"
    for row in refresh["files"]:
        correction = final.get(row["path"])
        if correction: assert correction["before_sha256"] == row["after_sha256"]
        expected = correction["after_sha256"] if correction else row["after_sha256"]
        assert digest(ROOT / row["path"]) == expected, row["path"]
        if row["archive"]: assert digest(ROOT / row["archive"]) == row["before_sha256"]
    baseline = read(ROOT / "docs/quality/history/stage87-before-folder-work/receipt.json")
    for key, count in (("published_migrations", 103), ("published_contracts", 532)):
        assert len(baseline[key]) == count
        for name, expected in baseline[key].items(): assert digest(ROOT / name) == expected
    progress = read(ROOT / "docs/quality/requirements-alignment-progress.json")
    assert [{k: row[k] for k in FIELDS} for row in progress["requirements"]] == baseline["original_requirements"]
    assert dict(Counter(row["assessment"] for row in progress["requirements"])) == {"partial_verified": 86, "completion_not_proven": 16}
    assert progress["fully_accepted_requirements"] == progress["qualified_live_roles"] == 0
    assert all(row["full_acceptance"] == "not_proven" for row in progress["gates"]) and len(progress["gates"]) == 10
    for row in progress["requirements"]:
        if row["requirement_id"] in ("REQ-040", "REQ-042"):
            assert row["verified_repairs"][-1]["stage"] == 88 and row["acceptance_case_execution"] == "not_completed"
    for name in ("2026-10-25-goal-gap-summary.md", "2026-10-25-goal-gap-assessment.md"):
        text = (ROOT / "docs/quality" / name).read_text(encoding="utf-8-sig")
        assert set(re.findall(r"^\| (GAP-\d{2}) \|", text, re.M)) == {f"GAP-{i:02}" for i in range(1, 27)}
        assert "阶段 88" in text and "十二" in text
    text = (ROOT / "docs/quality/2026-10-25-goal-gap-assessment.md").read_text(encoding="utf-8-sig")
    assert set(re.findall(r"^\| (REQ-\d{3}) \|", text, re.M)) == {row["requirement_id"] for row in progress["requirements"]}
    review_file = ROOT / "docs/quality/local-programs-media-review-01.json"
    media = read(review_file)
    assert media["status"] == "passed" and media["checkpoint"]["sha256"] == digest(file)
    checked = {}
    for recording in proof["recordings"]:
        for row in recording["files"]: checked[row["path"]] = row["sha256"]
    for recording in media["recordings"]:
        for row in recording["files"]:
            assert row["fully_decoded"] and row["decoded_frames"] > 1 and digest(source(row["path"])) == checked[row["path"]] == row["sha256"]
    assert sum(len(row["files"]) for row in media["recordings"]) == len(checked)
    for row in proof["screenshots"]: assert digest(source(row["path"])) == row["sha256"]
    for row in refresh["media_copies"]: assert digest(source(row["source"])) == digest(ROOT / row["target"]) == row["sha256"]
    assert all(read(DELIVERY / f"evidence/desktop-local-ui-{attempt}.json")["status"] == "failed" for attempt in (70, 71))
    parser, links = MarkdownIt("commonmark"), Counter()
    readmes = [ROOT / "docs" / name for name in ("README.md", "README.en.md")]
    readmes += [DEV / ("copypaste-" + component) / name for component in BRANCHES.values() for name in ("README.md", "README.en.md")]
    for readme in readmes:
        text = readme.read_text(encoding="utf-8-sig")
        assert len(text) > 2500 and "```mermaid" in text and "local-programs-stage88" in text
        assert all(str(proof[k]) in text for k in ("desktop_ui_checks", "client_unit_tests")) and "1023" in text
        assert re.search(r"[\u4e00-\u9fff]", text) if readme.name == "README.md" else len(re.findall(r"[A-Za-z]{3,}", text)) > 200
        repo = ROOT if readme.parent == ROOT / "docs" else readme.parent
        for target in targets(parser.parse(text)):
            parsed = urlsplit(target)
            if parsed.netloc == "github.com" and parsed.path.startswith("/copypasteltd/workmate/"):
                parts = unquote(parsed.path).split("/")
                if len(parts) > 5 and parts[3] in ("tree", "blob") and parts[4] in BRANCHES:
                    destination = DEV / ("copypaste-" + BRANCHES[parts[4]]) / "/".join(parts[5:])
                elif len(parts) > 5 and parts[3] in ("tree", "blob") and parts[4] in ("main", "docs"):
                    destination = ROOT / "/".join(parts[5:])
                else:
                    links["external_not_fetched"] += 1
                    continue
                assert destination.exists(), (str(readme), target)
                links["mapped_github_target_exists"] += 1
            elif parsed.scheme or parsed.netloc: links["external_not_fetched"] += 1
            elif parsed.path:
                destination = (readme.parent / unquote(parsed.path)).resolve()
                assert destination.is_relative_to(repo) and destination.exists(), (str(readme), target)
                links["independent_repo_local_target_exists"] += 1
    visual_file = ROOT / "docs/design/implementation/local-programs-visual-review.md"
    assert visual_file.is_file() and "尝试 72" in visual_file.read_text(encoding="utf-8")
    result = {"at": datetime.now(timezone.utc).isoformat(), "status": "passed", "checkpoint": ref(file),
              "source_files_checked": len(proof["source_files"]), "bilingual_readmes": 14, "readmes": [ref(p) for p in readmes],
              "documentation_refresh": ref(refresh_file), "readme_formatting": ref(format_file), "refreshed_files_exact": len(refresh["files"]), "original_requirement_records_unchanged": 102,
              "migrations_byte_preserved": 103, "contracts_byte_preserved": 532, "gap_groups": 26,
              "fully_accepted": 0, "qualified_roles": 0, "G01_G10": "not_proven", "media_review": ref(review_file), "visual_review": ref(visual_file),
              "screenshots_checked": len(proof["screenshots"]), "recordings_fully_decoded": len(media["recordings"]), "links": dict(links),
              "product_inputs_modified": False, "failed_attempt_70_preserved": True, "verifier_sha256": digest(Path(__file__))}
    with output.open("x", encoding="utf-8", newline="\n") as stream: stream.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": "passed", "sources": len(proof["source_files"]), "readmes": 14, "original_requirements": 102}))


if __name__ == "__main__": main()
