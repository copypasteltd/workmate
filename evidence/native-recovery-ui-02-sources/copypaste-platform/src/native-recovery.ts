import pg from "pg";
import path from "node:path";
import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, rename, lstat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import type { Config } from "./config.js";
import { Database } from "./db.js";
import { Storage } from "./storage.js";
import { ErasureService } from "./erasure.js";
import { pruneNativeBackups } from "./native-recovery-retention.js";
import { hash } from "./lib.js";
import {
  canonicalDirectory, checkedFile, durableWrite, encryptEntry, decryptEntry, recoveryKey,
  sealRecovery, openRecovery, verifyBackup, ledgerSchema, recoveryTargets,
  type ErasureLedger, type BackupManifest, type ArchiveEntry,
} from "./native-recovery-archive.js";

export type RecoveryOptions = { config: Config; ownerURL: string; backupKey: string; pgBinDir: string };
function settings(o: RecoveryOptions) {
  recoveryKey(o.backupKey);
  if (!o.config.MASTER_KEY || hash(Buffer.from(o.config.MASTER_KEY, "hex")) === hash(Buffer.from(o.backupKey, "hex"))) throw new Error("RECOVERY_SEPARATE_KEYS_REQUIRED");
  const u = new URL(o.ownerURL), app = new URL(o.config.DATABASE_URL);
  if (!["postgres:", "postgresql:"].includes(u.protocol) || !u.username || !u.pathname ||
      u.hostname !== app.hostname || u.port !== app.port || u.pathname !== app.pathname) throw new Error("RECOVERY_OWNER_SCOPE_INVALID");
  return u;
}
async function owner(o: RecoveryOptions, target?: string) {
  const u = settings(o); if (target) u.pathname = "/" + target;
  const c = new pg.Client({ connectionString: u.href, application_name: "copypaste-native-recovery", connectionTimeoutMillis: 15000, query_timeout: 120000 });
  await c.connect(); return c;
}
async function tool(o: RecoveryOptions, name: "pg_dump" | "pg_restore", database: string, args: string[]) {
  const dir = await canonicalDirectory(o.pgBinDir), file = path.join(dir, name + (process.platform === "win32" ? ".exe" : ""));
  await checkedFile(file);
  if (process.platform === "win32") {
    const pin = JSON.parse(await readFile("contracts/native-recovery-tools.json", "utf8"));
    for (const [name, digest] of Object.entries(pin.files)) {
      const part = path.join(dir, name); await checkedFile(part);
      if (hash(await readFile(part)) !== digest) throw new Error("RECOVERY_POSTGRES_TOOL_PIN_MISMATCH");
    }
  }
  const u = settings(o); u.pathname = "/" + database;
  const password = decodeURIComponent(u.password); u.password = "";
  const env: NodeJS.ProcessEnv = {};
  for (const key of ["PATH", "SystemRoot", "WINDIR", "TEMP", "TMP", "LANG", "LC_ALL", "SSL_CERT_FILE"]) if (process.env[key]) env[key] = process.env[key];
  env.PGPASSWORD = password; env.PGAPPNAME = "copypaste-native-recovery"; env.PGCONNECT_TIMEOUT = "15";
  const child = spawn(file, ["--no-password", "--dbname=" + u.href, ...args], { env, windowsHide: true, stdio: ["pipe", "pipe", "pipe"], timeout: 3 * 3600000 });
  // Error text may include a DSN, object body or operator path. Keep it private.
  let stderr = ""; child.stderr.on("data", b => { if (stderr.length < 32768) stderr += b; });
  const closed = new Promise<void>((resolve, reject) => {
    child.once("error", () => reject(new Error("RECOVERY_POSTGRES_TOOL_UNAVAILABLE")));
    child.once("close", code => code === 0 ? resolve() : reject(new Error("RECOVERY_POSTGRES_TOOL_FAILED")));
  });
  // Attach a handler immediately; callers await the same promise after streaming.
  void closed.catch(() => {});
  return { child, closed, warning: () => stderr.length > 0 };
}
async function source(c: pg.Client) {
  const row = (await c.query("SELECT source_id,state,current_user AS owner,current_setting('server_version_num')::int AS version,(SELECT shobj_description(oid,'pg_database') FROM pg_database WHERE datname=current_database()) AS marker FROM recovery_environment WHERE singleton")).rows[0];
  if (!row || row.state !== "live" || String(row.marker ?? "").startsWith("copypaste:recovery:") || row.version < 180000 || row.version >= 190000) throw new Error("RECOVERY_SOURCE_NOT_LIVE_PG18");
  return row;
}
async function captureLedger(c: pg.Client, sourceId: string, at: string): Promise<ErasureLedger> {
  const targets = (await c.query("SELECT target_type AS type,target_id AS id,tenant_id FROM deletion_jobs ORDER BY target_type,target_id")).rows;
  const objects = (await c.query("SELECT storage_key FROM object_erasure_tombstones ORDER BY storage_key")).rows.map(r => r.storage_key);
  return ledgerSchema.parse({ protocol: "copypaste-erasure-ledger/1", id: randomUUID(), source_id: sourceId, observed_at: at, targets, objects });
}
async function receipt(c: pg.Client, row: { id: string; source_id: string; kind: string; outcome: string; started_at: string; snapshot_at?: string; ledger_at?: string; incident_at?: string; file_count?: number; plaintext_bytes?: number; manifest_sha256?: string; detail?: Record<string, unknown> }) {
  await c.query(`INSERT INTO recovery_runs(id,source_id,kind,outcome,started_at,finished_at,snapshot_at,ledger_at,incident_at,file_count,plaintext_bytes,manifest_sha256,detail)
    VALUES($1,$2,$3,$4,$5,clock_timestamp(),$6,$7,$8,$9,$10,$11,$12)`,
  [row.id, row.source_id, row.kind, row.outcome, row.started_at, row.snapshot_at ?? null, row.ledger_at ?? null, row.incident_at ?? null, row.file_count ?? 0, row.plaintext_bytes ?? 0, row.manifest_sha256 ?? null, JSON.stringify(row.detail ?? {})]);
}

/** PostgreSQL and immutable objects share one exported MVCC snapshot. */
export async function createNativeBackup(o: RecoveryOptions, archiveRoot: string) {
  const started = new Date().toISOString(), id = randomUUID(), root = await canonicalDirectory(archiveRoot), c = await owner(o);
  let identity: any, snapshotAt: string | undefined, staged: string | undefined;
  try {
    const data = path.resolve(o.config.DATA_DIR), relation = path.relative(data, root);
    if (!relation || (!relation.startsWith(".." + path.sep) && !path.isAbsolute(relation))) throw new Error("RECOVERY_ARCHIVE_MUST_BE_OUTSIDE_DATA");
    await c.query("SELECT pg_advisory_lock(hashtextextended('copypaste-native-backup',0))");
    await c.query("SELECT pg_advisory_lock_shared(hashtextextended('copypaste-schema-migration',0))");
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
    identity = await source(c);
    const snap = (await c.query("SELECT pg_export_snapshot() AS id,transaction_timestamp() AS at")).rows[0]; snapshotAt = snap.at.toISOString();
    const ledger = await captureLedger(c, identity.source_id, snapshotAt!);
    const migrations = (await c.query("SELECT version,source_sha256 FROM schema_migrations ORDER BY version")).rows;
    const objects = (await c.query(`SELECT DISTINCT v.storage_key,v.bytes::text,v.sha256 FROM asset_versions v JOIN assets a ON a.id=v.asset_id
      WHERE v.erased_at IS NULL AND a.state<>'deleted' AND NOT EXISTS(SELECT 1 FROM object_erasure_tombstones t WHERE t.storage_key=v.storage_key) ORDER BY v.storage_key`)).rows;
    if (new Set(objects.map(r => r.storage_key)).size !== objects.length) throw new Error("RECOVERY_CONFLICTING_OBJECT_REFERENCES");
    staged = path.join(root, ".partial-" + id); await mkdir(staged, { mode: 0o700 });
    const files: ArchiveEntry[] = [], dump = await tool(o, "pg_dump", decodeURIComponent(settings(o).pathname.slice(1)), ["--format=custom", "--snapshot=" + snap.id, "--lock-wait-timeout=15000"]);
    dump.child.stdin.end();
    try {
      files.push(await encryptEntry(staged, o.backupKey, id, 0, "database", "database", dump.child.stdout));
      await dump.closed;
    } catch (e) { dump.child.kill(); await dump.closed.catch(() => {}); throw e; }
    const storage = new Storage(o.config);
    for (const row of objects) {
      const bytes = Number(row.bytes); if (!Number.isSafeInteger(bytes)) throw new Error("RECOVERY_OBJECT_TOO_LARGE");
      files.push(await encryptEntry(staged, o.backupKey, id, files.length, "object", row.storage_key, await storage.stream(row.storage_key), { bytes, sha256: row.sha256 }));
    }
    // Only closed, immutable encrypted receipt files are included; never tmp files.
    const receipts = path.resolve(o.config.DATA_DIR, "external-budget-receipts");
    const rs = await lstat(receipts).catch((e: NodeJS.ErrnoException) => { if (e.code !== "ENOENT") throw e; return null; });
    if (rs) {
      await canonicalDirectory(receipts);
      for (const name of (await readdir(receipts)).sort()) if (/^[a-f0-9-]{36}-[a-f0-9]{64}\.sealed$/.test(name)) {
        const file = path.join(receipts, name); await checkedFile(file, 16_000_000);
        files.push(await encryptEntry(staged, o.backupKey, id, files.length, "receipt", "external-budget-receipts/" + name, createReadStream(file)));
      }
    }
    await c.query("COMMIT");
    const m: BackupManifest = { protocol: "copypaste-native-backup/1", id, source_id: identity.source_id, snapshot_at: snapshotAt!, completed_at: new Date().toISOString(),
      source_owner: identity.owner, postgres_major: 18, master_key_sha256: hash(Buffer.from(o.config.MASTER_KEY!, "hex")), migrations, ledger, files,
      excluded: ["operator secrets and MASTER_KEY", "Desktop local files", "uncommitted uploads", "transient Codex/browser/program workspaces and process state", "post-snapshot database commits and later receipt files"] };
    const sealed = sealRecovery(o.backupKey, id, "manifest", m); await durableWrite(path.join(staged, "manifest.sealed"), sealed);
    const target = path.join(root, id); await rename(staged, target); staged = undefined;
    // Authentication, full decryption, byte counts and content digests are checked before success.
    await verifyBackup(target, o.backupKey);
    const result = { id, source_id: identity.source_id, snapshot_at: snapshotAt!, file_count: files.length,
      plaintext_bytes: files.reduce((sum, f) => sum + f.bytes, 0), manifest_sha256: hash(sealed) };
    await receipt(c, { ...result, kind: "backup", outcome: "verified", started_at: started, ledger_at: ledger.observed_at,
      detail: { authenticated_full_read: true, has_tool_warnings: dump.warning(), object_count: objects.length, receipt_count: files.length - objects.length - 1 } });
    return { ...result, directory: target };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    if (identity) await receipt(c, { id, source_id: identity.source_id, kind: "backup", outcome: "failed", started_at: started, snapshot_at: snapshotAt,
      detail: { error_code: "RECOVERY_BACKUP_FAILED", partial_preserved: !!staged } }).catch(() => {});
    throw e;
  } finally { await c.end(); }
}

/** Export separately from older backups. Keep this journal on independent storage. */
export async function exportErasureLedger(o: RecoveryOptions, archiveRoot: string) {
  const root = await canonicalDirectory(archiveRoot), c = await owner(o), started = new Date().toISOString();
  try {
    await c.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY"); const identity = await source(c);
    const at = (await c.query("SELECT transaction_timestamp() AS at")).rows[0].at.toISOString();
    const ledger = await captureLedger(c, identity.source_id, at); await c.query("COMMIT");
    const bytes = sealRecovery(o.backupKey, ledger.id, "ledger", ledger), file = path.join(root, "ledger-" + ledger.id + ".sealed");
    await durableWrite(file, bytes);
    ledgerSchema.parse(openRecovery(o.backupKey, await readFile(file, "utf8"), "ledger"));
    await receipt(c, { id: ledger.id, source_id: identity.source_id, kind: "ledger", outcome: "verified", started_at: started, ledger_at: ledger.observed_at,
      file_count: 1, plaintext_bytes: Buffer.byteLength(JSON.stringify(ledger)), manifest_sha256: hash(bytes), detail: { target_count: ledger.targets.length, object_count: ledger.objects.length } });
    return { file, id: ledger.id, source_id: ledger.source_id, observed_at: ledger.observed_at };
  } finally { await c.end(); }
}

export async function readErasureLedger(file: string, key: string) {
  await checkedFile(file, 64_000_000); return ledgerSchema.parse(openRecovery(key, await readFile(file, "utf8"), "ledger"));
}

/** An independently ticking journal is not held behind a long object backup. */
export async function watchNativeRecovery(o: RecoveryOptions, archiveRoot: string, signal: AbortSignal,
  report: (value: Record<string, unknown>) => void = value => console.log(JSON.stringify(value))) {
  const lease = await owner(o), internal = new AbortController(), combined = AbortSignal.any([signal, internal.signal]);
  try {
    if (!(await lease.query("SELECT pg_try_advisory_lock(hashtextextended('copypaste-native-recovery-watch',0)) AS locked")).rows[0].locked) throw new Error("RECOVERY_WATCH_ALREADY_RUNNING");
    const loop = async (kind: "backup" | "ledger", interval: number) => {
      while (!combined.aborted) {
        await lease.query("SELECT 1"); // A lost lease stops admission on both loops.
        const started = Date.now();
        try {
          if (kind === "ledger") { const r = await exportErasureLedger(o, archiveRoot); report({ kind, status: "verified", id: r.id, observed_at: r.observed_at }); }
          else {
            const r = await createNativeBackup(o, archiveRoot); report({ kind, status: "verified", id: r.id, snapshot_at: r.snapshot_at });
            await pruneNativeBackups(archiveRoot, o.backupKey);
          }
        } catch { report({ kind, status: "failed" }); }
        const wait = Math.max(1000, interval - (Date.now() - started));
        try { await delay(wait, undefined, { signal: combined }); } catch (e) { if (!combined.aborted) throw e; }
      }
    };
    const run = (kind: "backup" | "ledger", interval: number) => loop(kind, interval).catch(e => { internal.abort(); throw e; });
    const results = await Promise.allSettled([run("ledger", 60000), run("backup", 10 * 60000)]);
    for (const r of results) if (r.status === "rejected") throw r.reason;
  } finally { internal.abort(); await lease.end(); }
}

export async function restoreNativeBackup(o: RecoveryOptions, input: {
  backup: string; ledger: string; incidentAt: string; databaseName: string; targetDataDir: string; acknowledgeIsolation: boolean;
}) {
  if (!input.acknowledgeIsolation || !/^workmate_recovery_[a-f0-9]{32}$/.test(input.databaseName)) throw new Error("RECOVERY_ISOLATED_TARGET_REQUIRED");
  const incident = new Date(input.incidentAt); if (!Number.isFinite(+incident) || incident.toISOString() !== input.incidentAt || +incident > Date.now() + 60_000) throw new Error("RECOVERY_INCIDENT_CLOCK_INVALID");
  const checked = await verifyBackup(input.backup, o.backupKey), m = checked.manifest, ledger = await readErasureLedger(input.ledger, o.backupKey);
  if (hash(Buffer.from(o.config.MASTER_KEY!, "hex")) !== m.master_key_sha256 || decodeURIComponent(settings(o).username) !== m.source_owner) throw new Error("RECOVERY_SOURCE_IDENTITY_MISMATCH");
  if (ledger.source_id !== m.source_id || Date.parse(ledger.observed_at) < Date.parse(m.snapshot_at) || +incident < Date.parse(m.snapshot_at)) throw new Error("RECOVERY_LEDGER_COVERAGE_INVALID");
  if (!path.isAbsolute(input.targetDataDir)) throw new Error("RECOVERY_ABSOLUTE_PATH_REQUIRED");
  const parent = await canonicalDirectory(path.dirname(input.targetDataDir)), target = path.resolve(input.targetDataDir);
  if (path.dirname(target) !== parent || !/^restore-[a-f0-9]{32}$/.test(path.basename(target))) throw new Error("RECOVERY_TARGET_DIRECTORY_INVALID");
  if (await lstat(target).then(() => true, (e: NodeJS.ErrnoException) => { if (e.code !== "ENOENT") throw e; return false; })) throw new Error("RECOVERY_TARGET_EXISTS");
  const started = new Date().toISOString(), restoreId = randomUUID(), admin = await owner(o, "postgres");
  let created = false, db: Database | undefined;
  try {
    const roles = (await admin.query("SELECT rolname,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb FROM pg_roles WHERE rolname=ANY($1)", [["cp_app", "cp_control", "cp_queue"]])).rows;
    if (roles.length !== 3 || roles.some(r => r.rolsuper || r.rolbypassrls || r.rolcreaterole || r.rolcreatedb)) throw new Error("RECOVERY_ROLE_BOUNDARY_INVALID");
    if ((await admin.query("SELECT 1 FROM pg_database WHERE datname=$1", [input.databaseName])).rowCount) throw new Error("RECOVERY_DATABASE_EXISTS");
    // No business schema exists during CREATE DATABASE. Install the startup marker
    // and revoke CONNECT before importing any customer data or runnable work.
    await admin.query(`CREATE DATABASE "${input.databaseName}" TEMPLATE template0`); created = true;
    await admin.query(`REVOKE CONNECT ON DATABASE "${input.databaseName}" FROM PUBLIC,cp_app,cp_control,cp_queue`);
    await admin.query(`COMMENT ON DATABASE "${input.databaseName}" IS 'copypaste:recovery:${restoreId}'`);
    const connections = (await admin.query("SELECT has_database_privilege(role,$1,'CONNECT') AS allowed FROM unnest(ARRAY['cp_app','cp_control','cp_queue']) AS role", [input.databaseName])).rows;
    if (connections.some(r => r.allowed)) throw new Error("RECOVERY_CONNECT_FENCE_FAILED");
    await mkdir(target, { mode: 0o700 });
    await durableWrite(path.join(target, "recovery-quarantine.json"), JSON.stringify({ protocol: "copypaste-recovery-quarantine/1", restore_id: restoreId, source_id: m.source_id, state: "quarantined", incident_at: input.incidentAt }) + "\n");
    const restore = await tool(o, "pg_restore", input.databaseName, ["--exit-on-error", "--single-transaction"]);
    restore.child.stdout.resume();
    try { await decryptEntry(checked.root, o.backupKey, m.id, m.files[0], restore.child.stdin); await restore.closed; }
    catch (e) { restore.child.kill(); await restore.closed.catch(() => {}); throw e; }
    const targetOwner = await owner(o, input.databaseName);
    try {
      await targetOwner.query("UPDATE recovery_environment SET state='quarantined',restore_id=$1,quarantined_at=clock_timestamp() WHERE singleton", [restoreId]);
      await targetOwner.query("BEGIN");
      for (const item of ledger.targets) {
        if (!recoveryTargets.includes(item.type)) throw new Error("RECOVERY_ERASURE_TARGET_INVALID");
        const column = item.type === "assets" ? "state" : "content_state";
        const counters = (await targetOwner.query("SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name=$1 AND column_name IN('version','moderation_version','revision') AND data_type IN('integer','bigint')", [item.type])).rows;
        const bump = counters.map(r => `,"${r.column_name}"="${r.column_name}"+1`).join("");
        await targetOwner.query(`UPDATE "${item.type}" SET "${column}"='deleted'${bump} WHERE id=$1 AND tenant_id=$2 AND "${column}"<>'deleted'`, [item.id, item.tenant_id]);
      }
      for (const key of ledger.objects) await targetOwner.query("INSERT INTO object_erasure_tombstones(storage_key) VALUES($1) ON CONFLICT DO NOTHING", [key]);
      await targetOwner.query("COMMIT");
    } finally { await targetOwner.end(); }
    // Materialize objects only after applying the newer deletion ledger. Deleted bytes never reappear.
    const active = await owner(o, input.databaseName);
    let erasedObjects: Set<string>;
    try { erasedObjects = new Set((await active.query("SELECT storage_key FROM object_erasure_tombstones UNION SELECT v.storage_key FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE a.state='deleted' AND NOT EXISTS(SELECT 1 FROM asset_versions live JOIN assets owner ON owner.id=live.asset_id WHERE live.storage_key=v.storage_key AND owner.state<>'deleted' AND live.erased_at IS NULL)")).rows.map(r => r.storage_key)); }
    finally { await active.end(); }
    for (const entry of m.files.slice(1)) {
      if (entry.kind === "object" && erasedObjects.has(entry.locator)) continue;
      const dest = path.join(target, entry.locator); await mkdir(path.dirname(dest), { recursive: true, mode: 0o700 });
      await decryptEntry(checked.root, o.backupKey, m.id, entry, createWriteStream(dest, { flags: "wx", mode: 0o600 }));
    }
    const env = { ...o.config, DATA_DIR: target, S3_BUCKET: undefined, S3_ENDPOINT: undefined };
    // Operator-only erasure uses the owner connection while the service identities stay disconnected.
    const restoreURL = settings(o); restoreURL.pathname = "/" + input.databaseName;
    db = new Database({ ...env, DATABASE_URL: restoreURL.href, CONTROL_DATABASE_URL: restoreURL.href, QUEUE_DATABASE_URL: restoreURL.href });
    const erasure = new ErasureService(db, new Storage(env), () => false, restoreId);
    for (let batch = 0; batch < 100; batch++) {
      const count = Number((await db.control.query("SELECT count(*) AS n FROM deletion_jobs WHERE state<>'completed'")).rows[0].n);
      if (!count) break;
      await db.control.query("UPDATE deletion_jobs SET state='queued',next_attempt_at=clock_timestamp(),lease_token=NULL,lease_until=NULL,attempts=0 WHERE state<>'completed'");
      await erasure.advance(Math.min(count, 100));
    }
    const remaining = Number((await db.control.query("SELECT count(*) AS n FROM deletion_jobs WHERE state<>'completed'")).rows[0].n);
    const missing = (await db.control.query(`SELECT v.storage_key FROM asset_versions v JOIN assets a ON a.id=v.asset_id
      WHERE a.state<>'deleted' AND v.erased_at IS NULL AND NOT EXISTS(SELECT 1 FROM object_erasure_tombstones t WHERE t.storage_key=v.storage_key)`)).rows;
    for (const row of missing) await checkedFile(path.join(target, row.storage_key));
    const result = { id: restoreId, source_id: m.source_id, kind: "restore", outcome: remaining ? "incomplete" : "quarantined", started_at: started,
      snapshot_at: m.snapshot_at, ledger_at: ledger.observed_at, incident_at: input.incidentAt, file_count: m.files.length,
      plaintext_bytes: m.files.reduce((sum, f) => sum + f.bytes, 0), manifest_sha256: checked.manifest_sha256,
      detail: { erasure_jobs_remaining: remaining, tasks_inflight: Number((await db.control.query("SELECT count(*) AS n FROM tasks WHERE status IN('queued','running','paused','awaiting_approval','reconciling','needs_input')")).rows[0].n),
        snapshot_gap_ms: Math.max(0, +incident - Date.parse(m.snapshot_at)), ledger_gap_ms: Math.max(0, +incident - Date.parse(ledger.observed_at)),
        native_restore_ms: Date.now() - Date.parse(started), execution_quarantined: true, production_release: false } };
    const recorder = await owner(o, input.databaseName); try { await receipt(recorder, result); } finally { await recorder.end(); }
    let sourceReceiptRecorded = false;
    try { const sourceDb = await owner(o); try { await receipt(sourceDb, result); sourceReceiptRecorded = true; } finally { await sourceDb.end(); } } catch { /* A disaster may have destroyed the source database. The restored receipt remains durable. */ }
    await durableWrite(path.join(target, "recovery-result.json"), JSON.stringify(result, null, 2) + "\n");
    return { ...result, source_receipt_recorded: sourceReceiptRecorded, database: input.databaseName, data_directory: target };
  } catch (e) {
    // Preserve failed isolated targets for diagnosis. Never drop an operator database or un-fence it.
    if (created) {
      await admin.query(`REVOKE CONNECT ON DATABASE "${input.databaseName}" FROM PUBLIC,cp_app,cp_control,cp_queue`).catch(() => {});
    }
    throw e;
  } finally { await db?.close(); await admin.end(); }
}
