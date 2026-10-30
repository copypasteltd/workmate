import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [mode, attempt] = process.argv.slice(2);
assert.ok(["baseline", "unit", "native", "types"].includes(mode));
assert.match(attempt ?? "", /^\d{2}$/); assert.equal(process.argv.length, 4);
const root = process.cwd(), prefix = path.resolve(".data/receipt-sync-131/probe-" + attempt);
const hash = value => createHash("sha256").update(value).digest("hex");
await mkdir(path.dirname(prefix), { recursive: true });
for (const suffix of [".json", ".tap", "-verifier.mjs"]) await assert.rejects(readFile(prefix + suffix), error => error.code === "ENOENT");
async function sources() {
  const names = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "ls-files",
    "--cached", "--others", "--exclude-standard", "-z", "--", "src", "renderer", "tests", "scripts", "contracts", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts"],
    { cwd: root, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
  const result = {}; for (const name of [...new Set(names)].sort()) result[name] = hash(await readFile(name)); return result;
}
const fixtures = async () => Object.fromEntries(await Promise.all([".data/controller-tests", ".data/native-local-tests"].map(async name =>
  [name, (await readdir(name).catch(error => { if (error.code === "ENOENT") return []; throw error; })).sort()])));
const before = await sources(), originalFixtures = await fixtures();
for (const [name, identity] of Object.entries(before)) {
  const bytes = await readFile(name); assert.equal(hash(bytes), identity);
  const target = path.join(prefix + "-sources", name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: "wx" });
}
await writeFile(prefix + "-verifier.mjs", await readFile(import.meta.filename), { flag: "wx" });
const binary = path.resolve("../copypaste-desktop/.data/runtime/windows-x64/codex.exe");
const pin = JSON.parse(await readFile("contracts/local-codex-runtime.json", "utf8"));
if (mode === "native") assert.equal(hash(await readFile(binary)), pin.windows_x64_sha256);
const plans = mode === "types" ? [
  ["node_modules/typescript/bin/tsc", "--noEmit"],
  ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "renderer/tsconfig.json"],
] : [["--import", "tsx", "--test", "--test-concurrency=1", ...(mode === "baseline"
  ? ["--test-name-pattern=^receipt synchronization flushes a saved child", "tests/local-receipt-sync.test.ts"]
  : mode === "native" ? ["tests/integration/local-codex.native.test.ts"]
  : ["tests/local-receipt-sync.test.ts", "tests/local-agent.test.ts", "tests/local-workflow.test.ts", "tests/local-input.test.ts", "tests/local-geo.test.ts", "tests/local-schedule.test.ts", "tests/local-startup.test.ts"])]];
const raw = createWriteStream(prefix + ".tap", { flags: "wx" }), commands = []; let error;
try {
  for (const args of plans) {
    const child = spawn(process.execPath, args, { cwd: root, env: { ...process.env, ...(mode === "native" ? { COPYPASTE_LOCAL_CODEX_TEST_BIN: binary } : {}) },
      windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(raw, { end: false }); child.stderr.pipe(raw, { end: false });
    const result = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
    commands.push({ args, ...result });
  }
} catch (failure) { error = String(failure); }
await new Promise(resolve => raw.end(resolve));
const bytes = await readFile(prefix + ".tap"), text = bytes.toString();
const counts = mode === "types" ? null : Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(name =>
  [name, Number(text.match(new RegExp("^# " + name + " (\\d+)\\r?$", "m"))?.[1] ?? -1)]));
const unchanged = JSON.stringify(before) === JSON.stringify(await sources()), finalFixtures = await fixtures();
const clean = JSON.stringify(originalFixtures) === JSON.stringify(finalFixtures);
const passed = !error && commands.length === plans.length && commands.every(row => row.code === 0) && unchanged && clean
  && (counts === null || counts.tests > 0 && counts.pass === counts.tests && ["fail", "cancelled", "skipped", "todo"].every(name => counts[name] === 0));
const report = { at: new Date().toISOString(), status: passed ? "passed" : "failed", mode, counts, commands, error,
  source_files: before, source_unchanged: unchanged, original_fixtures: originalFixtures, final_fixtures: finalFixtures, fixtures_restored: clean,
  raw_sha256: hash(bytes), verifier_sha256: hash(await readFile(import.meta.filename)), native_pin: mode === "native" ? pin : null,
  scope: "Exact Desktop sources; baseline reproducer, selected controller checks, actual pinned native checks or compilation only. Full workflow SQL and packaged journeys are separate." };
await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: report.status, mode, counts, source_unchanged: unchanged, fixtures_restored: clean, error }));
process.exitCode = passed ? 0 : 1;
