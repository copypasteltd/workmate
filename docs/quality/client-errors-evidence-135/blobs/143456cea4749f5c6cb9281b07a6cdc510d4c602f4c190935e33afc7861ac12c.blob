import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import * as OTPAuth from "otpauth";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { seal } from "../src/lib.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>;
let system: Awaited<ReturnType<typeof buildApp>>;
const permissions = ["admin.publication.read", "admin.publication.policy.write", "admin.publication.resolve"];
before(async () => {
  isolated = await isolatedTestEnvironment();
  system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", WORKER_ENABLED: "false" }), { worker: false });
});
after(async () => { try { await system?.app.close(); } finally { await isolated?.cleanup(); } });
async function principal() {
  const address = `publication-upgrade-${randomUUID()}@example.invalid`, secret = new OTPAuth.Secret({ size: 20 });
  const row = (await system.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Explicit publishing operator',$2) RETURNING id,auth_version",
    [address, seal(system.db.config.MASTER_KEY!, secret.base32)])).rows[0];
  await system.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,effect) VALUES($1,'super_admin','global','allow')", [row.id]);
  return { ...row, address, secret };
}
async function command(address: string, acknowledge = true) {
  const child = spawn(process.execPath, ["--import", "tsx", "scripts/admin-enable-publications.ts", address,
    ...(acknowledge ? ["--acknowledge-global-publication-authority"] : [])], {
    cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", WORKER_ENABLED: "false", MASTER_KEY: system.db.config.MASTER_KEY },
  });
  let stdout = "", stderr = "";
  child.stdout.on("data", bytes => { stdout += bytes; }); child.stderr.on("data", bytes => { stderr += bytes; });
  const timeout = setTimeout(() => child.kill(), 30000);
  try {
    const code = await new Promise<number | null>((resolve, reject) => { child.once("error", reject); child.once("close", resolve); });
    return { code, stdout, stderr };
  } finally { clearTimeout(timeout); }
}
async function login(admin: Awaited<ReturnType<typeof principal>>) {
  const request = async (url: string, body: unknown) => {
    const response = await system.app.inject({ method: "POST", url, headers: { origin: system.db.config.ADMIN_ORIGIN, "content-type": "application/json" }, payload: JSON.stringify(body) });
    assert.equal(response.statusCode, 200, response.body); return response;
  };
  const challenge = (await request("/v1/admin/auth/challenge", { email: admin.address })).json();
  const mail = JSON.parse(await readFile(path.join(system.db.config.DATA_DIR, "mailbox", challenge.challenge_id + ".json"), "utf8"));
  const response = await request("/v1/admin/auth/verify", { challenge_id: challenge.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0], totp: new OTPAuth.TOTP({ secret: admin.secret, digits: 6, period: 30, algorithm: "SHA1" }).generate() });
  return response.cookies.map(cookie => cookie.name + "=" + cookie.value).join("; ");
}
async function currentSession(cookie: string) {
  return system.app.inject({ method: "GET", url: "/v1/admin/me", headers: { cookie } });
}
async function grants(id: string) {
  return Number((await system.db.control.query("SELECT count(*)::text AS n FROM admin_bindings WHERE principal_id=$1 AND role_key='publication_operator_v1'", [id])).rows[0].n);
}

test("the operator command requires the explicit global-authority acknowledgement", async () => {
  const admin = await principal(), result = await command(admin.address, false);
  assert.notEqual(result.code, 0); assert.equal(await grants(admin.id), 0);
  assert.equal((await system.db.control.query("SELECT auth_version FROM admin_principals WHERE id=$1", [admin.id])).rows[0].auth_version, admin.auth_version);
});
test("an explicit upgrade invalidates the old MFA session and preserves independent body-read permission", async () => {
  const admin = await principal(), cookie = await login(admin), before = (await system.db.control.query("SELECT key,permissions FROM admin_roles WHERE builtin ORDER BY key")).rows;
  assert.equal((await currentSession(cookie)).statusCode, 200);
  const result = await command(admin.address); assert.equal(result.code, 0, result.stderr);
  assert.equal(await grants(admin.id), 1); assert.equal((await currentSession(cookie)).statusCode, 401);
  assert.equal((await system.db.control.query("SELECT auth_version FROM admin_principals WHERE id=$1", [admin.id])).rows[0].auth_version, admin.auth_version + 1);
  const role = (await system.db.control.query("SELECT permissions,builtin FROM admin_roles WHERE key='publication_operator_v1'")).rows[0];
  assert.deepEqual([...role.permissions].sort(), [...permissions].sort()); assert.equal(role.builtin, false);
  assert.equal(role.permissions.includes("admin.content.body.read"), false);
  assert.deepEqual((await system.db.control.query("SELECT key,permissions FROM admin_roles WHERE builtin ORDER BY key")).rows, before);
});
test("repeating or concurrently issuing the same grant is idempotent and does not revoke a fresh session", async () => {
  const admin = await principal();
  const results = await Promise.all([command(admin.address), command(admin.address)]);
  for (const result of results) assert.equal(result.code, 0, result.stderr);
  assert.equal(await grants(admin.id), 1);
  const current = (await system.db.control.query("SELECT auth_version FROM admin_principals WHERE id=$1", [admin.id])).rows[0].auth_version;
  assert.equal(current, admin.auth_version + 1);
  const cookie = await login(admin), repeated = await command(admin.address);
  assert.equal(repeated.code, 0, repeated.stderr); assert.equal((await currentSession(cookie)).statusCode, 200);
  assert.equal((await system.db.control.query("SELECT count(*)::text AS n FROM audit_log WHERE action='admin.publication.explicit_upgrade' AND principal_id=$1", [admin.id])).rows[0].n, "1");
});
test("tenant-only, suspended, unenrolled and explicitly denied administrators cannot obtain a global upgrade", async () => {
  for (const kind of ["tenant", "suspended", "pending", "deny"]) {
    const admin = await principal();
    if (kind === "tenant") await system.db.control.query("UPDATE admin_bindings SET scope_kind='tenant',scope_id=$2 WHERE principal_id=$1", [admin.id, randomUUID()]);
    if (kind === "suspended") await system.db.control.query("UPDATE admin_principals SET status='suspended' WHERE id=$1", [admin.id]);
    if (kind === "pending") await system.db.control.query("UPDATE admin_principals SET enrollment_state='pending',totp_secret=NULL WHERE id=$1", [admin.id]);
    if (kind === "deny") await system.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,effect) VALUES($1,'super_admin','global','deny')", [admin.id]);
    const result = await command(admin.address); assert.notEqual(result.code, 0, kind);
    assert.equal(await grants(admin.id), 0, kind);
  }
});
test("a conflicting existing role is refused without overwriting permissions or leaving a partial grant", async () => {
  const admin = await principal(), before = (await system.db.control.query("SELECT permissions FROM admin_roles WHERE key='publication_operator_v1'")).rows[0].permissions;
  const conflict = [...before, "admin.content.body.read"];
  await system.db.control.query("UPDATE admin_roles SET permissions=$1 WHERE key='publication_operator_v1'", [JSON.stringify(conflict)]);
  try {
    const result = await command(admin.address); assert.notEqual(result.code, 0); assert.equal(await grants(admin.id), 0);
    assert.deepEqual((await system.db.control.query("SELECT permissions FROM admin_roles WHERE key='publication_operator_v1'")).rows[0].permissions, conflict);
    assert.equal((await system.db.control.query("SELECT auth_version FROM admin_principals WHERE id=$1", [admin.id])).rows[0].auth_version, admin.auth_version);
  } finally { await system.db.control.query("UPDATE admin_roles SET permissions=$1 WHERE key='publication_operator_v1'", [JSON.stringify(before)]); }
});
