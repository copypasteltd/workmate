import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, mkdir, readdir, lstat } from "node:fs/promises";
import { createServer, connect } from "node:net";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { hash, fingerprint, validateInventory, validateFileReceipt, sumCompleteInventory, checkedReference } from "./integrated-recovery-inventory.mjs";
import { parseCompleteTap, requirePassingCounts } from "./platform-qualification-state.mjs";

const attempt = process.argv[2], maxFiles = Number(process.argv[3] ?? 10);
assert.match(attempt ?? "", /^\d{2}$/); assert.ok(process.argv.length <= 4);
assert.ok(Number.isSafeInteger(maxFiles) && maxFiles > 0 && maxFiles <= 200);
assert.equal(path.basename(process.cwd()), "copypaste-delivery");
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), prefix = "evidence/integrated-recovery-full-" + attempt, runs = prefix + "-runs";
const verifierHash = hash(await readFile(import.meta.filename));
const testFiles = (await readdir(path.join(platform, "tests"))).filter(name => /^[a-z0-9-]+\.test\.ts$/.test(name)).sort().map(name => "tests/" + name);
const json = async file => JSON.parse(await readFile(file, "utf8"));
const exists = async file => { try { await lstat(file); return true; } catch (error) { if (error.code === "ENOENT") return false; throw error; } };
const save = async (file, value) => { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" }); };
const reference = async file => ({ path: file.replaceAll("\\", "/"), sha256: hash(await readFile(file)) });
function gone(pid) { assert.ok(Number.isSafeInteger(pid) && pid > 0); try { process.kill(pid, 0); return false; } catch (error) { if (error.code === "ESRCH") return true; throw error; } }
async function portClosed(port) { return new Promise((resolve, reject) => { const socket = connect({ host: "127.0.0.1", port }); socket.once("connect", () => { socket.destroy(); resolve(false); }); socket.once("error", error => { socket.destroy(); if (error.code === "ECONNREFUSED") resolve(true); else reject(error); }); socket.setTimeout(2000, () => { socket.destroy(); reject(new Error("OWNED_PORT_STATE_UNKNOWN")); }); }); }
async function snapshot() {
  const names = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src", "tests", "scripts", "migrations", "catalog", "assets/fonts", "public", "contracts", "skills", "package.json", "package-lock.json", "tsconfig.json"], { cwd: platform, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
  const result = {}; for (const name of [...new Set(names)].sort()) result["copypaste-platform/" + name] = hash(await readFile(path.join(platform, name)));
  for (const name of ["scripts/run-integrated-recovery-full-v2.mjs", "scripts/integrated-recovery-inventory.mjs", "scripts/platform-qualification-state.mjs", "tests/integrated-recovery-inventory.test.mjs"]) result["copypaste-delivery/" + name] = hash(await readFile(name));
  return result;
}
const sources = await snapshot();
if (!await exists(prefix + "-plan.json")) {
  for (const tail of [".json", "-verifier.mjs"]) assert.equal(await exists(prefix + tail), false, "Use a fresh attempt number");
  await save(prefix + "-plan.json", { format: "source_bound_complete_inventory_v2", at: new Date().toISOString(), test_files: testFiles, source_files: sources, source_fingerprint: fingerprint(sources), verifier_sha256: verifierHash });
}
const plan = await json(prefix + "-plan.json"); validateInventory(plan, testFiles, sources, verifierHash);
for (const [name, expected] of Object.entries(sources)) { const bytes = await readFile(path.resolve("..", name)); assert.equal(hash(bytes), expected); const file = prefix + "-sources/" + name; if (!await exists(file)) { await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, bytes, { flag: "wx" }); } }
if (!await exists(prefix + "-verifier.mjs")) await writeFile(prefix + "-verifier.mjs", await readFile(import.meta.filename), { flag: "wx" });
assert.equal(hash(await readFile(prefix + "-verifier.mjs")), verifierHash);
for (const [name, expected] of Object.entries(plan.source_files)) assert.equal(hash(await readFile(prefix + "-sources/" + name)), expected);
await mkdir(runs + "/epochs", { recursive: true }); await mkdir(runs + "/files", { recursive: true });
process.loadEnvFile(path.join(platform, ".env"));
const desktop = path.resolve("../copypaste-desktop"), pin = await json(path.join(desktop, "contracts/local-codex-runtime.json")), binary = path.join(desktop, ".data/runtime/windows-x64/codex.exe");
assert.equal(hash(await readFile(binary)), pin.windows_x64_sha256);
const baseEnv = { ...process.env, CODEX_BIN: binary, CODEX_VERSION: pin.runtime_version, COPYPASTE_LOCAL_CODEX_BIN: binary, COPYPASTE_LOCAL_CODEX_TEST_BIN: binary };
function launch(args, environment, file) {
  const stream = createWriteStream(file, { flags: "wx" }); let output = "";
  const child = spawn(process.execPath, args, { cwd: platform, env: environment, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  for (const pipe of [child.stdout, child.stderr]) pipe.on("data", bytes => { stream.write(bytes); output = (output + bytes.toString()).slice(-32000); });
  const closed = new Promise(resolve => { let spawnError; child.once("error", error => { spawnError = String(error); }); child.once("close", code => stream.end(() => resolve({ exit_code: code ?? 1, spawn_error: spawnError }))); });
  return { child, closed, output: () => output };
}
// Earlier epochs are immutable. An interrupted epoch can be closed only after
// its recorded owner, database PID, port and every declared fixture worker are gone.
const epochNames = (await readdir(runs + "/epochs")).filter(name => /^\d{4}\.json$/.test(name)).sort();
for (const name of epochNames) {
  const file = runs + "/epochs/" + name, epoch = await json(file), closeFile = file.replace(/\.json$/, "-closed.json");
  assert.equal(epoch.plan_sha256, hash(await readFile(prefix + "-plan.json")));
  if (await exists(closeFile)) continue;
  assert.ok(gone(epoch.owner_pid), "An earlier epoch is still active"); assert.ok(await portClosed(epoch.port), "The earlier owned database is still serving");
  const pidFile = path.join(platform, epoch.directory, "postmaster.pid");
  if (await exists(pidFile)) { const pid = Number((await readFile(pidFile, "utf8")).split(/\r?\n/)[0]); assert.ok(gone(pid), "The earlier owned postmaster is alive"); }
  const recovered = [];
  for (const fileName of (await readdir(runs + "/files")).filter(name => /-started\.json$/.test(name)).sort()) {
    const started = await json(runs + "/files/" + fileName); if (started.epoch !== epoch.id) continue;
    const directory = path.join(platform, ".data/test-fixture-reclamation", started.fixture_id), result = path.join(directory, "result.json");
    if (await exists(result)) { const row = await json(result); assert.equal(row.status, "passed"); assert.equal(row.workers_exited, true); continue; }
    if (!await exists(directory)) continue;
    assert.ok(!(await lstat(directory)).isSymbolicLink()); const manifest = await json(path.join(directory, "manifest.json")); assert.ok(gone(manifest.owner_pid));
    const raw = runs + "/epochs/" + epoch.id + "-recover-" + started.fixture_id + ".log";
    const job = launch(["--import", "tsx", "scripts/reclaim-test-fixtures.ts"], { ...baseEnv, COPYPASTE_TEST_RECLAMATION_DIR: directory, COPYPASTE_TEST_RECLAMATION_TOKEN: manifest.token, COPYPASTE_TEST_RECOVER_INTERRUPTED: "true" }, raw);
    assert.equal((await job.closed).exit_code, 0); const cleanup = await json(result); assert.equal(cleanup.status, "passed");
    const copy = raw.replace(/\.log$/, "-cleanup.json"); await writeFile(copy, await readFile(result), { flag: "wx" }); recovered.push({ raw_report: await reference(raw), cleanup: await reference(copy) });
  }
  await save(closeFile, { status: "passed", mode: "interrupted_owners_observed_gone", at: new Date().toISOString(), owner_gone: true, native_port_closed: true, verified_fixture_recovery: recovered, epoch: await reference(file) });
}
const selected = [];
for (const file of testFiles) {
  const stem = path.basename(file, ".test.ts"), rows = (await readdir(runs + "/files")).filter(name => name.startsWith(stem + "--") && /^.+--\d{2}\.json$/.test(name)).sort();
  for (const name of rows) { const receiptPath = runs + "/files/" + name, row = await json(receiptPath); if (row.status !== "passed") continue; await validateFileReceipt(plan, row, delivery, platform); assert.ok(!selected.some(item => item.test_file === file), "Duplicate passing file receipts"); selected.push({ ...row, receipt: await reference(receiptPath) }); }
}
const remaining = testFiles.filter(file => !selected.some(row => row.test_file === file)).slice(0, maxFiles);
let error = null;
if (remaining.length) {
  const id = String(epochNames.length + 1).padStart(4, "0"), epochFile = runs + "/epochs/" + id + ".json", port = await new Promise((resolve, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(err => err ? reject(err) : resolve(address.port)); }); });
  const directory = ".data/native-qa/" + randomUUID(), env = { ...baseEnv, COPYPASTE_NATIVE_DATABASE_DIR: directory };
  for (const name of ["OWNER_DATABASE_URL", "DATABASE_URL", "CONTROL_DATABASE_URL", "QUEUE_DATABASE_URL"]) { const url = new URL(process.env[name]); url.port = String(port); env[name] = url.href; }
  await save(epochFile, { id, owner_pid: process.pid, at: new Date().toISOString(), port, directory, plan_sha256: hash(await readFile(prefix + "-plan.json")), files: remaining });
  const checks = []; let database, databaseExit = null;
  try {
    for (const [name, args] of [["typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"]], ["build", ["node_modules/typescript/bin/tsc"]], ["bootstrap", ["scripts/copy-cloud-check-bootstrap.mjs"]]]) {
      const raw = runs + "/epochs/" + id + "-" + name + ".log", job = launch(args, env, raw), result = await job.closed; checks.push({ name, args, ...result, raw_report: await reference(raw) }); assert.equal(result.exit_code, 0, name);
    }
    database = launch(["scripts/native-db-launch.mjs"], { ...env, COPYPASTE_NATIVE_DATABASE_START_ONLY: "true" }, runs + "/epochs/" + id + "-database.log");
    const deadline = performance.now() + 900_000;
    while (!database.output().includes("Native PostgreSQL ready")) { assert.equal(database.child.exitCode, null); assert.ok(performance.now() < deadline); await new Promise(resolve => setTimeout(resolve, 200)); }
    for (const file of remaining) {
      assert.equal(fingerprint(await snapshot()), plan.source_fingerprint);
      const stem = path.basename(file, ".test.ts"), previous = (await readdir(runs + "/files")).filter(name => name.startsWith(stem + "--") && /-started\.json$/.test(name)), number = String(previous.length + 1).padStart(2, "0"), filePrefix = runs + "/files/" + stem + "--" + number, fixtureId = randomUUID(), args = ["--env-file=.env", "scripts/run-tests-owned.mjs", file];
      await save(filePrefix + "-started.json", { epoch: id, test_file: file, fixture_id: fixtureId, at: new Date().toISOString() });
      console.log("Running " + file + " (" + (selected.length + 1) + "/" + testFiles.length + ")");
      const job = launch(args, { ...env, COPYPASTE_TEST_RECLAMATION_ID: fixtureId }, filePrefix + ".tap"), exit = await job.closed, raw = await readFile(filePrefix + ".tap", "utf8");
      const row = { at: new Date().toISOString(), epoch: id, test_file: file, args, ...exit, status: "failed", verifier_sha256: verifierHash, source_fingerprint: plan.source_fingerprint, source_unchanged: fingerprint(await snapshot()) === plan.source_fingerprint, raw_report: await reference(filePrefix + ".tap") };
      try {
        row.counts = parseCompleteTap(raw); requirePassingCounts(row.counts);
        const matches = [...raw.matchAll(/^# owned_fixture_cleanup (.+)\r?$/gm)]; assert.equal(matches.length, 1); row.fixture_cleanup = JSON.parse(matches[0][1]);
        const cleanup = await checkedReference(platform, row.fixture_cleanup); await writeFile(filePrefix + "-cleanup.json", cleanup, { flag: "wx" }); row.fixture_cleanup_report = await reference(filePrefix + "-cleanup.json");
        row.status = "passed"; await validateFileReceipt(plan, row, delivery, platform);
      } catch (e) { row.status = "failed"; row.error = String(e); }
      await save(filePrefix + ".json", row); assert.equal(row.status, "passed", row.error); selected.push({ ...row, receipt: await reference(filePrefix + ".json") });
    }
  } catch (e) { error = String(e); }
  finally {
    if (database?.child.connected && database.child.exitCode === null) database.child.send({ action: "shutdown" });
    if (database) databaseExit = (await database.closed).exit_code;
    const closed = (!database || databaseExit === 0) && await portClosed(port);
    await save(epochFile.replace(/\.json$/, "-closed.json"), { status: closed ? "passed" : "failed", mode: "actual_child_exit", at: new Date().toISOString(), epoch: await reference(epochFile), error, checks, database_exit: databaseExit, database_started: !!database, native_port_closed: closed });
    assert.ok(closed, "Owned database shutdown remains unconfirmed");
  }
}
selected.sort((a, b) => testFiles.indexOf(a.test_file) - testFiles.indexOf(b.test_file));
if (!error && selected.length === testFiles.length) {
  const counts = sumCompleteInventory(plan, selected), epochRefs = [];
  for (const name of (await readdir(runs + "/epochs")).filter(name => /^\d{4}-closed\.json$/.test(name)).sort()) { const file = runs + "/epochs/" + name, row = await json(file); assert.equal(row.status, "passed"); epochRefs.push(await reference(file)); }
  const index = { format: plan.format, plan: await reference(prefix + "-plan.json"), counts, test_files: testFiles, file_receipts: selected.map(row => row.receipt), epochs: epochRefs };
  await save(prefix + "-index.json", index);
  await save(prefix + ".json", { at: new Date().toISOString(), status: "passed", scope: "all_platform_test_files", verification_mode: plan.format, test_files: testFiles, counts, test_exit: 0, owned_database_shutdown: true, source_unchanged: true, source_files: sources, verifier_sha256: verifierHash, native_codex: pin, raw_report: await reference(prefix + "-index.json"), not_validated: ["Actual live provider/customer professional qualification", "Full product acceptance"] });
  console.log(JSON.stringify({ status: "passed", complete_files: selected.length, counts }));
} else { console.log(JSON.stringify({ status: error ? "failed" : "checkpointed", complete_files: selected.length, total_files: testFiles.length, error })); if (error) process.exitCode = 1; }
