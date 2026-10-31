import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { historyLogin, type HistoryClient } from "./admin-history-fixture.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>;
let s: Awaited<ReturnType<typeof buildApp>>;
let owner: pg.Pool;
before(async () => {
  // A fresh owned native database per file; never a demonstration/customer database.
  isolated = await isolatedTestEnvironment();
  owner = new pg.Pool({ connectionString: isolated.env.OWNER_DATABASE_URL });
  s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", WORKER_ENABLED: "false" }), { worker: false });
});
after(async () => {
  try { await s?.app.close(); await owner?.end(); }
  finally { await isolated?.cleanup(); }
});

const proposal = () => ({ name: "Harbour first workspace", project_name: "Original approved project" });
async function call(client: HistoryClient | null, key: string, body?: ReturnType<typeof proposal>) {
  const raw = await s.app.inject({
    method: body ? "POST" : "GET",
    url: body ? "/v1/tenants" : "/v1/workspace-creation-requests/" + encodeURIComponent(key),
    headers: { origin: s.db.config.WEB_ORIGIN, "idempotency-key": key,
      ...(client ? { cookie: client.cookie, "x-csrf-token": client.csrf } : {}) },
    ...(body ? { payload: body } : {}),
  });
  return { status: raw.statusCode, data: raw.json(), raw };
}
async function counts(actor: string) {
  return (await s.db.control.query(`SELECT
    (SELECT count(*) FROM memberships WHERE user_id=$1 AND role='owner') AS workspaces,
    (SELECT count(*) FROM projects WHERE tenant_id IN (SELECT tenant_id FROM memberships WHERE user_id=$1)) AS projects,
    (SELECT count(*) FROM wallets WHERE tenant_id IN (SELECT tenant_id FROM memberships WHERE user_id=$1)) AS wallets,
    (SELECT count(*) FROM request_replays WHERE actor_id=$1 AND action='tenant.create') AS receipts,
    (SELECT count(*) FROM audit_log WHERE principal_id=$1 AND action='tenant.create') AS audits`, [actor])).rows[0];
}
async function created(client: HistoryClient, key = randomUUID(), body = proposal()) {
  const response = await call(client, key, body);
  assert.equal(response.status, 200, JSON.stringify(response.data));
  return { key, body, result: response.data };
}
const tick = (ms = 20) => new Promise(resolve => setTimeout(resolve, ms));
async function until(condition: () => Promise<boolean>) {
  const deadline = Date.now() + 10000;
  while (!(await condition())) { assert.ok(Date.now() < deadline, "Expected controlled SQL lock was not reached"); await tick(); }
}

test("a reply lost after the real commit is recovered without repeating workspace/project/wallet creation", async () => {
  const client = await historyLogin(s), key = randomUUID(), body = proposal();
  // Fixture-level lost response: execute the real SQL route, then discard its reply.
  await assert.rejects(async () => {
    const committed = await call(client, key, body);
    assert.equal(committed.status, 200);
    throw new Error("Synthetic transport loss after server commit");
  }, /transport loss/);
  const once = await counts(client.id);
  assert.deepEqual(once, { workspaces: "1", projects: "1", wallets: "1", receipts: "1", audits: "1" });
  const recovered = await call(client, key);
  assert.equal(recovered.status, 200); assert.equal(recovered.data.state, "completed");
  assert.equal(recovered.raw.headers["cache-control"], "no-store");
  assert.deepEqual(Object.keys(recovered.data).sort(), ["result", "state"]);
  assert.deepEqual(Object.keys(recovered.data.result.tenant).sort(), ["id", "name"]);
  assert.deepEqual(Object.keys(recovered.data.result.project).sort(), ["id", "name"]);
  const replayed = await call(client, key, body);
  assert.equal(replayed.status, 200);
  assert.equal(replayed.data.tenant.id, recovered.data.result.tenant.id);
  assert.equal(replayed.data.project.id, recovered.data.result.project.id);
  assert.deepEqual(await counts(client.id), once);
  assert.equal((await call(client, key, { ...body, name: "Changed pending request" })).data.error.code, "IDEMPOTENCY_CONFLICT");
  // An explicit new operation remains permitted, even with the same two names.
  const second = await created(client);
  assert.notEqual(second.result.tenant.id, replayed.data.tenant.id);
  assert.equal((await counts(client.id)).workspaces, "2");
});

test("simultaneous retries commit one identity and return current metadata without rewriting the original receipt", async () => {
  const client = await historyLogin(s), key = randomUUID(), body = proposal();
  const replies = await Promise.all([call(client, key, body), call(client, key, body)]);
  assert.ok(replies.every(r => r.status === 200)); assert.deepEqual(replies[0].data, replies[1].data);
  assert.equal((await counts(client.id)).workspaces, "1");
  const result = replies[0].data;
  await s.db.control.query("UPDATE tenants SET name='Current workspace name' WHERE id=$1", [result.tenant.id]);
  await s.db.control.query("UPDATE projects SET name='Current project name' WHERE id=$1", [result.project.id]);
  const recovered = await call(client, key), replayed = await call(client, key, body);
  assert.equal(recovered.data.result.tenant.name, "Current workspace name");
  assert.equal(recovered.data.result.project.name, "Current project name");
  assert.equal(replayed.data.tenant.name, "Current workspace name");
  assert.equal(replayed.data.project.name, "Current project name");
  const original = (await s.db.control.query("SELECT response FROM request_replays WHERE actor_id=$1 AND action='tenant.create' AND key=$2", [client.id, key])).rows[0].response;
  assert.equal(original.tenant.name, body.name); assert.equal(original.project.name, body.project_name);
  assert.equal((await counts(client.id)).audits, "1");
});

test("receipt keys are not credentials and disclose nothing to another signed-in account", async () => {
  const client = await historyLogin(s), other = await historyLogin(s), c = await created(client);
  const foreign = await call(other, c.key);
  assert.equal(foreign.status, 200); assert.deepEqual(foreign.data, { state: "not_found" });
  assert.equal((await call(null, c.key)).status, 401);
  assert.equal((await call(client, "invalid-key")).status, 400);
  assert.deepEqual((await call(client, randomUUID())).data, { state: "not_found" });
  assert.deepEqual(await counts(other.id), { workspaces: "0", projects: "0", wallets: "0", receipts: "0", audits: "0" });
});

test("a removed receipt is a terminal result and its old key cannot recreate anything", async () => {
  const client = await historyLogin(s), c = await created(client), before = await counts(client.id);
  await s.db.control.query("UPDATE request_replays SET revoked_at=clock_timestamp(),response='{}' WHERE actor_id=$1 AND action='tenant.create' AND key=$2", [client.id, c.key]);
  assert.deepEqual((await call(client, c.key)).data, { state: "removed" });
  const retry = await call(client, c.key, c.body);
  assert.equal(retry.status, 410); assert.equal(retry.data.error.code, "REQUEST_RESULT_REMOVED");
  assert.deepEqual(await counts(client.id), before);
});

test("membership removal and workspace suspension prevent stale receipt disclosure and replay", async () => {
  const client = await historyLogin(s), replacement = await historyLogin(s), c = await created(client);
  await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'owner')", [c.result.tenant.id, replacement.id]);
  const before = await counts(client.id);
  await s.db.control.query("UPDATE memberships SET status='removed',version=version+1 WHERE tenant_id=$1 AND user_id=$2", [c.result.tenant.id, client.id]);
  assert.deepEqual((await call(client, c.key)).data, { state: "unavailable" });
  const removed = await call(client, c.key, c.body);
  assert.equal(removed.status, 410); assert.equal(removed.data.error.code, "WORKSPACE_CREATION_UNAVAILABLE");
  assert.deepEqual(await counts(client.id), before);
  await s.db.control.query("UPDATE memberships SET status='active',version=version+1 WHERE tenant_id=$1 AND user_id=$2", [c.result.tenant.id, client.id]);
  await s.db.control.query("UPDATE tenants SET status='suspended' WHERE id=$1", [c.result.tenant.id]);
  assert.deepEqual((await call(client, c.key)).data, { state: "unavailable" });
  assert.equal((await call(client, c.key, c.body)).status, 410);
  assert.deepEqual(await counts(client.id), before);
});

test("an archived or deleted first project does not prevent recovering its enterprise or recreate that project", async () => {
  const client = await historyLogin(s), c = await created(client);
  await s.db.control.query("UPDATE projects SET archived=true WHERE id=$1", [c.result.project.id]);
  const archived = await call(client, c.key);
  assert.equal(archived.data.state, "completed"); assert.equal(archived.data.result.tenant.id, c.result.tenant.id);
  assert.equal(archived.data.result.project, null);
  assert.equal((await call(client, c.key, c.body)).data.project, null);
  // Remove only the empty, automatically provisioned roots in this owned fixture.
  // A freshly created project has real cloud-workspace foreign keys as well.
  await owner.query("DELETE FROM workspace_nodes WHERE project_id=$1", [c.result.project.id]);
  await owner.query("DELETE FROM cloud_workspaces WHERE project_id=$1", [c.result.project.id]);
  await owner.query("DELETE FROM projects WHERE id=$1", [c.result.project.id]);
  const deleted = await call(client, c.key);
  assert.equal(deleted.data.state, "completed"); assert.equal(deleted.data.result.project, null);
  const replayed = await call(client, c.key, c.body);
  assert.equal(replayed.status, 200); assert.equal(replayed.data.project, null);
  assert.equal((await counts(client.id)).workspaces, "1"); assert.equal((await counts(client.id)).projects, "0");
});

test("request-lock contention reports in_progress, and recovery never mistakes a committing transaction for not_found", async () => {
  const client = await historyLogin(s), key = randomUUID(), lockClient = await s.db.control.connect();
  try {
    await lockClient.query("SELECT pg_advisory_lock(hashtextextended($1,0))", [`${client.id}:tenant.create:${key}`]);
    assert.deepEqual((await call(client, key)).data, { state: "in_progress" });
  } finally { await lockClient.query("SELECT pg_advisory_unlock_all()"); lockClient.release(); }
  assert.deepEqual((await call(client, key)).data, { state: "not_found" });

  const barrier = 165000000 + Math.floor(Math.random() * 100000), blocker = await s.db.control.connect();
  let creating: Promise<Awaited<ReturnType<typeof call>>> | undefined;
  let recovering: Promise<Awaited<ReturnType<typeof call>>> | undefined;
  try {
    await blocker.query("SELECT pg_advisory_lock($1)", [barrier]);
    await owner.query(`CREATE FUNCTION test_workspace_creation_commit_165() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='tenant.create' AND NEW.principal_id='${client.id}' THEN PERFORM pg_advisory_xact_lock(${barrier}); END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_workspace_creation_commit_165 BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION test_workspace_creation_commit_165()`);
    creating = call(client, key, proposal());
    await until(async () => !!(await s.db.control.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=$1 AND NOT granted", [barrier])).rowCount);
    let settled = false;
    recovering = call(client, key).then(value => { settled = true; return value; });
    await until(async () => !!(await s.db.control.query(`SELECT 1 FROM pg_stat_activity WHERE datname=current_database()
      AND wait_event_type='Lock' AND query LIKE 'SELECT pg_advisory_xact_lock(hashtextextended%'`)).rowCount);
    assert.equal(settled, false, "Receipt lookup must wait for the same user's in-flight commit");
    await blocker.query("SELECT pg_advisory_unlock($1)", [barrier]);
    const [committed, recovered] = await Promise.all([creating, recovering]);
    assert.equal(committed.status, 200); assert.equal(recovered.data.state, "completed");
    assert.equal(recovered.data.result.tenant.id, committed.data.tenant.id);
    assert.equal((await counts(client.id)).workspaces, "1");
  } finally {
    await blocker.query("SELECT pg_advisory_unlock_all()");
    await Promise.allSettled([creating, recovering].filter((p): p is NonNullable<typeof p> => !!p));
    await owner.query("DROP TRIGGER IF EXISTS test_workspace_creation_commit_165 ON audit_log; DROP FUNCTION IF EXISTS test_workspace_creation_commit_165()");
    blocker.release();
  }
});
