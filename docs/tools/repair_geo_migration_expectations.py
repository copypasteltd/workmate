"""Retain a failed full run and update only historical migration test fixtures."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def read(file):
    return json.loads(file.read_text(encoding="utf-8"))


def main():
    output = ROOT / "docs/quality/geo-observation-migration-expectation-review.json"
    assert not output.exists()
    failure = DELIVERY / "evidence/desktop-execution-control-33-batch-08-attempt-01.json"
    failed = read(failure)
    assert failed["status"] == "failed" and failed["source_unchanged"] and failed["owned_database_shutdown"]
    assert "tests/creative-feedback.test.ts" in failed["files"] and failed["counts"]["fail"] == 1
    plan_file = DELIVERY / "evidence/desktop-execution-control-33-plan.json"
    plan = read(plan_file)
    known = {}
    for receipt in (ROOT / "docs/quality/history").glob("stage83-*/receipt.json"):
        for item in read(receipt).get("files", []):
            if "archive" in item and "sha256" in item:
                assert digest(ROOT / item["archive"]) == item["sha256"]
                known[item["sha256"]] = item["archive"]
    target = ROOT / "docs/quality/history/stage83-geo-migration-expectations"
    assert not target.exists()
    target.mkdir()
    rows = []
    for name, value in plan["source_files"].items():
        file = DEV / name
        assert digest(file) == value, name
        archive = known.get(value)
        if archive is None:
            saved = target / name
            saved.parent.mkdir(parents=True, exist_ok=True)
            saved.write_bytes(file.read_bytes())
            archive = saved.relative_to(ROOT).as_posix()
            known[value] = archive
        rows.append({"source": name, "sha256": value, "archive": archive})
    receipt_file = target / "receipt.json"
    receipt_file.write_text(json.dumps({"status": "archived_failed_full_run_sources", "plan": {"path": plan_file.relative_to(ROOT).as_posix(), "sha256": digest(plan_file)},
        "failed_batch": {"path": failure.relative_to(ROOT).as_posix(), "sha256": digest(failure)}, "files": rows}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    updates = []
    replacements = [("migrations.test.ts", b"\n      99,", b"\n      100,", 2, "latest_migration_expectation"),
        ("creative-feedback.test.ts", b'await runMigrations(client, "098 to confirmed creative feedback");', b'await runMigrations(client, "098 to confirmed creative feedback", { throughVersion: 99 });', 1, "historical_upgrade_fixture_bound")]
    for name, old_literal, new_literal, count, kind in replacements:
        file = DEV / "copypaste-platform/tests" / name
        before = file.read_bytes()
        assert before.count(old_literal) == count
        after = before.replace(old_literal, new_literal)
        old = next(row for row in rows if row["source"] == "copypaste-platform/tests/" + name)
        assert sha256(before).hexdigest() == old["sha256"]
        file.write_bytes(after)
        updates.append({"test_file": file.relative_to(ROOT).as_posix(), "before": old, "after_sha256": digest(file), "literal_changes": count, "kind": kind})
    result = {"at": datetime.now(timezone.utc).isoformat(), "status": "verified_test_fixture_updates_only", "test_updates": updates,
        "literal_changes": 3, "latest_expectation_changes": 2, "historical_fixture_bound_changes": 1,
        "product_source_changes": 0, "removed_or_weakened_assertions": 0, "reason": "Populated 041/047 upgrades require latest SQL100. The existing 098-to-099 fixture explicitly stops at its historical target. All original data, source OID, prepared-reader and replay assertions remain.",
        "failed_batch": {"path": failure.relative_to(ROOT).as_posix(), "sha256": digest(failure)},
        "source_archive": {"path": receipt_file.relative_to(ROOT).as_posix(), "sha256": digest(receipt_file)}, "verifier_sha256": digest(Path(__file__))}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": result["status"], "literal_changes": 3, "product_source_changes": 0}))


if __name__ == "__main__":
    main()
