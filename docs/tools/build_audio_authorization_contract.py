"""Add current audio consent shapes without changing any published contract."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
from jsonschema import Draft202012Validator
from build_audio_contract import build as original, obj, array, nullable, ref, uuid, timestamp, positive, money, digest, string

ROOT = Path(__file__).resolve().parents[2]
STATE = {"enum": ["pending", "confirmed", "declined", "withdrawn", "expired", "cancelled"]}


def build():
    document = original()
    document["info"] = {"title": "Workmate audio operations and independent customer confirmation", "version": "1.1.0",
        "description": "Current additive audio contract; published version 1.0.0 bytes are retained. Only an originating current customer session confirms exact operation/quote. No model or administrator signing. Unknown POST costs retain holds; voice quality and external evidence reconciliation are separate."}
    schemas = document["components"]["schemas"]
    rights = obj({"authorized": {"const": True}, "reference": {"type": "string", "minLength": 3, "maxLength": 300},
                  "purpose": {"type": "string", "minLength": 3, "maxLength": 1000}})
    source = obj({"asset_id": uuid, "version": positive})
    common = {"locale": {"enum": ["en", "zh-HK", "yue-HK"]}, "rights": rights}
    schemas["Proposal"] = {"oneOf": [
        obj({"kind": {"const": "speech"}, "text": {"type": "string", "minLength": 1, "maxLength": 4096},
             "voice": {"type": "string", "pattern": "^[a-zA-Z0-9_-]{1,80}$"}, "speed": {"type": "number", "minimum": .25, "maximum": 4}, **common}),
        obj({"kind": {"const": "transcription"}, "source": source, "timestamps": {"type": "boolean"}, **common})]}
    confirmation = obj({"confirm_authorized_use": {"const": True}, "rights_reference": {"type": "string", "minLength": 3, "maxLength": 300},
                        "purpose": {"type": "string", "minLength": 3, "maxLength": 1000}})
    schemas["Confirmation"] = {"oneOf": [obj({}), confirmation]}
    schemas["Decision"] = obj({"expected_revision": positive, "specification_hash": digest,
                               "quoted_micros": {"type": "string", "pattern": "^[1-9][0-9]{0,15}$"}})
    schemas["Confirm"] = obj({**schemas["Decision"]["properties"], **confirmation["properties"]})
    fields = {"id": uuid, "task_id": uuid, "state": STATE, "revision": positive, "specification_hash": digest,
              "capability_version_id": uuid, "model_alias": string, "data_mode": {"enum": ["simulated", "configured_services"]},
              "quoted_units": money, "rate_micros": money, "quoted_micros": money,
              "pricing_unit": {"enum": ["unicode_scalar", "input_millisecond"]}, "created_at": timestamp, "expires_at": timestamp,
              "confirmed_at": nullable(timestamp), "decision_reason": nullable(string), "confirmation_hash": nullable(digest),
              "proposal": ref("Proposal"), "confirmation": ref("Confirmation"),
              "source": nullable(obj({"asset_id": uuid, "version": positive, "sha256": digest, "duration_ms": positive}))}
    schemas["Authorization"] = obj(fields)
    schemas["AuthorizationList"] = obj({"items": array(ref("Authorization"), 100), "next_cursor": nullable(uuid)})
    admin = {key: value for key, value in fields.items() if key not in
             ["proposal", "confirmation", "source", "quoted_units", "rate_micros", "quoted_micros", "pricing_unit"]}
    admin.update({"tenant_id": uuid, "project_id": uuid, "actor_id": uuid, "decided_at": nullable(timestamp),
                  "cost": nullable(obj({"quoted_micros": money, "quoted_units": money, "rate_micros": money}))})
    schemas["AdminAuthorization"] = obj(admin)
    schemas["AdminAuthorizationList"] = obj({"items": array(ref("AdminAuthorization"), 100), "next_cursor": nullable(uuid)})
    event = obj({"state": STATE, "revision": positive, "actor_id": nullable(uuid), "created_at": timestamp,
                 "specification_hash": digest, "confirmation_hash": nullable(digest)})
    schemas["AdminAuthorizationBody"] = obj({"id": uuid, "proposal": ref("Proposal"), "specification_hash": digest,
        "confirmation": ref("Confirmation"), "confirmation_hash": nullable(digest), "confirmed_by": nullable(uuid),
        "confirmed_session_id": nullable(uuid), "confirmed_at": nullable(timestamp), "state": STATE, "revision": positive,
        "events": array(event)})
    basis = {"enum": ["independent_customer_session", "legacy_model_declaration"]}
    for name, extra in [("Job", {"authorization_id": nullable(uuid), "authorization_basis": basis}),
                        ("AdminJob", {"authorization_id": nullable(uuid)}),
                        ("AdminBody", {"authorization_basis": basis, "authorization": nullable(obj({
                            "id": uuid, "state": STATE, "revision": positive, "confirmed_by": nullable(uuid),
                            "confirmed_session_id": nullable(uuid), "confirmed_at": nullable(timestamp),
                            "confirmation": ref("Confirmation"), "confirmation_hash": nullable(digest), "expires_at": timestamp,
                            "decided_at": nullable(timestamp), "decision_reason": nullable(string)}))})]:
        schemas[name]["properties"].update(extra)
        schemas[name]["required"] += list(extra)
    base = "/v1/tenants/{tenant}/projects/{project}/audio-authorizations"
    pagination = {"task_id": uuid, "cursor": uuid, "limit": {**positive, "maximum": 100, "default": 25}}

    def operation(path, method, schema, command=None, admin=False, query=None):
        parameters = [{"name": key, "in": "path", "required": True, "schema": uuid}
                      for key in re.findall(r"\{([^}]+)\}", path)]
        parameters += [{"name": key, "in": "query", "required": False, "schema": value} for key, value in (query or {}).items()]
        if method == "post":
            parameters.append({"name": "Idempotency-Key", "in": "header", "required": True,
                               "schema": {"type": "string", "minLength": 16, "maxLength": 128}})
        item = {"operationId": method + "".join(word.title() for word in re.findall("[a-z]+", path)), "parameters": parameters,
                "security": [{"adminSession" if admin else "customerSession": []}],
                "responses": {"200": {"description": "Current authorized view; no stale confirmed replay after withdrawal",
                    "headers": {"Cache-Control": {"schema": {"const": "no-store"}, "description": "Private; never cache"}},
                    "content": {"application/json": {"schema": ref(schema)}}}},
                "x-requirements": ["REQ-021", "REQ-043", "REQ-046", "REQ-058"]}
        for code in ["400", "401", "403", "404", "409", "410"]:
            item["responses"][code] = {"description": "Invalid input, current authority, exact quote/version or retained-content conflict"}
        if command:
            item["requestBody"] = {"required": True, "content": {"application/json": {"schema": ref(command)}}}
        if admin:
            item["x-permission"] = ["admin.ai.requests.read"] + (["admin.content.body.read"] if path.endswith("/content") else [])
        document["paths"].setdefault(path, {})[method] = item

    operation(base, "get", "AuthorizationList", query=pagination)
    operation(base + "/{authorization}", "get", "Authorization")
    for action in ["confirm", "decline", "withdraw"]:
        operation(base + "/{authorization}/" + action, "post", "Authorization", "Confirm" if action == "confirm" else "Decision")
    operation("/v1/admin/ai/audio-authorizations", "get", "AdminAuthorizationList", admin=True,
              query={**pagination, "tenant_id": uuid, "project_id": uuid})
    operation("/v1/admin/ai/audio-authorizations/{authorization}/content", "get", "AdminAuthorizationBody", admin=True)
    for path, operations in document["paths"].items():
        if not path.startswith("/v1/admin/"):
            for item in operations.values():
                item["security"].append({"nativeBearer": []})
    return document


def main():
    baseline = json.loads((ROOT / "docs/quality/history/stage85-before-audio-controls/receipt.json").read_text(encoding="utf-8"))
    for file, expected in baseline["published_contracts"].items():
        assert sha256((ROOT / file).read_bytes()).hexdigest() == expected
    document = build()
    assert sum(len(operations) for operations in document["paths"].values()) == 14
    for schema in document["components"]["schemas"].values():
        Draft202012Validator.check_schema(schema)
    raw = (json.dumps(document, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    for file in ["docs/contracts/audio-authorizations-openapi.json", "dev/copypaste-platform/contracts/audio-authorizations-openapi.json"]:
        assert not (ROOT / file).exists()
        (ROOT / file).write_bytes(raw)
    inventory_file = ROOT / "dev/copypaste-platform/contracts/implemented-routes.json"
    inventory = json.loads(inventory_file.read_text(encoding="utf-8"))
    old_routes = {(row["method"], row["path"]) for row in inventory["routes"]}
    actual = set(old_routes)
    for path, operations in document["paths"].items():
        for method in operations:
            actual.add((method.upper(), re.sub(r"\{([^}]+)\}", r":\1", path)))
    assert len(actual - old_routes) == 7 and len(actual) == 479
    inventory["generated_at"] = datetime.now(timezone.utc).isoformat()
    inventory["routes"] = [{"method": method, "path": path} for method, path in sorted(actual, key=lambda row: (row[1], row[0]))]
    inventory.pop("additive_inventory_validation", None)
    inventory["candidate_extension"] = {"operations": 7, "source": "src/audio-production-routes.ts",
        "scope": "Retains all previously observed routes; new declarations require actual current-app validation in the stage 85 checkpoint."}
    raw_inventory = (json.dumps(inventory, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    for file in ["docs/contracts/implemented-routes.json", "dev/copypaste-platform/contracts/implemented-routes.json"]:
        (ROOT / file).write_bytes(raw_inventory)
    print(json.dumps({"status": "additive_customer_audio_contract_generated", "audio_operations": 14,
                      "all_declared_operations": len(actual), "published_contracts_preserved": True, "actual_http_validation": "pending"}))


if __name__ == "__main__":
    main()
