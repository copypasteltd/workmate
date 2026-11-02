import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import { Catalog } from "../src/catalog.js";
import { TaskBusinessTools } from "../src/task-business-tools.js";
import { desktopCompanyToolSchema } from "../src/desktop-tool-policy.js";
import { cloudToolDeclarations } from "../src/cloud-tool-contract.js";
import { apiCheckInput, databaseCheckInput } from "../src/cloud-development-checks.js";

test("every current cloud and desktop specialist has a serializable native tool schema", async () => {
  const catalog = new Catalog(); await catalog.load();
  const factory = new TaskBusinessTools({ config: { DATA_DIR: ".data/unused-schema-189" } } as any,
    catalog, {} as any, { authorize: async () => {}, inference: async () => {}, videoReady: true });
  let count = 0;
  for (const role of catalog.roles) for (const location of ["cloud", "desktop"]) {
    const tools = factory.build({ id: "00000000-0000-4000-8000-000000000001",
      tenant_id: "00000000-0000-4000-8000-000000000002", project_id: "00000000-0000-4000-8000-000000000003",
      execution_location: location, input_context: {}, mode: "execute" }, {} as any, "", role);
    for (const tool of tools) {
      const wire = desktopCompanyToolSchema(tool.inputSchema);
      assert.equal((wire as any).type, "object", role.role_key + ":" + tool.name);
      assert.doesNotMatch(JSON.stringify(wire), /"\$(?:ref|defs)"/);
      count++;
    }
  }
  assert.ok(catalog.roles.length >= 12 && count > 200);
});

test("recursive JSON expectations retain transport meaning and all other API fields", () => {
  const wire = desktopCompanyToolSchema(z.toJSONSchema(apiCheckInput)) as any;
  assert.deepEqual(wire.properties.requests.items.properties.expect.properties.json, {});
  assert.equal(wire.properties.requests.minItems, 1);
  assert.deepEqual(wire.properties.requests.items.properties.expect.required, ["status"]);
  assert.ok(apiCheckInput.safeParse({ entry: "index.mjs", requests: [{ name: "nested JSON", method: "GET", path: "/",
    expect: { status: 200, json: { nested: [{ count: 1, enabled: true }, null] } } }] }).success);
  assert.equal(apiCheckInput.safeParse({ entry: "index.mjs", requests: [{ name: "conflict", method: "GET", path: "/",
    expect: { status: 200, json: {}, text: "conflicting expectation" } }] }).success, false);
});

test("database expectations retain bounded rows and full business validation", () => {
  const wire = desktopCompanyToolSchema(z.toJSONSchema(databaseCheckInput)) as any;
  assert.deepEqual(wire.properties.checks.items.properties.expect.properties.rows.items.additionalProperties, {});
  assert.equal(databaseCheckInput.safeParse({ entry: "schema.sql", checks: [{ name: "bad value", sql: "SELECT 1",
    expect: { rows: [{ bad: Infinity }] } }] }).success, false);
});

test("arbitrary recursive definitions and external references are rejected", () => {
  for (const schema of [
    { type: "object", properties: { x: { $ref: "https://example.invalid/schema" } } },
    { type: "object", $defs: { node: { type: "object", required: ["secret"], properties: { next: { $ref: "#/$defs/node" } } } },
      properties: { x: { $ref: "#/$defs/node" } } },
    { type: "object", properties: { x: { $ref: "#/$defs/missing" } } },
  ]) assert.throws(() => desktopCompanyToolSchema(schema));
});

test("gateway compares received declarations exactly against the trusted projection", () => {
  const inputSchema = z.toJSONSchema(apiCheckInput), parameters = desktopCompanyToolSchema(inputSchema);
  const registered = [{ name: "api_test", description: "Actual guarded API tests", inputSchema }];
  const valid = { tools: [{ type: "function", name: "api_test", parameters }] };
  assert.doesNotThrow(() => cloudToolDeclarations(valid, ["api_test"], registered));
  const forged = structuredClone(valid) as any;
  forged.tools[0].parameters.properties.requests.minItems = 0;
  assert.throws(() => cloudToolDeclarations(forged, ["api_test"], registered));
  assert.throws(() => cloudToolDeclarations(valid, [], registered));
});
