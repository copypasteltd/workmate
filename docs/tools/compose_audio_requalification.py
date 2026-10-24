"""Cover every test once; re-execute the package-count batch without rewriting failures."""
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import socket

from compose_geo_test_requalification import passing, snapshot, reference
from record_desktop_browser import bound, cases, batch_cases

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"
OLD = "evidence/desktop-execution-control-35"
NEW = "evidence/desktop-execution-control-36"
CHANGED = "copypaste-platform/tests/skill-lifecycle.test.ts"


def read(file):
    return json.loads(file.read_text(encoding="utf-8"))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    output, index_file = [DELIVERY / (NEW + suffix) for suffix in [".json", "-index.json"]]
    assert not output.exists() and not index_file.exists()
    review_file = ROOT / "docs/quality/audio-production-skill-expectation-review.json"
    review = read(review_file)
    assert review["status"] == "verified_additive_skill_revision_counts" and review["literal_changes"] == 2
    assert review["product_source_changes"] == review["removed_or_weakened_functional_assertions"] == 0
    assert review["verifier_sha256"] == digest(ROOT / "docs/tools/review_audio_skill_expectation.py")
    before = (ROOT / review["before"]["archive"]).read_bytes()
    assert sha256(before).hexdigest() == review["before"]["sha256"]
    assert digest(DEV / CHANGED) == review["after_sha256"]
    old_file, current_file = [DELIVERY / (prefix + "-plan.json") for prefix in [OLD, NEW]]
    old, current = read(old_file), read(current_file)
    assert old["files"] == current["files"] and old["batches"] == current["batches"]
    assert len(current["files"]) == 77 and len(current["batches"]) == 20
    assert current["files"] == sorted("tests/" + file.name for file in (DEV / "copypaste-platform/tests").glob("*.test.ts"))
    assert set(old["source_files"]) == set(current["source_files"])
    assert [name for name in current["source_files"] if old["source_files"][name] != current["source_files"][name]] == [CHANGED]
    assert old["source_files"][CHANGED] == review["before"]["sha256"]
    assert current["source_files"][CHANGED] == review["after_sha256"]
    assert snapshot() == current["source_files"]
    assert old["native_binary"] == current["native_binary"]
    assert digest(Path(current["native_binary"]["path"])) == current["native_binary"]["sha256"]
    for plan in [old, current]:
        assert digest(bound(plan["verifier"])) == digest(DELIVERY / "scripts/run-desktop-platform-resumable.mjs")
    imported = re.compile(r'''(?:from\s*|import\s*\(|require\s*\()\s*["'][^"']*skill-lifecycle\.test(?:[.\"'/])''')
    for name in current["source_files"]:
        if name != CHANGED and Path(name).suffix in [".ts", ".js", ".mjs"]:
            assert not imported.search((DEV / name).read_text(encoding="utf-8")), name
    failed_file = DELIVERY / (OLD + "-batch-17-attempt-01.json")
    failed = read(failed_file)
    assert failed["status"] == "failed" and failed["source_unchanged"] and failed["owned_database_shutdown"]
    assert failed["plan_sha256"] == digest(old_file) and failed["source_fingerprint"] == old["source_fingerprint"]
    assert failed["counts"] == {"tests": 22, "pass": 21, "fail": 1, "cancelled": 0, "skipped": 0, "todo": 0}
    raw = bound(failed["raw_report"]).read_text(encoding="utf-8")
    failures = re.findall(r"^not ok .+\r?$", raw, re.M)
    assert len(failures) == 1 and "preset installation and version bindings" in failures[0]
    assert "31 !== 30" in raw and "tests\\skill-lifecycle.test.ts:177:10" in raw
    markers = re.findall(r"^# owned_fixture_cleanup (.+)\r?$", raw, re.M)
    assert len(markers) == 1
    marker = json.loads(markers[0])
    assert marker["exit_code"] == 0
    cleanup_source = (DEV / "copypaste-platform" / marker["path"]).resolve()
    assert cleanup_source.is_relative_to(DEV / "copypaste-platform/.data/test-fixture-reclamation")
    assert cleanup_source.name == "result.json" and digest(cleanup_source) == marker["sha256"]
    cleanup = read(cleanup_source)
    assert cleanup["status"] == "passed" and cleanup["workers_exited"] and all(row["reclaimed"] for row in cleanup["results"])
    setup_file = DELIVERY / (NEW + "-setup-attempt-01.json")
    setup = passing(setup_file)
    assert setup["plan_sha256"] == digest(current_file) and setup["source_fingerprint"] == current["source_fingerprint"]
    assert setup["counts"]["tests"] == 6 and all(row["exit_code"] == 0 for row in setup["checks"])
    selected, scopes = [], []
    for batch in current["batches"]:
        fresh = int(batch["id"]) >= 17
        source_file = current_file if fresh else old_file
        plan = current if fresh else old
        file = DELIVERY / ((NEW if fresh else OLD) + "-batch-" + batch["id"] + "-attempt-01.json")
        row = passing(file)
        assert row["files"] == batch["files"] and row["batch"] == batch["id"]
        assert row["plan_sha256"] == digest(source_file) and row["source_fingerprint"] == plan["source_fingerprint"]
        assert row.get("fixture_cleanup")
        assert all(plan["source_files"]["copypaste-platform/" + name] == current["source_files"]["copypaste-platform/" + name] for name in batch["files"])
        if "tests/skill-lifecycle.test.ts" in batch["files"]:
            assert fresh and batch["id"] == "17"
        selected.append({**reference(file), "batch": batch["id"], "files": batch["files"], "counts": row["counts"]})
        scopes.append({"batch": batch["id"], "source_plan": reference(source_file), "current_runtime_and_executed_test_sources_exact": True,
            "unexecuted_test_fixture_differences": [] if fresh else [CHANGED]})
    covered = sum((cases(bound(read(bound(item))["raw_report"])) for item in selected), start=Counter())
    previous = batch_cases(read(bound(read(DELIVERY / "evidence/desktop-execution-control-34.json")["raw_report"])))
    assert sum(previous.values()) == 968 and not previous - covered
    totals = {key: sum(item["counts"][key] for item in selected) for key in ["tests", "pass", "fail", "cancelled", "skipped", "todo"]}
    assert totals["tests"] == totals["pass"] == sum(covered.values()) == 988
    assert all(totals[key] == 0 for key in ["fail", "cancelled", "skipped", "todo"])
    assert snapshot() == current["source_files"]
    with socket.socket() as connection:
        connection.settimeout(1)
        assert connection.connect_ex(("127.0.0.1", 55432)) != 0
    cleanup_copy = DELIVERY / (NEW + "-rejected-35-batch-17-fixture-cleanup.json")
    assert not cleanup_copy.exists()
    cleanup_copy.write_bytes(cleanup_source.read_bytes())
    index = {"plan": reference(current_file), "setup": reference(setup_file), "batches": selected, "qualification_scopes": scopes,
        "previous_plan": reference(old_file), "rejected_receipt": reference(failed_file), "rejected_fixture_cleanup": reference(cleanup_copy),
        "note": "Every current test file is covered exactly once. Earlier passing batches have identical runtime and executed test/helper bytes; only the unexecuted reviewed package-count test differs. Its entire four-file batch and all remaining batches execute afresh. The failed batch contributes no passing coverage; no receipt/TAP is rewritten."}
    index_file.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    result = {"at": datetime.now(timezone.utc).isoformat(), "status": "passed", "execution_strategy": "complete_file_inventory_with_reviewed_skill_expectation_update",
        "scope": index["note"], "counts": totals, "checks": setup["checks"], "source_files": current["source_files"], "source_unchanged": True,
        "source_fingerprint": current["source_fingerprint"], "owned_database_shutdown": True, "native_binary_exercised": True,
        "native_binary": current["native_binary"], "qualification_state_test_counts": setup["counts"], "verifier": current["verifier"],
        "raw_report": reference(index_file), "composition_verifier": {"path": Path(__file__).relative_to(ROOT).as_posix(), "sha256": digest(Path(__file__))},
        "composition_dependencies": [{"path": "docs/tools/" + name, "sha256": digest(ROOT / "docs/tools" / name)} for name in ["compose_geo_test_requalification.py", "record_desktop_browser.py"]],
        "test_expectation_review": {"path": review_file.relative_to(ROOT).as_posix(), "sha256": digest(review_file)}, "error": None,
        "not_validated": ["live_model_quality", "signed_installation", "all_professional_outputs", "original_complete_acceptance"]}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": "passed", "tests": 988, "files": 77, "batches": 20, "failed_receipt_relabelled": False}))


if __name__ == "__main__":
    main()
