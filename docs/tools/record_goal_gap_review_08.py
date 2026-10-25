"""Preserve and assess current evidence without changing original acceptance."""
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import argparse
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[2]
DELIVERY = ROOT / "dev/copypaste-delivery"
COMPONENTS = ("platform", "web", "admin", "desktop", "extension", "delivery")
DOCS = ("docs/quality/2026-10-25-goal-gap-assessment.md", "docs/README.md",
        "docs/README.en.md", "docs/changes/2026-10-25-goal-gap-assessment.md")
OUTPUT = ROOT / "docs/quality/2026-10-25-goal-gap-review-08.json"
ARCHIVE = ROOT / "docs/quality/history/goal-gap-review-08"


def read(file):
    return json.loads(file.read_text(encoding="utf-8-sig"))


def digest(file):
    return sha256(file.read_bytes()).hexdigest() if file.is_file() else None


def save(file, value):
    file.parent.mkdir(parents=True, exist_ok=True)
    with file.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def git(repo, *args):
    return subprocess.check_output(["git", "-c", "core.fsmonitor=false", "-c",
        "core.untrackedCache=false", *args], cwd=repo).decode("utf-8").strip()


def preserve(source, kind):
    saved_name = source.relative_to(ROOT).as_posix().replace("/", "__") + ".snapshot"
    target = ARCHIVE / ("before" if kind == "document" else "evidence") / saved_name
    data = source.read_bytes()
    target.parent.mkdir(parents=True, exist_ok=True)
    with target.open("xb") as stream:
        stream.write(data)
    return {"kind": kind, "source_path": source.relative_to(ROOT).as_posix(),
            "archive_path": target.relative_to(ROOT).as_posix(), "sha256": digest(target),
            "bytes": len(data)}


def capture_current(source, kind):
    target = ARCHIVE / ("visual" if kind == "visual" else "evidence") / source.name
    data = source.read_bytes()
    target.parent.mkdir(parents=True, exist_ok=True)
    if target.exists():
        assert target.read_bytes() == data, "Never overwrite retained current evidence."
    else:
        with target.open("xb") as stream:
            stream.write(data)
    return {"kind": kind, "source_path": source.relative_to(ROOT).as_posix(),
            "archive_path": target.relative_to(ROOT).as_posix(), "sha256": digest(target),
            "bytes": len(data)}


def prepare():
    assert not ARCHIVE.exists(), "Use another review number; never replace an archive."
    files = [preserve(ROOT / name, "document") for name in DOCS]
    for attempt in ("65", "66", "67"):
        for file in sorted((DELIVERY / "evidence").glob("desktop-local-ui-" + attempt + "*")):
            if file.is_file() and file.suffix in (".json", ".tap", ".mjs", ".ts"):
                files.append(preserve(file, "evidence"))
    previous = read(ROOT / "docs/quality/2026-10-25-goal-gap-review-07.json")
    save(ARCHIVE / "archive.json", {"at": datetime.now(timezone.utc).isoformat(),
        "files": files, "protected_inputs": previous["protected_inputs_unchanged"],
        "scope": "Exact review-7 document preimages and completed attempts 65-67; no original result rewritten."})
    print(json.dumps({"status": "preserved", "files": len(files)}))


def source_path(name):
    parts = Path(name.replace("\\", "/")).parts
    assert not Path(name).is_absolute() and ".." not in parts
    if parts[0] in ("dev", "docs"):
        return ROOT.joinpath(*parts)
    if parts[0].startswith("copypaste-"):
        return ROOT.joinpath("dev", *parts)
    assert parts[0] in COMPONENTS
    return ROOT.joinpath("dev", "copypaste-" + parts[0], *parts[1:])


def compare(sources):
    changes = [{"source_path": name, "expected_sha256": expected,
                "current_sha256": digest(source_path(name))}
               for name, expected in sources.items() if digest(source_path(name)) != expected]
    return {"selected": len(sources), "unchanged": len(sources) - len(changes), "changed": changes}


def evidence(attempt):
    file = DELIVERY / "evidence" / ("desktop-local-ui-" + attempt + ".json")
    report = read(file)
    linked = {}
    for key in ("raw_report", "verifier", "journey_verifier", "journey", "fixture_cleanup"):
        item = report.get(key)
        if item:
            original = DELIVERY / item["path"]
            assert digest(original) == item["sha256"], (attempt, key)
            linked[key] = {"path": original.relative_to(ROOT).as_posix(), "sha256": digest(original)}
    raw = (DELIVERY / report["raw_report"]["path"]).read_text(encoding="utf-8-sig")
    unit = {key: int(re.search(r"^# " + key + r" (\d+)\s*$", raw, re.M)[1])
            for key in ("tests", "pass", "fail", "cancelled", "skipped", "todo")}
    assert unit == {"tests": 91, "pass": 91, "fail": 0, "cancelled": 0, "skipped": 0, "todo": 0}
    journey = read(DELIVERY / report["journey"]["path"]) if report.get("journey") else None
    return {"report": file.relative_to(ROOT).as_posix(), "sha256": digest(file),
            "status": report["status"], "error": report["error"], "counts": report["counts"],
            "current_sources": compare(report["source_files"]), "linked_evidence": linked,
            "unit_counts": unit, "journey_errors": journey["errors"] if journey else None,
            "native_folder_work": journey.get("native_folder_work") if journey else None,
            "packaged": report["packaged"], "packaged_unchanged": report.get("packaged_unchanged"),
            "source_unchanged_during_run": report["source_unchanged"],
            "owned_database_shutdown": report["owned_database_shutdown"],
            "owned_preview_closed": report["owned_preview_closed"],
            "owned_journey_cleanup": {k: journey[k] for k in ("electron_closed", "browser_closed", "api_closed", "fixture_closed")} if journey else None}


def record():
    assert not OUTPUT.exists()
    archive = read(ARCHIVE / "archive.json")
    for item in archive["files"]:
        file = ROOT / item["archive_path"]
        assert digest(file) == item["sha256"] and file.stat().st_size == item["bytes"]
        if item["kind"] == "evidence":
            assert digest(ROOT / item["source_path"]) == item["sha256"]
    for name, expected in archive["protected_inputs"].items():
        assert digest(ROOT / name) == expected, name
    checkpoint = read(ROOT / "docs/quality/shared-project-checkpoint.json")
    historical = []
    for item in checkpoint["qualification_scopes"]:
        file = DELIVERY / item["report"]
        assert digest(file) == item["sha256"] and read(file)["status"] == "passed"
        historical.append({"scope": item["scope"], "report": file.relative_to(ROOT).as_posix(),
                           "sha256": digest(file), "current_sources": compare(read(file)["source_files"])})
    attempts = [evidence(n) for n in ("65", "66", "67", "68")]
    assert all(item["status"] == "failed" for item in attempts)
    assert not attempts[-1]["current_sources"]["changed"]
    latest = attempts[-1]
    assert latest["counts"] == {"journey_checks": 54, "errors": 1}
    assert "focused page Ctrl+Home must return to the first content" in latest["journey_errors"][0]
    folder = latest["native_folder_work"]
    assert folder["charged_micros"] == ["90", "60"] and folder["additional_cloud_tasks"] == 0
    assert folder["same_native_thread"] and folder["original_bytes_preserved"]
    assert folder["application_restart"]["old_owned_process_exited"]
    assert folder["application_restart"]["old_pid"] != folder["application_restart"]["new_pid"]
    assert len(folder["actual_tool_outputs"]) == 2 and all(v["actual_output"] for v in folder["actual_tool_outputs"])
    assert len(folder["answered_questions"]) == 1 and folder["answered_questions"][0]["original_preserved"]
    assert len(folder["recordings"]) == 2
    for recording in folder["recordings"]:
        assert recording["skipped_capture_errors"] == 0 and recording["distinct_frames"] > 1
        for item in recording["files"]:
            assert digest(ROOT / "dev" / item["path"]) == item["sha256"]
    assert latest["packaged_unchanged"] and latest["source_unchanged_during_run"]
    assert latest["packaged"]["repository_media_excluded"] and latest["packaged"]["runtime_assets_match_source"]
    assert latest["packaged"]["app_asar_bytes"] == 41486095
    assert latest["owned_database_shutdown"] and latest["owned_preview_closed"]
    assert all(latest["owned_journey_cleanup"].values())
    complete_journey = read(DELIVERY / "evidence/desktop-local-ui-68-journey.json")
    start = next(i for i, item in enumerate(complete_journey["checks"]) if item.startswith("Folder rules require"))
    end = next(i for i, item in enumerate(complete_journey["checks"]) if item.startswith("Revoking a folder rule"))
    folder_checks = complete_journey["checks"][start:end + 1]
    assert len(folder_checks) == 7
    current_files = [capture_current(file, "evidence")
        for file in sorted((DELIVERY / "evidence").glob("desktop-local-ui-68*"))
        if file.is_file() and file.suffix in (".json", ".tap", ".mjs", ".ts")]
    for size in ("800x600", "1440x980"):
        file = ROOT / "dev/copypaste-desktop/assets/screenshots" / ("workmate-folders-68-history-" + size + "-en.png")
        current_files.append(capture_current(file, "visual"))
    current_manifest = {"files": current_files, "scope": "Exact completed attempt 68 and two visually reviewed native screenshots; entire attempt remains failed."}
    current_manifest_path = ARCHIVE / "current-evidence.json"
    if current_manifest_path.exists():
        assert read(current_manifest_path) == current_manifest
    else:
        save(current_manifest_path, current_manifest)
    progress = read(ROOT / "docs/quality/requirements-alignment-progress.json")
    assert len(progress["requirements"]) == 102
    assert dict(Counter(r["assessment"] for r in progress["requirements"])) == progress["summary"] == {
        "partial_verified": 84, "completion_not_proven": 18}
    assert progress["fully_accepted_requirements"] == progress["qualified_live_roles"] == 0
    assert all(g["full_acceptance"] == "not_proven" for g in progress["gates"])
    text = (ROOT / DOCS[0]).read_text(encoding="utf-8-sig")
    assert re.findall(r"^\| (GAP-\d{2}) \|", text, re.M) == [f"GAP-{i:02}" for i in range(1, 27)]
    assert re.findall(r"^\| (REQ-\d{3}) \|", text, re.M) == [r["requirement_id"] for r in progress["requirements"]]
    links = 0
    for name in DOCS:
        file = ROOT / name
        for match in re.finditer(r"!?\[[^\]]*\]\((<[^>]+>|[^\s)]+)(?:\s+\"[^\"]*\")?\)", file.read_text(encoding="utf-8-sig")):
            target = match[1].strip("<>")
            if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", target) or target.startswith("#"):
                continue
            resolved = (file.parent / unquote(target.split("#", 1)[0])).resolve()
            assert resolved == OUTPUT or resolved.exists(), (name, target)
            links += 1
    repositories = []
    for component in ("docs", *COMPONENTS):
        repo = ROOT if component == "docs" else ROOT / "dev" / ("copypaste-" + component)
        entries = git(repo, "status", "--porcelain=v1", "--untracked-files=all").splitlines()
        repositories.append({"component": component, "branch": git(repo, "branch", "--show-current"),
            "input_head": git(repo, "rev-parse", "HEAD"), "worktree_entries": entries})
    remote = {}
    for line in git(ROOT, "ls-remote", "origin", *["refs/heads/" + n for n in
            ("main", "docs", "backend", "web", "admin", "desktop", "extension", "delivery")]).splitlines():
        commit, ref = line.split()
        remote[ref.rsplit("/", 1)[1]] = commit
    assert len(remote) == 8 and remote["main"] == remote["docs"]
    for item in repositories:
        name = item["component"]
        assert remote["backend" if name == "platform" else name] == item["input_head"]
        if name in ("platform", "web", "admin", "extension"):
            assert not item["worktree_entries"]
    save(OUTPUT, {"schema_version": "1.0", "at": datetime.now(timezone.utc).isoformat(),
        "scope": "Eighth review across all 26 gaps, preserving original requirements and distinguishing unpublished work from published stage 86.",
        "repositories_at_review": repositories, "actual_remote_heads_at_review": remote,
        "baseline_sources": compare(checkpoint["source_files"]), "historical_qualification_scopes": historical,
        "native_attempts": attempts, "archive": {"path": (ARCHIVE / "archive.json").relative_to(ROOT).as_posix(),
            "sha256": digest(ARCHIVE / "archive.json"), "exact_files": len(archive["files"])},
        "current_evidence": {"path": current_manifest_path.relative_to(ROOT).as_posix(),
            "sha256": digest(current_manifest_path), "exact_files": len(current_files)},
        "bounded_folder_checks": folder_checks,
        "visual_review": {"status": "issues_observed", "images": [item for item in current_files if item["kind"] == "visual"],
            "finding": "At 800x600 the left project-configuration summary wraps into an excessively narrow text column. No visible scrollbar rails or horizontal overflow does not establish acceptable visual readability."},
        "protected_inputs_unchanged": archive["protected_inputs"],
        "original_acceptance": {"requirements": 102, "cases": 102, **progress["summary"],
            "fully_accepted": 0, "candidate_roles": 18, "qualified_roles": 0, "G01_G10": "not_proven"},
        "documentation_checks": {"gap_groups": 26, "mapped_requirements": 102,
            "existing_scoped_local_links": links, "external_urls_and_anchors_checked": False,
            "all_historical_directory_links_checked": False},
        "assessed_document_sha256": {name: digest(ROOT / name) for name in DOCS},
        "execution": {"assessment_tool_runs_product_tests": False, "concurrent_goal_validation": "actual native Desktop attempt 68 completed failed; all owned resources closed",
            "virtualization_used": False}, "verifier_sha256": digest(Path(__file__))})
    print(json.dumps({"status": "recorded", "gaps": 26, "requirements": 102, "links": links,
                      "latest_native_status": attempts[-1]["status"]}))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepare", action="store_true")
    prepare() if parser.parse_args().prepare else record()
