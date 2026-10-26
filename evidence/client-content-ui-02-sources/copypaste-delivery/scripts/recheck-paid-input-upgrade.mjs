import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import path from "node:path";

const id = process.argv[2];
assert.match(id ?? "", /^\d{2}$/);
assert.equal(process.argv.length, 3);
const prefix = `evidence/paid-input-upgrade-${id}`;
const platform = path.resolve("../copypaste-platform");
const sha = (b) => createHash("sha256").update(b).digest("hex");
const inputs = [];
async function bind(file) {
  const bytes = await readFile(file);
  const entry = { path: file, sha256: sha(bytes) };
  inputs.push(entry);
  return { value: JSON.parse(bytes), entry };
}
const failed = await bind("evidence/paid-input-upgrade-01.json");
assert.equal(failed.value.status, "failed");
assert.ok(failed.value.owned_database_shutdown);
for (const report of failed.value.raw_reports)
  assert.equal(sha(await readFile(report.path)), report.sha256);
const baseline = await bind("evidence/paid-input-migrations-01-before.json");
assert.equal(baseline.value.status, "captured_before_upgrade");
assert.ok(baseline.value.databases.every(d => d.migrations.length === 87));
const originalVerifier = {
  path: "scripts/qa-paid-input-migrations.mjs",
  sha256: sha(await readFile("scripts/qa-paid-input-migrations.mjs")),
};
assert.equal(originalVerifier.sha256, baseline.value.verifier_sha256);
for (const file of ["evidence/paid-input-regression-02.json", "evidence/paid-input-integration-10.json", "evidence/paid-input-clients-05.json"]) {
  const r = (await bind(file)).value;
  assert.equal(r.status, "passed");
  assert.ok(r.source_unchanged);
  for (const [source, expected] of Object.entries(r.source_files)) {
    const target = file.includes("clients")
      ? path.resolve("../copypaste-" + source.slice(0, source.indexOf("/")), source.slice(source.indexOf("/") + 1))
      : path.join(platform, source);
    assert.equal(sha(await readFile(target)), expected, source);
  }
}
for (const port of [4310, 4317, 4318, 4319, 55432]) {
  const busy = await new Promise(resolve => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
  assert.equal(busy, false);
}
for (const suffix of [".json", "-database.log", "-after.log"])
  await assert.rejects(access(prefix + suffix), e => e.code === "ENOENT");
const verifier = { path: prefix + "-verifier.mjs", sha256: sha(await readFile(import.meta.filename)) };
await writeFile(verifier.path, await readFile(import.meta.filename), { flag: "wx" });
const log = createWriteStream(prefix + "-database.log", { flags: "wx" });
const db = spawn(process.execPath, ["scripts/native-db-launch.mjs"], {
  cwd: platform, windowsHide: true,
  env: { ...process.env, COPYPASTE_NATIVE_DATABASE_START_ONLY: "true" },
  stdio: ["ignore", "pipe", "pipe", "ipc"],
});
db.stdout.pipe(log, { end: false }); db.stderr.pipe(log, { end: false });
let output = ""; db.stdout.on("data", b => { output = (output + b.toString()).slice(-8000); });
const closed = new Promise(resolve => db.once("close", code => resolve(code ?? 1)));
let code = null, shutdownCode = null, failure = null;
try {
  const deadline = Date.now() + 120000;
  while (!output.includes("Native PostgreSQL ready")) {
    assert.equal(db.exitCode, null); assert.ok(Date.now() < deadline);
    await new Promise(resolve => setTimeout(resolve, 200));
  }
  const afterLog = createWriteStream(prefix + "-after.log", { flags: "wx" });
  const probe = spawn(process.execPath, ["scripts/qa-paid-input-upgrade-recovery.mjs", id], {
    cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  });
  probe.stdout.pipe(afterLog, { end: false }); probe.stderr.pipe(afterLog, { end: false });
  code = await new Promise(resolve => probe.once("close", value => resolve(value ?? 1)));
  await new Promise(resolve => afterLog.end(resolve));
  assert.equal(code, 0, "Inspect the preserved post-upgrade log");
} catch (e) { failure = e.message; }
finally {
  if (db.connected && db.exitCode === null) db.send({ action: "shutdown" });
  shutdownCode = await closed;
  await new Promise(resolve => log.end(resolve));
  const raw = [];
  for (const file of [prefix + "-database.log", prefix + "-after.log"])
    raw.push({ path: file, sha256: sha(await readFile(file)) });
  const report = {
    at: new Date().toISOString(), status: code === 0 && shutdownCode === 0 ? "passed" : "failed", failure,
    scope: "Read-only post-upgrade verification against the original genuine SQL087 snapshot. The first probe compared a new nullable task_dependencies.checkpoint_id as if it were an old field; this probe excludes only that declared new column from old-field digests and independently requires it to remain NULL. No migration is rewritten or replayed, no historical row is edited, and the first failure is retained.",
    baseline: baseline.entry, initial_upgrade: failed.entry, original_verifier: originalVerifier,
    owned_database_shutdown: shutdownCode === 0, database_shutdown_exit_code: shutdownCode,
    inputs, raw_reports: raw, verifier, migration_proof: `evidence/paid-input-migrations-${id}.json`,
    migration_verifier: { path: "scripts/qa-paid-input-upgrade-recovery.mjs", sha256: sha(await readFile("scripts/qa-paid-input-upgrade-recovery.mjs")) },
  };
  await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  assert.equal(report.status, "passed", failure ?? "Owned PostgreSQL did not shut down");
  console.log(JSON.stringify({ status: report.status, migrations: 91, original_tables: 169, owned_database_shutdown: report.owned_database_shutdown }));
}
