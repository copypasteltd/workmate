"""Bind a real PostgreSQL lock-race failure and its narrowly corrected rerun."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
DELIVERY = ROOT / "dev/copypaste-delivery"
NAME = "recovery rechecks a renewed task lease after the actual row-lock wait and preserves its confirmed unsubmitted audio"


def read(file):
    return json.loads(file.read_text(encoding="utf-8"))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    output = ROOT / "docs/quality/audio-authorizations-recovery-race.json"
    assert not output.exists()
    before_file = DELIVERY / "evidence/audio-production-checks-18.json"
    after_file = DELIVERY / "evidence/audio-production-checks-19.json"
    before, after = read(before_file), read(after_file)
    assert before["status"] == "failed" and before["counts"] == {"tests": 56, "pass": 55, "fail": 1, "cancelled": 0, "skipped": 0, "todo": 0}
    assert after["status"] == "passed" and after["counts"] == {"tests": 56, "pass": 56, "fail": 0, "cancelled": 0, "skipped": 0, "todo": 0}
    for report in [before, after]:
        assert report["source_unchanged"] and report["owned_database_shutdown"]
        for field in ["raw_report", "verifier"]:
            row = report[field]
            assert digest(DELIVERY / row["path"]) == row["sha256"]
    raw_before = (DELIVERY / before["raw_report"]["path"]).read_text(encoding="utf-8")
    raw_after = (DELIVERY / after["raw_report"]["path"]).read_text(encoding="utf-8")
    assert re.findall(r"^not ok \d+ - (.+)$", raw_before, re.M) == [NAME]
    assert re.search(r"^ok \d+ - " + re.escape(NAME) + "$", raw_after, re.M)
    assert "'cancelled'" in raw_before and "'confirmed'" in raw_before
    assert before["source_files"].keys() == after["source_files"].keys()
    changed = [name for name in before["source_files"] if before["source_files"][name] != after["source_files"][name]]
    assert changed == ["copypaste-platform/src/audio-authorizations.ts"]
    for name, value in after["source_files"].items():
        file = ROOT / name if name.startswith(("docs/", "dev/")) else ROOT / "dev" / name
        assert digest(file) == value, name
    baseline = read(ROOT / "docs/quality/history/stage85-before-recovery-race-fix/receipt.json")
    row = next(row for row in baseline["files"] if row["source"] == "dev/copypaste-platform/src/audio-authorizations.ts")
    assert digest(ROOT / row["archive"]) == row["sha256"] == before["source_files"][changed[0]]
    old = (ROOT / row["archive"]).read_text(encoding="utf-8")
    new = (ROOT / "dev" / changed[0]).read_text(encoding="utf-8")
    anchor = "          AND NOT EXISTS(SELECT 1 FROM ai_audio_jobs j WHERE j.authorization_id=$1 AND j.state IN('dispatched','completed','unknown'))"
    guard = """          AND (expires_at<=clock_timestamp() OR EXISTS(SELECT 1 FROM tasks t WHERE t.id=audio_authorizations.task_id
            AND (t.status<>'running' OR t.fencing_token IS DISTINCT FROM audio_authorizations.origin_fencing
              OR t.attempt<>audio_authorizations.origin_attempt OR t.lease_until<=clock_timestamp()
              OR t.cancel_requested OR t.content_state<>'active')))
"""
    assert old.count(anchor) == 1 and old.replace(anchor, guard + anchor) == new
    partial = []
    for attempt, expected in [("01", 42), ("02", 75)]:
        file = DELIVERY / f"evidence/desktop-execution-control-37-batch-{attempt}-attempt-01.json"
        report = read(file)
        assert report["status"] == "passed" and report["source_unchanged"] and report["owned_database_shutdown"]
        assert report["counts"]["tests"] == report["counts"]["pass"] == expected
        partial.append({"path": file.relative_to(ROOT).as_posix(), "sha256": digest(file), "historical_tests": expected})
    assert not (DELIVERY / "evidence/desktop-execution-control-37.json").exists()
    result = {"at": datetime.now(timezone.utc).isoformat(), "status": "verified_real_row_lock_renewal_race_fix",
        "failure": {"path": before_file.relative_to(ROOT).as_posix(), "sha256": digest(before_file), "counts": before["counts"]},
        "corrected": {"path": after_file.relative_to(ROOT).as_posix(), "sha256": digest(after_file), "counts": after["counts"]},
        "unchanged_test_source": {"path": "dev/copypaste-platform/tests/audio-production.test.ts", "sha256": after["source_files"]["copypaste-platform/tests/audio-production.test.ts"]},
        "only_product_source_changed": changed, "fix": "Recheck deadline and current origin under the acquired task row lock before cancelling. No authority, cost, reservation or delivery gate removed.",
        "reproduction": "Real concurrent renewal transaction holds the task lock. Recovery observes the committed expired lease, waits on that actual lock (observed via pg_blocking_pids), then reads the committed live renewal. The same test requires confirmed/prepared state and one successful original audio dispatch.",
        "historical_partial_qualification_37": partial,
        "partial_scope": "The owning loop was stopped without killing its active batch. Both completed batches shut down their owned DB and preserved exact source checks. No aggregate full pass exists or is claimed; a new complete current qualification is required.",
        "verifier_sha256": digest(Path(__file__))}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": result["status"], "only_changed_sources": 1, "tests_unchanged_between_failure_and_fix": True}))


if __name__ == "__main__":
    main()
