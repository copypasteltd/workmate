import { test } from "node:test";
import assert from "node:assert/strict";
import {
  browserNamespace,
  browserToolDefinitions,
} from "../src/browser-contract.js";
import {
  desktopToolDeclarations,
  desktopToolNames,
  desktopCompanyToolSchema,
} from "../src/desktop-tool-policy.js";
import { readFile } from "node:fs/promises";
import { Catalog } from "../src/catalog.js";
import { TaskBusinessTools } from "../src/task-business-tools.js";
import { desktopRuntime } from "../src/desktop-runtime.js";
const declaration = () => ({
  type: "namespace",
  name: browserNamespace,
  tools: browserToolDefinitions.map(({ name, inputSchema }) => ({
    type: "function",
    name,
    parameters: structuredClone(inputSchema),
  })),
});
test("native browser namespace accepts only the complete registered wire schemas", () => {
  assert.equal(desktopToolDeclarations([declaration()]), true);
  for (const tool of browserToolDefinitions)
    assert.ok(desktopToolNames.includes(browserNamespace + "." + tool.name));
  const altered = declaration();
  altered.tools[0].parameters = {
    type: "object",
    properties: { override: { type: "string" } },
    required: [],
    additionalProperties: false,
  };
  assert.equal(desktopToolDeclarations([altered]), false);
});
test("native browser registrations cannot be flattened, renamed, nested or impersonated by another namespace", () => {
  const d = declaration();
  assert.equal(desktopToolDeclarations(d.tools), false);
  assert.equal(
    desktopToolDeclarations([{ ...d, name: "copypaste_browser_override" }]),
    false,
  );
  assert.equal(
    desktopToolDeclarations([
      { ...d, tools: [{ ...d.tools[0], name: "elevate" }] },
    ]),
    false,
  );
  assert.equal(desktopToolDeclarations([{ ...d, tools: [d] }]), false);
  assert.equal(desktopToolDeclarations([{ ...d, name: "copypaste" }]), false);
});
test("native browser duplicate declarations and schema annotations are denied before provider dispatch", () => {
  const d = declaration();
  assert.equal(desktopToolDeclarations([d, d]), false);
  const added = declaration();
  (added.tools[1].parameters as any).arbitrary_extension = true;
  assert.equal(desktopToolDeclarations([added]), false);
  assert.deepEqual(
    browserToolDefinitions.map((tool) =>
      desktopCompanyToolSchema(tool.inputSchema),
    ),
    browserToolDefinitions.map((tool) => tool.inputSchema),
  );
});

test("recorded native media declarations match trusted registration including minItems and size compaction", async () => {
  const fixture = JSON.parse(
    await readFile(
      "contracts/native-video-tool-wire-0.163.0-alpha.11.json",
      "utf8",
    ),
  );
  assert.equal(fixture.runtime_version, desktopRuntime.pinned_version);
  assert.equal(fixture.runtime_sha256, desktopRuntime.windows_x64_sha256);
  const catalog = new Catalog();
  await catalog.load();
  const role = [...catalog.roles, ...catalog.historicalRoles].find(
    (role) =>
      role.role_key === fixture.role_key &&
      role.version === fixture.role_version,
  );
  assert.ok(role);
  const factory = new TaskBusinessTools(
    { config: { DATA_DIR: ".data/unused-pure-schema-fixture" } } as any,
    catalog,
    {} as any,
    { authorize: async () => {}, inference: async () => {}, videoReady: true },
  );
  const tools = factory.build(
    {
      id: "00000000-0000-4000-8000-000000000001",
      tenant_id: "00000000-0000-4000-8000-000000000002",
      project_id: "00000000-0000-4000-8000-000000000003",
      execution_location: "desktop",
      input_context: {},
      mode: "execute",
    },
    {} as any,
    "",
    role,
  );
  const registered = tools.map((tool) => ({
    name: tool.name,
    inputSchema: desktopCompanyToolSchema(tool.inputSchema),
  }));
  assert.deepEqual(
    fixture.tools.map((tool: any) => tool.name),
    [
      "effect_render",
      "request_input",
      "video_project_edit",
      "video_project_queue",
    ],
  );
  const declaration = {
    type: "namespace",
    name: "copypaste",
    tools: fixture.tools.map((tool: any) => ({ type: "function", ...tool })),
  };
  assert.equal(desktopToolDeclarations([declaration], registered), true);
  // Caller declarations are compared as received. Removing a real constraint or
  // adding an annotation which projection would omit must still be rejected.
  const unconstrained = structuredClone(declaration);
  delete unconstrained.tools[1].parameters.properties.requests.minItems;
  assert.equal(desktopToolDeclarations([unconstrained], registered), false);
  const extra = structuredClone(declaration);
  extra.tools[0].parameters.properties.request.oneOf[0].properties.output.type =
    "object";
  assert.equal(desktopToolDeclarations([extra], registered), false);
  const injected = structuredClone(declaration);
  injected.tools[1].parameters.properties.requests.maxItems = 8;
  assert.equal(desktopToolDeclarations([injected], registered), false);
  assert.equal(
    desktopToolDeclarations([declaration, declaration], registered),
    false,
  );
  const source = tools.find((tool) => tool.name === "effect_render")!
    .inputSchema as any;
  assert.equal(
    source.properties.request.oneOf[0].properties.output.properties.seconds
      .maximum,
    12,
  );
  assert.ok(
    source.properties.request.oneOf[0].properties.sources.items.properties
      .sha256.pattern,
  );
});
