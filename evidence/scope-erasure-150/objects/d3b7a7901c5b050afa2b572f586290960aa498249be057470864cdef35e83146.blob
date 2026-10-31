import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { historyLogin, historyOk, type HistoryClient } from "./admin-history-fixture.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>;
async function call(client: HistoryClient | null, method: string, url: string, body?: any, requestKey: string = randomUUID(), headerTenant?: string) {
  const r = await s.app.inject({ method: method as any, url, headers: {
    origin: "http://localhost:4317", ...(client ? { cookie: client.cookie, "x-csrf-token": client.csrf } : {}),
    ...(headerTenant || client?.tenant ? { "x-tenant-id": headerTenant ?? client!.tenant! } : {}),
    "idempotency-key": requestKey,
  }, ...(body === undefined ? {} : { payload: body }) });
  return { status: r.statusCode, data: r.json() };
}
async function fixture() {
  const owner = await historyLogin(s);
  const w = await historyOk(s, owner, "POST", "/v1/tenants", { name: "Project lifecycle studio", project_name: "Launch workspace" });
  owner.tenant = w.tenant.id;
  return { owner, tenant: w.tenant.id, project: w.project.id, root: `/v1/tenants/${w.tenant.id}`, base: `/v1/tenants/${w.tenant.id}/projects/${w.project.id}` };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function member(f: Fixture, role = "member") {
  const client = await historyLogin(s); client.tenant = f.tenant;
  await s.db.control.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,$3)", [f.tenant, client.id, role]);
  if (!["owner", "admin"].includes(role)) await s.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')", [f.tenant, f.project, client.id]);
  return client;
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", DEV_MAILBOX: "true", WORKER_ENABLED: "false" }), { worker: false });
});
after(async () => { if (s) await s.app.close(); if (isolated) await isolated.cleanup(); });

test("archive-last-project hides normal access and restoration preserves original contents and identity", async () => {
  const f = await fixture();
  const agent = await historyOk(s, f.owner, "POST", f.base + "/agents", { name: "Launch specialist", role_key: "assistant", instructions: "Retain the customer's original guidance" });
  assert.equal((await call(f.owner, "PATCH", f.base, { archived: true, expected_archived: false })).status, 200);
  const active = await historyOk(s, f.owner, "GET", f.root + "/projects"); assert.equal(active.items.length, 0);
  assert.equal((await call(f.owner, "GET", f.base + "/agents")).status, 404);
  const directory = await historyOk(s, f.owner, "GET", f.root + "/project-directory?state=archived");
  assert.equal(directory.total, 1); assert.equal(directory.items[0].id, f.project);
  const restored = await call(f.owner, "PATCH", f.base, { archived: false, expected_archived: true });
  assert.equal(restored.status, 200); assert.equal(restored.data.archived, false); assert.equal(restored.data.id, f.project);
  assert.ok((await historyOk(s, f.owner, "GET", f.base + "/agents")).items.some((a: any) => a.id === agent.id));
  assert.equal((await s.db.control.query("SELECT body->>'instructions' AS text FROM agent_versions WHERE agent_id=$1", [agent.id])).rows[0].text, "Retain the customer's original guidance");
});

test("only current owners/admins manage or list archived projects; ordinary bindings remain insufficient", async () => {
  const f = await fixture(), admin = await member(f, "admin");
  for (const role of ["member", "approver", "viewer"]) {
    const actor = await member(f, role);
    assert.equal((await call(actor, "GET", f.root + "/project-directory?state=all")).status, 403, role);
    assert.equal((await call(actor, "PATCH", f.base, { archived: true })).status, 403, role);
  }
  assert.equal((await call(admin, "PATCH", f.base, { archived: true })).status, 200);
  assert.equal((await call(admin, "GET", f.root + "/project-directory?state=archived")).data.total, 1);
  assert.equal((await call(admin, "PATCH", f.base, { archived: false })).status, 200);
});

test("cross-workspace locators and mismatched headers never disclose or mutate projects", async () => {
  const a = await fixture(), b = await fixture();
  assert.equal((await call(a.owner, "PATCH", `${a.root}/projects/${b.project}`, { archived: true })).status, 404);
  assert.equal((await call(a.owner, "PATCH", b.base, { archived: true }, randomUUID(), b.tenant)).status, 404);
  assert.equal((await call(a.owner, "GET", a.root + "/project-directory", undefined, randomUUID(), b.tenant)).status, 400);
  assert.equal((await call(null, "GET", a.root + "/project-directory")).status, 401);
  assert.equal((await s.db.control.query("SELECT archived FROM projects WHERE id=$1", [b.project])).rows[0].archived, false);
});

test("competing expected-state changes serialize to one mutation and one conflict", async () => {
  const f = await fixture();
  const outcomes = await Promise.all([call(f.owner, "PATCH", f.base, { archived: true, expected_archived: false }), call(f.owner, "PATCH", f.base, { archived: true, expected_archived: false })]);
  assert.deepEqual(outcomes.map(r => r.status).sort(), [200, 409]);
  assert.equal(outcomes.find(r => r.status === 409)!.data.error.code, "PROJECT_CHANGED");
  assert.equal(Number((await s.db.control.query("SELECT count(*) AS n FROM audit_log WHERE target=$1 AND action='project.archive'", [f.project])).rows[0].n), 1);
});

test("lost-response replay returns current state without reapplying an obsolete archive, and rechecks authority", async () => {
  const f = await fixture(), actor = await member(f, "admin"), key = randomUUID(), body = { archived: true, expected_archived: false };
  assert.equal((await call(actor, "PATCH", f.base, body, key)).status, 200);
  assert.equal((await call(f.owner, "PATCH", f.base, { archived: false, expected_archived: true })).status, 200);
  const replayed = await call(actor, "PATCH", f.base, body, key);
  assert.equal(replayed.status, 200); assert.equal(replayed.data.archived, false);
  assert.equal((await call(actor, "PATCH", f.base, { ...body, name: "Different retry" }, key)).status, 409);
  await s.db.control.query("UPDATE memberships SET role='viewer',version=version+1 WHERE tenant_id=$1 AND user_id=$2", [f.tenant, actor.id]);
  assert.equal((await call(actor, "PATCH", f.base, body, key)).status, 403);
  assert.equal((await s.db.control.query("SELECT archived FROM projects WHERE id=$1", [f.project])).rows[0].archived, false);
});

async function authorityRace(change: "demote" | "remove" | "suspend") {
  const f = await fixture(), actor = await member(f, "admin");
  await historyOk(s, f.owner, "PATCH", f.base, { archived: true });
  const blocker = await s.db.control.connect(); let response: ReturnType<typeof call> | undefined;
  try {
    await blocker.query("BEGIN");
    const pid = (await blocker.query("SELECT pg_backend_pid() AS pid")).rows[0].pid;
    await blocker.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", ["user-authority:" + actor.id]);
    response = call(actor, "PATCH", f.base, { archived: false, expected_archived: true });
    const deadline = Date.now() + 10000; let blocked = false;
    while (!blocked && Date.now() < deadline) {
      blocked = !!(await s.db.control.query("SELECT 1 FROM pg_locks WHERE locktype='advisory' AND NOT granted AND $1=ANY(pg_blocking_pids(pid)) LIMIT 1", [pid])).rowCount;
      if (!blocked) await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.equal(blocked, true, "Actual management request waited behind the authority lock");
    if (change === "suspend") await blocker.query("UPDATE users SET status='suspended',auth_version=auth_version+1 WHERE id=$1", [actor.id]);
    else await blocker.query(`UPDATE memberships SET ${change === "demote" ? "role='viewer'" : "status='removed'"},version=version+1 WHERE tenant_id=$1 AND user_id=$2`, [f.tenant, actor.id]);
    await blocker.query("COMMIT");
    const result = await response;
    assert.equal(result.status, change === "demote" ? 403 : 404);
    assert.equal((await s.db.control.query("SELECT archived FROM projects WHERE id=$1", [f.project])).rows[0].archived, true);
  } finally {
    await blocker.query("ROLLBACK").catch(() => {}); blocker.release();
    if (response) await response;
  }
}
test("a manager demoted while waiting cannot restore with stale authority", () => authorityRace("demote"));
test("a manager removed while waiting cannot restore with stale authority", () => authorityRace("remove"));
test("a globally suspended manager cannot restore after its lock is released", () => authorityRace("suspend"));

test("restoration does not recreate revoked project grants or membership access", async () => {
  const f = await fixture(), actor = await member(f);
  await historyOk(s, f.owner, "PATCH", f.base, { archived: true });
  await s.db.control.query("DELETE FROM project_members WHERE project_id=$1 AND user_id=$2", [f.project, actor.id]);
  await historyOk(s, f.owner, "PATCH", f.base, { archived: false, expected_archived: true });
  assert.equal((await call(actor, "GET", f.base + "/agents")).status, 404);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM project_members WHERE project_id=$1 AND user_id=$2", [f.project, actor.id])).rows[0].n, 0);
});

test("directory is paged, search is literal and edits reject stale metadata without auditing content", async () => {
  const f = await fixture();
  await s.db.control.query("INSERT INTO projects(tenant_id,name) SELECT $1,'Other '||n FROM generate_series(1,4) n", [f.tenant]);
  const first = await historyOk(s, f.owner, "GET", f.root + "/project-directory?state=all&page_size=2");
  const second = await historyOk(s, f.owner, "GET", f.root + "/project-directory?state=all&page_size=2&page=2");
  assert.equal(first.total, 5); assert.equal(first.items.length, 2); assert.equal(second.items.length, 2);
  assert.equal(new Set([...first.items, ...second.items].map(p => p.id)).size, 4);
  assert.equal((await historyOk(s, f.owner, "GET", f.root + "/project-directory?search=%25")).total, 0);
  assert.equal((await call(f.owner, "PATCH", f.base, { name: "Private new project name", expected_name: "Launch workspace", expected_description: "" })).status, 200);
  assert.equal((await call(f.owner, "PATCH", f.base, { name: "Overwritten", expected_name: "Launch workspace" })).status, 409);
  assert.equal((await call(f.owner, "PATCH", f.base, {})).status, 400);
  assert.equal((await call(f.owner, "PATCH", f.base, { archived: "false" })).status, 400);
  assert.equal((await call(f.owner, "GET", f.root + "/project-directory?state=invalid")).status, 400);
  const audits = (await s.db.control.query("SELECT detail FROM audit_log WHERE target=$1 AND action='project.update'", [f.project])).rows;
  assert.equal(audits.length, 1); assert.ok(!JSON.stringify(audits).includes("Private new project name"));
});
