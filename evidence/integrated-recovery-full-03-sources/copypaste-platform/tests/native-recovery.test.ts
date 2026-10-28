import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import path from "node:path";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, unlink, readdir, cp } from "node:fs/promises";
import * as OTPAuth from "otpauth";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { loadConfig } from "../src/config.js";
import { buildApp } from "../src/server.js";
import { Database } from "../src/db.js";
import { Catalog } from "../src/catalog.js";
import { Worker } from "../src/worker.js";
import { Storage, saveAsset } from "../src/storage.js";
import { ErasureService } from "../src/erasure.js";
import { createNativeBackup, exportErasureLedger, restoreNativeBackup, watchNativeRecovery, type RecoveryOptions } from "../src/native-recovery.js";
import { loadBackup, verifyBackup, sealRecovery, openRecovery } from "../src/native-recovery-archive.js";
import { pruneNativeBackups } from "../src/native-recovery-retention.js";
import { assertLiveEnvironment } from "../src/recovery-fence.js";
import { seal, hash } from "../src/lib.js";
import { removeOwnedUUIDDirectory } from "../src/owned-directory-cleanup.js";
import { recoverySummaryDTO } from "../src/native-recovery-routes.js";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>, s: Awaited<ReturnType<typeof buildApp>>, o: RecoveryOptions;
const group = randomUUID().replaceAll("-", ""), base = path.resolve(".data/test-recovery"), root = path.join(base, group), created: string[] = [];
let backup: Awaited<ReturnType<typeof createNativeBackup>>, journal: Awaited<ReturnType<typeof exportErasureLedger>>;
let tenant: string, project: string, user: string, keep: any, deleted: any;
type Client = { id: string; cookie: string; csrf: string };
async function call(c: Client | undefined, method: string, url: string, body?: unknown) {
  const r = await s.app.inject({ method: method as any, url, headers: { origin: url.startsWith("/v1/admin") ? s.db.config.ADMIN_ORIGIN : s.db.config.WEB_ORIGIN,
    "idempotency-key": randomUUID(), ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}), ...(body === undefined ? {} : { "content-type": "application/json" }) }, payload: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.statusCode, body: r.json(), raw: r };
}
async function signIn(address: string, admin = false, secret?: OTPAuth.Secret): Promise<Client> {
  const prefix = admin ? "/v1/admin/auth" : "/v1/auth", ch = await call(undefined, "POST", prefix + "/challenge", { email: address }); assert.equal(ch.status, 200, JSON.stringify(ch.body));
  const mail = JSON.parse(await readFile(path.join(s.db.config.DATA_DIR, "mailbox", ch.body.challenge_id + ".json"), "utf8"));
  const r = await call(undefined, "POST", prefix + "/verify", { challenge_id: ch.body.challenge_id, code: mail.text.match(/\b\d{6}\b/)[0],
    ...(secret ? { totp: new OTPAuth.TOTP({ secret, digits: 6, period: 30, algorithm: "SHA1" }).generate() } : {}) });
  assert.equal(r.status, 200, JSON.stringify(r.body)); const cookie = r.raw.cookies.find(c => c.name === (admin ? "cp_admin_session" : "cp_session"))!;
  return { id: r.body.user?.id ?? r.body.admin?.id, csrf: r.body.csrf_token, cookie: cookie.name + "=" + cookie.value };
}
async function admin(scope = "global", permission = "admin.recovery.read") {
  const email = `recovery-${randomUUID()}@example.invalid`, secret = new OTPAuth.Secret({ size: 20 });
  const p = (await s.db.control.query("INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Recovery test',$2) RETURNING id", [email, seal(s.db.config.MASTER_KEY!, secret.base32)])).rows[0];
  const role = "recovery_test_" + randomUUID().replaceAll("-", "");
  await s.db.control.query("INSERT INTO admin_roles(key,name,permissions) VALUES($1,'Recovery test',$2)", [role, JSON.stringify([permission])]);
  await s.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,$3,$4)", [p.id, role, scope, scope === "global" ? null : tenant]);
  const c = await signIn(email, true, secret); c.id = p.id; return { c, role };
}
const restoreArgs = () => ({ backup: backup.directory, ledger: journal.file, incidentAt: new Date().toISOString(), databaseName: "workmate_recovery_" + randomUUID().replaceAll("-", ""), targetDataDir: path.join(root, "restore-" + randomUUID().replaceAll("-", "")), acknowledgeIsolation: true });
async function inspect(database: string, f: (c: pg.Client) => Promise<void>) {
  const url = new URL(o.ownerURL); url.pathname = "/" + database; const c = new pg.Client({ connectionString: url.href }); await c.connect(); try { await f(c); } finally { await c.end(); }
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", DEMO_MODE: "true", WORKER_ENABLED: "false", DEV_MAILBOX: "true" }), { worker: false });
  await mkdir(root, { recursive: true });
  o = { config: s.db.config, ownerURL: isolated.env.OWNER_DATABASE_URL!, backupKey: randomBytes(32).toString("hex"), pgBinDir: path.resolve(".data/recovery-tools/bin") };
  const u = await signIn("recovery-owner-" + randomUUID() + "@example.invalid"), w = await call(u, "POST", "/v1/tenants", { name: "Recovery QA", project_name: "Hong Kong campaign" });
  assert.equal(w.status, 200, JSON.stringify(w.body)); user = u.id; tenant = w.body.tenant.id; project = w.body.project.id;
  keep = await s.db.tx(tx => saveAsset(tx, s.storage, { tenant, project, user, name: "keep.txt", mime: "text/plain", bytes: Buffer.from("retained campaign original") }), tenant, true, user);
  deleted = await s.db.tx(tx => saveAsset(tx, s.storage, { tenant, project, user, name: "delete-after-checkpoint.txt", mime: "text/plain", bytes: Buffer.from("must never return from an older backup") }), tenant, true, user);
  await mkdir(path.join(s.db.config.DATA_DIR, "external-budget-receipts"));
  await writeFile(path.join(s.db.config.DATA_DIR, "external-budget-receipts", randomUUID() + "-" + "a".repeat(64) + ".sealed"), seal(s.db.config.MASTER_KEY!, "synthetic immutable provider receipt"));
  backup = await createNativeBackup(o, root);
  await s.db.control.query("UPDATE assets SET state='deleted',moderation_version=moderation_version+1 WHERE id=$1", [deleted.id]);
  await new ErasureService(s.db, s.storage).advance(20);
  journal = await exportErasureLedger(o, root);
});
after(async () => {
  await s?.app.close();
  if (o) {
    const url = new URL(o.ownerURL); url.pathname = "/postgres"; const c = new pg.Client({ connectionString: url.href }); await c.connect();
    try { for (const name of created) { assert.match(name, /^workmate_recovery_[a-f0-9]{32}$/); await c.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`); } } finally { await c.end(); }
  }
  await isolated?.cleanup(); await removeOwnedUUIDDirectory(base, group);
});

test("native snapshot includes real PostgreSQL, exact object bytes and encrypted receipts; keys stay separate", async () => {
  const v = await verifyBackup(backup.directory, o.backupKey); assert.equal(v.manifest.files.filter(f => f.kind === "object").length, 2); assert.equal(v.manifest.files.filter(f => f.kind === "receipt").length, 1);
  const migrationFiles = (await readdir("migrations")).filter(f => /^\d{3}-.+\.sql$/.test(f)).sort();
  const expectedMigrations = await Promise.all(migrationFiles.map(async file => ({ version: Number(file.slice(0, 3)), source_sha256: hash(await readFile("migrations/" + file)) })));
  assert.ok(expectedMigrations.some(m => m.version === 126), "The signed event migration must be included");
  assert.deepEqual(v.manifest.migrations, expectedMigrations, "Backup must bind every applied migration and its exact current source bytes");
  assert.equal(v.manifest_sha256, backup.manifest_sha256);
  assert.ok(!(await readFile(path.join(backup.directory, "manifest.sealed"), "utf8")).includes("must never return"));
  await assert.rejects(verifyBackup(backup.directory, randomBytes(32).toString("hex")));
  await assert.rejects(createNativeBackup({ ...o, backupKey: o.config.MASTER_KEY! }, root), /SEPARATE_KEYS/);
});

test("native restore replays a newer deletion journal, preserves live files and exact financial facts", async () => {
  const args = restoreArgs(); created.push(args.databaseName);
  const result = await restoreNativeBackup(o, args); assert.equal(result.outcome, "quarantined"); assert.equal(result.detail.erasure_jobs_remaining, 0); assert.equal(result.detail.production_release, false);
  const liveKey = (await s.db.control.query("SELECT storage_key FROM asset_versions WHERE asset_id=$1", [keep.id])).rows[0].storage_key;
  assert.equal(await readFile(path.join(args.targetDataDir, liveKey), "utf8"), "retained campaign original");
  const deadKey = (await s.db.control.query("SELECT storage_key FROM asset_versions WHERE asset_id=$1", [deleted.id])).rows[0].storage_key;
  await assert.rejects(readFile(path.join(args.targetDataDir, deadKey)), (e: any) => e.code === "ENOENT");
  await inspect(args.databaseName, async c => {
    assert.equal((await c.query("SELECT state FROM assets WHERE id=$1", [deleted.id])).rows[0].state, "deleted");
    assert.equal((await c.query("SELECT state FROM recovery_environment")).rows[0].state, "quarantined");
    const f = (await c.query("SELECT pg_get_userbyid(proowner) AS owner FROM pg_proc WHERE proname='journal_content_erasure'")).rows; assert.ok(f.every(r => r.owner === "cp_control"));
    assert.equal((await c.query("SELECT has_database_privilege('cp_app',current_database(),'CONNECT') AS allowed")).rows[0].allowed, false);
    const original = (await s.db.control.query("SELECT balance_micros,reserved_micros,spent_micros FROM wallets WHERE tenant_id=$1", [tenant])).rows;
    assert.deepEqual((await c.query("SELECT balance_micros,reserved_micros,spent_micros FROM wallets WHERE tenant_id=$1", [tenant])).rows, original);
  });
  assert.equal((await s.db.control.query("SELECT state FROM recovery_environment")).rows[0].state, "live");
});

test("database marker and environment fence block API and each worker entry even after accidental CONNECT grants", async () => {
  const args = restoreArgs(); created.push(args.databaseName); await restoreNativeBackup(o, args);
  const config = { ...s.db.config, DATA_DIR: args.targetDataDir };
  for (const key of ["DATABASE_URL", "CONTROL_DATABASE_URL", "QUEUE_DATABASE_URL"] as const) { const url = new URL(config[key]); url.pathname = "/" + args.databaseName; config[key] = url.href; }
  await inspect(args.databaseName, async c => {
    await c.query(`GRANT CONNECT ON DATABASE "${args.databaseName}" TO cp_app,cp_control,cp_queue`);
    // The independent database marker still blocks an erroneously live table state.
    await c.query("UPDATE recovery_environment SET state='live',restore_id=NULL,quarantined_at=NULL");
  });
  const db = new Database(config), catalog = new Catalog(); await catalog.load(); const worker = new Worker(db, catalog, new Storage(config));
  try {
    await assert.rejects(assertLiveEnvironment(db), /RECOVERY_QUARANTINED/);
    await assert.rejects(buildApp(config), /RECOVERY_QUARANTINED/);
    await assert.rejects(worker.start(), /RECOVERY_QUARANTINED/); await assert.rejects(worker.dispatch(), /RECOVERY_QUARANTINED/); await assert.rejects(worker.run(tenant, randomUUID()), /RECOVERY_QUARANTINED/);
  } finally { await db.close(); }
});

test("restore refuses existing targets, unacknowledged isolation and foreign or stale erasure ledgers", async () => {
  const args = restoreArgs(); await mkdir(args.targetDataDir); await writeFile(path.join(args.targetDataDir, "sentinel"), "user-owned");
  await assert.rejects(restoreNativeBackup(o, args), /TARGET_EXISTS/); assert.equal(await readFile(path.join(args.targetDataDir, "sentinel"), "utf8"), "user-owned");
  await assert.rejects(restoreNativeBackup(o, { ...restoreArgs(), acknowledgeIsolation: false }), /ISOLATED_TARGET/);
  const ledger = openRecovery(o.backupKey, await readFile(journal.file, "utf8"), "ledger"); ledger.source_id = randomUUID();
  const foreign = path.join(root, "foreign.sealed"); await writeFile(foreign, sealRecovery(o.backupKey, ledger.id, "ledger", ledger));
  await assert.rejects(restoreNativeBackup(o, { ...restoreArgs(), ledger: foreign }), /LEDGER_COVERAGE/);
  ledger.source_id = backup.source_id; ledger.observed_at = new Date(Date.parse(backup.snapshot_at) - 1000).toISOString();
  const stale = path.join(root, "stale.sealed"); await writeFile(stale, sealRecovery(o.backupKey, ledger.id, "ledger", ledger));
  await assert.rejects(restoreNativeBackup(o, { ...restoreArgs(), ledger: stale }), /LEDGER_COVERAGE/);
});

test("modified encrypted chunks, manifests, duplicate paths and unexpected files fail verification", async () => {
  const parent = path.join(root, "tamper"); await mkdir(parent); const dest = path.join(parent, backup.id); await cp(backup.directory, dest, { recursive: true });
  const m = (await loadBackup(dest, o.backupKey)).manifest, file = path.join(dest, m.files[0].name), original = await readFile(file), changed = Buffer.from(original); changed[8] ^= 1; await writeFile(file, changed);
  await assert.rejects(verifyBackup(dest, o.backupKey), /ENCRYPTED_INTEGRITY/); await writeFile(file, original);
  await writeFile(path.join(dest, "extra"), "unowned"); await assert.rejects(loadBackup(dest, o.backupKey), /UNEXPECTED_ARCHIVE/); await unlink(path.join(dest, "extra"));
  m.files[1].locator = "objects/../../outside"; await writeFile(path.join(dest, "manifest.sealed"), sealRecovery(o.backupKey, m.id, "manifest", m));
  await assert.rejects(loadBackup(dest, o.backupKey), /LOCATOR_INVALID/);
});

test("missing source objects leave a failed immutable receipt rather than a successful empty backup", async () => {
  const object = (await s.db.control.query("SELECT storage_key FROM asset_versions WHERE asset_id=$1", [keep.id])).rows[0].storage_key, filename = path.join(o.config.DATA_DIR, object), bytes = await readFile(filename);
  await unlink(filename); try { await assert.rejects(createNativeBackup(o, root)); } finally { await writeFile(filename, bytes); }
  const row = (await s.db.control.query("SELECT * FROM recovery_runs WHERE kind='backup' ORDER BY finished_at DESC LIMIT 1")).rows[0]; assert.equal(row.outcome, "failed");
  await inspect(isolated.database, async c => { await assert.rejects(c.query("UPDATE recovery_runs SET outcome='verified' WHERE id=$1", [row.id]), /immutable/); });
});

test("35-day pruning verifies files and retains the newest valid checkpoint for each source", async () => {
  const fresh = await createNativeBackup(o, root), oldFile = path.join(backup.directory, "manifest.sealed"), oldBytes = await readFile(oldFile, "utf8"), old = openRecovery(o.backupKey, oldBytes, "manifest");
  old.snapshot_at = new Date(Date.now() - 40 * 86400000).toISOString(); old.ledger.observed_at = old.snapshot_at;
  await writeFile(oldFile, sealRecovery(o.backupKey, old.id, "manifest", old));
  const r = await pruneNativeBackups(root, o.backupKey); assert.deepEqual(r.removed, [backup.id]); assert.ok((await readdir(root)).includes(fresh.id));
  const newestFile = path.join(fresh.directory, "manifest.sealed"), v = openRecovery(o.backupKey, await readFile(newestFile, "utf8"), "manifest"); v.snapshot_at = old.snapshot_at; v.ledger.observed_at = old.snapshot_at;
  await writeFile(newestFile, sealRecovery(o.backupKey, v.id, "manifest", v)); assert.deepEqual((await pruneNativeBackups(root, o.backupKey)).removed, []);
});

test("Admin recovery view requires global permission and current MFA; no paths, keys or archived content leave the API", async () => {
  const a = await admin(), scoped = await admin("tenant"), ordinary = await admin("global", "admin.users.read");
  const r = await call(a.c, "GET", "/v1/admin/recovery?limit=1"); assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.items.length, 1); assert.equal(r.body.production_recovery_qualified, false); assert.ok(r.body.next_cursor);
  recoverySummaryDTO.parse(r.body);
  const contract = JSON.parse(await readFile("contracts/native-recovery-schemas.json", "utf8")), ajv = new Ajv2020({ strict: false }); (addFormats as unknown as (a: Ajv2020) => void)(ajv);
  const valid = ajv.compile(contract.schemas.RecoverySummary); assert.equal(!!valid(r.body), true, JSON.stringify(valid.errors));
  assert.ok(!JSON.stringify(r.body).includes(o.backupKey)); assert.ok(!JSON.stringify(r.body).includes(root)); assert.ok(!JSON.stringify(r.body).includes("retained campaign"));
  const next = await call(a.c, "GET", "/v1/admin/recovery?limit=1&cursor=" + r.body.next_cursor); assert.equal(next.status, 200); assert.notEqual(next.body.items[0].id, r.body.items[0].id);
  assert.equal((await call(scoped.c, "GET", "/v1/admin/recovery")).status, 403); assert.equal((await call(ordinary.c, "GET", "/v1/admin/recovery")).status, 403);
  await s.db.control.query("UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1", [a.c.id]); assert.equal((await call(a.c, "GET", "/v1/admin/recovery")).body.error.code, "MFA_REQUIRED");
  const denied = await admin(); await s.db.control.query("INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,'tenant',$3,'deny')", [denied.c.id, denied.role, tenant]);
  assert.equal((await call(denied.c, "GET", "/v1/admin/recovery")).status, 403);
});

test("watch persists independent backup and erasure-journal receipts and rejects a second owner", async () => {
  const stop = new AbortController(), seen = new Set<string>(); let second: Promise<void> | undefined;
  const job = watchNativeRecovery(o, root, stop.signal, row => {
    assert.equal(row.status, "verified"); seen.add(String(row.kind));
    second ??= assert.rejects(watchNativeRecovery(o, root, new AbortController().signal), /WATCH_ALREADY_RUNNING/);
    if (seen.size === 2) stop.abort();
  });
  await job; await second; assert.deepEqual([...seen].sort(), ["backup", "ledger"]);
});

test("recovery succeeds when the source database has been lost and records the result in the isolated target", async () => {
  backup = await createNativeBackup(o, root); journal = await exportErasureLedger(o, root);
  const args = restoreArgs(); created.push(args.databaseName);
  await s.app.close();
  const u = new URL(o.ownerURL); u.pathname = "/postgres"; const manager = new pg.Client({ connectionString: u.href }); await manager.connect();
  try { await manager.query(`DROP DATABASE "${isolated.database}" WITH (FORCE)`); } finally { await manager.end(); }
  const result = await restoreNativeBackup(o, args); assert.equal(result.outcome, "quarantined"); assert.equal(result.source_receipt_recorded, false);
  await inspect(args.databaseName, async c => {
    assert.equal((await c.query("SELECT outcome FROM recovery_runs WHERE id=$1", [result.id])).rows[0].outcome, "quarantined");
    assert.equal((await c.query("SELECT state FROM assets WHERE id=$1", [keep.id])).rows[0].state, "active");
  });
});
