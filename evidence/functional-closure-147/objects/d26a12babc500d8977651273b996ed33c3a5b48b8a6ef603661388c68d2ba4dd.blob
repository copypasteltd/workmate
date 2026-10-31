import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { lockLocalHandoffParent } from "../src/task-local-handoffs.js";
import { assertTaskContentSources } from "../src/task-content-sources.js";
import { s, fixture, handoff, admitted, ok, call } from "./task-local-handoff-fixture-147-v2.js";

// Actual database locks and HTTP control paths. The imported fixture asserts
// zero provider calls; these checks do not claim a model turn or OS execution.
async function running() {
  const f = await fixture(), h = await handoff(f), native = await admitted(f, h);
  const url = f.base + "/desktop-executions/" + native.task_id;
  const start = await ok(s, f.c, "POST", url + "/start", f.fields);
  const task = (await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [native.task_id])).rows[0];
  return { ...f, h, native, url, start, localTask: task };
}
type F = Awaited<ReturnType<typeof running>>;
async function bounded<T>(work: Promise<T>, message: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([work, new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(message)), 6000);
    })]);
  } finally { if (timer) clearTimeout(timer); }
}
async function blockedBy(pid: number) {
  const deadline = Date.now() + 6000;
  for (;;) {
    const result = await s.db.control.query(`SELECT EXISTS(SELECT 1 FROM pg_stat_activity
      WHERE datname=current_database() AND $1::int=ANY(pg_blocking_pids(pid))) AS waiting`, [pid]);
    if (result.rows[0].waiting) return;
    assert.ok(Date.now() < deadline, "Observe the real competing transaction's database lock wait");
    await delay(20);
  }
}
async function finances(f: F) {
  return (await s.db.control.query(`SELECT task_id,amount_micros FROM reservations
    WHERE task_id=ANY($1::uuid[]) ORDER BY task_id`, [[f.task.id, f.native.task_id]])).rows;
}
async function unchangedExecution(f: F, revision: number) {
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM tasks WHERE input_context->>'local_handoff_id'=$1", [f.h.id])).rows[0].n, 1);
  assert.equal((await s.db.control.query("SELECT revision FROM task_local_handoffs WHERE id=$1", [f.h.id])).rows[0].revision, revision);
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM reservations WHERE task_id=ANY($1::uuid[])", [[f.task.id, f.native.task_id]])).rows[0].n, 2);
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM ai_gateway_requests WHERE task_id=$1", [f.native.task_id])).rows[0].n, 0);
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM ai_input_count_requests WHERE task_id=$1", [f.native.task_id])).rows[0].n, 0);
}

test("a held real handoff authorization read permits concurrent source/configuration reads and native heartbeat", async () => {
  const f = await running(), holder = await s.db.control.connect(), money = await finances(f);
  const requests: Promise<any>[] = [];
  try {
    await holder.query("BEGIN");
    await holder.query("SET LOCAL statement_timeout='6s'");
    await lockLocalHandoffParent(holder, f.localTask);
    requests.push(s.db.tx(tx => assertTaskContentSources(tx, f.localTask), f.tenant, false, f.web.id));
    requests.push(call(s, f.c, "GET", f.base + "/tasks/" + f.native.task_id + "/project-configuration"));
    requests.push(call(s, f.c, "POST", f.url + "/heartbeat", {}));
    const results = await bounded(Promise.all(requests), "Compatible authorization readers must finish before the held helper transaction releases");
    assert.equal(results[1].status, 200, JSON.stringify(results[1].data));
    assert.equal(results[2].status, 200, JSON.stringify(results[2].data));
    assert.equal(results[2].data.status, "running");
    assert.equal(results[2].data.task_id, f.native.task_id);
  } finally {
    await holder.query("ROLLBACK"); holder.release();
    await Promise.allSettled(requests);
  }
  assert.deepEqual(await finances(f), money);
  await unchangedExecution(f, f.h.revision + 1);
});

test("a heartbeat waiting on the real native child cannot make its owner's source manifest fail NOWAIT", async () => {
  const f = await running(), holder = await s.db.control.connect(), money = await finances(f);
  let heartbeat: ReturnType<typeof call> | undefined;
  try {
    await holder.query("BEGIN");
    await holder.query("SET LOCAL statement_timeout='6s'");
    const pid = Number((await holder.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
    await holder.query("SELECT id FROM tasks WHERE id=$1 FOR UPDATE", [f.native.task_id]);
    heartbeat = call(s, f.c, "POST", f.url + "/heartbeat", {});
    void heartbeat.catch(() => {});
    await blockedBy(pid);
    // Heartbeat has reached the locked child after the actual parent/handoff
    // helper. This is the native-inference/heartbeat cycle observed by UI 07.
    await assertTaskContentSources(holder, f.localTask);
    await holder.query("COMMIT");
    const result = await bounded(heartbeat, "The same heartbeat must finish after the child owner commits");
    assert.equal(result.status, 200, JSON.stringify(result.data));
    assert.equal(result.data.task_id, f.native.task_id); assert.equal(result.data.status, "running");
  } finally {
    await holder.query("ROLLBACK"); holder.release();
    await heartbeat?.catch(() => {});
  }
  assert.deepEqual(await finances(f), money);
  await unchangedExecution(f, f.h.revision + 1);
});

test("handoff withdrawal waits for actual authorization readers and still denies later native inference without another fee", async () => {
  const f = await running(), holder = await s.db.control.connect(), money = await finances(f);
  let withdrawal: ReturnType<typeof call> | undefined;
  try {
    await holder.query("BEGIN");
    await holder.query("SET LOCAL statement_timeout='6s'");
    const pid = Number((await holder.query("SELECT pg_backend_pid() AS pid")).rows[0].pid);
    await lockLocalHandoffParent(holder, f.localTask);
    withdrawal = call(s, f.web, "POST", f.base + "/local-handoffs/" + f.h.id + "/cancel", { expected_revision: f.h.revision + 1, confirm: true });
    void withdrawal.catch(() => {});
    await blockedBy(pid);
    await assertTaskContentSources(holder, f.localTask);
    await holder.query("COMMIT");
    const cancelled = await bounded(withdrawal, "An actual source mutation must continue after the authorization reader commits");
    assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data)); assert.equal(cancelled.data.state, "cancelled");
  } finally {
    await holder.query("ROLLBACK"); holder.release();
    await withdrawal?.catch(() => {});
  }
  await assert.rejects(s.db.tx(tx => assertTaskContentSources(tx, f.localTask), f.tenant, false, f.web.id), (e: any) => e.code === "TASK_SOURCE_REVOKED");
  const config = await call(s, f.c, "GET", f.base + "/tasks/" + f.native.task_id + "/project-configuration");
  assert.equal(config.status, 409); assert.equal(config.data.error.code, "TASK_SOURCE_REVOKED");
  // Actual scoped HTTP inference preflight must deny before touching the
  // fixture provider; its zero-call assertion remains in force.
  const inference = await s.app.inject({ method: "POST", url: "/v1/desktop-inference/v1/responses",
    headers: { Authorization: "Bearer " + f.start.credential.token, "Content-Type": "application/json" },
    payload: JSON.stringify({ model: f.start.model, input: "Read the explicitly approved input", stream: true }) });
  assert.equal(inference.statusCode, 409, inference.body); assert.equal(inference.json().error.code, "TASK_SOURCE_REVOKED");
  assert.deepEqual(await finances(f), money);
  assert.equal((await s.db.control.query("SELECT charged_micros FROM tasks WHERE id=$1", [f.native.task_id])).rows[0].charged_micros, "0");
  await unchangedExecution(f, f.h.revision + 2);
});
