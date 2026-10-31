import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";
// Retained executed proofs use superseded protocol expectations. They remain
// byte-for-byte available to their original explicit qualification commands.
const historical = new Set(["delivery-revision-138-v1.test.ts", "delivery-revision-138-v2.test.ts", "native-agent-groups-139-v1.test.ts", "native-agent-groups-139-v2.test.ts", "desktop-executions.test.ts"]);
const names = (await readdir("tests")).filter(name => name.endsWith(".test.ts")).sort();
const files = names.filter(name => !historical.has(name)).map(name => "tests/" + name);
assert.ok(files.includes("tests/delivery-revision-138-v3.test.ts"));
assert.ok(files.includes("tests/native-agent-groups-139-v3.test.ts"));
if (process.argv[2] === "--list") {
  console.log(JSON.stringify({current_test_files: files, retained_historical: names.filter(name => historical.has(name))}));
} else {
  assert.equal(process.argv.length, 2, "Pass explicit historical attempts to run-tests-owned.mjs instead");
  const child = spawn(process.execPath, ["scripts/run-tests-owned.mjs", ...files], {stdio: "inherit", windowsHide: true, env: process.env});
  child.once("error", () => { process.exitCode = 1; });
  child.once("close", code => { process.exitCode = code ?? 1; });
}
