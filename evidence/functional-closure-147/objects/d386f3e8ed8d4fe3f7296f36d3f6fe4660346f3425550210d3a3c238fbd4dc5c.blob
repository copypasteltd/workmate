import assert from "node:assert/strict";
import { readdir } from "node:fs/promises";
import { spawn } from "node:child_process";

// This unversioned suite was replaced by desktop-executions-139-v2.
// Executed historical files stay byte-identical and remain explicitly runnable.
const supersededBase = new Set(["desktop-executions.test.ts"]);
const names = (await readdir("tests")).filter(n => n.endsWith(".test.ts")).sort();
const latest = new Map();
for (const name of names) {
  const match = /^(.+-\d+)-v([1-9]\d*)\.test\.ts$/.exec(name);
  if (!match) continue;
  const version = Number(match[2]);
  assert.ok(Number.isSafeInteger(version), "Test attempt version is too large");
  if (!latest.has(match[1]) || latest.get(match[1]).version < version)
    latest.set(match[1], { version, name });
}
const current = names.filter(name => {
  if (supersededBase.has(name)) return false;
  const match = /^(.+-\d+)-v([1-9]\d*)\.test\.ts$/.exec(name);
  return !match || latest.get(match[1]).name === name;
});
const selected = new Set(current), files = current.map(n => "tests/" + n);
if (process.argv[2] === "--list") {
  assert.equal(process.argv.length, 3, "Only --list is supported");
  console.log(JSON.stringify({ current_test_files: files, retained_historical: names.filter(n => !selected.has(n)) }));
} else {
  assert.equal(process.argv.length, 2, "Run explicit historical attempts through run-tests-owned.mjs");
  const child = spawn(process.execPath, ["scripts/run-tests-owned.mjs", ...files], { stdio: "inherit", windowsHide: true, env: process.env });
  child.once("error", () => { process.exitCode = 1; });
  child.once("close", code => { process.exitCode = code ?? 1; });
}
