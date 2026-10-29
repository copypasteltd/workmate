import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createConnection, createServer } from "node:net";
import path from "node:path";

const attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/); assert.equal(process.argv.length, 3);
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform-publication-125"),
  admin = path.resolve("../copypaste-admin-publication-125"), web = path.resolve("../copypaste-web-publication-125"),
  prefix = "evidence/publications-ui-" + attempt,
  sha = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(path.basename(delivery), "copypaste-delivery");
await mkdir(path.dirname(prefix), { recursive: true });
for (const suffix of [".json", ".tap", "-journey.json", "-verifier.mjs", "-journey-verifier.ts"])
  await assert.rejects(readFile(prefix + suffix), error => error.code === "ENOENT");
async function occupied(port) {
  return new Promise(resolve => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(true); }); socket.once("error", () => resolve(false));
  });
}
for (const port of [4310, 4317, 4318]) assert.equal(await occupied(port), false, "Preserve existing services");
const roots = { "copypaste-platform": platform, "copypaste-admin": admin, "copypaste-web": web, "copypaste-delivery": delivery };
async function snapshot() {
  const result = {};
  for (const [label, repo] of Object.entries(roots)) {
    const selected = label === "copypaste-delivery"
      ? ["scripts/run-publications-ui-v10.mjs", "scripts/qa-publications-ui-v10.ts", "scripts/record-workmate-media.ts"]
      : ["src", "tests", "scripts", "migrations", "catalog", "contracts", "skills", "assets", ":(exclude)assets/screenshots/**", "public", "index.html", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts"];
    const files = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...selected], { cwd: repo, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
    for (const file of [...new Set(files)].sort()) result[label + "/" + file] = sha(await readFile(path.join(repo, file)));
  }
  return result;
}
process.loadEnvFile(path.join(platform, ".env"));
const priorReceiptPath = path.join(platform, ".data/publications-125/backend-06.json"), priorBytes = await readFile(priorReceiptPath), prior = JSON.parse(priorBytes);
assert.equal(prior.status, "passed"); assert.equal(prior.counts.tests, 29); assert.equal(prior.counts.pass, 29);
for (const name of ["source_unchanged", "owned_database_shutdown", "owned_database_port_closed"]) assert.equal(prior[name], true);
assert.match(prior.owned_native_directory, /^\.data\/native-qa\/[a-f\d-]{36}$/);
assert.equal(await occupied(prior.owned_native_port), false);
await assert.rejects(readFile(path.join(platform, prior.owned_native_directory, "postmaster.pid")), error => error.code === "ENOENT");
const oldCleanup = await readFile(path.join(platform, prior.fixture_cleanup.path));
assert.equal(sha(oldCleanup), prior.fixture_cleanup.sha256);
const cleaned = JSON.parse(oldCleanup);
assert.ok(cleaned.status === "passed" && cleaned.workers_exited && cleaned.actual_filesystem_checked && cleaned.results.every(row => row.reclaimed));
const previousUIPath = "evidence/publications-ui-10.json", previousUIBytes = await readFile(previousUIPath), previousUI = JSON.parse(previousUIBytes);
assert.equal(previousUI.status, "failed");
assert.equal(previousUI.source_unchanged, true);
assert.equal(previousUI.owned_database_shutdown, true);
assert.equal(previousUI.owned_database_port_closed, true); assert.equal(previousUI.owned_previews_closed, true);
assert.equal(previousUI.owned_native_directory, prior.owned_native_directory);
assert.ok(Object.values(previousUI.ports_closed).every(Boolean));
const previousUICleanup = await readFile(previousUI.fixture_cleanup.path);
assert.equal(sha(previousUICleanup), previousUI.fixture_cleanup.sha256);
const previousUIReclaimed = JSON.parse(previousUICleanup);
assert.ok(previousUIReclaimed.status === "passed" && previousUIReclaimed.actual_filesystem_checked && previousUIReclaimed.results.every(row => row.reclaimed));
const databasePort = await new Promise((resolve, reject) => {
  const server = createServer(); server.once("error", reject);
  server.listen(0, "127.0.0.1", () => { const address = server.address(); server.close(error => error ? reject(error) : resolve(address.port)); });
});
const databaseEnv = { COPYPASTE_NATIVE_DATABASE_DIR: prior.owned_native_directory };
for (const name of ["OWNER_DATABASE_URL", "DATABASE_URL", "CONTROL_DATABASE_URL", "QUEUE_DATABASE_URL"]) {
  const url = new URL(process.env[name]); url.port = String(databasePort); databaseEnv[name] = url.href;
}
const before = await snapshot();
for (const [name, expected] of Object.entries(before)) {
  const split = name.indexOf("/"), bytes = await readFile(path.join(roots[name.slice(0, split)], name.slice(split + 1)));
  assert.equal(sha(bytes), expected);
  const target = path.resolve(prefix + "-sources", name);
  assert.ok(target.startsWith(path.resolve(prefix + "-sources") + path.sep));
  await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: "wx" });
}
await writeFile(prefix + "-verifier.mjs", await readFile(import.meta.filename), { flag: "wx" });
await writeFile(prefix + "-journey-verifier.ts", await readFile("scripts/qa-publications-ui-v10.ts"), { flag: "wx" });
const run = path.join(platform, ".data/test-fixture-reclamation", randomUUID()), token = randomUUID();
await mkdir(run, { recursive: true }); await writeFile(path.join(run, "manifest.json"), JSON.stringify({ owner_pid: process.pid, token }), { flag: "wx" });
const log = createWriteStream(prefix + ".tap", { flags: "wx" }), checks = [];
function launch(args, cwd, env = {}, ipc = false) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...databaseEnv,
    COPYPASTE_LOCAL_CODEX_BIN: path.resolve("../copypaste-desktop/.data/runtime/windows-x64/codex.exe"), ...env },
    windowsHide: true, stdio: ipc ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const closed = new Promise(resolve => { child.once("close", code => resolve(code ?? 1)); child.once("error", () => resolve(1)); });
  return { child, closed };
}
let database, error = null, journey = null, journeyCode = null, cleanup = null, shutdown = null;
const previews = [];
try {
  for (const [name, args, cwd] of [
    ["platform typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"], platform],
    ["platform build", ["node_modules/typescript/bin/tsc"], platform],
    ["cloud bootstrap", ["scripts/copy-cloud-check-bootstrap.mjs"], platform],
    ["web typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"], web],
    ["web build", ["node_modules/vite/bin/vite.js", "build"], web],
    ["admin typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"], admin],
    ["admin build", ["node_modules/vite/bin/vite.js", "build"], admin],
    ["delivery typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"], delivery],
  ]) { const code = await launch(args, cwd).closed; checks.push({ name, exit_code: code }); assert.equal(code, 0, name); }
  database = launch(["scripts/native-db-launch.mjs"], platform, { COPYPASTE_NATIVE_DATABASE_START_ONLY: "true" }, true);
  let output = ""; database.child.stdout.on("data", bytes => { output = (output + bytes).slice(-16000); });
  const databaseDeadline = Date.now() + 900000;
  while (!output.includes("Native PostgreSQL ready")) {
    assert.equal(database.child.exitCode, null); assert.ok(Date.now() < databaseDeadline);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  for (const [repo, port] of [[web, 4317], [admin, 4318]]) {
    const preview = launch(["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], repo);
    previews.push(preview);
    const deadline = Date.now() + 30000;
    while (!(await occupied(port))) { assert.equal(preview.child.exitCode, null); assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 200)); }
  }
  console.log("Running actual customer/Admin publishing pages with owned native PostgreSQL and explicit synthetic Meta provider");
  const env = { COPYPASTE_TEST_RECLAMATION_DIR: run, COPYPASTE_TEST_RECLAMATION_TOKEN: token,
    CHROME_BIN: path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe") };
  const action = launch(["--env-file=" + path.join(platform, ".env"), "--import", "tsx", "scripts/qa-publications-ui-v10.ts", attempt], delivery, env);
  const timeout = setTimeout(() => {
    if (action.child.exitCode === null && action.child.pid) try {
      execFileSync("taskkill.exe", ["/PID", String(action.child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 15000 });
    } catch {}
  }, 1080000);
  try { journeyCode = await action.closed; } finally { clearTimeout(timeout); }
  const cleanupCode = await launch(["--import", "tsx", "scripts/reclaim-test-fixtures.ts"], platform, env).closed;
  const bytes = await readFile(path.join(run, "result.json"));
  await writeFile(prefix + "-fixture-cleanup.json", bytes, { flag: "wx" });
  cleanup = { ...JSON.parse(bytes), path: prefix + "-fixture-cleanup.json", sha256: sha(bytes), exit_code: cleanupCode };
  journey = JSON.parse(await readFile(prefix + "-journey.json"));
} catch (failure) { error = String(failure); }
finally {
  for (const preview of previews) { if (preview.child.exitCode === null) preview.child.kill(); await preview.closed; }
  if (database?.child.connected && database.child.exitCode === null) database.child.send({ action: "shutdown" });
  if (database) shutdown = await database.closed;
  await new Promise(resolve => log.end(resolve));
  const portsClosed = {};
  for (const port of [databasePort, 4310, 4317, 4318]) portsClosed[port] = !(await occupied(port));
  const unchanged = JSON.stringify(before) === JSON.stringify(await snapshot()), raw = await readFile(prefix + ".tap"),
    journeyBytes = await readFile(prefix + "-journey.json").catch(() => null);
  const passed = !error && journeyCode === 0 && journey?.status === "passed" && journey.checks.length >= 10 &&
    journey.errors.length === 0 && journey.model_calls === 0 &&
    ["web-preview", "admin-private-review"].every(component => [375, 768, 1024, 1440].every(width =>
      journey.layouts.some(row => row.component === component && row.width === width && row.page_fits && row.dialog_fits && row.fields_fit))) && journey.screenshots.length >= 6 && journey.recordings.length >= 2 &&
    journey.recordings.every(row => row.distinct_frames > 1 && row.skipped_capture_errors === 0) &&
    journey.browser_closed && journey.api_closed && journey.fixture_closed && cleanup?.status === "passed" &&
    cleanup.exit_code === 0 && cleanup.actual_filesystem_checked && cleanup.results.every(row => row.reclaimed) &&
    shutdown === 0 && Object.values(portsClosed).every(Boolean) && unchanged;
  const report = { at: new Date().toISOString(), status: passed ? "passed" : "failed", error, checks,
    journey_exit_code: journeyCode, counts: { journey_checks: journey?.checks.length ?? 0, errors: journey?.errors.length ?? 1 },
    source_files: before, source_unchanged: unchanged, owned_database_shutdown: shutdown === 0,
    owned_database_port_closed: portsClosed[databasePort], owned_native_port: databasePort,
    owned_native_directory: prior.owned_native_directory, ports_closed: portsClosed,
    reused_backend_receipt: { path: priorReceiptPath, sha256: sha(priorBytes) },
    previous_ui_attempt: { path: previousUIPath, sha256: sha(previousUIBytes), status: previousUI.status },
    owned_previews_closed: previews.every(row => row.child.exitCode !== null || row.child.signalCode !== null),
    fixture_cleanup: cleanup, raw_report: { path: prefix + ".tap", sha256: sha(raw) },
    verifier: { path: prefix + "-verifier.mjs", sha256: sha(await readFile(import.meta.filename)) },
    journey_verifier: { path: prefix + "-journey-verifier.ts", sha256: sha(await readFile("scripts/qa-publications-ui-v10.ts")) },
    journey: journeyBytes ? { path: prefix + "-journey.json", sha256: sha(journeyBytes) } : null,
    not_validated: ["Live provider or professional customer quality", "Actual Desktop or native Chrome Side Panel publishing", "Full product acceptance"] };
  await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, counts: report.counts, source_unchanged: unchanged, error }));
  if (!passed) process.exitCode = 1;
}
