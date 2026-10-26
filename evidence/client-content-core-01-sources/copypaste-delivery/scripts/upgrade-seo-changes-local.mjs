import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { createWriteStream } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const [fullId, uiId, nativeId, clientsId, id] = process.argv.slice(2);
for (const value of [fullId, uiId, nativeId, clientsId, id])
  assert.match(value ?? "", /^\d{2}$/);
const platform = path.resolve("../copypaste-platform"),
  prefix = `evidence/seo-change-upgrade-${id}`;
const sha = (b) => createHash("sha256").update(b).digest("hex");
const read = async (file) => JSON.parse(await readFile(file, "utf8"));
const inputs = [];
async function bound(file) {
  const bytes = await readFile(file);
  inputs.push({ path: file, sha256: sha(bytes) });
  return JSON.parse(bytes);
}
async function source(files, kind) {
  for (const [file, expected] of Object.entries(files)) {
    let target;
    if (kind === "platform") target = path.join(platform, file);
    else if (kind === "components") {
      const slash = file.indexOf("/");
      target = path.resolve(
        "../copypaste-" + file.slice(0, slash),
        file.slice(slash + 1),
      );
    } else
      target = file.startsWith("docs/")
        ? path.resolve("../..", file)
        : path.resolve("..", file);
    assert.equal(
      sha(await readFile(target)),
      expected,
      "Executed source changed: " + file,
    );
  }
}
async function cleanup(c) {
  assert.equal(sha(await readFile(c.path)), c.sha256);
  const proof = await read(c.path);
  assert.ok(
    proof.status === "passed" &&
      proof.workers_exited &&
      proof.actual_filesystem_checked &&
      proof.results.every((r) => r.reclaimed),
  );
}
async function suite(kind, number, minimum) {
  const r = await bound(`evidence/seo-change-${kind}-${number}.json`);
  assert.equal(r.status, "passed");
  assert.ok(
    r.source_unchanged && r.owned_database_shutdown && r.exit_code === 0,
  );
  const raw = await readFile(r.raw_report.path);
  for (const field of ["raw_report", "verifier", "database_log"])
    assert.equal(sha(await readFile(r[field].path)), r[field].sha256);
  for (const key of ["tests", "pass", "fail", "cancelled", "skipped", "todo"])
    assert.equal(
      r.counts[key],
      Number(
        raw
          .toString()
          .match(new RegExp("^# " + key + " (\\d+)\\r?$", "m"))?.[1] ?? -1,
      ),
    );
  assert.ok(
    r.counts.tests >= minimum &&
      r.counts.tests === r.counts.pass &&
      r.counts.fail + r.counts.cancelled + r.counts.skipped + r.counts.todo ===
        0,
  );
  await cleanup(r.fixture_cleanup);
  await source(r.source_files, "platform");
  return r;
}

const full = await suite("regression", fullId, 734);
const prior = await read("evidence/marketing-connectors-regression-01.json");
assert.equal(prior.counts.tests, 674);
assert.equal(sha(await readFile(prior.raw_report)), prior.raw_sha256);
function names(raw) {
  const result = new Map();
  for (const m of raw
    .toString()
    .matchAll(/^\s*(?:ok|not ok) \d+ - (.+?)\r?$/gm))
    result.set(m[1], (result.get(m[1]) ?? 0) + 1);
  return result;
}
const currentNames = names(await readFile(full.raw_report.path));
for (const [name, count] of names(await readFile(prior.raw_report)))
  assert.ok(
    (currentNames.get(name) ?? 0) >= count,
    "Prior named test removed: " + name,
  );
for (const [kind, number, minimum] of [
  ["ui", uiId, 18],
  ["native", nativeId, 23],
]) {
  const r = await bound(`evidence/seo-change-${kind}-${number}.json`);
  assert.equal(r.status, "passed");
  assert.ok(
    r.source_unchanged &&
      r.owned_database_shutdown &&
      r.web_build_unchanged &&
      r.owned_web_preview_closed,
  );
  for (const field of ["journey", "verifier", "journey_verifier", "raw_report"])
    assert.equal(sha(await readFile(r[field].path)), r[field].sha256);
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
  else assert.ok(r.admin_build_unchanged && r.owned_admin_preview_closed);
  await cleanup(r.fixture_cleanup);
  await source(r.source_files, "prefixed");
}
const clients = await bound(`evidence/seo-change-clients-${clientsId}.json`);
assert.ok(
  clients.status === "passed" &&
    clients.source_unchanged &&
    clients.checks.length === 13,
);
assert.equal(
  sha(await readFile(clients.verifier.path)),
  clients.verifier.sha256,
);
for (const check of clients.checks) {
  assert.equal(check.exit_code, 0);
  assert.equal(sha(await readFile(check.raw_report)), check.raw_sha256);
}
await source(clients.source_files, "components");
for (const file of [
  prefix + ".json",
  prefix + "-database.log",
  `evidence/seo-change-migrations-${id}-before.json`,
])
  await assert.rejects(access(file), (e) => e.code === "ENOENT");
for (const port of [4310, 4317, 4318, 4319, 55432]) {
  const used = await new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
  assert.equal(used, false, "An unrelated process owns a required port");
}
const verifier = await readFile(import.meta.filename);
await writeFile(prefix + "-verifier.mjs", verifier, { flag: "wx" });
const log = createWriteStream(prefix + "-database.log", { flags: "wx" });
const db = spawn(process.execPath, ["scripts/native-db-launch.mjs"], {
  cwd: platform,
  windowsHide: true,
  env: { ...process.env, COPYPASTE_NATIVE_DATABASE_START_ONLY: "true" },
  stdio: ["ignore", "pipe", "pipe", "ipc"],
});
let ready = false,
  completed = false,
  shutdownCode = null,
  failure = null;
db.on("message", (message) => {
  if (message?.event === "database_ready") ready = true;
});
db.stdout.on("data", (b) => {
  if (b.toString().includes("Native PostgreSQL ready")) ready = true;
  log.write(b);
});
db.stderr.on("data", (b) => log.write(b));
const closed = new Promise((resolve, reject) => {
  db.once("close", resolve);
  db.once("error", reject);
});
async function run(args, cwd, file) {
  const stream = createWriteStream(file, { flags: "wx" });
  const child = spawn(process.execPath, args, {
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
  assert.equal(code, 0, "Inspect preserved upgrade log: " + file);
}
try {
  const deadline = Date.now() + 900000;
  while (!ready) {
    assert.equal(db.exitCode, null);
    assert.ok(Date.now() < deadline);
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await run(
    ["scripts/qa-seo-change-migrations.mjs", id, "--before"],
    process.cwd(),
    prefix + "-before.log",
  );
  await run(
    ["--env-file=.env", "--import", "tsx", "scripts/migrate.ts"],
    platform,
    prefix + "-sql080.log",
  );
  await run(
    ["scripts/qa-seo-change-migrations.mjs", id],
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
  const reports = [];
  for (const file of [
    prefix + "-database.log",
    prefix + "-before.log",
    prefix + "-sql080.log",
    prefix + "-after.log",
  ]) {
    const bytes = await readFile(file).catch((e) => {
      if (e.code === "ENOENT") return null;
      throw e;
    });
    if (bytes) reports.push({ path: file, sha256: sha(bytes) });
  }
  await writeFile(
    prefix + ".json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: completed && shutdownCode === 0 ? "passed" : "failed",
        scope:
          "Native persistent SQL079 to 080; both databases and all 167 prior public tables preserved; no invented website/business history",
        failure,
        owned_database_shutdown: shutdownCode === 0,
        database_shutdown_exit_code: shutdownCode,
        inputs,
        raw_reports: reports,
        migration_proof: `evidence/seo-change-migrations-${id}.json`,
        verifier: { path: prefix + "-verifier.mjs", sha256: sha(verifier) },
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
    version: 80,
    original_tables: 167,
    owned_database_shutdown: true,
  }),
);
