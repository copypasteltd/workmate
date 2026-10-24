"""Refresh descriptive routes from an actual successful app, preserving old routes."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def read(file):
    return json.loads(file.read_text(encoding="utf-8"))


def main():
    output = ROOT / "docs/quality/geo-observation-inventory-repair.json"
    assert not output.exists()
    archive = ROOT / "docs/quality/history/stage83-geo-inventory-gap/receipt.json"
    saved = read(archive)
    assert saved["status"] == "archived_before_inventory_refresh"
    source = ROOT / "dev/copypaste-delivery/evidence/geo-observation-ui-04.json"
    report = read(source)
    assert report["status"] == "passed" and report["source_unchanged"]
    for name, value in report["source_files"].items():
        file = ROOT / name if name.startswith(("docs/", "dev/")) else ROOT / "dev" / name
        assert digest(file) == value, name
    platform = ROOT / "dev/copypaste-platform/contracts/implemented-routes.json"
    documentation = ROOT / "docs/contracts/implemented-routes.json"
    old = read(platform)
    assert platform.read_bytes() == documentation.read_bytes()
    old_sha = digest(platform)
    label = lambda row: (row["method"], row["path"])
    observed = report["journey"]["route_inventory"]
    actual = {label(row) for row in observed["routes"]}
    assert len(actual) == len(observed["routes"])
    conditional = {label(row) for row in old["conditional_routes"]}
    previous = {label(row) for row in old["routes"]} | conditional
    assert previous <= actual
    added = actual - previous
    assert len(added) == 11 and all("/geo/" in path for method, path in added)
    rows = [{"method": method, "path": path} for method, path in sorted(actual - conditional, key=lambda row: (row[1], row[0]))]
    assert len(rows) == 465 and len(conditional) == 1
    current = {"generated_at": datetime.now(timezone.utc).isoformat(), "contract": "actual_fastify_route_inventory", "not_full_design_openapi": True,
        "routes": rows, "additive_inventory_validation": {"source": source.relative_to(ROOT).as_posix(), "sha256": digest(source),
            "scope": "Actual unchanged routing code observed before this descriptive inventory refresh. The complete inventory is independently checked against the registered app in the new full backend qualification."},
        "conditional_routes": old["conditional_routes"]}
    raw = json.dumps(current, ensure_ascii=False, indent=2) + "\n"
    for file in [platform, documentation]:
        file.write_text(raw, encoding="utf-8", newline="\n")
    result = {"status": "refreshed_from_actual_app", "old_sha256": old_sha, "new_sha256": digest(platform), "configured_routes": len(rows), "conditional_routes": len(conditional),
        "actual_simulated_routes": len(actual), "previous_routes_preserved": len(previous), "added_geo_operations": [{"method": method, "path": path} for method, path in sorted(added)],
        "archive": {"path": archive.relative_to(ROOT).as_posix(), "sha256": digest(archive)}, "observed_report": {"path": source.relative_to(ROOT).as_posix(), "sha256": digest(source)},
        "original_openapi_replaced": False, "verifier_sha256": digest(Path(__file__))}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({key: result[key] for key in ["status", "configured_routes", "conditional_routes", "actual_simulated_routes"]}))


if __name__ == "__main__":
    main()
