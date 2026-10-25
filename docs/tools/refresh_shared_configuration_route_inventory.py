"""Refresh descriptive routes from the retained actual configured/demo app check."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import sys

ROOT = Path(__file__).resolve().parents[2]


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def main():
    assert len(sys.argv) == 2 and re.fullmatch(r"\d{2}", sys.argv[1])
    attempt = sys.argv[1]
    output = ROOT / "docs/quality/shared-project-route-inventory.json"
    assert not output.exists(), "Preserve the first refresh receipt"
    report_path = ROOT / f"dev/copypaste-delivery/evidence/project-configuration-checks-{attempt}.json"
    report = json.loads(report_path.read_text(encoding="utf-8"))
    assert report["status"] == "passed" and report["phase"] == "core"
    assert report["source_unchanged"] and report["owned_database_shutdown"]
    assert report["counts"]["tests"] == report["counts"]["pass"] == 25
    assert all(report["counts"][key] == 0 for key in ["fail", "skipped", "cancelled", "todo"])
    for name, expected in report["source_files"].items():
        source = ROOT / ("dev/" + name if name.startswith("copypaste-") else name)
        assert digest(source) == expected, name
    log = ROOT / "dev/copypaste-delivery" / report["raw_report"]["path"]
    assert digest(log) == report["raw_report"]["sha256"]
    lines = re.findall(r"^# (?:# )?SHAREDCFG_ACTUAL_ROUTES (\{[^\r\n]+\})\s*$", log.read_text(encoding="utf-8"), re.M)
    assert len(lines) == 1, "Require one actual configured/demo route observation"
    observed = json.loads(lines[0])
    assert observed["data_mode"] == "configured_services" and observed["demo_mode"] is False
    platform = ROOT / "dev/copypaste-platform/contracts/implemented-routes.json"
    documentation = ROOT / "docs/contracts/implemented-routes.json"
    old_bytes = platform.read_bytes()
    assert old_bytes == documentation.read_bytes()
    old = json.loads(old_bytes)
    identity = lambda row: (row["method"], row["path"])
    prior = set(map(identity, old["routes"]))
    actual = set(map(identity, observed["routes"]))
    conditional = set(map(identity, observed["conditional_routes"]))
    assert len(actual) == len(observed["routes"]) == 487 and len(prior) == 479
    assert prior <= actual and not actual & conditional
    assert observed["conditional_routes"] == old["conditional_routes"]
    contract = json.loads((ROOT / "dev/copypaste-platform/contracts/project-configuration-openapi.json").read_text(encoding="utf-8"))
    required = {(method.upper(), re.sub(r"\{([^}]+)\}", r":\1", path))
                for path, methods in contract["paths"].items() for method in methods}
    assert actual - prior == required and len(required) == 8
    baseline_path = ROOT / "docs/quality/history/stage86-before-shared-configuration/receipt.json"
    baseline = json.loads(baseline_path.read_text(encoding="utf-8"))
    for name in [platform.relative_to(ROOT).as_posix(), documentation.relative_to(ROOT).as_posix()]:
        row = next(row for row in baseline["files"] if row["source"] == name)
        assert row["sha256"] == digest(ROOT / row["archive"]) == sha256(old_bytes).hexdigest()
    for name, expected in baseline["published_migrations"].items():
        assert digest(ROOT / "dev/copypaste-platform/migrations" / name) == expected
    for name, expected in baseline["published_contracts"].items():
        assert digest(ROOT / name) == expected
    source = report_path.relative_to(ROOT).as_posix()
    result = {"generated_at": datetime.now(timezone.utc).isoformat(), "contract": "actual_fastify_route_inventory",
              "not_full_design_openapi": True, "routes": sorted(observed["routes"], key=lambda row: (row["path"], row["method"])),
              "conditional_routes": observed["conditional_routes"], "additive_inventory_validation": {
                  "source": source, "sha256": digest(report_path),
                  "scope": "Actual configured-services and demo app registration before this descriptive refresh; 479 prior operations retained, eight shared-project operations added, and the one conditional demo-credit operation retained. Successful new HTTP bodies are separately checked against their additive contract; this is not complete design/API acceptance."}}
    raw = (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    platform.write_bytes(raw)
    documentation.write_bytes(raw)
    receipt = {"at": datetime.now(timezone.utc).isoformat(), "status": "refreshed_from_actual_configured_and_demo_apps",
               "configured_routes": len(actual), "conditional_routes": len(conditional),
               "old_sha256": sha256(old_bytes).hexdigest(), "new_sha256": sha256(raw).hexdigest(),
               "added_operations": [{"method": m, "path": p} for m, p in sorted(required)],
               "source": source, "source_sha256": digest(report_path), "baseline_receipt": baseline_path.relative_to(ROOT).as_posix(),
               "baseline_receipt_sha256": digest(baseline_path), "published_migrations_preserved": 102,
               "original_contracts_preserved": 4, "verifier_sha256": digest(Path(__file__))}
    output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({key: receipt[key] for key in ["status", "configured_routes", "conditional_routes"]}))


if __name__ == "__main__":
    main()
