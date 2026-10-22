// Development recheck of existing upgrade tests; full qualification uses the full-platform runner.
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import path from "node:path";

const platform = path.resolve("../copypaste-platform"), prefix = "evidence/desktop-migration-upgrade-01";
const digest = bytes => createHash("sha256").update(bytes).digest("hex");
for (const suffix of [".json", ".tap", "-verifier.mjs"]) await assert.rejects(readFile(prefix + suffix), e => e.code === "ENOENT");
const occupied = await new Promise(resolve => {
  const socket = createConnection({ host: "127.0.0.1", port: 55432 });
  socket.once("connect", () => { socket.destroy(); resolve(true); }); socket.once("error", () => resolve(false));
});
assert.equal(occupied, false, "Never adopt an occupied database");
const names = ["tests/migrations.test.ts", "scripts/migration-runner.ts", "scripts/native-db-launch.mjs",
  ...(await readdir(path.join(platform, "migrations"))).filter(name => name.endsWith(".sql")).map(name => "migrations/" + name)].sort();
async function snapshot() { return Object.fromEntries(await Promise.all(names.map(async name => [name, digest(await readFile(path.join(platform, name)))]))); }
const source = await snapshot(), verifier = await readFile(import.meta.filename);
await writeFile(prefix + "-verifier.mjs", verifier, { flag: "wx" });
const log = createWriteStream(prefix + ".tap", { flags: "wx" });
function launch(args, env = {}) {
  const child = spawn(process.execPath, args, { cwd: platform, env: { ...process.env, ...env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  return { child, closed: new Promise(resolve => { child.once("close", code => resolve(code ?? 1)); child.once("error", () => resolve(1)); }) };
}
let database, testExit = null, shutdown = null, error = null;
try {
  database = launch(["scripts/native-db-launch.mjs"], { COPYPASTE_NATIVE_DATABASE_START_ONLY: "true" });
  let output = ""; database.child.stdout.on("data", bytes => { output = (output + bytes.toString()).slice(-16000); });
  const deadline = Date.now() + 900000;
  while (!output.includes("Native PostgreSQL ready")) { assert.equal(database.child.exitCode, null); assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 200)); }
  testExit = await launch(["--env-file=.env", "scripts/run-tests-owned.mjs", "tests/migrations.test.ts"]).closed;
} catch (e) { error = String(e); }
finally {
  if (database?.child.connected && database.child.exitCode === null) database.child.send({ action: "shutdown" });
  if (database) shutdown = await database.closed;
  await new Promise(resolve => log.end(resolve));
  const raw = await readFile(prefix + ".tap"), text = raw.toString();
  const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => [key, Number(text.match(new RegExp("^# " + key + " (\\d+)\\r?$", "m"))?.[1] ?? -1)]));
  const unchanged = JSON.stringify(source) === JSON.stringify(await snapshot());
  const passed = !error && testExit === 0 && shutdown === 0 && unchanged && counts.tests === 3 && counts.pass === 3
    && ["fail", "cancelled", "skipped", "todo"].every(key => counts[key] === 0) && text.includes("# owned_fixture_cleanup");
  const report = { at: new Date().toISOString(), status: passed ? "passed" : "failed", scope: "Existing immutable-migration digest and populated 041/047 upgrade tests only; overlaps full Platform regression", counts,
    error, test_exit_code: testExit, owned_database_shutdown: shutdown === 0, source_unchanged: unchanged, source_files: source,
    raw_report: { path: prefix + ".tap", sha256: digest(raw) }, verifier: { path: prefix + "-verifier.mjs", sha256: digest(verifier) } };
  await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, counts, error, shutdown, source_unchanged: unchanged }));
  assert.ok(passed);
}
