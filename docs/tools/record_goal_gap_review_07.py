"""Record a bounded, read-only product assessment; never run product fixtures."""
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote


ROOT = Path(__file__).resolve().parents[2]
COMPONENTS = ("platform", "web", "admin", "desktop", "extension", "delivery")
DOCS = (
    "docs/quality/2026-10-25-goal-gap-assessment.md",
    "docs/README.md",
    "docs/README.en.md",
    "docs/changes/2026-10-25-goal-gap-assessment.md",
)
OUTPUT = ROOT / "docs/quality/2026-10-25-goal-gap-review-07.json"


def read(path):
    return json.loads(path.read_text(encoding="utf-8-sig"))


def digest(path):
    return sha256(path.read_bytes()).hexdigest() if path.is_file() else None


def git(repo, *args):
    return subprocess.check_output(
        ["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", *args],
        cwd=repo,
    ).decode("utf-8").strip()


def source_path(name):
    """Resolve each historical producer's explicit path convention."""
    parts = Path(name.replace("\\", "/")).parts
    assert not Path(name).is_absolute() and ".." not in parts, name
    first = parts[0]
    if first in ("dev", "docs"):
        return ROOT.joinpath(*parts)
    if first.startswith("copypaste-"):
        assert first.removeprefix("copypaste-") in COMPONENTS, name
        return ROOT.joinpath("dev", *parts)
    assert first in COMPONENTS, name
    return ROOT.joinpath("dev", "copypaste-" + first, *parts[1:])


def compare_sources(sources):
    changes = []
    by_component = {}
    for name, expected in sources.items():
        path = source_path(name)
        current = digest(path)
        component = path.relative_to(ROOT).parts[:2]
        component = "/".join(component) if component[0] == "dev" else "docs"
        counts = by_component.setdefault(component, {"selected": 0, "unchanged": 0})
        counts["selected"] += 1
        if current == expected:
            counts["unchanged"] += 1
        else:
            changes.append({"source_path": name, "expected_sha256": expected, "current_sha256": current})
    return {"selected": len(sources), "unchanged": len(sources) - len(changes),
            "changed": changes, "by_component": by_component}


def main():
    assert not OUTPUT.exists(), "Keep the original review immutable; use a new review number."
    archive_file = ROOT / "docs/quality/history/goal-gap-review-07/archive.json"
    archive = read(archive_file)
    for entry in archive["files"]:
        saved = ROOT / entry["archive_path"]
        assert digest(saved) == entry["sha256"] and saved.stat().st_size == entry["bytes"]
        if entry["kind"] == "evidence":
            assert digest(ROOT / entry["source_path"]) == entry["sha256"]
    for name, expected in archive["protected_inputs"].items():
        assert digest(ROOT / name) == expected, name

    checkpoint_file = ROOT / "docs/quality/shared-project-checkpoint.json"
    checkpoint = read(checkpoint_file)
    baseline_sources = compare_sources(checkpoint["source_files"])
    assert (baseline_sources["selected"], baseline_sources["unchanged"]) == (1510, 1503)
    historical = []
    for item in checkpoint["qualification_scopes"]:
        file = ROOT / "dev/copypaste-delivery" / item["report"]
        assert digest(file) == item["sha256"]
        report = read(file)
        assert report["status"] == "passed"
        comparison = compare_sources(report["source_files"])
        assert len(comparison["changed"]) == 7
        historical.append({"scope": item["scope"], "original_report": file.relative_to(ROOT).as_posix(),
                           "report_sha256": digest(file), "retained_status": report["status"],
                           "current_source_comparison": comparison})

    latest_file = ROOT / "dev/copypaste-delivery/evidence/desktop-local-ui-65.json"
    latest = read(latest_file)
    latest_sources = compare_sources(latest["source_files"])
    assert latest["status"] == "failed" and latest_sources["selected"] == 1411
    assert not latest_sources["changed"] and latest["source_unchanged"] is True
    linked = {}
    for key in ("raw_report", "verifier", "journey_verifier", "journey"):
        item = latest[key]
        file = ROOT / "dev/copypaste-delivery" / item["path"]
        assert digest(file) == item["sha256"]
        linked[key] = {"original_path": file.relative_to(ROOT).as_posix(), "sha256": digest(file)}
    journey = read(ROOT / linked["journey"]["original_path"])
    assert len(journey["checks"]) == 8 and len(journey["errors"]) == 1
    assert journey.get("native_folder_work") is None
    assert all(journey.get(key) is True for key in ("electron_closed", "browser_closed", "api_closed", "fixture_closed"))
    assert latest["owned_database_shutdown"] is True and latest["owned_preview_closed"] is True
    raw = (ROOT / linked["raw_report"]["original_path"]).read_text(encoding="utf-8-sig")
    unit = {key: int(re.search(r"^# " + key + r" (\d+)\s*$", raw, re.M)[1])
            for key in ("tests", "pass", "fail", "cancelled", "skipped", "todo")}
    assert unit == {"tests": 91, "pass": 91, "fail": 0, "cancelled": 0, "skipped": 0, "todo": 0}
    assert all(check["exit_code"] == 0 for check in latest["checks"])

    new_names = [
        "dev/copypaste-desktop/src/local-schedule-files.ts",
        "dev/copypaste-desktop/src/local-schedule.ts",
        "dev/copypaste-desktop/renderer/src/local-schedules.tsx",
        "dev/copypaste-desktop/renderer/src/local-schedules.css",
        "dev/copypaste-desktop/tests/local-schedule-files.test.ts",
        "dev/copypaste-desktop/tests/local-schedule.test.ts",
        "dev/copypaste-delivery/scripts/desktop-folder-work.ts",
    ]
    new_sources = {name: digest(ROOT / name) for name in new_names}
    assert all(new_sources.values()) and not set(new_names).intersection(checkpoint["source_files"])

    progress = read(ROOT / "docs/quality/requirements-alignment-progress.json")
    requirements = progress["requirements"]
    assert len(requirements) == 102
    assert dict(Counter(r["assessment"] for r in requirements)) == progress["summary"] == {
        "partial_verified": 84, "completion_not_proven": 18}
    assert progress["fully_accepted_requirements"] == progress["qualified_live_roles"] == 0
    assert all(gate["full_acceptance"] == "not_proven" for gate in progress["gates"])
    assessment = (ROOT / DOCS[0]).read_text(encoding="utf-8-sig")
    gap_ids = re.findall(r"^\| (GAP-\d{2}) \|", assessment, re.M)
    assert gap_ids == [f"GAP-{i:02}" for i in range(1, 27)]
    mapped = re.findall(r"^\| (REQ-\d{3}) \|", assessment, re.M)
    assert mapped == [r["requirement_id"] for r in requirements]

    links = 0
    link_pattern = re.compile(r"!?\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+\"[^\"]*\")?\)")
    for name in DOCS:
        file = ROOT / name
        for match in link_pattern.finditer(file.read_text(encoding="utf-8-sig")):
            target = match[1].strip("<>")
            if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", target) or target.startswith("#"):
                continue
            path = (file.parent / unquote(target.split("#", 1)[0])).resolve()
            if path == OUTPUT:
                links += 1  # This tool creates that exact report below.
                continue
            assert path.exists(), (name, target)
            links += 1

    repositories = []
    for name in ("docs", *COMPONENTS):
        repo = ROOT if name == "docs" else ROOT / "dev" / ("copypaste-" + name)
        status = git(repo, "status", "--porcelain=v1", "--untracked-files=all").splitlines()
        repositories.append({"component": name, "branch": git(repo, "branch", "--show-current"),
                             "input_head": git(repo, "rev-parse", "HEAD"),
                             "worktree_entry_count": len(status), "worktree_entries": status})
    remote = {}
    for line in git(ROOT, "ls-remote", "origin", *["refs/heads/" + n for n in
                    ("main", "docs", "backend", "web", "admin", "desktop", "extension", "delivery")]).splitlines():
        commit, ref = line.split()
        remote[ref.rsplit("/", 1)[1]] = commit
    assert len(remote) == 8
    for repo in repositories:
        name = repo["component"]
        branch = "backend" if name == "platform" else name
        assert remote[branch] == repo["input_head"]
        if name in ("platform", "web", "admin", "extension"):
            assert repo["worktree_entry_count"] == 0
    assert remote["main"] == remote["docs"]

    result = {
        "schema_version": "1.0", "at": datetime.now(timezone.utc).isoformat(),
        "scope": "Seventh same-day assessment: published stage 86 and unpublished local folder-work candidate; no product tests rerun.",
        "repositories_at_review": repositories, "actual_remote_heads_at_review": remote,
        "remote_matches_committed_input_at_review": True,
        "baseline_checkpoint": {"path": checkpoint_file.relative_to(ROOT).as_posix(), "sha256": digest(checkpoint_file),
                                "current_source_comparison": baseline_sources},
        "historical_qualification_scopes": historical,
        "latest_candidate": {"original_report": latest_file.relative_to(ROOT).as_posix(), "sha256": digest(latest_file),
                             "status": latest["status"], "current_source_comparison": latest_sources,
                             "linked_evidence": linked, "unit_counts": unit,
                             "actual_journey_checks": len(journey["checks"]), "errors": journey["errors"],
                             "folder_work_reached": False, "assertion_origin": "not retained; unresolved",
                             "all_owned_cleanup_recorded": True, "additional_sources": new_sources},
        "archive": {"path": archive_file.relative_to(ROOT).as_posix(), "sha256": digest(archive_file),
                    "exact_saved_files": len(archive["files"])},
        "protected_inputs_unchanged": archive["protected_inputs"],
        "original_acceptance": {"requirements": 102, "cases": 102, **progress["summary"], "fully_accepted": 0,
                                "candidate_roles": 18, "qualified_roles": 0, "G01_G10": "not_proven"},
        "documentation_checks": {"gap_groups": len(gap_ids), "mapped_requirement_ids": len(mapped),
                                 "existing_scoped_local_links": links, "external_urls_and_anchors_checked": False,
                                 "all_historical_directory_links_checked": False},
        "assessed_document_sha256": {name: digest(ROOT / name) for name in DOCS},
        "limitations": ["unresolved actual packaged Desktop assertion", "folder-work end-to-end journey not reached",
                        "unpublished Desktop and Delivery candidates", "live professional quality and twelve-role qualification",
                        "complete original 102 acceptance cases and G01-G10", "signed installation, performance and disaster recovery"],
        "execution": {"product_tests_rerun": False, "browser_started": False, "database_started": False,
                      "virtualization_used": False},
        "verifier_sha256": digest(Path(__file__)),
    }
    with OUTPUT.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": "recorded", "gap_groups": 26, "requirements": 102,
                      "scoped_local_links": links, "candidate_sources_exact": latest_sources["selected"],
                      "retained_candidate_result": "failed", "product_tests_rerun": False}))


if __name__ == "__main__":
    main()
