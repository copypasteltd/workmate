import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import path from "node:path";

const attempt = process.argv[2];
const native = process.argv[3] === "--native";
assert.match(attempt ?? "", /^\d{2}$/); assert.equal(process.argv.length, native ? 4 : 3);
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), desktop = path.resolve("../copypaste-desktop");
const prefix = "evidence/desktop-workflows-" + (native ? "native-" : "") + attempt;
if (native) assert.ok(path.isAbsolute(process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN ?? ""));
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
await assert.rejects(readFile(prefix + ".json"), error => error.code === "ENOENT");
async function snapshot() {
  const source = {};
  for (const repo of [platform, desktop, delivery]) {
    const files = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--",
      "src", "renderer", "renderer-source.json", "vite.config.ts", "tests", "scripts", "migrations", "catalog", "contracts", "skills", "package.json", "package-lock.json", "tsconfig.json"], { cwd: repo, windowsHide: true, encoding: "utf8" }).split("\0").filter(Boolean);
    for (const file of [...new Set(files)].sort()) source[path.basename(repo) + "/" + file] = hash(await readFile(path.join(repo, file)));
  }
  return source;
}
const occupied = await new Promise(resolve => {
  const socket = createConnection({ host: "127.0.0.1", port: 55432 });
  socket.once("connect", () => { socket.destroy(); resolve(true); }); socket.once("error", () => resolve(false));
});
assert.equal(occupied, false, "Never adopt an occupied database");
const source = await snapshot(), verifier = await readFile(import.meta.filename);
await writeFile(prefix + "-verifier.mjs", verifier, { flag: "wx" });
const sourceHeads = {}, preservedChanges = {};
for (const repo of [platform, desktop, delivery]) {
  const git = args => execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", ...args], { cwd: repo, encoding: "utf8", windowsHide: true });
  sourceHeads[path.basename(repo)] = git(["rev-parse", "HEAD"]).trim();
  const changed = new Set([...git(["diff", "--name-only", "-z", "HEAD"]).split("\0"), ...git(["ls-files", "--others", "--exclude-standard", "-z"]).split("\0")]);
  for (const file of changed) {
    const label = path.basename(repo) + "/" + file;
    if (!Object.hasOwn(source, label)) continue;
    const target = path.resolve(prefix + "-sources", label); await mkdir(path.dirname(target), { recursive: true });
    const bytes = await readFile(path.join(repo, file)); assert.equal(hash(bytes), source[label]);
    await writeFile(target, bytes, { flag: "wx" }); preservedChanges[label] = { sha256: source[label], path: path.relative(delivery, target).replaceAll("\\", "/") };
  }
}
const log = createWriteStream(prefix + ".tap", { flags: "wx" });
function launch(args, cwd, env = {}) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const closed = new Promise(resolve => { child.once("close", code => resolve(code ?? 1)); child.once("error", () => resolve(1)); });
  return { child, closed };
}
let database, testExit = null, shutdown = null, error = null, fixtureCleanup = null;
const checks = [], files = native ? ["tests/desktop-workflow-native.integration.ts"]
  : ["tests/desktop-workflows.test.ts", "tests/desktop-executions.test.ts", "tests/desktop-video.test.ts", "tests/task-source-visibility.test.ts", "tests/task-history-sources.test.ts"];
try {
  for (const [name, args, cwd] of [["delivery typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"], delivery],
    ["platform typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"], platform],
    ["desktop main typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"], desktop],
    ["desktop renderer typecheck", ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "renderer/tsconfig.json"], desktop]]) {
    const code = await launch(args, cwd).closed; checks.push({ name, exit_code: code }); assert.equal(code, 0, name);
  }
  database = launch(["scripts/native-db-launch.mjs"], platform, { COPYPASTE_NATIVE_DATABASE_START_ONLY: "true" });
  let output = ""; database.child.stdout.on("data", bytes => { output = (output + bytes.toString()).slice(-16000); });
  const deadline = Date.now() + 900000;
  while (!output.includes("Native PostgreSQL ready")) { assert.equal(database.child.exitCode, null); assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 200)); }
  console.log("Owned database ready; checking native workflow definitions, local children, consent and cancellation");
  if (native) {
    const reclamation = path.join(platform, ".data/test-fixture-reclamation", randomUUID()), token = randomUUID();
    await mkdir(reclamation, { recursive: true }); await writeFile(path.join(reclamation, "manifest.json"), JSON.stringify({ owner_pid: process.pid, token }), { flag: "wx" });
    const env = { COPYPASTE_TEST_RECLAMATION_DIR: reclamation, COPYPASTE_TEST_RECLAMATION_TOKEN: token,
      COPYPASTE_NATIVE_WORKFLOW_ROUTE_OUTPUT: path.resolve(prefix + "-routes.json") };
    const probe = launch(["--env-file=" + path.join(platform, ".env"), "--import", "tsx", "--test", "--test-concurrency=1", ...files], delivery, env);
    const deadline = setTimeout(() => {
      if (probe.child.exitCode === null && probe.child.pid) {
        try { execFileSync("taskkill.exe", ["/PID", String(probe.child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 15000 }); } catch {}
      }
    }, 450000);
    try { testExit = await probe.closed; } finally { clearTimeout(deadline); }
    const cleanupCode = await launch(["--import", "tsx", "scripts/reclaim-test-fixtures.ts"], platform, env).closed;
    const bytes = await readFile(path.join(reclamation, "result.json")); await writeFile(prefix + "-fixture-cleanup.json", bytes, { flag: "wx" });
    fixtureCleanup = { ...JSON.parse(bytes), exit_code: cleanupCode, path: prefix + "-fixture-cleanup.json", sha256: hash(bytes) };
  } else testExit = await launch(["--env-file=.env", "scripts/run-tests-owned.mjs", ...files], platform).closed;
} catch (failure) { error = String(failure); }
finally {
  if (database?.child.connected && database.child.exitCode === null) database.child.send({ action: "shutdown" });
  if (database) shutdown = await database.closed;
  await new Promise(resolve => log.end(resolve));
  const bytes = await readFile(prefix + ".tap"), raw = bytes.toString();
  const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => [key, Number(raw.match(new RegExp("^# " + key + " (\\d+)\\r?$", "m"))?.[1] ?? -1)]));
  const unchanged = JSON.stringify(source) === JSON.stringify(await snapshot());
  const required = native ? ["actual native workflow execute uses local child Codex and company receipts", "actual native workflow stop uses local child Codex and company receipts", "actual native workflow revoke uses local child Codex and company receipts"]
    : ["native workflow specialist exposes eight scoped tools", "native workflow launch waits for explicit fee confirmation", "native workflow creates exactly one local child", "native workflow advances actual child receipts", "same-project members and other native families", "cloud workflow workers and schedules cannot take over", "stopping a native consultant cancels its run", "native child unknown outcomes stop the workflow", "admin deletion scrubs immutable private workflow", "all eighteen connected native roles", "explicitly published native SOPs retain workflow provenance"];
  const covered = required.every(name => raw.split(/\r?\n/).some(line => /^ok \d+ - /.test(line) && line.includes(name)));
  const passed = !error && testExit === 0 && shutdown === 0 && unchanged && (native ? counts.tests === 3 : counts.tests >= 42) && counts.pass === counts.tests
    && ["fail", "cancelled", "skipped", "todo"].every(key => counts[key] === 0)
    && (native ? fixtureCleanup?.exit_code === 0 && fixtureCleanup.status === "passed" && fixtureCleanup.results.every(result => result.reclaimed) : raw.includes("# owned_fixture_cleanup")) && covered;
  const report = { at: new Date().toISOString(), status: passed ? "passed" : "failed", scope: native ? "actual_local_Codex_workflow_children_full_access_approvals_stop_and_revoke" : "native_workflow_control_plane_video_and_content_provenance_regressions",
    files, error, counts, checks, test_exit_code: testExit, owned_database_shutdown: shutdown === 0, source_unchanged: unchanged, source_files: source,
    source_heads: sourceHeads, preserved_changes: preservedChanges, fixture_cleanup: fixtureCleanup,
    raw_report: { path: prefix + ".tap", sha256: hash(bytes) }, verifier: { path: prefix + "-verifier.mjs", sha256: hash(verifier) }, required_scenarios: required,
    not_validated: [...(native ? [] : ["native_Codex_child_roundtrip"]), "packaged_Desktop_workflow_interaction", "entire_platform_regression", "professional_or_production_acceptance"] };
  await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, counts, source_unchanged: unchanged, owned_database_shutdown: shutdown === 0, error }));
  assert.ok(passed, "Keep failures; correct their cause before a fresh attempt");
}
