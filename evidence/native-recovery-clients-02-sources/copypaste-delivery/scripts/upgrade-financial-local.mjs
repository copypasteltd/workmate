import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { createWriteStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
const platform = path.resolve("../copypaste-platform");
for (const port of [4310, 4317, 4318, 4319, 55432]) {
  const reachable = await new Promise((resolve) => {
    const s = createConnection({ host: "127.0.0.1", port });
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
  });
  assert.equal(
    reachable,
    false,
    "Stop the owned controller first; preserve other services",
  );
}
await assert.rejects(
  access("evidence/financial-migrations-before.json"),
  (e) => e.code === "ENOENT",
);
const candidate = await readFile("evidence/financial-candidate-04.tap", "utf8");
assert.match(candidate, /^# fail 0\r?$/m);
assert.match(candidate, /^# pass 38\r?$/m);
assert.deepEqual(
  await readFile(
    path.join(platform, "migrations/061-durable-financial-notifications.sql"),
  ),
  await readFile("evidence/financial-candidate-04-061.sql"),
);
const log = createWriteStream("evidence/financial-native-database-start.log"),
  db = spawn(process.execPath, ["scripts/native-db-launch.mjs"], {
    cwd: platform,
    windowsHide: true,
    env: { ...process.env, COPYPASTE_NATIVE_DATABASE_START_ONLY: "true" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
let ready = "";
db.stdout.on("data", (b) => {
  ready = (ready + b.toString()).slice(-4000);
  log.write(b);
});
db.stderr.on("data", (b) => log.write(b));
const stopped = new Promise((resolve) => db.once("exit", resolve));
async function run(args, cwd, logFile) {
  const stream = logFile && createWriteStream(logFile),
    p = spawn(process.execPath, args, {
      cwd,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  p.stdout.on("data", (b) =>
    stream ? stream.write(b) : process.stdout.write(b),
  );
  p.stderr.on("data", (b) =>
    stream ? stream.write(b) : process.stderr.write(b),
  );
  const code = await new Promise((resolve, reject) => {
    p.once("error", reject);
    p.once("close", resolve);
  });
  if (stream) await new Promise((resolve) => stream.end(resolve));
  assert.equal(code, 0, "Owned upgrade command failed; inspect its saved log");
}
try {
  const deadline = Date.now() + 120000;
  while (!ready.includes("Native PostgreSQL ready")) {
    assert.equal(db.exitCode, null);
    assert.ok(Date.now() < deadline);
    await new Promise((r) => setTimeout(r, 200));
  }
  await run(["scripts/qa-financial-migrations.mjs", "--before"], process.cwd());
  await run(
    ["--env-file=.env", "--import", "tsx", "scripts/migrate.ts"],
    platform,
    "evidence/financial-live-migration-061.log",
  );
  await run(["scripts/qa-financial-migrations.mjs"], process.cwd());
} finally {
  if (db.connected && db.exitCode === null) db.send({ action: "shutdown" });
  await stopped;
  await new Promise((resolve) => log.end(resolve));
}
console.log(
  "Native 061 upgrade and original-fact comparison finished before API restart.",
);
