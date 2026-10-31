// Owned native PostgreSQL and actual Web only. Never touch another database.
import assert from "node:assert/strict";
import { fork, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const root = process.cwd(), platform = path.resolve("../copypaste-platform"), web = path.resolve("../copypaste-web"), out = path.resolve(".data/session-fence-163/ui-" + randomUUID());
await mkdir(out, { recursive: true });
const log = await open(path.join(out, "commands.log"), "wx");
const publicReceipt = "evidence/session-boundary-163/ui-qualification-03.json";
await assert.rejects(readFile(publicReceipt), e => e.code === "ENOENT");
const digest = b => createHash("sha256").update(b).digest("hex");
process.loadEnvFile(path.join(platform, ".env"));
const env = { ...process.env, NODE_ENV: "test", COPYPASTE_NATIVE_DATABASE_DIR: ".data/native-qa/" + randomUUID(), COPYPASTE_NATIVE_DATABASE_START_ONLY: "true", COPYPASTE_SESSION_BOUNDARY_FIXTURE: path.join(out, "private-fixture.json") };
for (const k of ["OWNER_DATABASE_URL", "DATABASE_URL", "CONTROL_DATABASE_URL", "QUEUE_DATABASE_URL"]) {
  const u = new URL(env[k]); assert.ok(["localhost", "127.0.0.1"].includes(u.hostname));
  u.hostname = "127.0.0.1"; u.port = "55441"; u.pathname = "/copypaste"; env[k] = u.href;
}
const sourceNames = ["copypaste-web/src/api.ts", "copypaste-web/src/session-request.ts", "copypaste-web/src/task-events.ts", "copypaste-platform/scripts/serve-session-boundary-163-v2.ts", "copypaste-delivery/scripts/qa-session-boundary-163-v3.ts", "copypaste-delivery/scripts/qualify-session-ui-163-v3.mjs"];
const snapshot = async () => Object.fromEntries(await Promise.all(sourceNames.map(async name => [name, digest(await readFile(path.resolve("..", name)))])));
const before = await snapshot();
const result = { at: new Date().toISOString(), status: "running", error: null, checks: [], owned_services_closed: false, source_before: before };
function launch(args, cwd, ipc = false) {
  const child = spawn(process.execPath, args, { cwd, env, stdio: ipc ? ["ignore", log.fd, log.fd, "ipc"] : ["ignore", log.fd, log.fd], windowsHide: true });
  const closed = new Promise(resolve => { child.once("error", () => resolve(1)); child.once("close", code => resolve(code ?? 1)); });
  return { child, closed };
}
const occupied = port => new Promise(resolve => { const s = net.connect({ host: "127.0.0.1", port }); s.once("connect", () => { s.destroy(); resolve(true); }); s.once("error", e => { s.destroy(); resolve(e.code !== "ECONNREFUSED"); }); s.setTimeout(1500, () => { s.destroy(); resolve(true); }); });
async function ready(process, read, milliseconds) {
  const end = Date.now() + milliseconds;
  while (!await read()) { assert.equal(process.child.exitCode, null); assert.ok(Date.now() < end, "Owned readiness deadline"); await new Promise(r => setTimeout(r, 150)); }
}
async function stop(p, ipc) {
  if (!p || p.child.exitCode !== null) return;
  if (ipc && p.child.connected) p.child.send({ action: "shutdown" }); else p.child.kill("SIGTERM");
  let timer;
  try { await Promise.race([p.closed, new Promise((_, reject) => timer = setTimeout(() => reject(new Error("Owned shutdown deadline")), 55000))]); }
  finally { clearTimeout(timer); }
}
let database, api, vite;
try {
  for (const port of [4310, 4317, 55441]) assert.equal(await occupied(port), false, "Existing port owner preserved: " + port);
  database = launch(["scripts/native-db-launch.mjs"], platform, true);
  await ready(database, async () => (await readFile(path.join(out, "commands.log"), "utf8")).includes("Native PostgreSQL ready on 127.0.0.1:55441"), 120000);
  console.log("Owned native database ready");
  let apiReady = false;
  api = launch(["--import", "tsx", "scripts/serve-session-boundary-163-v2.ts"], platform, true);
  api.child.on("message", m => { if (m?.ready) apiReady = true; });
  await ready(api, async () => apiReady, 120000);
  vite = launch(["node_modules/vite/bin/vite.js", "--host", "localhost", "--port", "4317", "--strictPort"], web);
  await ready(vite, async () => { try { return (await fetch("http://localhost:4317")).ok; } catch { return false; } }, 30000);
  console.log("Actual Web and isolated API ready");
  const journey = launch(["--import", "tsx", "scripts/qa-session-boundary-163-v3.ts", env.COPYPASTE_SESSION_BOUNDARY_FIXTURE], root);
  assert.equal(await journey.closed, 0, "Actual Web journey failed; original logs retained");
  const ui = JSON.parse(await readFile("evidence/session-boundary-163/ui-03.json", "utf8"));
  assert.equal(ui.status, "passed"); assert.ok(ui.browser_closed); assert.equal(ui.checks.length, 3);
  result.checks = ui.checks; result.browser = { path: "evidence/session-boundary-163/ui-03.json", sha256: digest(await readFile("evidence/session-boundary-163/ui-03.json")) };
} catch (e) { result.error = String(e); }
finally {
  for (const [p, ipc] of [[vite, false], [api, true], [database, true]]) try { await stop(p, ipc); } catch (e) { result.error = (result.error || "") + "; " + String(e); }
  result.owned_services_closed = !(await occupied(4310)) && !(await occupied(4317)) && !(await occupied(55441));
  result.source_unchanged = JSON.stringify(before) === JSON.stringify(await snapshot());
  result.status = !result.error && result.browser && result.owned_services_closed && result.source_unchanged ? "passed" : "failed";
  result.finished_at = new Date().toISOString(); result.verifier_sha256 = digest(await readFile(import.meta.filename));
  await log.close(); result.private_log = path.relative(root, path.join(out, "commands.log")).replaceAll("\\", "/"); result.private_log_sha256 = digest(await readFile(path.join(out, "commands.log")));
  await writeFile(publicReceipt, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: result.status, error: result.error, checks: result.checks.length, owned_services_closed: result.owned_services_closed, receipt: publicReceipt }));
}
assert.equal(result.status, "passed");
