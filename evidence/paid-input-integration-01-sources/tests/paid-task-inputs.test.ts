import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { Worker } from "../src/worker.js";
import { saveAsset } from "../src/storage.js";
import {
  CodexRuntimeAdapter,
  type RuntimeContext,
  type RuntimeResult,
} from "../src/runtime.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>;
let s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string };
async function call(c: Client | undefined, method: string, url: string,
  body?: unknown, tenant?: string, requestKey = randomUUID()) {
  const raw = await s.app.inject({ method: method as any, url,
    headers: { origin: "http://localhost:4317", "idempotency-key": requestKey,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      ...(tenant ? { "x-tenant-id": tenant } : {}) }, payload: body });
  return { status: raw.statusCode, data: raw.json(), raw };
}
function value(r: Awaited<ReturnType<typeof call>>, status = 200) {
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
}
async function user(): Promise<Client> {
  const c = value(await call(undefined, "POST", "/v1/auth/challenge",
    { email: `paid-input-${randomUUID()}@example.invalid` }));
  const mail = JSON.parse(await readFile(`${s.db.config.DATA_DIR}/mailbox/${c.challenge_id}.json`, "utf8"));
  const r = await call(undefined, "POST", "/v1/auth/verify",
    { challenge_id: c.challenge_id, code: mail.text.match(/\b\d{6}\b/)[0] });
  const d = value(r);
  return { id: d.user.id, cookie: r.raw.cookies[0].name + "=" + r.raw.cookies[0].value, csrf: d.csrf_token };
}
async function fixture() {
  const owner = await user();
  const w = value(await call(owner, "POST", "/v1/tenants",
    { name: "Paid input continuity", project_name: "Retained work" }));
  const tenant = w.tenant.id, project = w.project.id;
  await s.db.control.query("UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1", [tenant]);
  const base = `/v1/tenants/${tenant}/projects/${project}`;
  const d = value(await call(owner, "POST", base + "/delegations", {
    title: "Continue the original paid task", prompt: "Prepare the deliverable after reading my approved material.",
    mode: "execute", budget_micros: 1000000, client_message_id: randomUUID(),
  }));
  return { owner, tenant, project, base, task: d.task, conversation: d.conversation };
}
async function selectedAsset(f: Awaited<ReturnType<typeof fixture>>) {
  const a = await s.db.tx(tx => saveAsset(tx, s.storage, {
    tenant: f.tenant, project: f.project, user: f.owner.id, name: "approved.txt",
    mime: "text/plain", bytes: Buffer.from("APPROVED_PAID_INPUT"), kind: "file",
  }), f.tenant, false, f.owner.id);
  const v = (await s.db.control.query("SELECT id FROM asset_versions WHERE asset_id=$1", [a.id])).rows[0].id;
  return { id: a.id, version: v };
}
async function task(f: Awaited<ReturnType<typeof fixture>>) {
  return (await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [f.task.id])).rows[0];
}
class InputRuntime extends CodexRuntimeAdapter {
  calls: RuntimeContext[] = [];
  thread = "paid-input-thread-" + randomUUID();
  constructor(private failSecond = false) { super(s.db.config); }
  override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
    this.calls.push(ctx);
    const turn = "turn-" + this.calls.length;
    await ctx.onEvent("runtime.thread", { thread_id: this.thread });
    await ctx.onEvent("runtime.turn", { turn_id: turn });
    if (this.calls.length === 1) {
      const input = ctx.tools.find(t => t.name === "request_input");
      assert.ok(input, "A model must be able to report an essential input gap after paid work started");
      await input.run({ requests: [{ kind: "file", description: "Approved material required for the remaining work" }] }, "input-call-1");
    } else {
      assert.equal(ctx.thread, this.thread, "Resume the actual paid thread on the same task");
      assert.ok(ctx.prompt.includes("approved.txt"));
      if (this.failSecond) throw new Error("Controlled failure before another provider dispatch");
      await ctx.tools.find(t => t.name === "deliver_text")!.run({
        filename: "complete.txt", content: "Completed with the selected input", mime_type: "text/plain",
      }, "final-write");
    }
    return { text: this.calls.length === 1 ? "Please select the approved source." : "The original work is complete.",
      status: "completed", inputTokens: 100, outputTokens: 50, usageKnown: true, accepted: true,
      thread: this.thread, turn };
  }
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", WORKER_ENABLED: "false",
    DEMO_MODE: "false", AI_BASE_URL: "http://127.0.0.1:9/v1", AI_ALLOWED_HOSTS: "127.0.0.1",
    AI_API_KEY: "controlled-fixture", AI_MODEL: "controlled-fixture", AI_VERIFIED: "true",
    AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000",
  }), { worker: false });
});
after(async () => { try { if (s) await s.app.close(); } finally { await isolated?.cleanup(); } });

test("a paid model input gap waits on the original task, resumes the same thread and settles one cumulative charge", async () => {
  const f = await fixture(), runtime = new InputRuntime(), worker = new Worker(s.db, s.catalog, s.storage, runtime);
  await worker.run(f.tenant, f.task.id);
  const waiting = await task(f);
  assert.equal(waiting.status, "needs_input", "A completed paid input-request turn must become a resumable input checkpoint");
  assert.equal(waiting.attempt, 1);
  assert.equal(Number(waiting.accrued_micros), 150);
  assert.equal(Number(waiting.charged_micros), 0);
  assert.equal((await s.db.control.query("SELECT status FROM reservations WHERE task_id=$1", [f.task.id])).rows[0].status, "reserved");
  const dependencies = value(await call(f.owner, "GET", f.base + `/tasks/${f.task.id}/dependencies`)).items;
  assert.equal(dependencies.length, 1);
  const a = await selectedAsset(f), d = dependencies[0], requestKey = randomUUID();
  const r = await call(f.owner, "POST", `/v1/task-dependencies/${d.id}/resolutions`,
    { expected_version: d.version, resource_ids: [a.version] }, f.tenant, requestKey);
  assert.equal(value(r, 202).id, f.task.id);
  value(await call(f.owner, "POST", `/v1/task-dependencies/${d.id}/resolutions`,
    { expected_version: d.version, resource_ids: [a.version] }, f.tenant, requestKey), 202);
  await Promise.all([worker.run(f.tenant, f.task.id), worker.run(f.tenant, f.task.id)]);
  const done = await task(f);
  assert.equal(done.status, "succeeded");
  assert.equal(done.attempt, 2);
  assert.equal(runtime.calls.length, 2);
  assert.equal(Number(done.charged_micros), 300);
  assert.equal(Number(done.input_tokens), 200);
  assert.equal(Number(done.output_tokens), 100);
  const financial = await s.db.control.query("SELECT count(*)::int AS n,sum(amount_micros)::text AS total FROM ledger WHERE task_id=$1 AND kind='charge'", [f.task.id]);
  assert.deepEqual(financial.rows[0], { n: 1, total: "-300" });
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM reservations WHERE task_id=$1", [f.task.id])).rows[0].n, 1);
});

test("cancelling a paid input checkpoint settles its already measured work once", async () => {
  const f = await fixture(), runtime = new InputRuntime();
  await new Worker(s.db, s.catalog, s.storage, runtime).run(f.tenant, f.task.id);
  assert.equal((await task(f)).status, "needs_input");
  value(await call(f.owner, "POST", f.base + `/tasks/${f.task.id}/cancel`, {}));
  const stopped = await task(f);
  assert.equal(stopped.status, "cancelled");
  assert.equal(Number(stopped.charged_micros), 150);
  assert.equal(runtime.calls.length, 1);
  assert.equal((await s.db.control.query("SELECT status FROM reservations WHERE task_id=$1", [f.task.id])).rows[0].status, "settled");
});
