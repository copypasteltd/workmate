import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { parseCompleteTap, requirePassingCounts } from "./platform-qualification-state.mjs";

const attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
assert.equal(process.argv.length, 3);
assert.equal(path.basename(process.cwd()), "copypaste-delivery-cloud-121");
const desktop = path.resolve("../copypaste-desktop-cloud-121");
const prefix = `.data/dedicated-cloud-121/desktop-${attempt}`;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
for (const suffix of [".json", "-verifier.mjs"]) await assert.rejects(readFile(prefix + suffix), e => e.code === "ENOENT");
const binary = path.resolve("../copypaste-desktop/.data/runtime/windows-x64/codex.exe");
const pin = JSON.parse(await readFile(path.join(desktop, "contracts/local-codex-runtime.json")));
assert.equal(sha(await readFile(binary)), pin.windows_x64_sha256);
const support = { path: "scripts/platform-qualification-state.mjs", sha256: sha(await readFile("scripts/platform-qualification-state.mjs")) };
async function snapshot() {
  const names = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src", "renderer", "renderer-source.json", "tests", "scripts", "contracts", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "deployment.json", ":(glob)assets/*.png", ":(glob)assets/*.ico", ":(glob)assets/*.cmd", "assets/browser-shell.html", "assets/browser-shell.css", "assets/browser-shell.js", "assets/licenses"], { cwd: desktop, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
  const result = {};
  for (const name of [...new Set(names)].sort()) result[name] = sha(await readFile(path.join(desktop, name)));
  return result;
}
const before = await snapshot();
const renderer = JSON.parse(await readFile(path.join(desktop, "renderer-source.json")));
assert.equal(renderer.native_desktop, true);
for (const [name, digest] of Object.entries(renderer.files)) assert.equal(before["renderer/" + name], digest, name);
for (const [name, digest] of Object.entries(before)) {
  const bytes = await readFile(path.join(desktop, name)); assert.equal(sha(bytes), digest);
  const dest = prefix + "-sources/" + name; await mkdir(path.dirname(dest), { recursive: true }); await writeFile(dest, bytes, { flag: "wx" });
}
const verifier = await readFile(import.meta.filename);
await writeFile(prefix + "-verifier.mjs", verifier, { flag: "wx" });
const tests = (await readdir(path.join(desktop, "tests"))).filter(name => name.endsWith(".test.ts")).sort().map(name => "tests/" + name);
assert.ok(tests.includes("tests/dedicated-cloud-boundary.test.ts"));
const checks = []; let error = null;
async function run(name, args, tap = false) {
  const child = spawn(process.execPath, args, { cwd: desktop, env: { ...process.env, COPYPASTE_LOCAL_CODEX_BIN: binary, COPYPASTE_LOCAL_CODEX_TEST_BIN: binary }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  const buffers = []; child.stdout.on("data", b => buffers.push(b)); child.stderr.on("data", b => buffers.push(b));
  const result = await new Promise(resolve => { child.once("close", (code, signal) => resolve({ exit_code: code, signal })); child.once("error", e => resolve({ exit_code: null, error: String(e) })); });
  const bytes = Buffer.concat(buffers), file = prefix + "-" + name + (tap ? ".tap" : ".log");
  await writeFile(file, bytes, { flag: "wx" });
  const row = { name, args, ...result, raw_report: { path: file, sha256: sha(bytes) } }; checks.push(row);
  assert.equal(result.exit_code, 0, name + ": " + bytes.toString().slice(-1200));
  if (tap) { row.counts = parseCompleteTap(bytes.toString()); requirePassingCounts(row.counts); }
  console.log(JSON.stringify(row.counts ? { name, ...row.counts } : { name, exit_code: result.exit_code }));
}
try {
  await run("types-main", ["node_modules/typescript/bin/tsc", "--noEmit"]);
  await run("types-renderer", ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "renderer/tsconfig.json"]);
  await run("program-guardian", ["scripts/build-program-host.mjs"]);
  await run("update-guardian", ["scripts/build-update-host.mjs"]);
  await run("native-host", ["scripts/build-native-host.mjs"]);
  await run("unit-tests", ["--import", "tsx", "--test", "--test-concurrency=1", ...tests], true);
  await run("native-codex", ["--import", "tsx", "--test", "--test-concurrency=1", "tests/integration/local-codex.native.test.ts"], true);
} catch (e) { error = String(e); }
const unchanged = JSON.stringify(before) === JSON.stringify(await snapshot());
const result = { at: new Date().toISOString(), status: !error && unchanged ? "passed" : "failed", error, scope: "Exact complete current Desktop unit-file inventory, original real native Codex integration, current main/renderer types and native host builds; cloud resource routes are denied at the authenticated Desktop renderer bridge", tests, checks, renderer_files_checked: Object.keys(renderer.files).length, native_codex: pin, source_files: before, source_unchanged: unchanged, verifier_sha256: sha(verifier), support, not_validated: ["Current actual Electron presentation (verified separately)", "Real customer/provider professional acceptance", "Signed production installer"] };
await writeFile(prefix + ".json", JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: result.status, error, tests: tests.length, source_unchanged: unchanged }));
assert.equal(result.status, "passed");
