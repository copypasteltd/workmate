// Preserve a real native reproduction and its later bounded recovery qualification.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const [mode, attempt] = process.argv.slice(2);
assert.ok(["red", "green"].includes(mode));
assert.match(attempt ?? "", /^[0-9]{2}$/);
assert.equal(process.argv.length, 4);
const hash = body => createHash("sha256").update(body).digest("hex");
const directory = path.resolve(".data/pre-turn-startup-126"), prefix = path.join(directory, "probe-" + attempt);
await mkdir(directory, { recursive: true });
for (const suffix of [".json", ".tap", "-verifier.mjs"])
  await assert.rejects(readFile(prefix + suffix), error => error.code === "ENOENT");
const fixtureRoot = path.resolve(".data/test/runtime-startup");
const fixtures = async () => (await readdir(fixtureRoot).catch(error => {
  if (error.code === "ENOENT") return []; throw error;
})).sort();
async function sources() {
  const files = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false",
    "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src", "tests", "scripts",
    "catalog", "migrations", "skills", "contracts", "assets/fonts", "package.json", "package-lock.json", "tsconfig.json"],
    { encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
  const result = {};
  for (const file of [...new Set(files)].sort()) result[file] = hash(await readFile(file));
  return result;
}
const before = await sources(), originalFixtures = await fixtures();
for (const [name, expected] of Object.entries(before)) {
  const output = path.resolve(prefix + "-sources", name);
  assert.ok(output.startsWith(prefix + "-sources" + path.sep));
  const body = await readFile(name); assert.equal(hash(body), expected);
  await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, body, { flag: "wx" });
}
await writeFile(prefix + "-verifier.mjs", await readFile(import.meta.filename), { flag: "wx" });
const pin = JSON.parse(await readFile("../copypaste-desktop/contracts/local-codex-runtime.json", "utf8"));
const binary = path.resolve("../copypaste-desktop/.data/runtime/windows-x64/codex.exe");
assert.equal(hash(await readFile(binary)), pin.windows_x64_sha256);
const stream = createWriteStream(prefix + ".tap", { flags: "wx" });
async function run(args) {
  const child = spawn(process.execPath, args, { cwd: process.cwd(), windowsHide: true,
    env: { ...process.env, CODEX_BIN: binary, CODEX_VERSION: pin.runtime_version }, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(stream, { end: false }); child.stderr.pipe(stream, { end: false });
  return new Promise(resolve => { child.once("close", code => resolve(code ?? 1)); child.once("error", () => resolve(1)); });
}
let compile = null, exit = null;
try {
  compile = await run(["node_modules/typescript/bin/tsc", "--noEmit"]);
  if (compile === 0) exit = await run(["--env-file=.env", "--import", "tsx", "--test", "--test-concurrency=1",
    ...(mode === "red" ? ["--test-name-pattern=^thread/start connection:"] : []), "tests/runtime-pre-turn.test.ts", "tests/native-fault-ownership.test.ts"]);
} finally {
  await new Promise(resolve => stream.end(resolve));
  const raw = await readFile(prefix + ".tap"), text = raw.toString();
  const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key =>
    [key, Number(text.match(new RegExp("^# " + key + " (\\d+)\\r?$", "m"))?.[1] ?? -1)]));
  const unchanged = JSON.stringify(before) === JSON.stringify(await sources());
  const reclaimed = JSON.stringify(originalFixtures) === JSON.stringify(await fixtures());
  const diagnostics = [...text.matchAll(/^# (\{"code".+)\r?$/gm)].map(match => JSON.parse(match[1]));
  const reproduced = mode === "red" && compile === 0 && exit === 1 && unchanged && reclaimed && counts.fail === 1
    && counts.pass === 0 && counts.cancelled === 0 && counts.todo === 0
    && diagnostics.some(row => row.code === "CODEX_CONNECTION_LOST" && row.method === "thread/start"
      && row.provider_calls === 0 && row.events.some(event => event.kind === "runtime.rpc.failed"
        && event.body.method === "thread/start" && event.body.provider_requests === 0));
  const passed = mode === "green" && compile === 0 && exit === 0 && unchanged && reclaimed && counts.tests === 9
    && counts.pass === 9 && ["fail", "cancelled", "skipped", "todo"].every(key => counts[key] === 0);
  const result = { at: new Date().toISOString(), status: passed ? "passed" : "failed", mode, counts,
    known_pre_turn_failure_reproduced: reproduced, source_unchanged: unchanged, original_fixture_set_restored: reclaimed,
    test_exit: exit, typecheck_exit: compile, native_codex: pin, source_files: before,
    verifier_sha256: hash(await readFile(import.meta.filename)), raw_report_sha256: hash(raw),
    scope: "actual_pinned_native_thread_start_resume_faults_with_synthetic_loopback_provider; no production reliability claim" };
  await writeFile(prefix + ".json", JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: result.status, mode, counts, reproduced, unchanged, reclaimed }));
  process.exitCode = mode === "red" ? reproduced ? 0 : 1 : passed ? 0 : 1;
}
