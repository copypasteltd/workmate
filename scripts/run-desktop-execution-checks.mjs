import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import path from "node:path";

const attempt = process.argv[2], focused = process.argv.includes("--focused"), fullPlatform = process.argv.includes("--full-platform");
assert.match(attempt ?? "", /^\d{2}$/);
assert.ok(!(focused && fullPlatform), "Choose focused or full-platform verification");
if (fullPlatform) assert.ok(process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN, "Full verification includes the native integration and requires the pinned binary");
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), desktop = path.resolve("../copypaste-desktop");
const prefix = "evidence/desktop-execution-control-" + attempt, hash = bytes => createHash("sha256").update(bytes).digest("hex");
await assert.rejects(readFile(prefix + ".json"), error => error.code === "ENOENT");
async function snapshot() {
  const result = {};
  for (const repo of [platform, desktop, delivery]) {
    const names = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--",
      "src", "renderer", "renderer-source.json", "vite.config.ts", "tests", "scripts", "migrations", "catalog", "contracts", "skills", "package.json", "package-lock.json", "tsconfig.json"], { cwd: repo, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
    for (const file of [...new Set(names)].sort()) result[path.basename(repo) + "/" + file] = hash(await readFile(path.join(repo, file)));
  }
  return result;
}
const occupied = await new Promise(resolve => { const socket = createConnection({ host: "127.0.0.1", port: 55432 }); socket.once("connect", () => { socket.destroy(); resolve(true); }); socket.once("error", () => resolve(false)); });
assert.equal(occupied, false, "The test port must be free; never adopt another database");
const source = await snapshot(), verifier = await readFile(import.meta.filename);
await writeFile(prefix + "-verifier.mjs", verifier, { flag: "wx" });
const log = createWriteStream(prefix + ".tap", { flags: "wx" });
function launch(args, cwd, env = {}) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const closed = new Promise(resolve => { child.once("close", code => resolve(code ?? 1)); child.once("error", () => resolve(1)); });
  return { child, closed };
}
let database, shutdown = null, testExit = null, error = null;
const checks = [];
try {
  const typecheck = await launch(["node_modules/typescript/bin/tsc", "--noEmit"], platform).closed;
  checks.push({ name: "platform typecheck", exit_code: typecheck }); assert.equal(typecheck, 0);
  database = launch(["scripts/native-db-launch.mjs"], platform, { COPYPASTE_NATIVE_DATABASE_START_ONLY: "true" });
  let output = ""; database.child.stdout.on("data", b => { output = (output + b.toString()).slice(-16000); });
  const end = Date.now() + 900000;
  while (!output.includes("Native PostgreSQL ready")) { assert.equal(database.child.exitCode, null); assert.ok(Date.now() < end); await new Promise(r => setTimeout(r, 200)); }
  console.log("Owned native database ready; running local execution ownership and billing checks");
  const files = fullPlatform ? ["tests/*.test.ts"] : ["tests/desktop-executions.test.ts", ...(process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN ? ["tests/desktop-local-runtime.test.ts"] : []),
    ...(focused ? [] : ["tests/canonical-tasks.test.ts", "tests/execution-capacity.test.ts", "tests/internal-ai-gateway.test.ts", "tests/provider-request-control.test.ts"])];
  testExit = await launch(["--env-file=.env", "scripts/run-tests-owned.mjs", ...files], platform).closed;
} catch (e) { error = String(e); }
finally {
  if (database?.child.connected && database.child.exitCode === null) database.child.send({ action: "shutdown" });
  if (database) shutdown = await database.closed;
  await new Promise(resolve => log.end(resolve));
  const bytes = await readFile(prefix + ".tap"), raw = bytes.toString();
  const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => [key, Number(raw.match(new RegExp("^# " + key + " (\\d+)\\r?$", "m"))?.[1] ?? -1)]));
  const unchanged = JSON.stringify(source) === JSON.stringify(await snapshot());
  const required = ["all sixteen connected native roles", "native company tools recheck owner", "native designer generation and editing", "native company namespace rejects altered schemas", "an unknown native company image result fences",
    ...(process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN ? ["real native Codex edits local files, uses company Image 2 and same-thread edits"] : [])];
  const scenarioPassed = name => raw.split(/\r?\n/).some(line => /^ok \d+ - /.test(line) && line.includes(name));
  const passed = !error && testExit === 0 && shutdown === 0 && unchanged && counts.tests >= (process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN ? 16 : 15) && counts.pass === counts.tests && ["fail", "cancelled", "skipped", "todo"].every(k => counts[k] === 0) && raw.includes("# owned_fixture_cleanup") && required.every(scenarioPassed);
  const report = { at: new Date().toISOString(), status: passed ? "passed" : "failed", scope: fullPlatform ? "all_platform_tests_including_cloud_business_tools_and_native_execution" : focused ? "desktop_server_contract_focused" : "desktop_server_contract_and_existing_cloud_regressions",
    error, counts, checks, test_exit_code: testExit, owned_database_shutdown: shutdown === 0, source_unchanged: unchanged, source_files: source,
    raw_report: { path: prefix + ".tap", sha256: hash(bytes) }, verifier: { path: prefix + "-verifier.mjs", sha256: hash(verifier) },
    native_binary_exercised: !!process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN,
    required_scenarios: required,
    not_validated: ["Electron_user_permission_and_execution_integration", ...(!process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN ? ["native_Codex_through_company_billing_gateway"] : []), "signed_installer", "all_roles_and_media_tools", "entire_product_acceptance"] };
  await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, counts, error, source_unchanged: unchanged, shutdown }));
  assert.ok(passed, "Inspect the retained execution-control evidence");
}
