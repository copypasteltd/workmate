"""Preserve all exact qualification snapshots before refreshing route metadata."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"
TARGET = ROOT / "docs/quality/history/stage83-geo-inventory-gap"


def read(file):
    return json.loads(file.read_text(encoding="utf-8"))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    assert not TARGET.exists()
    known = {}
    for receipt in (ROOT / "docs/quality/history").glob("stage83-*/receipt.json"):
        for item in read(receipt).get("files", []):
            if "archive" in item and "sha256" in item:
                file = ROOT / item["archive"]
                assert digest(file) == item["sha256"]
                known[item["sha256"]] = item["archive"]
    selected = ["geo-observation-checks-06.json", "geo-observation-ui-04.json", "desktop-local-ui-47.json", "history-source-clients-07.json", "desktop-execution-control-32-plan.json"]
    sources, reports = {}, []
    for name in selected:
        file = DELIVERY / "evidence" / name
        report = read(file)
        if not name.endswith("-plan.json"):
            assert report["status"] == "passed" and report["source_unchanged"]
        for key, value in report["source_files"].items():
            if name.startswith("history-source"):
                component, relative = key.split("/", 1)
                source = DEV / ("copypaste-" + component) / relative
            else:
                source = ROOT / key if key.startswith(("docs/", "dev/")) else DEV / key
            assert digest(source) == value, (name, key)
            key = source.relative_to(ROOT).as_posix()
            assert key not in sources or sources[key] == value
            sources[key] = value
        reports.append({"path": file.relative_to(ROOT).as_posix(), "sha256": digest(file), "scope": "historical_exact_source_before_route_inventory_refresh"})
    failure = DELIVERY / "evidence/desktop-execution-control-32-batch-05-attempt-01.json"
    failed = read(failure)
    assert failed["status"] == "failed" and failed["source_unchanged"] and failed["owned_database_shutdown"]
    assert failed["counts"] == {"tests": 45, "pass": 44, "fail": 1, "cancelled": 0, "skipped": 0, "todo": 0}
    TARGET.mkdir()
    rows = []
    for name, value in sorted(sources.items()):
        archive = known.get(value)
        if archive is None:
            file = TARGET / name
            file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes((ROOT / name).read_bytes())
            archive = file.relative_to(ROOT).as_posix()
            known[value] = archive
        rows.append({"source": name, "archive": archive, "sha256": value})
    result = {"at": datetime.now(timezone.utc).isoformat(), "status": "archived_before_inventory_refresh", "reports": reports,
        "failed_batch": {"path": failure.relative_to(ROOT).as_posix(), "sha256": digest(failure)}, "files": rows,
        "reason": "Full backend batch 05 detected eleven real GEO operations missing from the complete generated route inventory. Earlier successful scopes remain historical; no failed receipt is relabelled.",
        "verifier_sha256": digest(Path(__file__))}
    (TARGET / "receipt.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": result["status"], "files": len(rows)}))


if __name__ == "__main__":
    main()
