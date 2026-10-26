import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { createWriteStream } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";

const platform = path.resolve("../copypaste-platform"),
  attempt = process.argv[2] ?? "01";
assert.match(attempt, /^\d{2}$/);
const logPath = `evidence/support-candidate-${attempt}.tap`,
  migration = "migrations/062-controlled-support-scopes.sql",
  sources = [
    migration,
    "src/admin-support.ts",
    "src/server.ts",
    "src/admin.ts",
    "src/admin-jobs.ts",
    "src/admin-operations.ts",
    "tests/admin-support.test.ts",
    "tests/migrations.test.ts",
    "contracts/admin-support-schemas.json",
  ],
  sha = (bytes) => createHash("sha256").update(bytes).digest("hex"),
  hashes = {};
await assert.rejects(access(logPath), (e) => e.code === "ENOENT");
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
    "Stop the owned stack before candidate database work",
  );
}
for (const source of sources)
  hashes[source] = sha(await readFile(path.join(platform, source)));
await writeFile(
  `evidence/support-candidate-${attempt}-062.sql`,
  await readFile(path.join(platform, migration)),
  { flag: "wx" },
);
const databaseLog = createWriteStream(
    `evidence/support-candidate-${attempt}-database.log`,
  ),
  database = spawn(process.execPath, ["scripts/native-db-launch.mjs"], {
    cwd: platform,
    windowsHide: true,
    env: { ...process.env, COPYPASTE_NATIVE_DATABASE_START_ONLY: "true" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
let ready = "",
  testCode = null;
database.stdout.on("data", (bytes) => {
  ready = (ready + bytes.toString()).slice(-4000);
  databaseLog.write(bytes);
});
database.stderr.on("data", (bytes) => databaseLog.write(bytes));
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
  const log = createWriteStream(logPath),
    child = spawn(
      process.execPath,
      [
        "--env-file=.env",
        "--import",
        "tsx",
        "--test",
        "--test-concurrency=1",
        "tests/admin-support.test.ts",
        "tests/financial-notifications.test.ts",
        "tests/migrations.test.ts",
      ],
      { cwd: platform, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
  child.stdout.on("data", (bytes) => log.write(bytes));
  child.stderr.on("data", (bytes) => log.write(bytes));
  testCode = await new Promise((resolve, reject) => {
    child.once("close", resolve);
    child.once("error", reject);
  });
  await new Promise((resolve) => log.end(resolve));
  for (const source of sources)
    assert.equal(
      sha(await readFile(path.join(platform, source))),
      hashes[source],
      "Candidate changed during execution: " + source,
    );
} finally {
  if (database.connected && database.exitCode === null)
    database.send({ action: "shutdown" });
  await stopped;
  await new Promise((resolve) => databaseLog.end(resolve));
  await writeFile(
    `evidence/support-candidate-${attempt}.json`,
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: testCode === 0 ? "passed" : "failed",
        exit_code: testCode,
        scope:
          "Isolated native controlled support, populated migration and prior financial delivery suites; no live database migration or API restart",
        source_files: hashes,
        raw_report: logPath,
        raw_sha256: sha(await readFile(logPath)),
        owned_database_shutdown: true,
      },
      null,
      2,
    ) + "\n",
  );
}
console.log(
  JSON.stringify({
    attempt,
    exit_code: testCode,
    owned_database_shutdown: true,
  }),
);
assert.equal(
  testCode,
  0,
  "Inspect preserved candidate TAP before changing or applying SQL",
);
