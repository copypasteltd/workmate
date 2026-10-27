import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createConnection } from "node:net";
import { createWriteStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
const platform = path.resolve("../copypaste-platform"),
  prefix = "evidence/marketing-connector-startup-" + attempt;
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const sources = {};
for (const file of [
  "scripts/native-db-launch.mjs",
  "scripts/db-local.ts",
  "dist/scripts/db-local.js",
])
  sources[file] = sha(await readFile(path.join(platform, file)));
await assert.rejects(readFile(prefix + ".json"), (e) => e.code === "ENOENT");
const verifier = await readFile(import.meta.filename);
await writeFile(prefix + "-verifier.mjs", verifier, { flag: "wx" });
async function occupied() {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port: 55432 });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}
const checks = [];
for (const when of ["immediately_after_spawn", "after_database_ready"]) {
  assert.equal(
    await occupied(),
    false,
    "Native database must be idle before this owned check",
  );
  const file = prefix + "-" + when + ".log",
    log = createWriteStream(file, { flags: "wx" });
  const child = spawn(process.execPath, ["scripts/native-db-launch.mjs"], {
    cwd: platform,
    windowsHide: true,
    env: { ...process.env, COPYPASTE_NATIVE_DATABASE_START_ONLY: "true" },
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let output = "",
    shutdownSent = false;
  function shutdown() {
    if (!shutdownSent && child.connected) {
      shutdownSent = true;
      child.send({ action: "shutdown" });
    }
  }
  child.stdout.on("data", (bytes) => {
    output += bytes.toString();
    log.write(bytes);
    if (
      when === "after_database_ready" &&
      output.includes("Native PostgreSQL ready")
    )
      shutdown();
  });
  child.stderr.on("data", (bytes) => {
    output += bytes.toString();
    log.write(bytes);
  });
  if (when === "immediately_after_spawn") shutdown();
  const code = await new Promise((resolve, reject) => {
    child.once("close", resolve);
    child.once("error", reject);
  });
  await new Promise((resolve) => log.end(resolve));
  const bytes = await readFile(file),
    passed =
      code === 0 &&
      shutdownSent &&
      output.includes("database system is shut down") &&
      !(await occupied());
  checks.push({
    when,
    status: passed ? "passed" : "failed",
    exit_code: code,
    shutdown_requested: shutdownSent,
    actual_checkpointed_shutdown: output.includes(
      "database system is shut down",
    ),
    owned_database_listener_closed: !(await occupied()),
    raw_report: file,
    raw_sha256: sha(bytes),
  });
  if (!passed) break;
}
const stable = (
  await Promise.all(
    Object.entries(sources).map(
      async ([file, digest]) =>
        sha(await readFile(path.join(platform, file))) === digest,
    ),
  )
).every(Boolean);
const passed =
  checks.length === 2 &&
  checks.every((check) => check.status === "passed") &&
  stable;
await writeFile(
  prefix + ".json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      status: passed ? "passed" : "failed",
      scope:
        "Actual owned native PostgreSQL immediate-startup and ready-state IPC shutdown, no migrations, fixture insertion, browser or virtualization",
      source_files: sources,
      source_unchanged: stable,
      verifier: { path: prefix + "-verifier.mjs", sha256: sha(verifier) },
      checks,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
console.log(
  JSON.stringify({
    status: passed ? "passed" : "failed",
    checks: checks.length,
    source_unchanged: stable,
  }),
);
assert.ok(passed, "Inspect retained native startup/shutdown evidence");
