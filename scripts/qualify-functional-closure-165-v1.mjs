// Owned native PostgreSQL, actual Web and Admin only. Never touch another database.
import assert from "node:assert/strict";
import { fork, spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, readFile, writeFile } from "node:fs/promises";
import net from "node:net";
import path from "node:path";

const root = process.cwd(), platform = path.resolve("../copypaste-platform"), web = path.resolve("../copypaste-web"), admin = path.resolve("../copypaste-admin"), out = path.resolve(".data/functional-closure-165/ui-" + randomUUID());
await mkdir(out, { recursive: true });
await mkdir("evidence/functional-closure-165", { recursive: true });
const log = await open(path.join(out, "commands.log"), "wx");
const publicReceipt = "evidence/functional-closure-165/ui-qualification-01.json";
await assert.rejects(readFile(publicReceipt), e => e.code === "ENOENT");
const digest = b => createHash("sha256").update(b).digest("hex");
process.loadEnvFile(path.join(platform, ".env"));
const env = { ...process.env, NODE_ENV: "test", COPYPASTE_NATIVE_DATABASE_DIR: ".data/native-qa/" + randomUUID(), COPYPASTE_NATIVE_DATABASE_START_ONLY: "true", COPYPASTE_FUNCTIONAL_FIXTURE: path.join(out, "private-fixture.json") };
for (const k of ["OWNER_DATABASE_URL", "DATABASE_URL", "CONTROL_DATABASE_URL", "QUEUE_DATABASE_URL"]) {
  const u = new URL(env[k]); assert.ok(["localhost", "127.0.0.1"].includes(u.hostname));
  u.hostname = "127.0.0.1"; u.port = "55442"; u.pathname = "/copypaste"; env[k] = u.href;
}
const sourceNames = ["copypaste-web/src/workspace-creation.ts", "copypaste-web/src/workspace-creation-form.tsx", "copypaste-web/src/api.ts", "copypaste-web/src/context.tsx", "copypaste-platform/src/workspaces.ts", "copypaste-platform/tests/workspace-creation-165-v1.test.ts", "copypaste-admin/src/main.tsx", "copypaste-admin/src/directory.tsx", "copypaste-platform/scripts/serve-functional-closure-165-v1.ts", "copypaste-delivery/scripts/qa-workspace-recovery-165-v1.ts", "copypaste-delivery/scripts/qa-admin-target-165-v1.ts", "copypaste-delivery/scripts/qualify-functional-closure-165-v1.mjs"];
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
let database, api, vite, adminVite;
try {
  for (const port of [4310, 4317, 4318, 55442]) assert.equal(await occupied(port), false, "Existing port owner preserved: " + port);
  database = launch(["scripts/native-db-launch.mjs"], platform, true);
  await ready(database, async () => (await readFile(path.join(out, "commands.log"), "utf8")).includes("Native PostgreSQL ready on 127.0.0.1:55442"), 120000);
  console.log("Owned native database ready");
  const core = launch(["scripts/run-tests-owned.mjs", "tests/workspace-creation-165-v1.test.ts"], platform);
  assert.equal(await core.closed, 0, "Focused database checks failed; original logs retained");
  const helper = launch(["--import", "tsx", "--test", "tests/workspace-creation-165.test.ts"], web);
  assert.equal(await helper.closed, 0, "Workspace helper checks failed");
  result.focused_database_tests = 7; result.focused_helper_tests = 4;
  let apiReady = false;
  api = launch(["--import", "tsx", "scripts/serve-functional-closure-165-v1.ts"], platform, true);
  api.child.on("message", m => { if (m?.ready) apiReady = true; });
  await ready(api, async () => apiReady, 120000);
  vite = launch(["node_modules/vite/bin/vite.js", "--host", "localhost", "--port", "4317", "--strictPort"], web);
  await ready(vite, async () => { try { return (await fetch("http://localhost:4317")).ok; } catch { return false; } }, 30000);
  adminVite = launch(["node_modules/vite/bin/vite.js", "--host", "localhost", "--port", "4318", "--strictPort"], admin);
  await ready(adminVite, async () => { try { return (await fetch("http://localhost:4318")).ok; } catch { return false; } }, 30000);
  console.log("Actual Web, Admin and isolated API ready");
  const receipts = [];
  for (const [script, receipt] of [["qa-workspace-recovery-165-v1.ts", "workspace-ui-01.json"], ["qa-admin-target-165-v1.ts", "admin-ui-01.json"]]) {
    const journey = launch(["--import", "tsx", "scripts/" + script, env.COPYPASTE_FUNCTIONAL_FIXTURE], root);
    assert.equal(await journey.closed, 0, "Actual UI journey failed; original logs retained");
    const p = "evidence/functional-closure-165/" + receipt, ui = JSON.parse(await readFile(p, "utf8"));
    assert.equal(ui.status, "passed"); assert.ok(ui.browser_closed); assert.ok(ui.checks.length >= 3);
    result.checks.push(...ui.checks); receipts.push({ path: p, sha256: digest(await readFile(p)) });
  }
  result.browser = receipts;
} catch (e) { result.error = String(e); }
finally {
  for (const [p, ipc] of [[adminVite, false], [vite, false], [api, true], [database, true]]) try { await stop(p, ipc); } catch (e) { result.error = (result.error || "") + "; " + String(e); }
  result.owned_services_closed = !(await occupied(4310)) && !(await occupied(4317)) && !(await occupied(4318)) && !(await occupied(55442));
  result.source_unchanged = JSON.stringify(before) === JSON.stringify(await snapshot());
  result.status = !result.error && result.browser && result.owned_services_closed && result.source_unchanged ? "passed" : "failed";
  result.finished_at = new Date().toISOString(); result.verifier_sha256 = digest(await readFile(import.meta.filename));
  await log.close(); result.private_log = path.relative(root, path.join(out, "commands.log")).replaceAll("\\", "/"); result.private_log_sha256 = digest(await readFile(path.join(out, "commands.log")));
  await writeFile(publicReceipt, JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: result.status, error: result.error, checks: result.checks.length, owned_services_closed: result.owned_services_closed, receipt: publicReceipt }));
}
assert.equal(result.status, "passed");
