import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, createConnection } from "node:net";
import path from "node:path";

const attempt = process.argv[2]; assert.match(attempt ?? "", /^\d{2}$/); assert.equal(process.argv.length, 3);
const delivery = process.cwd(), desktop = path.resolve("../copypaste-desktop-publication-125"), backend = path.resolve("../copypaste-platform-publication-125");
const repositories = { "copypaste-desktop": desktop, "copypaste-platform": backend, "copypaste-delivery": delivery };
const prefix = path.resolve("evidence/workflow-recovery-130/native-" + attempt), hash = bytes => createHash("sha256").update(bytes).digest("hex");
await mkdir(path.dirname(prefix), { recursive: true });
for (const suffix of [".json", ".tap", "-verifier.mjs", "-observations.json"]) await assert.rejects(readFile(prefix + suffix), error => error.code === "ENOENT");
const prechecks = [];
for (const [mode, number] of [["unit", "03"], ["native", "05"], ["types", "06"]]) {
  const name = path.join(desktop, ".data/workflow-recovery-130/probe-" + number), bytes = await readFile(name + ".json"), report = JSON.parse(bytes);
  assert.equal(report.status, "passed"); assert.equal(report.mode, mode); assert.equal(report.source_unchanged, true); assert.equal(report.fixtures_restored, true);
  assert.equal(hash(await readFile(name + ".tap")), report.raw_sha256);
  assert.equal(hash(await readFile(name + "-verifier.mjs")), report.verifier_sha256);
  for (const [file, expected] of Object.entries(report.source_files)) assert.equal(hash(await readFile(path.join(desktop, file))), expected, file);
  if (mode === "unit") assert.equal(report.counts.tests, 109);
  if (mode === "native") assert.equal(report.counts.tests, 43);
  prechecks.push({ mode, report: name, sha256: hash(bytes), counts: report.counts });
}
process.loadEnvFile(path.join(backend, ".env"));
const binary = path.resolve("../copypaste-desktop/.data/runtime/windows-x64/codex.exe");
const pin = JSON.parse(await readFile(path.join(desktop, "contracts/local-codex-runtime.json"), "utf8")); assert.equal(hash(await readFile(binary)), pin.windows_x64_sha256);
async function sources() {
  const result = {};
  for (const [label, root] of Object.entries(repositories)) {
    const names = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--",
      "src", "renderer", "tests", "scripts", "catalog", "contracts", "skills", "migrations", "renderer-source.json", "vite.config.ts", "package.json", "package-lock.json", "tsconfig.json"],
    { cwd: root, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
    for (const name of [...new Set(names)].sort()) result[label + "/" + name] = hash(await readFile(path.join(root, name)));
  }
  return result;
}
const before = await sources();
for (const [name, identity] of Object.entries(before)) {
  const slash = name.indexOf("/"), bytes = await readFile(path.join(repositories[name.slice(0, slash)], name.slice(slash + 1))); assert.equal(hash(bytes), identity);
  const target = path.join(prefix + "-sources", name); await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: "wx" });
}
await writeFile(prefix + "-verifier.mjs", await readFile(import.meta.filename), { flag: "wx" });
const databasePort = await new Promise((resolve, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(error => error ? reject(error) : resolve(port)); }); });
const databaseEnv = { COPYPASTE_NATIVE_DATABASE_DIR: ".data/native-qa/" + randomUUID() };
for (const name of ["OWNER_DATABASE_URL", "DATABASE_URL", "CONTROL_DATABASE_URL", "QUEUE_DATABASE_URL"]) { const url = new URL(process.env[name]); url.port = String(databasePort); databaseEnv[name] = url.href; }
const reclamation = path.join(backend, ".data/test-fixture-reclamation", randomUUID()), token = randomUUID();
await mkdir(reclamation, { recursive: true }); await writeFile(path.join(reclamation, "manifest.json"), JSON.stringify({ owner_pid: process.pid, token }), { flag: "wx" });
const log = createWriteStream(prefix + ".tap", { flags: "wx" }), commands = [];
const env = { ...process.env, ...databaseEnv, COPYPASTE_LOCAL_CODEX_TEST_BIN: binary, COPYPASTE_WORKFLOW_OBSERVATIONS: prefix + "-observations.json",
  COPYPASTE_TEST_RECLAMATION_DIR: reclamation, COPYPASTE_TEST_RECLAMATION_TOKEN: token };
function launch(label, args, cwd, ipc = false) {
  const started = new Date().toISOString(); log.write(JSON.stringify({ label, args, started_at: started }) + "\n");
  const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: ipc ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const closed = new Promise(resolve => { child.once("error", error => resolve({ exit_code: 1, error: String(error) })); child.once("close", code => resolve({ exit_code: code ?? 1 })); })
    .then(result => { const row = { label, args, started_at: started, finished_at: new Date().toISOString(), ...result }; commands.push(row); log.write(JSON.stringify(row) + "\n"); console.log(JSON.stringify(row)); return result; });
  return { child, closed };
}
let database, error, testResult, cleanup, shutdown;
try {
  assert.equal((await launch("Delivery compilation", ["node_modules/typescript/bin/tsc", "--noEmit"], delivery).closed).exit_code, 0);
  database = launch("owned native PostgreSQL", ["scripts/native-db-launch.mjs"], backend, true);
  let output = ""; database.child.stdout.on("data", bytes => { output = (output + bytes.toString()).slice(-16000); });
  const deadline = Date.now() + 900000;
  while (!output.includes("Native PostgreSQL ready")) { assert.equal(database.child.exitCode, null); assert.ok(Date.now() < deadline, "Owned PostgreSQL readiness deadline"); await new Promise(resolve => setTimeout(resolve, 150)); }
  const tests = launch("actual parent child recovery journeys", ["--import", "tsx", "--test", "--test-concurrency=1", "tests/desktop-workflow-recovery-130.integration.ts"], delivery);
  const bound = setTimeout(() => { if (tests.child.exitCode === null && tests.child.pid) try { execFileSync("taskkill.exe", ["/PID", String(tests.child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 15000 }); } catch {} }, 900000);
  try { testResult = await tests.closed; } finally { clearTimeout(bound); }
} catch (failure) { error = String(failure); }
finally {
  try {
    const result = await launch("owned fixture reclamation", ["--import", "tsx", "scripts/reclaim-test-fixtures.ts"], backend).closed;
    const bytes = await readFile(path.join(reclamation, "result.json")); await writeFile(prefix + "-fixture-cleanup.json", bytes, { flag: "wx" });
    cleanup = { ...JSON.parse(bytes), exit_code: result.exit_code, sha256: hash(bytes) };
  } catch (failure) { error ??= String(failure); }
  if (database?.child.connected && database.child.exitCode === null) database.child.send({ action: "shutdown" });
  if (database) shutdown = await database.closed;
  await new Promise(resolve => log.end(resolve));
}
const raw = await readFile(prefix + ".tap"), text = raw.toString();
const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(name => [name, Number(text.match(new RegExp("^# " + name + " (\\d+)\\r?$", "m"))?.[1] ?? -1)]));
const observations = await readFile(prefix + "-observations.json").then(bytes => ({ value: JSON.parse(bytes), sha256: hash(bytes) })).catch(() => null);
const unchanged = JSON.stringify(before) === JSON.stringify(await sources());
const portClosed = await new Promise(resolve => { const socket = createConnection({ host: "127.0.0.1", port: databasePort }); socket.once("connect", () => { socket.destroy(); resolve(false); }); socket.once("error", () => resolve(true)); });
const passed = !error && testResult?.exit_code === 0 && counts.tests === 3 && counts.pass === 3 && ["fail", "cancelled", "skipped", "todo"].every(name => counts[name] === 0)
  && observations?.value.observations.length === 3 && observations.value.provider_closed && unchanged && shutdown?.exit_code === 0 && portClosed
  && cleanup?.status === "passed" && cleanup.exit_code === 0 && cleanup.results.every(row => row.reclaimed);
const report = { at: new Date().toISOString(), status: passed ? "passed" : "failed", scope: "Three actual pinned customer-local Codex parent/child journeys with real commands, company SQL authorization and accounting; synthetic provider, customer decisions and injected transport faults. No packaged UI, full crash/multi-node or professional-role qualification.",
  error, counts, commands, prechecks, source_files: before, source_unchanged: unchanged, observations: observations && { sha256: observations.sha256 },
  owned_database_shutdown: shutdown?.exit_code === 0, owned_database_port_closed: portClosed, fixture_cleanup: cleanup,
  raw_sha256: hash(raw), verifier_sha256: hash(await readFile(import.meta.filename)), native_pin: pin };
await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: report.status, counts, source_unchanged: unchanged, error, fixture_reclaimed: cleanup?.status, database_closed: shutdown?.exit_code === 0 && portClosed }));
process.exitCode = passed ? 0 : 1;
