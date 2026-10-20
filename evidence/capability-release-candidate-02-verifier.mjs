import { spawn, execFileSync } from "node:child_process";
import { createConnection } from "node:net";
import { createWriteStream } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";

const platform = path.resolve("../copypaste-platform"),
  attempt = process.argv[2] ?? "01";
assert.match(attempt, /^\d{2}$/);
const rawPath = `evidence/capability-release-candidate-${attempt}.tap`;
await assert.rejects(access(rawPath), (e) => e.code === "ENOENT");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function snapshot() {
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
    { cwd: platform, windowsHide: true, encoding: "utf8" },
  )
    .split("\0")
    .filter(
      (file) =>
        /^(src|tests|migrations|catalog|contracts|scripts|skills)\//.test(
          file,
        ) || /^(package(-lock)?|tsconfig)\.json$/.test(file),
    );
  const result = {};
  for (const file of [...new Set(files)].sort())
    result[file] = sha(await readFile(path.join(platform, file)));
  return result;
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
const before = await snapshot(),
  verifier = sha(await readFile(import.meta.filename));
const migration = "migrations/064-controlled-capability-releases.sql";
await writeFile(`evidence/capability-release-candidate-${attempt}-verifier.mjs`,await readFile(import.meta.filename),{flag:"wx"});
await writeFile(
  `evidence/capability-release-candidate-${attempt}-064.sql`,
  await readFile(path.join(platform, migration)),
  { flag: "wx" },
);
const dbLog = createWriteStream(
  `evidence/capability-release-candidate-${attempt}-database.log`,
  { flags: "wx" },
);
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
    [
      "--env-file=.env",
      "--import",
      "tsx",
      "--test",
      "--test-concurrency=1",
      "tests/capability-releases.test.ts",
      "tests/capability-bindings.test.ts",
      "tests/agent-templates.test.ts",
      "tests/migrations.test.ts",
      "tests/runtime.test.ts",
      "tests/default-assistant.test.ts",
      "tests/task-control.test.ts",
      "tests/persistent-work.test.ts",
    ],
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
    counts.tests > 0 &&
    counts.pass === counts.tests &&
    ["fail", "cancelled", "skipped", "todo"].every((key) => counts[key] === 0);
  await writeFile(
    `evidence/capability-release-candidate-${attempt}.json`,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: passed ? "passed" : "failed",
        exit_code: testCode,
        scope:
          "Isolated capability document verification, independent Admin publication/rollback, current database heads, original strict capability contract, frozen tasks, populated 063-to-064 upgrade, real pinned Codex with controlled AI/media dependencies; not full product/role or production acceptance",
        counts,
        source_files: before,
        source_unchanged: sourceStable,
        verifier_sha256: verifier,
        verifier_snapshot: `evidence/capability-release-candidate-${attempt}-verifier.mjs`,
        raw_report: rawPath,
        raw_sha256: sha(raw),
        migration_snapshot: `evidence/capability-release-candidate-${attempt}-064.sql`,
        migration_sha256: before[migration],
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
    "Inspect preserved candidate TAP and SQL before changing or applying the migration",
  );
}
