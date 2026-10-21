import { spawn, execFileSync } from "node:child_process";
import { createConnection } from "node:net";
import { createWriteStream } from "node:fs";
import { access, readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";

const platform = path.resolve("../copypaste-platform"),
  attempt = process.argv[2] ?? "01";
assert.match(attempt, /^\d{2}$/);
const full = process.argv[3] === "--full",
  core = !full;
assert.ok(process.argv.length <= 3 || (process.argv.length === 4 && full));
const prefix = "template-video-" + (full ? "regression" : "core");
const testFiles = full
  ? ["tests/*.test.ts"]
  : ["tests/video-projects.test.ts", "tests/video-render.test.ts", "tests/migrations.test.ts"];
const rawPath = `evidence/${prefix}-${attempt}.tap`;
await assert.rejects(access(rawPath), (e) => e.code === "ENOENT");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function componentSnapshot(root) {
  const files = execFileSync(
    "git",
    [
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.untrackedCache=false",
      "ls-files",
      "--cached",
      "--others",
      "--exclude-standard",
      "-z",
    ],
    { cwd: root, windowsHide: true, encoding: "utf8" },
  )
    .split("\0")
    .filter(
      (file) =>
        /^(src|tests|migrations|catalog|contracts|scripts|skills|assets)\//.test(
          file,
        ) ||
        /^(package(-lock)?|tsconfig)\.json$/.test(file) ||
        file === ".env.example" || file === ".gitattributes",
    );
  const result = {};
  for (const file of [...new Set(files)].sort())
    result[file] = sha(await readFile(path.join(root, file)));
  return result;
}
async function snapshot() {
  return {
    platform: await componentSnapshot(platform),
    web: await componentSnapshot(path.resolve("../copypaste-web")),
  };
}
for (const port of [4310, 4317, 4318, 4319, 55432]) {
  const reachable = await new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
  assert.equal(
    reachable,
    false,
    "Stop the owned stack before isolated candidate work",
  );
}
const oldMigrations = execFileSync(
  "git",
  [
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.untrackedCache=false",
    "ls-tree",
    "-r",
    "--name-only",
    "9ade763",
    "--",
    "migrations",
  ],
  { cwd: platform, windowsHide: true, encoding: "utf8" },
)
  .trim()
  .split("\n");
assert.equal(oldMigrations.length, 69);
for (const file of oldMigrations) {
  const original = execFileSync(
    "git",
    [
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.untrackedCache=false",
      "show",
      "9ade763:" + file,
    ],
    { cwd: platform, windowsHide: true },
  );
  assert.equal(
    sha(await readFile(path.join(platform, file))),
    sha(original),
    "Original SQL 001-069 changed",
  );
}
const before = await snapshot(),
  verifier = sha(await readFile(import.meta.filename));
const preimages = {};
for (const [component, directory] of [
  ["platform", platform],
  ["web", path.resolve("../copypaste-web")],
]) {
  const tracked = execFileSync(
    "git",
    [
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.untrackedCache=false",
      "diff",
      "--name-only",
      "HEAD",
      "--",
      ".",
    ],
    { cwd: directory, encoding: "utf8", windowsHide: true },
  )
    .trim()
    .split("\n");
  const extra = execFileSync(
    "git",
    [
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.untrackedCache=false",
      "ls-files",
      "--others",
      "--exclude-standard",
      "-z",
    ],
    { cwd: directory, encoding: "utf8", windowsHide: true },
  ).split("\0");
  const baseline = execFileSync(
    "git",
    [
      "-c",
      "core.fsmonitor=false",
      "-c",
      "core.untrackedCache=false",
      "rev-parse",
      "HEAD",
    ],
    { cwd: directory, encoding: "utf8", windowsHide: true },
  ).trim();
  const files = [];
  for (const file of [...new Set([...tracked, ...extra])]
    .filter((f) => before[component][f])
    .sort()) {
    const destination = `evidence/${prefix}-${attempt}-sources/${component}/${file}`;
    await mkdir(path.dirname(destination), { recursive: true });
    const bytes = await readFile(path.join(directory, file));
    await writeFile(destination, bytes, { flag: "wx" });
    files.push({ source: file, path: destination, sha256: sha(bytes) });
  }
  preimages[component] = { baseline_commit: baseline, files };
}
await writeFile(
  `evidence/${prefix}-${attempt}-sources.json`,
  JSON.stringify(preimages, null, 2) + "\n",
  { flag: "wx" },
);
const migration = "migrations/070-template-video-projects.sql";
await writeFile(
  `evidence/${prefix}-${attempt}-verifier.mjs`,
  await readFile(import.meta.filename),
  { flag: "wx" },
);
await writeFile(
  `evidence/${prefix}-${attempt}-070.sql`,
  await readFile(path.join(platform, migration)),
  { flag: "wx" },
);
const dbLog = createWriteStream(`evidence/${prefix}-${attempt}-database.log`, {
  flags: "wx",
});
const database = spawn(process.execPath, ["scripts/native-db-launch.mjs"], {
  cwd: platform,
  windowsHide: true,
  env: { ...process.env, COPYPASTE_NATIVE_DATABASE_START_ONLY: "true" },
  stdio: ["ignore", "pipe", "pipe", "ipc"],
});
let ready = "",
  testCode = null,
  sourceStable = false,
  shutdownCode = null;
database.stdout.on("data", (bytes) => {
  ready = (ready + bytes.toString()).slice(-4000);
  dbLog.write(bytes);
});
database.stderr.on("data", (bytes) => dbLog.write(bytes));
const stopped = new Promise((resolve, reject) => {
  database.once("close", resolve);
  database.once("error", reject);
});
try {
  const deadline = Date.now() + 120000;
  while (!ready.includes("Native PostgreSQL ready")) {
    assert.equal(database.exitCode, null);
    assert.ok(Date.now() < deadline, "Native database readiness timed out");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  const log = createWriteStream(rawPath, { flags: "wx" });
  const suite = spawn(
    process.execPath,
    ["--env-file=.env", "scripts/run-tests-owned.mjs", ...testFiles],
    { cwd: platform, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  suite.stdout.on("data", (bytes) => log.write(bytes));
  suite.stderr.on("data", (bytes) => log.write(bytes));
  testCode = await new Promise((resolve, reject) => {
    suite.once("close", resolve);
    suite.once("error", reject);
  });
  await new Promise((resolve) => log.end(resolve));
  sourceStable =
    JSON.stringify(before) === JSON.stringify(await snapshot()) &&
    verifier === sha(await readFile(import.meta.filename));
} finally {
  if (database.connected && database.exitCode === null)
    database.send({ action: "shutdown" });
  shutdownCode = await stopped;
  await new Promise((resolve) => dbLog.end(resolve));
  const raw = await readFile(rawPath).catch((e) => {
    if (e.code === "ENOENT") return Buffer.alloc(0);
    throw e;
  });
  const text = raw.toString();
  let fixtureCleanup = null;
  try {
    const summary = JSON.parse(
      text.match(/^# owned_fixture_cleanup (.+)$/m)?.[1] ?? "null",
    );
    assert.match(
      summary.path,
      /^\.data\/test-fixture-reclamation\/[a-f0-9-]{36}\/result\.json$/,
    );
    const bytes = await readFile(path.join(platform, summary.path)),
      result = JSON.parse(bytes);
    assert.equal(summary.sha256, sha(bytes));
    assert.equal(summary.exit_code, 0);
    assert.equal(result.status, "passed");
    assert.equal(result.workers_exited, true);
    assert.equal(result.actual_filesystem_checked, true);
    assert.ok(result.results.every((r) => r.reclaimed));
    const cleanupSnapshot = `evidence/${prefix}-${attempt}-fixture-cleanup.json`;
    await writeFile(cleanupSnapshot, bytes, { flag: "wx" });
    fixtureCleanup = {
      path: cleanupSnapshot,
      sha256: summary.sha256,
      ...result,
    };
  } catch {
    /* An absent or failed actual cleanup makes the whole run fail. */
  }
  const counts = Object.fromEntries(
    ["tests", "pass", "fail", "cancelled", "skipped", "todo"].map((name) => [
      name,
      Number(text.match(new RegExp("^# " + name + " (\\d+)$", "m"))?.[1] ?? -1),
    ]),
  );
  const passed =
    testCode === 0 &&
    sourceStable &&
    shutdownCode === 0 &&
    fixtureCleanup !== null &&
    counts.tests > 0 &&
    counts.pass === counts.tests &&
    ["fail", "cancelled", "skipped", "todo"].every((key) => counts[key] === 0);
  await writeFile(
    `evidence/${prefix}-${attempt}.json`,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: passed ? "passed" : "failed",
        exit_code: testCode,
        schema_change: true,
        scope:
          "Template video projects: frozen scripts/storyboards/captions/sources, actual MP4 and audio, versioned durable render queue, current authority, scoped deliverables, cancellation, immutable history, source quarantine and physical erasure; native PostgreSQL and simulated platform configuration, no AI calls or whole-product qualification",
        source_preimages: `evidence/${prefix}-${attempt}-sources.json`,
        counts,
        fixture_cleanup: fixtureCleanup,
        test_files: testFiles,
        component_sources: before,
        source_files: before.platform,
        source_unchanged: sourceStable,
        verifier_sha256: verifier,
        verifier_snapshot: `evidence/${prefix}-${attempt}-verifier.mjs`,
        raw_report: rawPath,
        raw_sha256: sha(raw),
        migration_snapshot: `evidence/${prefix}-${attempt}-070.sql`,
        migration_sha256: before.platform[migration],
        database_shutdown_exit_code: shutdownCode,
        owned_database_shutdown: shutdownCode === 0,
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      attempt,
      passed,
      counts,
      source_unchanged: sourceStable,
      owned_database_shutdown: shutdownCode === 0,
    }),
  );
  assert.ok(
    passed,
    "Inspect the preserved video TAP, video source hashes and actual fixture cleanup",
  );
}
