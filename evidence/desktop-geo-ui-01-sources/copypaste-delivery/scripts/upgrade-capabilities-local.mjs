import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { createWriteStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";

const platform = path.resolve("../copypaste-platform"),
  attempt = process.argv[2];
assert.match(
  attempt ?? "",
  /^\d{2}$/,
  "Select the preserved successful candidate run explicitly",
);
const candidate = JSON.parse(
  await readFile(`evidence/capability-candidate-${attempt}.json`, "utf8"),
);
const raw = await readFile(`evidence/capability-candidate-${attempt}.tap`);
assert.equal(candidate.status, "passed");
assert.equal(candidate.source_unchanged, true);
assert.equal(candidate.owned_database_shutdown, true);
assert.equal(candidate.counts.fail, 0);
assert.equal(
  candidate.raw_sha256,
  createHash("sha256").update(raw).digest("hex"),
);
assert.deepEqual(
  await readFile(
    path.join(platform, "migrations/063-frozen-task-capabilities.sql"),
  ),
  await readFile(`evidence/capability-candidate-${attempt}-063.sql`),
);
for (const [file, expected] of Object.entries(candidate.source_files)) {
  assert.equal(
    createHash("sha256")
      .update(await readFile(path.join(platform, file)))
      .digest("hex"),
    expected,
    "A candidate source changed after the successful isolated run: " + file,
  );
}
await assert.rejects(
  access("evidence/capability-migrations-before.json"),
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
  "evidence/capability-upgrade-native-database.log",
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
    ["scripts/qa-capability-migrations.mjs", "--before"],
    process.cwd(),
  );
  await run(
    ["--env-file=.env", "--import", "tsx", "scripts/migrate.ts"],
    platform,
    "evidence/capability-live-migration-063.log",
  );
  await run(["scripts/qa-capability-migrations.mjs"], process.cwd());
} finally {
  if (database.connected && database.exitCode === null)
    database.send({ action: "shutdown" });
  assert.equal(await stopped, 0);
  await new Promise((resolve) => stream.end(resolve));
}
console.log(
  "Native 063 upgrade and original-row preservation verified; owned PostgreSQL stopped.",
);
