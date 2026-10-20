import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { createWriteStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
// Explicit local upgrade, after stopping the owned development controller.
// Only this process's native PostgreSQL child is started and stopped.
const platform = path.resolve("../copypaste-platform"),
  reachable = (port) =>
    new Promise((resolve) => {
      const s = createConnection({ host: "127.0.0.1", port });
      s.once("connect", () => {
        s.destroy();
        resolve(true);
      });
      s.once("error", () => resolve(false));
    });
for (const port of [4310, 4317, 4318, 4319, 55432])
  assert.equal(
    await reachable(port),
    false,
    "Stop the owned controller before this upgrade; existing services are preserved",
  );
await assert.rejects(
  access("evidence/vip-migrations-before.json"),
  (e) => e.code === "ENOENT",
);
assert.deepEqual(
  await readFile(
    path.join(platform, "migrations/057-canonical-vip-grant-lifecycle.sql"),
  ),
  await readFile("evidence/vip-candidate-06-migration-057.sql"),
);
const candidate = await readFile(
  "evidence/platform-vip-candidate-06.tap",
  "utf8",
);
assert.match(candidate, /^# fail 0\r?$/m);
assert.match(candidate, /^# pass 14\r?$/m);
const output = createWriteStream(
    "evidence/vip-primary-native-database-start.log",
  ),
  db = spawn(process.execPath, ["scripts/native-db-launch.mjs"], {
    cwd: platform,
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
let ready = "";
db.stdout.on("data", (b) => {
  ready = (ready + b.toString()).slice(-4000);
  output.write(b);
});
db.stderr.on("data", (b) => output.write(b));
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
  assert.equal(code, 0, "Owned upgrade command failed; review its saved log");
}
try {
  const deadline = Date.now() + 120000;
  while (!ready.includes("Native PostgreSQL ready")) {
    assert.equal(db.exitCode, null, "Owned native PostgreSQL exited");
    assert.ok(Date.now() < deadline, "Owned native PostgreSQL startup timeout");
    await new Promise((r) => setTimeout(r, 250));
  }
  await run(["scripts/qa-vip-migrations.mjs", "--before"], process.cwd());
  await run(
    ["--env-file=.env", "--import", "tsx", "scripts/migrate.ts"],
    platform,
    "evidence/vip-live-migration-057.log",
  );
} finally {
  if (db.connected && db.exitCode === null) db.send({ action: "shutdown" });
  await stopped;
  await new Promise((resolve) => output.end(resolve));
}
console.log(
  "Owned native upgrade finished; restart the controller, then run qa:vip-migration before any VIP test data is written.",
);
