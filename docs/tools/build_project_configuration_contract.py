"""Export the additive shared-project contract; retain all existing contracts."""
from copy import deepcopy
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
from jsonschema import Draft202012Validator

ROOT = Path(__file__).resolve().parents[2]
UUID = {"type": "string", "format": "uuid"}
POSITIVE = {"type": "integer", "minimum": 1}
REVISION = {"type": "integer", "minimum": 0}
HASH = {"type": "string", "pattern": "^[a-f0-9]{64}$"}
TEXT = {"type": "string"}
TIME = {"type": "string", "format": "date-time"}
MONEY = {"type": "integer", "minimum": 1, "maximum": 1_000_000_000_000}


def obj(properties, required=None):
    return {"type": "object", "properties": properties, "required": list(properties) if required is None else required, "additionalProperties": False}


def arr(schema, maximum=None, unique=False):
    result = {"type": "array", "items": schema}
    if maximum is not None:
        result["maxItems"] = maximum
    if unique:
        result["uniqueItems"] = True
    return result


def nullable(schema):
    return {"anyOf": [schema, {"type": "null"}]}


def ref(name):
    return {"$ref": "#/components/schemas/" + name}


def build():
    exact = obj({"id": UUID, "version": POSITIVE})
    definition_fields = {
        "schema_version": {"const": 1}, "name": {"type": "string", "minLength": 1, "maxLength": 160},
        "instructions": {"type": "string", "maxLength": 8000, "default": ""},
        "delivery_requirements": {"type": "string", "maxLength": 4000, "default": ""},
        "default_agent": nullable(exact), "brand": nullable(exact),
        "asset_version_ids": arr(UUID, 20, True), "connection_ids": arr(UUID, 12, True), "max_task_budget_micros": nullable(MONEY),
    }
    skill = obj({"installation_id": UUID, "skill_version_id": UUID, "skill_key": TEXT, "package_version": TEXT, "content_hash": HASH})
    agent = obj({"id": UUID, "version": POSITIVE, "name": TEXT, "role_key": TEXT, "role_hash": HASH,
                 "instructions": TEXT, "tool_ids": arr(TEXT), "skills": arr(skill)})
    brand = obj({"id": UUID, "version": POSITIVE, "name": TEXT, "sha256": HASH})
    resource_fields = {"asset_version_id": UUID, "asset_id": UUID, "name": TEXT, "version": POSITIVE,
                       "mime_type": TEXT, "bytes": {"type": "string", "pattern": "^[0-9]+$"}}
    connection = obj({"id": UUID, "name": TEXT, "provider": TEXT, "auth_version": POSITIVE,
                      "account_ids": arr(TEXT), "configuration_hash": HASH})
    resolved = obj({"default_agent": nullable(agent), "brand": nullable(brand),
                    "resources": arr(obj({**resource_fields, "sha256": HASH}), 20), "connections": arr(connection, 12)})
    body = obj({**deepcopy(definition_fields), "resolved": resolved})
    publication = obj({"id": UUID, "version": POSITIVE, "sha256": HASH, "body": nullable(ref("Body")),
                       "available": {"type": "boolean"}, "created_at": TIME, "name": TEXT, "current_version": POSITIVE},
                      ["id", "version", "sha256", "body", "available"])
    version = obj({"version": POSITIVE, "sha256": HASH, "body": nullable(ref("Body")), "available": {"type": "boolean"}, "created_at": TIME})
    schemas = {
        "Definition": obj(definition_fields, ["schema_version", "name"]), "Body": body, "Publication": publication,
        "Current": obj({"published": nullable(ref("Publication"))}),
        "Draft": obj({"id": nullable(UUID), "revision": REVISION, "draft": nullable(ref("Definition")),
                      "current_version": nullable(POSITIVE), "content_state": {"enum": ["active", "quarantined", "deleted"]}},
                     ["id", "revision", "draft", "current_version"]),
        "Save": obj({"expected_revision": REVISION, "definition": ref("Definition")}),
        "Saved": obj({"id": UUID, "revision": POSITIVE, "current_version": nullable(POSITIVE)}),
        "PreviewRequest": obj({"expected_revision": POSITIVE, "draft_sha256": HASH}, ["expected_revision"]),
        "PublishRequest": obj({"expected_revision": POSITIVE, "draft_sha256": HASH}),
        "Preview": obj({"revision": POSITIVE, "draft_sha256": HASH, "proposed_version": POSITIVE, "body": ref("Body"),
                        "current": nullable(obj({"version": POSITIVE, "sha256": HASH, "body": nullable(ref("Body")), "available": {"type": "boolean"}}))}),
        "Published": obj({"id": UUID, "revision": POSITIVE, "current_version": POSITIVE, "sha256": HASH}),
        "History": obj({"items": arr(version, 50), "next_before": nullable(POSITIVE)}),
        "Options": obj({"agents": arr(obj({"id": UUID, "name": TEXT, "version": POSITIVE, "role_key": TEXT}), 200),
                        "brands": arr(obj({"id": UUID, "name": TEXT, "version": POSITIVE}), 200),
                        "resources": arr(obj(resource_fields), 100),
                        "connections": arr(obj({"id": UUID, "name": TEXT, "provider": TEXT, "account_count": POSITIVE}), 200),
                        "limit": {"const": 200}, "resources_limit": {"type": "integer", "minimum": 1, "maximum": 100}, "resources_next_after": nullable(UUID)}),
    }
    document = {"openapi": "3.1.0", "jsonSchemaDialect": "https://json-schema.org/draft/2020-12/schema",
                "info": {"title": "Workmate shared project configuration", "version": "1.0.0",
                         "description": "Draft/CAS, exact preview/publication, immutable history and server-pinned task guidance. Shared references grant no tools, local OS permission, credentials, account authorization or larger budget. Chat attachments remain private until separately published."},
                "paths": {}, "components": {"schemas": schemas, "securitySchemes": {
                    "customerSession": {"type": "apiKey", "in": "cookie", "name": "cp_session"},
                    "nativeBearer": {"type": "http", "scheme": "bearer"}}}}
    base = "/v1/tenants/{tenant}/projects/{project}/project-configuration"

    def operation(path, method, response, command=None, manage=False, query=None):
        parameters = [{"name": name, "in": "path", "required": True, "schema": UUID} for name in re.findall(r"\{([^}]+)\}", path)]
        parameters += [{"name": name, "in": "query", "required": False, "schema": schema} for name, schema in (query or {}).items()]
        if method in ["put", "post"]:
            if not path.endswith("/preview"):
                parameters.append({"name": "Idempotency-Key", "in": "header", "required": True, "schema": {"type": "string", "minLength": 16, "maxLength": 128}})
            parameters.append({"name": "X-CSRF-Token", "in": "header", "required": False, "schema": TEXT, "description": "Required with cookie-session writes; native Bearer requests use native authentication."})
        item = {"operationId": method + "".join(x.title() for x in re.findall(r"[a-z]+", path)), "parameters": parameters,
                "security": [{"customerSession": []}, {"nativeBearer": []}], "x-access": "project.manage" if manage else "project.read",
                "x-requirements": ["REQ-005", "REQ-061", "REQ-063", "REQ-065"],
                "responses": {"200": {"description": "Current authorized view; unavailable retained source bodies are hidden",
                                      "content": {"application/json": {"schema": ref(response)}}}}}
        for status in ["400", "401", "403", "404", "409", "410"]:
            item["responses"][status] = {"description": "Input, current authority, source availability, exact preview or immutable replay conflict"}
        if command:
            item["requestBody"] = {"required": True, "content": {"application/json": {"schema": ref(command)}}}
        document["paths"].setdefault(path, {})[method] = item

    operation(base, "get", "Current")
    operation(base + "/draft", "get", "Draft", manage=True)
    operation(base + "/draft", "put", "Saved", "Save", manage=True)
    operation(base + "/preview", "post", "Preview", "PreviewRequest", manage=True)
    operation(base + "/publish", "post", "Published", "PublishRequest", manage=True)
    operation(base + "/versions", "get", "History", query={"before": POSITIVE, "limit": {"type": "integer", "minimum": 1, "maximum": 50, "default": 20}})
    operation(base + "/options", "get", "Options", manage=True, query={"resource_query": {"type": "string", "maxLength": 160, "default": ""}, "resource_after": UUID, "resource_limit": {"type": "integer", "minimum": 1, "maximum": 100, "default": 50}})
    operation("/v1/tenants/{tenant}/projects/{project}/tasks/{task}/project-configuration", "get", "Current")
    return document


def main():
    folder = ROOT / "dev/copypaste-platform/contracts"
    before = {p.name: sha256(p.read_bytes()).hexdigest() for p in folder.glob("*.json") if p.name != "project-configuration-openapi.json"}
    document = build()
    assert sum(len(x) for x in document["paths"].values()) == 8
    for schema in document["components"]["schemas"].values():
        Draft202012Validator.check_schema(schema)
    raw = (json.dumps(document, ensure_ascii=False, indent=2) + "\n").encode("utf-8")
    (folder / "project-configuration-openapi.json").write_bytes(raw)
    for name, digest in before.items():
        assert sha256((folder / name).read_bytes()).hexdigest() == digest, name
    print(json.dumps({"at": datetime.now(timezone.utc).isoformat(), "operations": 8, "schema_count": len(document["components"]["schemas"]), "sha256": sha256(raw).hexdigest(), "existing_contracts_preserved": len(before)}))


if __name__ == "__main__":
    main()
