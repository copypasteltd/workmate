import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [mode, attempt] = process.argv.slice(2);
assert.ok(["types", "unit", "native"].includes(mode));
assert.match(attempt ?? "", /^[0-9]{2}$/);
assert.equal(process.argv.length, 4);
const desktop = process.cwd(), backend = path.resolve("../copypaste-platform-publication-125");
const repositories = { desktop, backend };
const prefix = path.resolve(".data/startup-recovery-128/probe-" + attempt);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
await mkdir(path.dirname(prefix), { recursive: true });
for (const suffix of [".json", ".tap", "-verifier.mjs"])
  await assert.rejects(readFile(prefix + suffix), error => error.code === "ENOENT");
async function sources() {
  const result = {};
  for (const [label, cwd] of Object.entries(repositories)) {
    const names = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false",
      "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--",
      "src", "renderer", "tests", "scripts", "contracts", "catalog", "skills", "migrations",
      "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts"],
    { cwd, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
    result[label] = {};
    for (const name of [...new Set(names)].sort())
      result[label][name] = sha(await readFile(path.join(cwd, name)));
  }
  return result;
}
const fixtureRoot = mode === "native" ? ".data/native-local-tests" : ".data/controller-tests";
const fixtures = async () => (await readdir(fixtureRoot).catch(error => {
  if (error.code === "ENOENT") return []; throw error;
})).sort();
const before = await sources(), originalFixtures = await fixtures();
const pin = JSON.parse(await readFile("contracts/local-codex-runtime.json", "utf8"));
const binary = path.resolve("../copypaste-desktop/.data/runtime/windows-x64/codex.exe");
if (mode === "native") assert.equal(sha(await readFile(binary)), pin.windows_x64_sha256);
for (const [label, names] of Object.entries(before)) for (const [name, expected] of Object.entries(names)) {
  const bytes = await readFile(path.join(repositories[label], name));
  assert.equal(sha(bytes), expected);
  const target = path.resolve(prefix + "-sources", label, name);
  assert.ok(target.startsWith(prefix + "-sources" + path.sep));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" });
}
await writeFile(prefix + "-verifier.mjs", await readFile(import.meta.filename), { flag: "wx" });
const plans = [
  { repository: "backend", args: ["node_modules/typescript/bin/tsc", "--noEmit"] },
  { repository: "desktop", args: ["node_modules/typescript/bin/tsc", "--noEmit"] },
  { repository: "desktop", args: ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "renderer/tsconfig.json"] },
];
if (mode !== "types") plans.push({
  repository: "desktop",
  args: ["--import", "tsx", "--test", "--test-concurrency=1", ...(mode === "native"
    ? ["tests/integration/local-codex.native.test.ts"]
    : ["tests/local-agent.test.ts", "tests/local-workflow.test.ts", "tests/local-input.test.ts",
      "tests/local-geo.test.ts", "tests/local-schedule.test.ts", "tests/local-startup.test.ts"])],
});
const log = createWriteStream(prefix + ".tap", { flags: "wx" });
const commands = [], started = new Date().toISOString();
let failure;
try {
  for (const plan of plans) {
    if (plan.args[0] === "--import" && commands.some(row => row.code !== 0)) break;
    const child = spawn(process.execPath, plan.args, {
      cwd: repositories[plan.repository], windowsHide: true,
      env: { ...process.env, ...(mode === "native" ? { COPYPASTE_LOCAL_CODEX_TEST_BIN: binary } : {}) },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    const result = await new Promise((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code, signal) => resolve({ code, signal }));
    });
    commands.push({ ...plan, ...result });
  }
} catch (error) { failure = String(error); }
await new Promise(resolve => log.end(resolve));
const raw = await readFile(prefix + ".tap"), content = raw.toString();
const counts = mode === "types" ? null : Object.fromEntries(
  ["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key =>
    [key, Number(content.match(new RegExp("^# " + key + " (\\d+)\\r?$", "m"))?.[1] ?? -1)]),
);
const unchanged = JSON.stringify(before) === JSON.stringify(await sources());
const reclaimed = JSON.stringify(originalFixtures) === JSON.stringify(await fixtures());
const passed = !failure && commands.length === plans.length && commands.every(row => row.code === 0)
  && (mode === "types" || counts.tests > 0 && counts.pass === counts.tests
    && ["fail", "cancelled", "skipped", "todo"].every(key => counts[key] === 0))
  && unchanged && reclaimed;
const report = {
  started_at: started, finished_at: new Date().toISOString(), status: passed ? "passed" : "failed",
  mode, counts, failure, commands, source_files: before, source_unchanged: unchanged,
  fixture_root: fixtureRoot, original_fixtures: originalFixtures, final_fixtures: await fixtures(),
  original_fixture_set_restored: reclaimed, native_codex: mode === "native" ? pin : null,
  raw_report_sha256: sha(raw), verifier_sha256: sha(await readFile(import.meta.filename)),
  scope: "exact backend/Desktop source compilation; selected controller or pinned native startup recovery checks only; SQL/accounting and packaged UI require separate evidence",
};
await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: report.status, mode, counts, unchanged, reclaimed, failure }));
process.exitCode = passed ? 0 : 1;
