import assert from "node:assert/strict";
import { fork, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import net from "node:net";

const root = process.cwd(), platform = path.resolve("../copypaste-platform"), admin = path.resolve("../copypaste-admin");
const run = randomUUID(), out = path.resolve(".data/admin-overview-160", "qualification-" + run);
await mkdir(out, { recursive: true });
const logs = await open(path.join(out, "commands.log"), "wx");
process.loadEnvFile(path.join(platform, ".env"));
const env = { ...process.env, NODE_ENV: "test", COPYPASTE_NATIVE_DATABASE_DIR: ".data/native-qa/" + run, COPYPASTE_NATIVE_DATABASE_START_ONLY: "true", COPYPASTE_OVERVIEW_FIXTURE_FILE: path.join(out, "private-fixture.json") };
for (const k of ["OWNER_DATABASE_URL", "DATABASE_URL", "CONTROL_DATABASE_URL", "QUEUE_DATABASE_URL"]) {
  const u = new URL(env[k]); assert.ok(["localhost", "127.0.0.1"].includes(u.hostname));
  u.hostname = "127.0.0.1"; u.port = "55440"; u.pathname = "/copypaste"; env[k] = u.href;
}
const result = { at: new Date().toISOString(), status: "running", checks: [], commands: [], error: null, owned_services_closed: false };
const hash = b => createHash("sha256").update(b).digest("hex");
const wait = p => new Promise((resolve, reject) => { p.once("error", reject); p.once("close", code => resolve(code)); });
const occupied = port => new Promise(resolve => { const s = net.connect({ port, host: "127.0.0.1" }); s.once("connect", () => { s.destroy(); resolve(true); }); s.once("error", () => resolve(false)); });
async function runCommand(cwd, args) {
  await logs.write(JSON.stringify({ cwd, args }) + "\n");
  const p = spawn(process.execPath, args, { cwd, env, stdio: ["ignore", logs.fd, logs.fd], windowsHide: true });
  const code = await wait(p); result.commands.push({ cwd, args, exit_code: code }); assert.equal(code, 0, "Command failed; original commands.log retained");
}
let database, api, vite, apiReady = false;
async function stop(p, ipc) {
  if (!p || p.exitCode !== null) return;
  const ended = wait(p);
  if (ipc && p.connected) p.send({ action: "shutdown" }); else p.kill("SIGTERM");
  let timer;
  try { await Promise.race([ended, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Owned shutdown still pending")), 55000); })]); }
  finally { clearTimeout(timer); }
}
try {
  for (const port of [4310, 4318, 55440]) assert.equal(await occupied(port), false, "Port already in use; preserved " + port);
  await runCommand(platform, ["node_modules/typescript/bin/tsc"]);
  result.checks.push("Current backend and the focused fixture/test sources compile");
  database = fork(path.join(platform, "scripts/db-local.ts"), { execArgv: ["--import", "tsx"], cwd: platform, env, stdio: ["ignore", logs.fd, logs.fd, "ipc"], windowsHide: true });
  const deadline = Date.now() + 180000;
  while (!(await readFile(path.join(out, "commands.log"), "utf8")).includes("Native PostgreSQL ready on 127.0.0.1:55440")) {
    assert.equal(database.exitCode, null); assert.ok(Date.now() < deadline); await new Promise(r => setTimeout(r, 150));
  }
  result.checks.push("An exclusively owned native PostgreSQL starts on the selected free port");
  await runCommand(platform, ["scripts/run-tests-owned.mjs", "tests/admin-overview-160-v1.test.ts"]);
  result.checks.push("Eight focused real SQL/HTTP accounting, scope, mode and concurrent-revocation cases pass");
  api = fork(path.join(platform, "scripts/serve-admin-overview-160-v1.ts"), { execArgv: ["--import", "tsx"], cwd: platform, env, stdio: ["ignore", logs.fd, logs.fd, "ipc"], windowsHide: true });
  api.on("message", m => { if (m?.ready) apiReady = true; });
  const readyDeadline = Date.now() + 120000;
  while (!apiReady) { assert.equal(api.exitCode, null); assert.ok(Date.now() < readyDeadline); await new Promise(r => setTimeout(r, 150)); }
  vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--host", "localhost", "--port", "4318", "--strictPort"], { cwd: admin, env, stdio: ["ignore", logs.fd, logs.fd], windowsHide: true });
  const uiDeadline = Date.now() + 30000;
  while (true) { try { const r = await fetch("http://localhost:4318"); if (r.ok) break; } catch {} assert.equal(vite.exitCode, null); assert.ok(Date.now() < uiDeadline); await new Promise(r => setTimeout(r, 100)); }
  await runCommand(root, ["--import", "tsx", "scripts/qa-admin-overview-160-v1.ts", env.COPYPASTE_OVERVIEW_FIXTURE_FILE]);
  const ui = JSON.parse(await readFile("evidence/admin-overview-160/ui-01.json", "utf8"));
  assert.equal(ui.status, "passed"); assert.ok(ui.browser_closed);
  result.browser = { path: "evidence/admin-overview-160/ui-01.json", sha256: hash(await readFile("evidence/admin-overview-160/ui-01.json")), checks: ui.checks };
  result.checks.push("Actual MFA Admin overview, unavailable-data recovery, permission downgrade and bilingual views pass");
} catch (e) { result.error = String(e); }
finally {
  for (const [p, ipc] of [[vite, false], [api, true], [database, true]]) {
    try { await stop(p, ipc); } catch (e) { result.error = (result.error || "") + "; " + String(e); }
  }
  result.owned_services_closed = !(await occupied(4310)) && !(await occupied(4318)) && !(await occupied(55440));
  result.finished_at = new Date().toISOString(); result.verifier_sha256 = hash(await readFile(import.meta.filename));
  await logs.close(); result.log_sha256 = hash(await readFile(path.join(out, "commands.log"))); result.log_directory = path.relative(root, out).replaceAll("\\", "/");
  result.status = !result.error && result.owned_services_closed && result.browser ? "passed" : "failed";
  await mkdir("evidence/admin-overview-160", { recursive: true });
  await writeFile("evidence/admin-overview-160/qualification-01.json", JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: result.status, checks: result.checks.length, error: result.error, owned_services_closed: result.owned_services_closed, log: path.join(out, "commands.log") }));
}
assert.equal(result.status, "passed");
