import assert from "node:assert/strict";
import { before, after, test } from "node:test";
import { randomUUID } from "node:crypto";
import pg from "pg";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { supportFixture, historyLogin, historyOk, supportCounts } from "./support-access-fixture.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>, owner: pg.Pool;
before(async () => {
  isolated = await isolatedTestEnvironment(); owner = new pg.Pool({ connectionString: isolated.env.OWNER_DATABASE_URL });
  s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", WORKER_ENABLED: "false" }), { worker: false });
});
after(async () => { try { await s?.app.close(); await owner?.end(); } finally { await isolated?.cleanup(); } });
async function call(client: any, tenant: string, key: string, body?: any) {
  const raw = await s.app.inject({ method: body ? "POST" : "GET", url: "/v1/support-grants" + (body ? "" : "/attempts/" + key),
    headers: { origin: s.db.config.WEB_ORIGIN, cookie: client.cookie, "x-csrf-token": client.csrf, "x-tenant-id": tenant, "idempotency-key": key },
    ...(body ? { payload: body } : {}) });
  return { status: raw.statusCode, data: raw.json(), raw };
}
const proposal = (projects: string[]) => ({ reason: "Explicit customer retry consent", project_ids: projects, expires_at: new Date(Date.now() + 900000).toISOString() });

test("lost-response retries and simultaneous submissions create one grant and one audit with a fixed deadline", async () => {
  const f = await supportFixture(s), key = randomUUID(), body = proposal([f.project]), before = await supportCounts(s);
  const replies = await Promise.all([call(f.owner, f.tenant, key, body), call(f.owner, f.tenant, key, body)]);
  assert.ok(replies.every(r => r.status === 201)); assert.deepEqual(replies[0].data, replies[1].data);
  const recovered = await call(f.owner, f.tenant, key);
  assert.equal(recovered.status, 200); assert.equal(recovered.data.state, "committed"); assert.deepEqual(recovered.data.grant, replies[0].data);
  assert.equal(recovered.raw.headers["cache-control"], "no-store");
  assert.deepEqual(Object.keys(recovered.data).sort(), ["as_of", "grant", "state"]);
  assert.equal(recovered.data.grant.expires_at, body.expires_at);
  const counts = (await s.db.control.query("SELECT (SELECT count(*) FROM support_grants WHERE tenant_id=$1) AS grants,(SELECT count(*) FROM audit_log WHERE target=$2 AND action='support.grants.create') AS audits", [f.tenant, replies[0].data.id])).rows[0];
  assert.deepEqual(counts, { grants: "1", audits: "1" }); assert.deepEqual(await supportCounts(s), before);
  const changed = await call(f.owner, f.tenant, key, { ...body, reason: "Different consent" });
  assert.equal(changed.status, 409); assert.equal(changed.data.error.code, "IDEMPOTENCY_CONFLICT");
});

test("receipt recovery reports the current revocation and expiry rather than replaying stale active permission", async () => {
  const f = await supportFixture(s), key = randomUUID(), body = proposal([]), created = await call(f.owner, f.tenant, key, body);
  assert.equal(created.status, 201);
  await historyOk(s, f.owner, "POST", `/v1/support-grants/${created.data.id}/revoke`, { reason: "End support now" });
  assert.equal((await call(f.owner, f.tenant, key)).data.grant.state, "revoked");
  const replayed = await call(f.owner, f.tenant, key, body);
  assert.equal(replayed.data.id, created.data.id); assert.equal(replayed.data.state, "revoked");
  const shortKey = randomUUID(), shortBody = { ...body, expires_at: new Date(Date.now() + 1200).toISOString() }, short = await call(f.owner, f.tenant, shortKey, shortBody);
  assert.equal(short.status, 201); await new Promise(r => setTimeout(r, 1400));
  assert.equal((await call(f.owner, f.tenant, shortKey)).data.grant.state, "expired");
  const expired = await call(f.owner, f.tenant, shortKey, shortBody);
  assert.equal(expired.data.id, short.data.id); assert.equal(expired.data.state, "expired");
});

test("a known receipt key discloses nothing across customer identities or workspaces", async () => {
  const f = await supportFixture(s), key = randomUUID(), created = await call(f.owner, f.tenant, key, proposal([f.project]));
  assert.equal(created.status, 201);
  const other = await historyLogin(s);
  await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role,status) VALUES($1,$2,'admin','active')", [f.tenant, other.id]);
  const invisible = await call(other, f.tenant, key);
  assert.equal(invisible.status, 200); assert.equal(invisible.data.state, "not_found"); assert.equal(invisible.data.grant, undefined);
  const otherWorkspace = await historyOk(s, f.owner, "POST", "/v1/tenants", { name: "Other receipt boundary", project_name: "Other project" });
  assert.equal((await call(f.owner, otherWorkspace.tenant.id, key)).data.state, "not_found");
  const admin = await call(f.operator.client, f.tenant, key);
  assert.ok([401, 403].includes(admin.status)); assert.equal(admin.data.grant, undefined);
});

test("receipt lookup rechecks current membership and removed receipts cannot recreate an authorization", async () => {
  const f = await supportFixture(s), key = randomUUID(), body = proposal([f.project]), created = await call(f.owner, f.tenant, key, body);
  assert.equal(created.status, 201);
  await s.db.control.query("UPDATE memberships SET role='viewer',version=version+1 WHERE tenant_id=$1 AND user_id=$2", [f.tenant, f.owner.id]);
  const denied = await call(f.owner, f.tenant, key); assert.equal(denied.status, 403); assert.equal(denied.data.grant, undefined);
  await s.db.control.query("UPDATE memberships SET role='owner',version=version+1 WHERE tenant_id=$1 AND user_id=$2", [f.tenant, f.owner.id]);
  assert.equal((await call(f.owner, f.tenant, key)).data.grant.state, "revoked");
  await s.db.control.query("UPDATE request_replays SET revoked_at=clock_timestamp(),response='{}' WHERE actor_id=$1 AND key=$2", [f.owner.id, key]);
  const removed = await call(f.owner, f.tenant, key); assert.equal(removed.data.state, "removed"); assert.equal(removed.data.grant, undefined);
  const refused = await call(f.owner, f.tenant, key, body); assert.equal(refused.status, 410);
  assert.equal((await s.db.control.query("SELECT count(*) AS n FROM support_grants WHERE tenant_id=$1", [f.tenant])).rows[0].n, "1");
});

test("result recovery waits for an actual concurrent commit before deciding whether the request exists", async () => {
  const f = await supportFixture(s), key = randomUUID(), lock = 134000000 + Math.floor(Math.random() * 100000), client = await s.db.control.connect();
  let creating: Promise<any> | undefined, recovering: Promise<any> | undefined;
  try {
    await client.query("SELECT pg_advisory_lock($1)", [lock]);
    await owner.query(`CREATE FUNCTION test_support_recovery_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
      IF NEW.action='support.grants.create' AND NEW.tenant_id='${f.tenant}' THEN PERFORM pg_advisory_xact_lock(${lock}); END IF; RETURN NEW; END $$;
      CREATE TRIGGER test_support_recovery_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION test_support_recovery_audit()`);
    creating = call(f.owner, f.tenant, key, proposal([f.project]));
    const until = Date.now() + 10000;
    while (!(await s.db.control.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND objid=$1 AND NOT granted", [lock])).rowCount) {
      assert.ok(Date.now() < until); await new Promise(r => setTimeout(r, 20));
    }
    let settled = false; recovering = call(f.owner, f.tenant, key).then(r => { settled = true; return r; });
    await new Promise(r => setTimeout(r, 100)); assert.equal(settled, false, "A lookup must not claim no grant while that key's transaction is committing");
    await client.query("SELECT pg_advisory_unlock($1)", [lock]);
    const [created, recovered] = await Promise.all([creating, recovering]);
    assert.equal(created.status, 201); assert.equal(recovered.data.state, "committed"); assert.equal(recovered.data.grant.id, created.data.id);
  } finally {
    await client.query("SELECT pg_advisory_unlock_all()"); await creating; await recovering;
    await owner.query("DROP TRIGGER IF EXISTS test_support_recovery_audit ON audit_log; DROP FUNCTION IF EXISTS test_support_recovery_audit()"); client.release();
  }
});

test("receipt lookup validates opaque key shape and never treats a key as a customer credential", async () => {
  const f = await supportFixture(s), key = randomUUID();
  assert.equal((await call(f.owner, f.tenant, "invalid-key")).status, 400);
  const unauthenticated = await s.app.inject({ method: "GET", url: "/v1/support-grants/attempts/" + key, headers: { "x-tenant-id": f.tenant } });
  assert.equal(unauthenticated.statusCode, 401);
  const unknown = await call(f.owner, f.tenant, key); assert.equal(unknown.data.state, "not_found"); assert.equal(unknown.data.grant, undefined);
});
