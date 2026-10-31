import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const root = process.cwd(), platform = path.resolve("../copypaste-platform"), admin = path.resolve("../copypaste-admin");
const out = path.resolve(".data/admin-team-usage-174/run-" + randomUUID());
await mkdir(out, { recursive: true }); await mkdir("evidence/admin-team-usage-174", { recursive: true });
const receipt = "evidence/admin-team-usage-174/qualification-02.json";
await assert.rejects(readFile(receipt), e => e.code === "ENOENT");
const log = await open(path.join(out, "commands.log"), "wx"), digest = b => createHash("sha256").update(b).digest("hex");
process.loadEnvFile(path.join(platform, ".env"));
const env = { ...process.env, NODE_ENV: "test", COPYPASTE_NATIVE_DATABASE_DIR: ".data/native-qa/" + randomUUID(), COPYPASTE_NATIVE_DATABASE_START_ONLY: "true", COPYPASTE_FUNCTIONAL_FIXTURE: path.join(out, "private-fixture.json") };
for (const key of ["OWNER_DATABASE_URL", "DATABASE_URL", "CONTROL_DATABASE_URL", "QUEUE_DATABASE_URL"]) {
  const url = new URL(env[key]); assert.ok(["localhost", "127.0.0.1"].includes(url.hostname)); url.hostname = "127.0.0.1"; url.port = "55446"; url.pathname = "/copypaste"; env[key] = url.href;
}
const files = ["copypaste-platform/src/admin.ts", "copypaste-platform/src/admin-usage-reports.ts", "copypaste-platform/src/admin-usage-report-model.ts", "copypaste-platform/src/admin-usage-report-query.ts", "copypaste-platform/tests/admin-usage-report-169-v1.test.ts", "copypaste-platform/tests/admin-posting-period-172-v2.test.ts", "copypaste-platform/tests/admin-team-usage-174-v1.test.ts", "copypaste-platform/tests/admin-team-usage-fixture-174-v1.ts", "copypaste-platform/scripts/serve-admin-team-usage-174-v1.ts", "copypaste-admin/src/main.tsx", "copypaste-admin/src/usage-reports.tsx", "copypaste-admin/src/usage-reports.css", "copypaste-delivery/scripts/qa-admin-team-usage-174-v2.ts", "copypaste-delivery/scripts/qualify-admin-team-usage-174-v2.mjs"];
const snapshot = async () => Object.fromEntries(await Promise.all(files.map(async name => [name, digest(await readFile(path.resolve("..", name)))])));
const before = await snapshot(), result = { at: new Date().toISOString(), status: "running", error: null, build_commands: [], source_before: before, owned_services_closed: false };
function launch(args, cwd, ipc = false) {
  const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: ipc ? ["ignore", log.fd, log.fd, "ipc"] : ["ignore", log.fd, log.fd] });
  const closed = new Promise(resolve => { child.once("error", () => resolve(1)); child.once("close", code => resolve(code ?? 1)); }); return { child, closed };
}
const occupied = port => new Promise(resolve => {
  const socket = net.connect({ host: "127.0.0.1", port }); socket.once("connect", () => { socket.destroy(); resolve(true); }); socket.once("error", e => { socket.destroy(); resolve(e.code !== "ECONNREFUSED"); }); socket.setTimeout(1500, () => { socket.destroy(); resolve(true); });
});
async function ready(process, check, ms) {
  const end = Date.now() + ms;
  while (!await check()) { assert.equal(process.child.exitCode, null); assert.ok(Date.now() < end, "Owned readiness deadline"); await new Promise(resolve => setTimeout(resolve, 150)); }
}
async function stop(process, ipc) {
  if (!process || process.child.exitCode !== null) return;
  if (ipc && process.child.connected) process.child.send({ action: "shutdown" }); else process.child.kill("SIGTERM");
  let timer; try { await Promise.race([process.closed, new Promise((_, reject) => timer = setTimeout(() => reject(new Error("Owned shutdown deadline")), 55000))]); } finally { clearTimeout(timer); }
}
let db, api, vite;
try {
  for (const port of [4310, 4318, 55446]) assert.equal(await occupied(port), false, "Existing port owner preserved: " + port);
  const priorPath = "evidence/admin-team-usage-174/qualification-01.json", prior = JSON.parse(await readFile(priorPath, "utf8"));
  assert.equal(prior.status, "failed"); assert.ok(prior.source_unchanged && prior.owned_services_closed); assert.equal(prior.database_tests, 21);
  assert.equal(prior.build_commands.length, 4); assert.ok(prior.build_commands.every(c => c.exit_code === 0));
  const priorLog = await readFile(path.resolve(root, prior.private_log)); assert.equal(digest(priorLog), prior.private_log_sha256);
  assert.match(priorLog.toString("utf8"), /# tests 21\r?\n/); assert.match(priorLog.toString("utf8"), /# pass 21\r?\n/); assert.match(priorLog.toString("utf8"), /# fail 0\r?\n/);
  for (const [name, hash] of Object.entries(prior.source_after)) if (name in before) assert.equal(before[name], hash, "Inherited source changed: " + name);
  result.build_commands = prior.build_commands; result.database_tests = 21; result.fresh_team_sql_api_tests = 0; result.inherited_current_team_sql_api_tests = 6; result.current_legacy_report_cases = 15;
  result.inherited_checks = { path: priorPath, sha256: digest(await readFile(priorPath)), exact_source_cases: 21, scope: "Four production build commands and 21 successful SQL/API cases only. The original UI interruption remains failed. A new UI verifier serializes movie/still screenshots." };
  console.log("Exact-source builds and 21 successful report cases verified; supplementing actual UI only");
  db = launch(["scripts/native-db-launch.mjs"], platform, true);
  await ready(db, async () => (await readFile(path.join(out, "commands.log"), "utf8")).includes("Native PostgreSQL ready on 127.0.0.1:55446"), 120000);
  let apiReady = false; api = launch(["--import", "tsx", "scripts/serve-admin-team-usage-174-v1.ts"], platform, true); api.child.on("message", message => { if (message?.ready) apiReady = true; });
  await ready(api, async () => apiReady, 120000);
  vite = launch(["node_modules/vite/bin/vite.js", "--host", "localhost", "--port", "4318", "--strictPort"], admin);
  await ready(vite, async () => { try { return (await fetch("http://localhost:4318")).ok; } catch { return false; } }, 30000);
  const ui = launch(["--import", "tsx", "scripts/qa-admin-team-usage-174-v2.ts", env.COPYPASTE_FUNCTIONAL_FIXTURE], root);
  assert.equal(await ui.closed, 0, "Actual Admin UI checks failed; originals retained");
  const uiPath = "evidence/admin-team-usage-174/admin-ui-02.json", data = JSON.parse(await readFile(uiPath, "utf8")); assert.equal(data.status, "passed"); assert.ok(data.browser_closed);
  result.ui = { path: uiPath, sha256: digest(await readFile(uiPath)), checks: data.checks.length };
} catch (error) { result.error = String(error); }
finally {
  for (const [process, ipc] of [[vite, false], [api, true], [db, true]]) try { await stop(process, ipc); } catch (error) { result.error = (result.error || "") + "; " + String(error); }
  result.owned_services_closed = !(await occupied(4310)) && !(await occupied(4318)) && !(await occupied(55446));
  result.source_after = await snapshot(); result.source_unchanged = JSON.stringify(before) === JSON.stringify(result.source_after);
  result.status = !result.error && result.ui && result.source_unchanged && result.owned_services_closed ? "passed" : "failed";
  result.finished_at = new Date().toISOString(); result.verifier_sha256 = digest(await readFile(import.meta.filename)); await log.close();
  result.private_log = path.relative(root, path.join(out, "commands.log")).replaceAll("\\", "/"); result.private_log_sha256 = digest(await readFile(path.join(out, "commands.log")));
  await writeFile(receipt, JSON.stringify(result, null, 2) + "\n", { flag: "wx" }); console.log(JSON.stringify({ status: result.status, error: result.error, receipt, owned_services_closed: result.owned_services_closed }));
}
assert.equal(result.status, "passed");
