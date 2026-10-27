import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createConnection } from "node:net";
import { createWriteStream } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
const [coreId, fullId, uiId, nativeId] = process.argv.slice(2);
for (const id of [coreId, fullId, uiId, nativeId])
  assert.match(id ?? "", /^\d{2}$/);
const platform = path.resolve("../copypaste-platform"),
  sha = (b) => createHash("sha256").update(b).digest("hex");
async function read(file) {
  return JSON.parse(await readFile(file, "utf8"));
}
async function suite(name) {
  const r = await read("evidence/" + name + ".json"),
    raw = await readFile(r.raw_report);
  assert.equal(r.status, "passed");
  assert.equal(r.exit_code, 0);
  assert.ok(r.source_unchanged && r.owned_database_shutdown);
  assert.equal(r.raw_sha256, sha(raw));
  assert.equal(r.migration_sha256, sha(await readFile(r.migration_snapshot)));
  assert.equal(r.verifier_sha256, sha(await readFile(r.verifier_snapshot)));
  assert.ok(
    r.fixture_cleanup.status === "passed" &&
      r.fixture_cleanup.workers_exited &&
      r.fixture_cleanup.actual_filesystem_checked &&
      r.fixture_cleanup.results.every((x) => x.reclaimed),
  );
  assert.equal(
    r.fixture_cleanup.sha256,
    sha(await readFile(r.fixture_cleanup.path)),
  );
  for (const k of ["tests", "pass", "fail", "cancelled", "skipped", "todo"])
    assert.equal(
      r.counts[k],
      Number(
        raw
          .toString()
          .match(new RegExp("^# " + k + " (\\d+)\\r?$", "m"))?.[1] ?? -1,
      ),
    );
  assert.equal(r.counts.pass, r.counts.tests);
  assert.equal(
    r.counts.fail + r.counts.cancelled + r.counts.skipped + r.counts.todo,
    0,
  );
  return r;
}
const core = await suite("template-video-core-" + coreId),
  full = await suite("template-video-regression-" + fullId);
assert.ok(core.counts.tests >= 34 && full.counts.tests >= 638);
assert.deepEqual(core.component_sources, full.component_sources);
for (const [component, files] of Object.entries(full.component_sources))
  for (const [file, expected] of Object.entries(files))
    assert.equal(
      sha(await readFile(path.resolve("../copypaste-" + component, file))),
      expected,
      "Current executed source changed: " + file,
    );
const baseline = await read(path.resolve("../../docs/quality/creative-matrix-checkpoint.json"));
const prior = await read(path.resolve("../..", baseline.full_platform_regression.path));
assert.equal(prior.counts.tests, 607);
const oldRaw = await readFile(prior.raw_report),
  newRaw = await readFile(full.raw_report);
assert.equal(sha(oldRaw), prior.raw_sha256);
function names(raw) {
  const result = new Map();
  for (const m of raw
    .toString()
    .matchAll(/^\s*(?:ok|not ok) \d+ - (.+?)\r?$/gm))
    result.set(m[1], (result.get(m[1]) ?? 0) + 1);
  return result;
}
const currentNames = names(newRaw);
for (const [name, count] of names(oldRaw))
  assert.ok(
    (currentNames.get(name) ?? 0) >= count,
    "Prior test removed: " + name,
  );
for (const [kind, id, min] of [
  ["ui", uiId, 10],
  ["native", nativeId, 17],
]) {
  const r = await read(`evidence/template-video-${kind}-${id}.json`);
  assert.equal(r.status, "passed");
  assert.ok(
    r.source_unchanged && r.owned_database_shutdown && r.web_build_unchanged,
  );
  const j = await read(r.journey.path);
  assert.equal(sha(await readFile(r.journey.path)), r.journey.sha256);
  assert.ok(
    j.browser_closed &&
      j.owned_api_closed &&
      j.checks.length >= min &&
      j.errors.length === 0,
  );
  for (const [key, expected] of Object.entries(r.source_files))
    if (
      key.startsWith("copypaste-platform/") ||
      key.startsWith("copypaste-web/")
    )
      assert.equal(sha(await readFile(path.resolve("..", key))), expected);
}
const compiled = await read("evidence/template-video-static-02.json");
assert.equal(compiled.status, "passed");
assert.deepEqual(compiled.source_files, full.source_files);
assert.equal(full.retention_migration_sha256,sha(await readFile(full.retention_migration_snapshot)));
for (const c of compiled.checks)
  assert.ok(
    c.exit_code === 0 && sha(await readFile(c.raw_report)) === c.raw_sha256,
  );
await assert.rejects(
  access("evidence/template-video-migrations-before.json"),
  (e) => e.code === "ENOENT",
);
for (const port of [4310, 4317, 4318, 4319, 55432])
  assert.equal(
    await new Promise((resolve) => {
      const s = createConnection({ host: "127.0.0.1", port });
      s.once("connect", () => {
        s.destroy();
        resolve(true);
      });
      s.once("error", () => resolve(false));
    }),
    false,
    "Owned service ports must be free",
  );
const log = createWriteStream("evidence/template-video-upgrade-database.log", {
    flags: "wx",
  }),
  db = spawn(process.execPath, ["scripts/native-db-launch.mjs"], {
    cwd: platform,
    windowsHide: true,
    env: { ...process.env, COPYPASTE_NATIVE_DATABASE_START_ONLY: "true" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
let ready = "",
  completed = false,
  shutdownCode = null;
db.stdout.on("data", (b) => {
  ready = (ready + b.toString()).slice(-4000);
  log.write(b);
});
db.stderr.on("data", (b) => log.write(b));
const closed = new Promise((resolve, reject) => {
  db.once("close", resolve);
  db.once("error", reject);
});
async function run(args, cwd, file) {
  const stream = createWriteStream(file, { flags: "wx" }),
    child = spawn(process.execPath, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  child.stdout.pipe(stream, { end: false });
  child.stderr.pipe(stream, { end: false });
  const code = await new Promise((resolve, reject) => {
    child.once("close", resolve);
    child.once("error", reject);
  });
  await new Promise((r) => stream.end(r));
  assert.equal(code, 0, "Inspect preserved native migration check: " + file);
}
try {
  const deadline = Date.now() + 120000;
  while (!ready.includes("Native PostgreSQL ready")) {
    assert.equal(db.exitCode, null);
    assert.ok(Date.now() < deadline);
    await new Promise((r) => setTimeout(r, 200));
  }
  await run(
    ["scripts/qa-template-video-migrations.mjs", "--before"],
    process.cwd(),
    "evidence/template-video-migrations-before.log",
  );
  await run(
    ["--env-file=.env", "--import", "tsx", "scripts/migrate.ts"],
    platform,
    "evidence/template-video-live-migration-070-071.log",
  );
  await run(
    ["scripts/qa-template-video-migrations.mjs"],
    process.cwd(),
    "evidence/template-video-migrations-after.log",
  );
  completed = true;
} finally {
  if (db.connected && db.exitCode === null) db.send({ action: "shutdown" });
  shutdownCode = await closed;
  await new Promise((r) => log.end(r));
  await writeFile(
    "evidence/template-video-upgrade.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: completed && shutdownCode === 0 ? "passed" : "failed",
        native_database_shutdown_exit_code: shutdownCode,
        owned_database_shutdown: shutdownCode === 0,
        core: coreId,
        full: fullId,
        web: uiId,
        native: nativeId,
        verifier_sha256: sha(await readFile(import.meta.filename)),
        migration_sha256: sha(
          await readFile(
            path.join(
              platform,
              "migrations/070-template-video-projects.sql",
            ),
          ),
        ),
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  assert.ok(completed && shutdownCode === 0);
}
console.log(
  JSON.stringify({
    status: "passed",
    version: 71,
    prior_tables: 154,
    original_migrations: 69,
    owned_database_shutdown: true,
  }),
);
