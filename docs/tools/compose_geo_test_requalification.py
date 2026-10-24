"""Qualify all actual test files, reusing only unchanged executable/test bytes.

The only permitted cross-plan changes are reviewed historical test fixtures.
Their whole batches must run again. Original receipts stay intact.
"""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import socket
import subprocess

from record_desktop_browser import bound, cases, batch_cases

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"
OLD = "evidence/desktop-execution-control-33"
NEW = "evidence/desktop-execution-control-34"


def read(file):
    return json.loads(file.read_text(encoding="utf-8"))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def reference(file):
    return {"path": file.relative_to(DELIVERY).as_posix(), "sha256": digest(file)}


def passing(file):
    row = read(file)
    assert row["status"] == "passed" and row["source_unchanged"], file.name
    assert row["owned_database_shutdown"] is (None if row["batch"] is None else True), file.name
    counts = row["counts"]
    assert counts["tests"] == counts["pass"] > 0 and all(counts[key] == 0 for key in ["fail", "cancelled", "skipped", "todo"])
    raw = bound(row["raw_report"]).read_text(encoding="utf-8")
    for key, value in counts.items():
        assert re.findall(r"^# " + key + r" (\d+)\r?$", raw, re.M) == [str(value)], (file.name, key)
    assert sum(cases(bound(row["raw_report"])).values()) == counts["tests"]
    if row.get("fixture_cleanup"):
        cleanup = read(bound(row["fixture_cleanup"]))
        assert cleanup["status"] == "passed" and all(item["reclaimed"] for item in cleanup["results"])
    return row


def snapshot():
    result = {}
    for component in ["platform", "desktop", "delivery"]:
        repo = DEV / ("copypaste-" + component)
        names = subprocess.check_output(["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--",
            "src", "renderer", "renderer-source.json", "vite.config.ts", "tests", "scripts", "migrations", "catalog", "contracts", "skills", "package.json", "package-lock.json", "tsconfig.json",
            "assets/browser-shell.html", "assets/browser-shell.css", "assets/browser-shell.js"], cwd=repo).decode("utf-8").split("\0")
        for name in sorted(set(filter(None, names))):
            result[repo.name + "/" + name] = digest(repo / name)
    return result


def main():
    output = DELIVERY / (NEW + ".json")
    index_file = DELIVERY / (NEW + "-index.json")
    assert not output.exists() and not index_file.exists()
    review_file = ROOT / "docs/quality/geo-observation-migration-expectation-review.json"
    review = read(review_file)
    assert review["status"] == "verified_test_fixture_updates_only" and review["literal_changes"] == 3
    assert review["product_source_changes"] == review["removed_or_weakened_assertions"] == 0
    changes = {item["test_file"].removeprefix("dev/"): item for item in review["test_updates"]}
    assert set(changes) == {"copypaste-platform/tests/migrations.test.ts", "copypaste-platform/tests/creative-feedback.test.ts"}
    replacements = {"migrations.test.ts": (b"\n      99,", b"\n      100,", 2),
        "creative-feedback.test.ts": (b'await runMigrations(client, "098 to confirmed creative feedback");', b'await runMigrations(client, "098 to confirmed creative feedback", { throughVersion: 99 });', 1)}
    for name, item in changes.items():
        before = (ROOT / item["before"]["archive"]).read_bytes()
        old_literal, new_literal, count = replacements[Path(name).name]
        assert before.count(old_literal) == count and (DEV / name).read_bytes() == before.replace(old_literal, new_literal)
    old_file, new_file = [DELIVERY / (prefix + "-plan.json") for prefix in [OLD, NEW]]
    old, current = read(old_file), read(new_file)
    assert old["files"] == current["files"] and old["batches"] == current["batches"]
    assert current["files"] == sorted("tests/" + file.name for file in (DEV / "copypaste-platform/tests").glob("*.test.ts"))
    assert len(current["files"]) == 76 and len(current["batches"]) == 19
    assert set(old["source_files"]) == set(current["source_files"])
    differences = [name for name in current["source_files"] if old["source_files"][name] != current["source_files"][name]]
    assert set(differences) == set(changes)
    for name, item in changes.items():
        assert old["source_files"][name] == item["before"]["sha256"] and current["source_files"][name] == item["after_sha256"]
    assert snapshot() == current["source_files"]
    assert old["native_binary"] == current["native_binary"]
    assert digest(Path(current["native_binary"]["path"])) == current["native_binary"]["sha256"]
    assert digest(bound(current["verifier"])) == digest(DELIVERY / "scripts/run-desktop-platform-resumable.mjs")
    # The changed test is an explicit Node test entry, never an imported helper.
    imported = re.compile(r'''(?:from\s*|import\s*\(|require\s*\()\s*["'][^"']*(?:migrations|creative-feedback)\.test(?:[.\"'/])''')
    for name in current["source_files"]:
        if name not in changes and Path(name).suffix in [".ts", ".js", ".mjs"]:
            assert not imported.search((DEV / name).read_text(encoding="utf-8")), name
    setup_file = DELIVERY / (NEW + "-setup-attempt-01.json")
    setup = passing(setup_file)
    assert setup["plan_sha256"] == digest(new_file) and all(item["exit_code"] == 0 for item in setup["checks"])
    selected, scopes = [], []
    for batch in current["batches"]:
        changed_batch = any("copypaste-platform/" + name in changes for name in batch["files"])
        fresh = DELIVERY / (NEW + "-batch-" + batch["id"] + "-attempt-01.json")
        historical = DELIVERY / (OLD + "-batch-" + batch["id"] + "-attempt-01.json")
        file = fresh if fresh.exists() else historical
        assert not changed_batch or file == fresh, "The changed test's complete batch must run again"
        row = passing(file)
        expected_plan = new_file if file == fresh else old_file
        expected_source = current if file == fresh else old
        assert row["plan_sha256"] == digest(expected_plan) and row["source_fingerprint"] == expected_source["source_fingerprint"]
        assert row["files"] == batch["files"] and row["batch"] == batch["id"]
        for name in batch["files"]:
            assert expected_source["source_files"]["copypaste-platform/" + name] == current["source_files"]["copypaste-platform/" + name]
        assert row.get("fixture_cleanup"), file.name
        selected.append({**reference(file), "batch": batch["id"], "files": batch["files"], "counts": row["counts"]})
        scopes.append({"batch": batch["id"], "source_plan": reference(expected_plan), "current_runtime_and_executed_test_sources_exact": True,
            "unexecuted_test_fixture_differences": sorted(changes) if file == historical else []})
    assert [item["batch"] for item in scopes if item["unexecuted_test_fixture_differences"]] == [str(value).zfill(2) for value in range(1, 8)]
    index = {"plan": reference(new_file), "setup": reference(setup_file), "batches": selected, "qualification_scopes": scopes,
        "previous_plan": reference(old_file), "note": "Every actual test file is covered exactly once. Earlier batches use identical runtime and executed test/helper bytes. Only the separately reviewed historical migration test fixtures differ; both affected whole batches execute afresh. Original TAP files/receipts remain separate and immutable."}
    from collections import Counter
    covered = Counter()
    for item in selected:
        covered += cases(bound(read(bound(item))["raw_report"]))
    previous = batch_cases(read(bound(read(DELIVERY / "evidence/desktop-execution-control-31.json")["raw_report"])))
    assert sum(previous.values()) == 946 and not previous - covered
    counts = {key: sum(item["counts"][key] for item in selected) for key in ["tests", "pass", "fail", "cancelled", "skipped", "todo"]}
    assert counts["tests"] == counts["pass"] == sum(covered.values()) == 968
    assert all(counts[key] == 0 for key in ["fail", "cancelled", "skipped", "todo"])
    assert snapshot() == current["source_files"]
    with socket.socket() as connection:
        connection.settimeout(1)
        assert connection.connect_ex(("127.0.0.1", 55432)) != 0, "Owned database must be closed"
    result = {"at": datetime.now(timezone.utc).isoformat(), "status": "passed", "execution_strategy": "complete_file_inventory_with_reviewed_test_expectation_update",
        "scope": "All current platform runtime and actual test-file bytes, with the whole changed migration-test batch freshly executed; no failed receipt is relabelled.",
        "counts": counts, "checks": setup["checks"], "source_files": current["source_files"], "source_unchanged": True,
        "source_fingerprint": current["source_fingerprint"], "owned_database_shutdown": True, "native_binary_exercised": True, "native_binary": current["native_binary"],
        "qualification_state_test_counts": setup["counts"], "verifier": current["verifier"], "raw_report": {"path": NEW + "-index.json", "sha256": None},
        "composition_verifier": {"path": Path(__file__).relative_to(ROOT).as_posix(), "sha256": digest(Path(__file__))},
        "test_expectation_review": {"path": review_file.relative_to(ROOT).as_posix(), "sha256": digest(review_file)}, "error": None,
        "not_validated": ["live_model_and_image_quality", "signed_installer", "all_professional_outcomes", "complete_original_acceptance"]}
    index_file.write_text(json.dumps(index, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    result["raw_report"]["sha256"] = digest(index_file)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": result["status"], "tests": counts["tests"], "files": len(current["files"]), "batches": len(selected), "old_receipts_rewritten": False}))


if __name__ == "__main__":
    main()
