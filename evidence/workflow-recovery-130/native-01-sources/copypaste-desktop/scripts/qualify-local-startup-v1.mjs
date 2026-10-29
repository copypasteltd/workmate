import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";

const [mode, attempt] = process.argv.slice(2);
assert.ok(["red", "green"].includes(mode));
assert.match(attempt ?? "", /^[0-9]{2}$/);
assert.equal(process.argv.length, 4);
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const prefix = path.resolve(".data/local-startup-127/probe-" + attempt);
await mkdir(path.dirname(prefix), { recursive: true });
for (const suffix of [".json", ".tap", "-verifier.mjs"])
  await assert.rejects(readFile(prefix + suffix), error => error.code === "ENOENT");
async function sources() {
  const names = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--",
    "src", "renderer", "tests", "scripts", "contracts", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts"], { encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
  const result = {};
  for (const name of [...new Set(names)].sort()) result[name] = sha(await readFile(name));
  return result;
}
const fixtures = async () => (await readdir(".data/controller-tests").catch(error => { if (error.code === "ENOENT") return []; throw error; })).sort();
const before = await sources(), originalFixtures = await fixtures();
for (const [name, expected] of Object.entries(before)) {
  const bytes = await readFile(name); assert.equal(sha(bytes), expected);
  const target = path.resolve(prefix + "-sources", name);
  assert.ok(target.startsWith(prefix + "-sources" + path.sep));
  await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: "wx" });
}
await writeFile(prefix + "-verifier.mjs", await readFile(import.meta.filename), { flag: "wx" });
const log = createWriteStream(prefix + ".tap", { flags: "wx" }), commands = [], started = new Date().toISOString();
let failure;
try {
  for (const args of [
    ["node_modules/typescript/bin/tsc", "--noEmit"],
    ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "renderer/tsconfig.json"],
    ["--import", "tsx", "--test", "--test-concurrency=1", ...(mode === "red" ? ["--test-name-pattern=spanning the initial company lease"] : []),
      "tests/local-agent.test.ts", ...(mode === "green" ? ["tests/local-workflow.test.ts", "tests/local-input.test.ts", "tests/local-geo.test.ts", "tests/local-schedule.test.ts"] : [])],
  ]) {
    const child = spawn(process.execPath, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    const result = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
    commands.push({ args, ...result });
    if (result.code !== 0) { assert.equal(args[0], "--import", "Compilation must pass before reproducing a runtime failure"); break; }
  }
} catch (error) { failure = String(error); }
await new Promise(resolve => log.end(resolve));
const raw = await readFile(prefix + ".tap"), text = raw.toString();
const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => [key, Number(text.match(new RegExp("^# " + key + " (\\d+)\\r?$", "m"))?.[1] ?? -1)]));
const unchanged = JSON.stringify(before) === JSON.stringify(await sources());
const reclaimed = JSON.stringify(originalFixtures) === JSON.stringify(await fixtures());
const reproduced = !failure && mode === "red" && commands.length === 3 && commands[2].code === 1 && counts.fail === 2 && counts.pass === 0 && counts.cancelled === 0
  && text.includes("Startup must keep checking company and local permission every ten seconds") && unchanged && reclaimed;
const passed = !failure && mode === "green" && commands.length === 3 && commands.every(row => row.code === 0) && counts.tests > 0 && counts.pass === counts.tests
  && ["fail", "cancelled", "skipped", "todo"].every(key => counts[key] === 0) && unchanged && reclaimed;
const report = { started_at: started, finished_at: new Date().toISOString(), status: passed ? "passed" : "failed", mode, counts, failure, commands,
  known_lease_gap_reproduced: reproduced, source_unchanged: unchanged, original_fixture_set_restored: reclaimed, source_files: before,
  raw_report_sha256: sha(raw), verifier_sha256: sha(await readFile(import.meta.filename)),
  scope: "controller mock-clock lease lifecycle, cancellation and workflow regression; actual native startup and packaged UI require separate evidence" };
await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: report.status, mode, counts, reproduced, unchanged, reclaimed, failure }));
process.exitCode = (mode === "red" ? reproduced : passed) ? 0 : 1;
