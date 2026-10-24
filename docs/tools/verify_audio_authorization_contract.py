"""Validate new audio contract with actual current authenticated UI exchanges."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import sys
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[2]


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    attempt = sys.argv[1]
    assert re.fullmatch(r"\d{2}", attempt) and len(sys.argv) == 2
    file = ROOT / f"dev/copypaste-delivery/evidence/audio-production-ui-{attempt}.json"
    report = json.loads(file.read_text(encoding="utf-8"))
    assert report["status"] == "passed" and report["source_unchanged"] and report["compiled_unchanged"]
    journey = report["journey"]
    assert journey["status"] == "passed" and journey["browser_closed"] and journey["api_closed"] and journey["fixture_closed"] and journey["provider_closed"]
    contract_file = ROOT / "docs/contracts/audio-authorizations-openapi.json"
    assert contract_file.read_bytes() == (ROOT / "dev/copypaste-platform/contracts/audio-authorizations-openapi.json").read_bytes()
    contract = json.loads(contract_file.read_text(encoding="utf-8"))
    meta = json.loads((ROOT / "docs/contracts/vendor/openapi-3.1-meta.schema.json").read_text(encoding="utf-8"))
    Draft202012Validator(meta).validate(contract)
    for schema in contract["components"]["schemas"].values():
        Draft202012Validator.check_schema(schema)
    samples = journey["response_samples"]
    roots = {sample["schema"] for sample in samples}
    assert roots >= {"Job", "JobList", "Preview", "AdminJobList", "AdminBody", "Authorization", "AuthorizationList",
                     "AdminAuthorizationList", "AdminAuthorizationBody"}
    matched, commands = set(), 0
    for sample in samples:
        Draft202012Validator({"$ref": "#/components/schemas/" + sample["schema"], "components": contract["components"]},
                            format_checker=FormatChecker()).validate(sample["body"])
        candidates = [(route, methods[sample["method"].lower()]) for route, methods in contract["paths"].items()
                      if sample["method"].lower() in methods and
                      re.fullmatch(re.sub(r"\{[^}]+\}", "[^/]+", route), sample["path"])]
        assert len(candidates) == 1, sample["path"]
        route, operation = candidates[0]
        matched.add((sample["method"], route))
        if "requestBody" in operation:
            schema = operation["requestBody"]["content"]["application/json"]["schema"]
            Draft202012Validator({**schema, "components": contract["components"]}, format_checker=FormatChecker()).validate(sample["request_body"])
            commands += 1
    assert commands >= 3
    actual = {(row["method"], row["path"]) for row in journey["route_inventory"]["routes"]}
    expected = {(method.upper(), re.sub(r"\{([^}]+)\}", r":\1", route)) for route, methods in contract["paths"].items() for method in methods}
    assert len(expected) == 14 and expected <= actual
    inventory_file = ROOT / "docs/contracts/implemented-routes.json"
    assert inventory_file.read_bytes() == (ROOT / "dev/copypaste-platform/contracts/implemented-routes.json").read_bytes()
    inventory = json.loads(inventory_file.read_text(encoding="utf-8"))
    assert {(row["method"], row["path"]) for row in inventory["routes"]} == actual
    assert len(actual) == 479
    baseline = json.loads((ROOT / "docs/quality/history/stage85-before-audio-controls/receipt.json").read_text(encoding="utf-8"))
    for name, expected_hash in baseline["published_contracts"].items():
        assert digest(ROOT / name) == expected_hash
    for name, expected_hash in baseline["published_migrations"].items():
        assert digest(ROOT / "dev/copypaste-platform/migrations" / name) == expected_hash
    output = ROOT / f"docs/quality/audio-authorizations-contract-{attempt}.json"
    assert not output.exists()
    result = {"at": datetime.now(timezone.utc).isoformat(), "status": "passed_current_audio_authorization_http",
        "source": file.relative_to(ROOT).as_posix(), "source_sha256": digest(file), "contract_sha256": digest(contract_file),
        "validated_samples": len(samples), "validated_customer_commands": commands, "schema_roots": sorted(roots),
        "observed_audio_operations": len(matched), "declared_audio_operations": 14, "complete_actual_route_inventory": 479,
        "published_contracts_preserved": 4, "published_sql_preserved": 101, "verifier_sha256": digest(Path(__file__)),
        "scope": "Actual authenticated current UI HTTP exchanges and complete configured-app route inventory. Synthetic company services; not live voice quality or full professional acceptance."}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({key: result[key] for key in ["status", "validated_samples", "validated_customer_commands", "complete_actual_route_inventory"]}))


if __name__ == "__main__":
    main()
