import { spawn, execFileSync } from "node:child_process";
import { createConnection } from "node:net";
import { createWriteStream } from "node:fs";
import { access, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";

const platform = path.resolve("../copypaste-platform"),
  attempt = process.argv[2];
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
async function admit(report, raw) {
  assert.equal(report.status, "passed");
  assert.equal(report.exit_code, 0);
  assert.equal(report.source_unchanged, true);
  assert.equal(report.owned_database_shutdown, true);
  assert.equal(report.database_shutdown_exit_code, 0);
  assert.equal(report.fixture_cleanup?.status, "passed");
  assert.equal(report.fixture_cleanup.workers_exited, true);
  assert.equal(report.fixture_cleanup.actual_filesystem_checked, true);
  assert.ok(report.fixture_cleanup.results.every((r) => r.reclaimed));
  assert.equal(
    report.fixture_cleanup.sha256,
    sha(await readFile(report.fixture_cleanup.path)),
  );
  assert.equal(report.raw_sha256, sha(raw));
  const counts = Object.fromEntries(
    ["tests", "pass", "fail", "cancelled", "skipped", "todo"].map((name) => [
      name,
      Number(
        raw
          .toString()
          .match(new RegExp("^# " + name + " (\\d+)\\r?$", "m"))?.[1] ?? -1,
      ),
    ]),
  );
  assert.deepEqual(report.counts, counts);
  assert.ok(counts.tests > 0);
  assert.equal(counts.pass, counts.tests);
  for (const key of ["fail", "cancelled", "skipped", "todo"])
    assert.equal(counts[key], 0);
  assert.equal(
    sha(await readFile(report.verifier_snapshot)),
    report.verifier_sha256,
  );
  assert.equal(
    sha(await readFile(report.migration_snapshot)),
    report.migration_sha256,
  );
}
assert.match(
  attempt ?? "",
  /^\d{2}$/,
  "Select the preserved successful candidate run explicitly",
);
const candidate = JSON.parse(
  await readFile(`evidence/agent-adoption-candidate-${attempt}.json`, "utf8"),
);
const raw = await readFile(`evidence/agent-adoption-candidate-${attempt}.tap`);
await admit(candidate, raw);
assert.deepEqual(
  [...candidate.test_files].sort(),
  [
    "tests/capability-releases.test.ts",
    "tests/agent-adoption.test.ts",
    "tests/capability-bindings.test.ts",
    "tests/agent-templates.test.ts",
    "tests/migrations.test.ts",
    "tests/runtime.test.ts",
    "tests/default-assistant.test.ts",
    "tests/task-control.test.ts",
    "tests/persistent-work.test.ts",
  ].sort(),
  "All nine focused files are required",
);
const regressionAttempt = process.argv[3];
assert.match(
  regressionAttempt ?? "",
  /^\d{2}$/,
  "Select the successful full regression explicitly",
);
const regression = JSON.parse(
  await readFile(
    `evidence/agent-adoption-regression-${regressionAttempt}.json`,
    "utf8",
  ),
);
await admit(regression, await readFile(regression.raw_report));
assert.deepEqual(regression.source_files, candidate.source_files);
assert.deepEqual(
  await snapshot(),
  candidate.source_files,
  "Added, removed or changed source files require a new isolated run",
);
assert.equal(regression.migration_sha256, candidate.migration_sha256);
assert.deepEqual(
  await readFile(
    path.join(platform, "migrations/065-explicit-agent-adoption.sql"),
  ),
  await readFile(`evidence/agent-adoption-candidate-${attempt}-065.sql`),
);
await assert.rejects(
  access("evidence/agent-adoption-migrations-before.json"),
  (e) => e.code === "ENOENT",
);
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
    "Stop only the owned controller before the upgrade",
  );
}
const stream = createWriteStream(
  "evidence/agent-adoption-upgrade-native-database.log",
  { flags: "wx" },
);
const database = spawn(process.execPath, ["scripts/native-db-launch.mjs"], {
  cwd: platform,
  windowsHide: true,
  env: { ...process.env, COPYPASTE_NATIVE_DATABASE_START_ONLY: "true" },
  stdio: ["ignore", "pipe", "pipe", "ipc"],
});
let ready = "";
database.stdout.on("data", (bytes) => {
  ready = (ready + bytes.toString()).slice(-4000);
  stream.write(bytes);
});
database.stderr.on("data", (bytes) => stream.write(bytes));
const stopped = new Promise((resolve, reject) => {
  database.once("close", resolve);
  database.once("error", reject);
});
let completed = false,
  sourceStable = false,
  shutdownCode = null;
async function run(args, cwd, logFile) {
  const log = logFile ? createWriteStream(logFile, { flags: "wx" }) : undefined;
  const child = spawn(process.execPath, args, {
    cwd,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (bytes) =>
    log ? log.write(bytes) : process.stdout.write(bytes),
  );
  child.stderr.on("data", (bytes) =>
    log ? log.write(bytes) : process.stderr.write(bytes),
  );
  const code = await new Promise((resolve, reject) => {
    child.once("close", resolve);
    child.once("error", reject);
  });
  if (log) await new Promise((resolve) => log.end(resolve));
  assert.equal(code, 0, "Inspect the retained native upgrade log");
}
try {
  const deadline = Date.now() + 120000;
  while (!ready.includes("Native PostgreSQL ready")) {
    assert.equal(database.exitCode, null);
    assert.ok(Date.now() < deadline, "Native database did not become ready");
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  await run(
    ["scripts/qa-agent-adoption-migrations.mjs", "--before"],
    process.cwd(),
  );
  await run(
    ["--env-file=.env", "--import", "tsx", "scripts/migrate.ts"],
    platform,
    "evidence/agent-adoption-live-migration-065.log",
  );
  await run(["scripts/qa-agent-adoption-migrations.mjs"], process.cwd());
  sourceStable =
    JSON.stringify(await snapshot()) === JSON.stringify(candidate.source_files);
  assert.equal(
    sourceStable,
    true,
    "Platform source changed during the upgrade",
  );
  completed = true;
} finally {
  if (database.connected && database.exitCode === null)
    database.send({ action: "shutdown" });
  shutdownCode = await stopped;
  await new Promise((resolve) => stream.end(resolve));
  await writeFile(
    "evidence/agent-adoption-upgrade.json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status:
          completed && sourceStable && shutdownCode === 0 ? "passed" : "failed",
        scope:
          "Native local 064-to-065 upgrade of both existing databases after unchanged focused and full regression admission; no production deployment or fabricated customer adoption facts",
        candidate: {
          path: `evidence/agent-adoption-candidate-${attempt}.json`,
          sha256: sha(
            await readFile(`evidence/agent-adoption-candidate-${attempt}.json`),
          ),
        },
        regression: {
          path: `evidence/agent-adoption-regression-${regressionAttempt}.json`,
          sha256: sha(
            await readFile(
              `evidence/agent-adoption-regression-${regressionAttempt}.json`,
            ),
          ),
        },
        source_unchanged: sourceStable,
        owned_database_shutdown: shutdownCode === 0,
        database_shutdown_exit_code: shutdownCode,
        verifier_sha256: sha(await readFile(import.meta.filename)),
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  assert.equal(shutdownCode, 0);
}
console.log(
  "Native 065 upgrade and original-row preservation verified; owned PostgreSQL stopped.",
);
