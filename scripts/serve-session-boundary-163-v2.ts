import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { isolatedTestEnvironment } from "../tests/native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { overviewWorkspace, overviewTask } from "../tests/admin-overview-fixture-160-v2.js";

const file = process.env.COPYPASTE_SESSION_BOUNDARY_FIXTURE;
assert.ok(file);
const isolated = await isolatedTestEnvironment();
let system: Awaited<ReturnType<typeof buildApp>> | undefined, closing = false;
async function close() {
  if (closing) return; closing = true;
  try { await system?.app.close(); } finally { await isolated.cleanup(); }
  process.exit(0);
}
process.on("message", m => { if ((m as any)?.action === "shutdown") void close(); });
process.on("SIGTERM", () => void close());
try {
  system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", DEV_MAILBOX: "true", WORKER_ENABLED: "false", API_ORIGIN: "http://localhost:4310", WEB_ORIGIN: "http://localhost:4317", ADMIN_ORIGIN: "http://localhost:4318" }), { worker: false });
  const f = await overviewWorkspace(system), task = await overviewTask(system, f);
  const second = await overviewWorkspace(system);
  await system.app.listen({ host: "127.0.0.1", port: 4310 });
  await writeFile(file, JSON.stringify({ user: f.owner.id, email: f.owner.email, tenant: f.tenant, project: f.project, task: task.id, mailbox: system.db.config.DATA_DIR + "/mailbox", database_url: isolated.env.CONTROL_DATABASE_URL, second: { user: second.owner.id, email: second.owner.email, tenant: second.tenant, project: second.project } }), { flag: "wx" });
  process.send?.({ ready: true });
} catch (e) { try { await system?.app.close(); } finally { await isolated.cleanup(); } throw e; }
