// Stage 123: fresh owned native cluster; each integration file owns and reclaims a separate UUID database.
import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createServer, createConnection } from "node:net";
import path from "node:path";
const attempt = process.argv[2], mode = process.argv[3];
assert.ok(["focused", "full"].includes(mode));
const scope = "admin_content_revisions_" + mode;
assert.match(attempt ?? "", /^\d{2}$/);
assert.equal(path.basename(process.cwd()), "copypaste-platform-admin-content-123");
assert.ok(process.argv.length === 4);
const platform = process.cwd(), delivery = path.resolve("../copypaste-delivery"), relativePrefix = ".data/admin-content-123/backend-" + attempt, prefix = path.join(delivery, relativePrefix);
const testFiles = mode === "focused" ? ["tests/admin-content-revisions.test.ts"] : ["tests/admin-content-revisions.test.ts", "tests/agent-groups.test.ts", "tests/project-configuration.test.ts", "tests/solutions.test.ts", "tests/schema-compatibility.test.ts"];
await (await import("node:fs/promises")).mkdir(path.dirname(prefix), { recursive: true });
assert.ok(testFiles.length > 0, "No platform test files were found");
const hash = (b) => createHash("sha256").update(b).digest("hex");
for (const tail of [".json", ".tap", "-verifier.mjs"])
  await assert.rejects(readFile(prefix + tail), (e) => e.code === "ENOENT");
async function snapshot() {
  const result = {};
  for (const repo of [platform]) {
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
        "--",
        "src",
        "tests",
        "scripts",
        "migrations",
        "catalog",
        "assets/fonts",
        "public",
        "contracts",
        "skills",
        "package.json",
        "package-lock.json",
        "tsconfig.json",
      ],
      { cwd: repo, encoding: "utf8", windowsHide: true },
    )
      .split("\0")
      .filter(Boolean);
    for (const file of [...new Set(files)].sort())
      result["copypaste-platform/" + file] = hash(
        await readFile(path.join(repo, file)),
      );
  }
  return result;
}
process.loadEnvFile(path.join(platform, ".env"));
const databasePort = await new Promise((resolve, reject) => { const s=createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{const a=s.address();s.close(e=>e?reject(e):resolve(a.port));}); });
const priorReceiptPath = path.join(delivery, ".data/admin-content-123/backend-02.json");
const priorReceiptBytes = await readFile(priorReceiptPath), priorReceipt = JSON.parse(priorReceiptBytes);
assert.equal(priorReceipt.status, "failed");
assert.equal(priorReceipt.owned_database_shutdown, true);
assert.equal(priorReceipt.owned_database_port_closed, true);
assert.equal(priorReceipt.fixture_cleanup.exit_code, 0);
assert.equal(priorReceipt.owned_native_directory, ".data/native-qa/ca1845d0-88dd-4870-bb25-461381a6a5bc");
const cleanupBytes = await readFile(path.join(delivery, priorReceipt.fixture_cleanup.path));
assert.equal(hash(cleanupBytes), priorReceipt.fixture_cleanup.sha256);
const cleanupValue = JSON.parse(cleanupBytes);
assert.equal(cleanupValue.status, "passed");
assert.ok(cleanupValue.workers_exited && cleanupValue.actual_filesystem_checked && cleanupValue.results.every(r => r.reclaimed));
await new Promise((resolve, reject) => {
  const socket = createConnection({ host: "127.0.0.1", port: priorReceipt.owned_native_port });
  socket.once("connect", () => { socket.destroy(); reject(new Error("PREVIOUS_OWNED_CLUSTER_STILL_RUNNING")); });
  socket.once("error", e => { socket.destroy(); e.code === "ECONNREFUSED" ? resolve() : reject(e); });
  socket.setTimeout(2000, () => { socket.destroy(); reject(new Error("PREVIOUS_CLUSTER_STATE_UNKNOWN")); });
});
const databaseEnv = { COPYPASTE_NATIVE_DATABASE_DIR: priorReceipt.owned_native_directory };
for(const n of ["OWNER_DATABASE_URL","DATABASE_URL","CONTROL_DATABASE_URL","QUEUE_DATABASE_URL"]) { const u=new URL(process.env[n]);u.port=String(databasePort);databaseEnv[n]=u.href; }
const desktop = path.resolve("../copypaste-desktop"), pin = JSON.parse(await readFile(path.join(desktop,"contracts/local-codex-runtime.json"),"utf8")), binary = path.join(desktop,".data/runtime/windows-x64/codex.exe");
assert.equal(hash(await readFile(binary)),pin.windows_x64_sha256);
const before = await snapshot();
for (const [file, expected] of Object.entries(before)) {
  const bytes = await readFile(path.join(platform, file.slice("copypaste-platform/".length)));
  assert.equal(hash(bytes), expected);
  const output = path.resolve(prefix + "-sources", file);
  assert.ok(output.startsWith(path.resolve(prefix + "-sources") + path.sep));
  await (
    await import("node:fs/promises")
  ).mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, bytes, { flag: "wx" });
}
await writeFile(
  prefix + "-verifier.mjs",
  await readFile(import.meta.filename),
  { flag: "wx" },
);
const log = createWriteStream(prefix + ".tap", { flags: "wx" });
function launch(args, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd: platform,
    env: {
      ...process.env,
      COPYPASTE_LOCAL_CODEX_BIN: path.resolve(
        "../copypaste-desktop/.data/runtime/windows-x64/codex.exe",
      ),
      CODEX_BIN: binary, CODEX_VERSION: pin.runtime_version, COPYPASTE_LOCAL_CODEX_TEST_BIN: binary,
      ...databaseEnv, ...env,
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const closed = new Promise((resolve) => {
    child.once("close", (code) => resolve(code ?? 1));
    child.once("error", () => resolve(1));
  });
  return { child, closed };
}
let database,
  code = null,
  shutdown = null,
  error;
try {
  assert.equal(
    await launch(["node_modules/typescript/bin/tsc", "--noEmit"]).closed,
    0,
  );
  for (const args of [
    ["node_modules/typescript/bin/tsc"],
    ["scripts/copy-cloud-check-bootstrap.mjs"],
  ])
    assert.equal(await launch(args).closed, 0);
  database = launch(["scripts/native-db-launch.mjs"], {
    COPYPASTE_NATIVE_DATABASE_START_ONLY: "true",
  });
  let output = "";
  database.child.stdout.on(
    "data",
    (b) => (output = (output + b).slice(-16000)),
  );
  const deadline = Date.now() + 900000;
  while (!output.includes("Native PostgreSQL ready")) {
    assert.equal(database.child.exitCode, null);
    assert.ok(Date.now() < deadline);
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(
    "Verified stopped owned native PostgreSQL ready; qualifying scoped administrator revisions and existing customer behavior with synthetic company inference",
  );
  code = await launch([
    "--env-file=.env",
    "scripts/run-tests-owned.mjs",
    ...testFiles,
  ]).closed;
} catch (e) {
  error = String(e);
} finally {
  if (database?.child.connected && database.child.exitCode === null)
    database.child.send({ action: "shutdown" });
  if (database) shutdown = await database.closed;
  await new Promise((r) => log.end(r));
  const raw = await readFile(prefix + ".tap"),
    text = raw.toString();
  const counts = Object.fromEntries(
    ["tests", "pass", "fail", "cancelled", "skipped", "todo"].map((k) => [
      k,
      Number(
        text.match(new RegExp("^# " + k + " (\\d+)\\r?$", "m"))?.[1] ?? -1,
      ),
    ]),
  );
  const markerRows = [...text.matchAll(/^# owned_fixture_cleanup (.+)\r?$/gm)];
  let fixtureCleanup, portClosed = false;
  if (markerRows.length === 1) {
    const marker = JSON.parse(markerRows[0][1]);
    const file = path.resolve(platform, marker.path);
    assert.ok(file.startsWith(path.join(platform, ".data/test-fixture-reclamation") + path.sep));
    const bytes = await readFile(file); assert.equal(hash(bytes), marker.sha256);
    const value = JSON.parse(bytes);
    if (marker.exit_code === 0 && value.status === "passed" && value.workers_exited && value.actual_filesystem_checked && value.results.every(row => row.reclaimed)) {
      await writeFile(prefix + "-cleanup.json", bytes, { flag: "wx" });
      fixtureCleanup = { path: relativePrefix + "-cleanup.json", sha256: hash(bytes), exit_code: marker.exit_code };
    }
  }
  portClosed = await new Promise((resolve, reject) => {
    const socket = createConnection({ host: "127.0.0.1", port: databasePort });
    socket.once("connect", () => { socket.destroy(); resolve(false); });
    socket.once("error", e => { socket.destroy(); if (e.code === "ECONNREFUSED") resolve(true); else reject(e); });
    socket.setTimeout(2000, () => { socket.destroy(); reject(new Error("OWNED_DATABASE_PORT_STATE_UNKNOWN")); });
  });
  const unchanged = JSON.stringify(before) === JSON.stringify(await snapshot()),
    passed =
      !error &&
      !!fixtureCleanup && portClosed &&
      code === 0 &&
      shutdown === 0 &&
      unchanged &&
      counts.tests > 0 &&
      counts.pass === counts.tests &&
      ["fail", "cancelled", "skipped", "todo"].every((k) => counts[k] === 0) &&
      text.includes("# owned_fixture_cleanup");
  await writeFile(
    prefix + ".json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: passed ? "passed" : "failed",
        scope, delivered_repository: platform, fixture_cleanup: fixtureCleanup, owned_database_port_closed: portClosed, owned_native_port: databasePort, owned_native_directory: databaseEnv.COPYPASTE_NATIVE_DATABASE_DIR, native_codex: pin, verifier_sha256: hash(await readFile(import.meta.filename)),
        test_files: testFiles,
        owned_cluster_reuse: { prior_receipt: ".data/admin-content-123/backend-02.json", prior_receipt_sha256: hash(priorReceiptBytes) }, fresh_private_database_per_file: true,
        counts,
        error,
        test_exit: code,
        owned_database_shutdown: shutdown === 0,
        source_unchanged: unchanged,
        source_files: before,
        raw_report: { path: relativePrefix + ".tap", sha256: hash(raw) },
        not_validated: [
          "Actual live provider/customer professional qualification",
          "Actual Admin editor UI, Web, Desktop and native Chrome Side Panel UI",
          "Full product acceptance",
        ],
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(
    JSON.stringify({
      status: passed ? "passed" : "failed",
      counts,
      error,
      source_unchanged: unchanged,
      shutdown,
    }),
  );
  process.exitCode = passed ? 0 : 1;
}
