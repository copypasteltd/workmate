import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { createWriteStream } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const [coreId, fullId, uiId, nativeId, clientsId, attempt] =
  process.argv.slice(2);
for (const id of [coreId, fullId, uiId, nativeId, clientsId, attempt])
  assert.match(id ?? "", /^\d{2}$/);
const platform = path.resolve("../copypaste-platform"),
  prefix = "evidence/marketing-connector-upgrade-" + attempt;
const sha = (b) => createHash("sha256").update(b).digest("hex");
const read = async (file) => JSON.parse(await readFile(file, "utf8"));
async function bound(file) {
  const r = await read(file);
  return { path: file, sha256: sha(await readFile(file)), receipt: r };
}
async function suite(name) {
  const record = await bound("evidence/" + name + ".json"),
    r = record.receipt,
    raw = await readFile(r.raw_report);
  assert.equal(r.status, "passed");
  assert.equal(r.exit_code, 0);
  assert.ok(r.source_unchanged && r.owned_database_shutdown);
  assert.equal(r.raw_sha256, sha(raw));
  assert.equal(r.verifier_sha256, sha(await readFile(r.verifier_snapshot)));
  for (const key of ["tests", "pass", "fail", "cancelled", "skipped", "todo"])
    assert.equal(
      r.counts[key],
      Number(
        raw
          .toString()
          .match(new RegExp("^# " + key + " (\\d+)\\r?$", "m"))?.[1] ?? -1,
      ),
    );
  assert.equal(r.counts.pass, r.counts.tests);
  assert.equal(
    r.counts.fail + r.counts.cancelled + r.counts.skipped + r.counts.todo,
    0,
  );
  const c = r.fixture_cleanup;
  assert.ok(
    c.status === "passed" &&
      c.workers_exited &&
      c.actual_filesystem_checked &&
      c.results.every((x) => x.reclaimed),
  );
  assert.equal(c.sha256, sha(await readFile(c.path)));
  assert.equal(r.migration_sha256, sha(await readFile(r.migration_snapshot)));
  assert.equal(
    r.lineage_migration_sha256,
    sha(await readFile(r.lineage_migration_snapshot)),
  );
  for (const [file, proof] of Object.entries(r.forward_migrations)) {
    assert.equal(proof.sha256, sha(await readFile(proof.path)));
    assert.equal(proof.sha256, sha(await readFile(path.join(platform, file))));
  }
  return record;
}
const core = await suite("marketing-connectors-core-" + coreId),
  full = await suite("marketing-connectors-regression-" + fullId);
assert.ok(core.receipt.counts.tests >= 39 && full.receipt.counts.tests >= 674);
assert.deepEqual(
  core.receipt.component_sources,
  full.receipt.component_sources,
);
for (const [component, files] of Object.entries(full.receipt.component_sources))
  for (const [file, expected] of Object.entries(files))
    assert.equal(
      sha(await readFile(path.resolve("../copypaste-" + component, file))),
      expected,
      "Current executed source changed: " + file,
    );
function names(raw) {
  const result = new Map();
  for (const m of raw
    .toString()
    .matchAll(/^\s*(?:ok|not ok) \d+ - (.+?)\r?$/gm))
    result.set(m[1], (result.get(m[1]) ?? 0) + 1);
  return result;
}
const previous = await read("evidence/template-video-regression-02.json"),
  priorRaw = await readFile(previous.raw_report);
assert.equal(previous.counts.tests, 638);
assert.equal(previous.raw_sha256, sha(priorRaw));
const currentNames = names(await readFile(full.receipt.raw_report));
for (const [name, count] of names(priorRaw))
  assert.ok(
    (currentNames.get(name) ?? 0) >= count,
    "Original named test removed: " + name,
  );
const runtime = [];
for (const [kind, id, minimum] of [
  ["ui", uiId, 10],
  ["native", nativeId, 16],
]) {
  const record = await bound(`evidence/marketing-connector-${kind}-${id}.json`),
    r = record.receipt;
  assert.equal(r.status, "passed");
  assert.ok(
    r.source_unchanged && r.owned_database_shutdown && r.web_build_unchanged,
  );
  for (const key of ["journey", "raw_report", "verifier", "journey_verifier"])
    assert.equal(r[key].sha256, sha(await readFile(r[key].path)));
  const j = await read(r.journey.path);
  assert.ok(
    j.status === "passed" &&
      j.checks.length >= minimum &&
      j.errors.length === 0 &&
      j.browser_closed &&
      j.owned_api_closed,
  );
  if (kind === "native")
    assert.ok(
      j.desktop_closed && j.extension_closed && j.artifacts_unchanged_after_run,
    );
  if (kind === "ui")
    assert.ok(r.admin_build_unchanged && r.owned_admin_preview_closed);
  for (const [key, expected] of Object.entries(r.source_files))
    assert.equal(
      sha(
        await readFile(
          key.startsWith("docs/")
            ? path.resolve("../..", key)
            : path.resolve("..", key),
        ),
      ),
      expected,
      key,
    );
  runtime.push(record);
}
const clients = await bound(
  "evidence/marketing-connector-clients-" + clientsId + ".json",
);
assert.ok(
  clients.receipt.status === "passed" &&
    clients.receipt.source_unchanged &&
    clients.receipt.checks.length === 13,
);
for (const check of clients.receipt.checks) {
  assert.equal(check.exit_code, 0);
  assert.equal(check.raw_sha256, sha(await readFile(check.raw_report)));
}
for (const [key, expected] of Object.entries(clients.receipt.source_files)) {
  const slash = key.indexOf("/");
  assert.equal(
    sha(
      await readFile(
        path.resolve(
          "../copypaste-" + key.slice(0, slash),
          key.slice(slash + 1),
        ),
      ),
    ),
    expected,
    key,
  );
}
for (const file of [
  prefix + ".json",
  `evidence/marketing-connector-migrations-${attempt}-before.json`,
])
  await assert.rejects(access(file), (e) => e.code === "ENOENT");
for (const port of [4310, 4317, 4318, 4319, 55432])
  assert.equal(
    await new Promise((resolve) => {
      const socket = createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
    }),
    false,
    "Owned service port occupied",
  );
const log = createWriteStream(prefix + "-database.log", { flags: "wx" });
const db = spawn(process.execPath, ["scripts/native-db-launch.mjs"], {
  cwd: platform,
  windowsHide: true,
  env: { ...process.env, COPYPASTE_NATIVE_DATABASE_START_ONLY: "true" },
  stdio: ["ignore", "pipe", "pipe", "ipc"],
});
let ready = "",
  completed = false,
  shutdownCode = null,
  failure = null;
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
  await new Promise((resolve) => stream.end(resolve));
  assert.equal(code, 0, "Inspect preserved migration log: " + file);
}
try {
  const deadline = Date.now() + 900000;
  while (!ready.includes("Native PostgreSQL ready")) {
    assert.equal(db.exitCode, null);
    assert.ok(Date.now() < deadline);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await run(
    ["scripts/qa-marketing-connector-migrations.mjs", attempt, "--before"],
    process.cwd(),
    prefix + "-before.log",
  );
  await run(
    ["--env-file=.env", "--import", "tsx", "scripts/migrate.ts"],
    platform,
    prefix + "-sql072-077.log",
  );
  await run(
    ["scripts/qa-marketing-connector-migrations.mjs", attempt],
    process.cwd(),
    prefix + "-after.log",
  );
  completed = true;
} catch (error) {
  failure = error.message;
} finally {
  if (db.connected && db.exitCode === null) db.send({ action: "shutdown" });
  shutdownCode = await closed;
  await new Promise((resolve) => log.end(resolve));
  await writeFile(
    prefix + ".json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: completed && shutdownCode === 0 ? "passed" : "failed",
        failure,
        scope:
          "Native persistent SQL071→077, both databases and all 157 prior public tables preserved; no live-provider qualification",
        owned_database_shutdown: shutdownCode === 0,
        database_shutdown_exit_code: shutdownCode,
        inputs: [core, full, ...runtime, clients].map(({ path, sha256 }) => ({
          path,
          sha256,
        })),
        migration_proof: `evidence/marketing-connector-migrations-${attempt}.json`,
        verifier_sha256: sha(await readFile(import.meta.filename)),
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  assert.ok(
    completed && shutdownCode === 0,
    failure ?? "Owned database shutdown failed",
  );
}
console.log(
  JSON.stringify({
    status: "passed",
    version: 77,
    original_tables: 157,
    owned_database_shutdown: true,
  }),
);
