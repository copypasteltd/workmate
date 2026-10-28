import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { programNamespace, programToolDefinitions } from "../src/program-contract.js";
import { desktopToolDeclarations, desktopToolNames } from "../src/desktop-tool-policy.js";
const declaration = () => ({ type: "namespace", name: programNamespace, tools: programToolDefinitions.map(({ name, inputSchema }) => ({ type: "function", name, parameters: structuredClone(inputSchema) })) });
test("native approved-program namespace is accepted only with registered structured argv schemas", () => {
  assert.equal(desktopToolDeclarations([declaration()]), true);
  for (const tool of programToolDefinitions) assert.ok(desktopToolNames.includes(programNamespace + "." + tool.name));
  const altered = declaration(); (altered.tools[1].parameters.properties as any).executable = { type: "string" };
  assert.equal(desktopToolDeclarations([altered]), false);
  assert.equal(desktopToolDeclarations(declaration().tools), false);
  assert.equal(desktopToolDeclarations([declaration(), declaration()]), false);
  assert.equal(desktopToolDeclarations([{ ...declaration(), name: "functions" }]), false);
});
test("native approved-program registration cannot accept renamed, nested or duplicate tools", () => {
  assert.equal(desktopToolDeclarations([{ ...declaration(), tools: [{ ...declaration().tools[0], name: "shell" }] }]), false);
  assert.equal(desktopToolDeclarations([{ ...declaration(), tools: [declaration()] }]), false);
  assert.equal(desktopToolDeclarations([{ ...declaration(), tools: [declaration().tools[0], declaration().tools[0]] }]), false);
});
test("Desktop and company gateway keep byte-identical native approved-program contracts", async () => {
  assert.deepEqual(await readFile(new URL("../src/program-contract.ts", import.meta.url)), await readFile(new URL("../../copypaste-desktop/src/program-contract.ts", import.meta.url)));
});
