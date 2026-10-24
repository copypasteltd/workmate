import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import path from "node:path";

const attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/); assert.equal(process.argv.length, 3);
assert.ok(process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN, "Generated video verification includes the explicitly pinned native Codex executable");
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform");
const prefix = "evidence/generated-video-" + attempt;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
await assert.rejects(readFile(prefix + ".json"), error => error.code === "ENOENT");
async function snapshot() {
  const source = {};
  for (const repo of [platform, path.resolve("../copypaste-desktop"), delivery]) {
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
const log = createWriteStream(prefix + ".tap", { flags: "wx" });
function launch(args, cwd, env = {}) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const closed = new Promise(resolve => { child.once("close", code => resolve(code ?? 1)); child.once("error", () => resolve(1)); });
  return { child, closed };
}
let database, testExit = null, shutdown = null, error = null;
const checks = [], files = ["tests/generated-video-jobs.test.ts", "tests/video-job-protocol.test.ts", "tests/internal-ai-gateway.test.ts"];
try {
  for (const [name, args, cwd] of [["platform typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"], platform],
    ["platform build", ["node_modules/typescript/bin/tsc"], platform]]) {
    const code = await launch(args, cwd).closed; checks.push({ name, exit_code: code }); assert.equal(code, 0, name);
  }
  database = launch(["scripts/native-db-launch.mjs"], platform, { COPYPASTE_NATIVE_DATABASE_START_ONLY: "true" });
  let output = ""; database.child.stdout.on("data", bytes => { output = (output + bytes.toString()).slice(-16000); });
  const deadline = Date.now() + 900000;
  while (!output.includes("Native PostgreSQL ready")) { assert.equal(database.child.exitCode, null); assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 200)); }
  console.log("Owned native database ready; validating generated video durable operation, billing and actual native MP4 validation");
  testExit = await launch(["--env-file=.env", "scripts/run-tests-owned.mjs", ...files], platform).closed;
} catch (failure) { error = String(failure); }
finally {
  if (database?.child.connected && database.child.exitCode === null) database.child.send({ action: "shutdown" });
  if (database) shutdown = await database.closed;
  await new Promise(resolve => log.end(resolve));
  const rawBytes = await readFile(prefix + ".tap"), raw = rawBytes.toString();
  const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => [key, Number(raw.match(new RegExp("^# " + key + " (\\d+)\\r?$", "m"))?.[1] ?? -1)]));
  const unchanged = JSON.stringify(source) === JSON.stringify(await snapshot());
  const required = ["a frozen native video operation persists before HTTP", "lost submit response resumes the original operation", "an unconfirmed lookup, terminal status without usage", "concurrent video quotes share the original budget", "cancelling before dispatch proves zero", "authenticated observations deduplicate", "revoking a reference while real media is in flight", "completed status with corrupt actual bytes", "same-project peers and other tenants", "over-quote final usage is retained", "an interrupted processor resumes only its retained operation", "an expired processor cannot overwrite a replacement lease", "revoked native login permits resource-only cost reconciliation", "higher sequence observations cannot regress", "a pre-upgrade native video task keeps its frozen role", "video Admin metadata, cost visibility and recheck", "a video-only uncertain task holds funds", "video holds and measured native reasoning spend"];
  required.push("real native Codex completes generated video tools");
  const covered = required.every(name => raw.split(/\r?\n/).some(line => /^ok \d+ - /.test(line) && line.includes(name)));
  const passed = !error && testExit === 0 && shutdown === 0 && unchanged && counts.tests === 57 && counts.pass === counts.tests
    && ["fail", "cancelled", "skipped", "todo"].every(key => counts[key] === 0) && raw.includes("# owned_fixture_cleanup") && covered;
  const report = { at: new Date().toISOString(), status: passed ? "passed" : "failed", scope: "company_generated_video_jobs_protocol_gateway_durability_billing_authorization_and_real_MP4_decode",
    files, error, counts, checks, test_exit_code: testExit, owned_database_shutdown: shutdown === 0, source_unchanged: unchanged, source_files: source,
    raw_report: { path: prefix + ".tap", sha256: hash(rawBytes) }, verifier: { path: prefix + "-verifier.mjs", sha256: hash(verifier) }, required_scenarios: required,
    not_validated: ["generated_video_user_interface_and_Admin_panel", "actual_packaged_Electron_generated_video_interaction", "entire_platform_regression", "real_company_video_provider", "professional_or_production_acceptance"] };
  await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, counts, source_unchanged: unchanged, owned_database_shutdown: shutdown === 0, error }));
  assert.ok(passed, "Retain failed evidence and correct its cause before a new attempt");
}
