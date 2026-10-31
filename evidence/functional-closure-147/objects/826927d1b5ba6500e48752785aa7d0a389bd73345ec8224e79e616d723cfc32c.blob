import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile, copyFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url)), runner = path.join(root, "scripts/run-current-tests-owned-v10.mjs");
async function fixture(t: any, files: Record<string, string>) {
  await mkdir(path.join(root, ".data"), { recursive: true });
  const parent = await realpath(path.join(root, ".data")), directory = await mkdtemp(path.join(parent, "test-discovery-141-"));
  t.after(async () => {
    assert.equal(path.dirname(directory), parent); assert.ok(path.basename(directory).startsWith("test-discovery-141-"));
    await rm(directory, { recursive: true, force: true });
  });
  await mkdir(path.join(directory, "tests")); await mkdir(path.join(directory, "scripts"));
  await copyFile(runner, path.join(directory, "scripts/current.mjs"));
  for (const [name, body] of Object.entries(files)) await writeFile(path.join(directory, "tests", name), body);
  await writeFile(path.join(directory, "scripts/run-tests-owned.mjs"), `import {readFile} from 'node:fs/promises';
for(const file of process.argv.slice(2)) new Function(await readFile(file,'utf8'))();
console.log(JSON.stringify({executed:process.argv.slice(2)}));process.exitCode=Number(process.env.DISCOVERY_FIXTURE_EXIT??0);\n`);
  return (args: string[] = [], extra: Record<string, string> = {}) => spawnSync(process.execPath, ["scripts/current.mjs", ...args], { cwd: directory, env: { ...process.env, ...extra }, windowsHide: true, encoding: "utf8" });
}
const obsolete = "throw new Error('An obsolete attempt must not execute');";
test("default execution selects numeric v12 and never executes retained v1 or v9", async t => {
  const run = await fixture(t, { "creative-140-v1.test.ts": obsolete, "creative-140-v9.test.ts": obsolete, "creative-140-v12.test.ts": "" });
  const result = run(); assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).executed, ["tests/creative-140-v12.test.ts"]);
});
test("distinct suites and ordinary tests remain active while the replaced desktop base stays historical", async t => {
  const run = await fixture(t, { "native-139-v1.test.ts": obsolete, "native-139-v8.test.ts": "", "creative-140-v6.test.ts": "", "billing.test.ts": "", "desktop-executions.test.ts": obsolete });
  const result = run(); assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).executed, ["tests/billing.test.ts", "tests/creative-140-v6.test.ts", "tests/native-139-v8.test.ts"]);
});
test("inspection lists historical attempts without executing any test", async t => {
  const run = await fixture(t, { "creative-140-v1.test.ts": obsolete, "creative-140-v6.test.ts": obsolete, "notes.txt": obsolete });
  const result = run(["--list"]); assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout), { current_test_files: ["tests/creative-140-v6.test.ts"], retained_historical: ["creative-140-v1.test.ts"] });
});
test("a current test runner failure remains a failing default command", async t => {
  const run = await fixture(t, { "current.test.ts": "" }); assert.equal(run([], { DISCOVERY_FIXTURE_EXIT: "7" }).status, 7);
});
test("unexpected selection arguments fail before executing a child", async t => {
  const run = await fixture(t, { "current.test.ts": obsolete });
  for (const args of [["--unknown"], ["--list", "extra"]]) { const result = run(args); assert.notEqual(result.status, 0); assert.equal(result.stdout, ""); }
});
test("the real npm test entry includes current creative/native suites and excludes their retained failed attempts", async () => {
  const pkg = JSON.parse(await readFile(path.join(root, "package.json"), "utf8")); assert.equal(pkg.scripts.test, "node --env-file=.env scripts/run-current-tests-owned-v10.mjs");
  const result = spawnSync(process.execPath, [runner, "--list"], { cwd: root, windowsHide: true, encoding: "utf8" }); assert.equal(result.status, 0, result.stderr);
  const list = JSON.parse(result.stdout);
  for (const file of ["creative-packages-140-v6.test.ts", "native-agent-groups-139-v8.test.ts", "desktop-executions-139-v2.test.ts", "current-test-discovery-141-v1.test.ts"])
    assert.ok(list.current_test_files.includes("tests/" + file));
  for (const file of ["creative-packages-140-v1.test.ts", "creative-packages-140-v2.test.ts", "creative-packages-140-v3.test.ts", "creative-packages-140-v4.test.ts", "creative-packages-140-v5.test.ts", "desktop-executions.test.ts"])
    assert.ok(!list.current_test_files.includes("tests/" + file) && list.retained_historical.includes(file));
});
