import assert from "node:assert/strict";
import { writeFile } from "node:fs/promises";
import { isolatedTestEnvironment } from "../tests/native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { overviewWorkspace, overviewAdmin, overviewTask, overviewSettle } from "../tests/admin-overview-fixture-160-v2.js";

const file = process.env.COPYPASTE_OVERVIEW_FIXTURE_FILE;
assert.ok(file);
const isolated = await isolatedTestEnvironment();
let s: Awaited<ReturnType<typeof buildApp>> | undefined, closing = false;
async function close() {
  if (closing) return; closing = true;
  try { await s?.app.close(); } finally { await isolated.cleanup(); }
  process.exit(0);
}
process.on("message", m => { if ((m as any)?.action === "shutdown") void close(); });
process.on("SIGTERM", () => void close());
try {
  s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "false", DEV_MAILBOX: "true", WORKER_ENABLED: "false", AI_BASE_URL: "http://127.0.0.1:9/v1", AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "explicit-synthetic-no-requests", AI_MODEL: "synthetic-fixture", AI_VERIFIED: "true", AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000" }), { worker: false });
  const f = await overviewWorkspace(s), admin = await overviewAdmin(s, undefined, false);
  const settled = await overviewTask(s, f); await overviewSettle(s, f, settled.id);
  await overviewTask(s, f, f.personalWallet);
  const role = (await s.db.control.query("SELECT role_key FROM admin_bindings WHERE principal_id=$1", [admin.id])).rows[0].role_key;
  await s.app.listen({ host: "127.0.0.1", port: 4310 });
  await writeFile(file, JSON.stringify({ email: admin.email, secret: admin.secret.base32, principal: admin.id, role, mailbox: s.db.config.DATA_DIR + "/mailbox", database_url: isolated.env.CONTROL_DATABASE_URL, expected: { users: 1, tenants: 1, charged_micros: "875000", reserved_micros: "1000000" } }), { flag: "wx" });
  process.send?.({ ready: true });
} catch (e) { try { await s?.app.close(); } finally { await isolated.cleanup(); } throw e; }
