import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { mkdir } from "node:fs/promises";
const attempt = process.argv[2],
  scope = "single_analysis_rpc_diagnostic_no_qualification";
assert.match(attempt ?? "", /^\d{2}$/);
assert.equal(
  path.basename(process.cwd()),
  "copypaste-delivery-cloud-121",
  "Run this verifier from its delivery repository",
);
assert.ok(process.argv.length <= 3);
const platform = path.resolve("../copypaste-platform-recovery-120"),
  prefix = ".data/dedicated-cloud-121/analysis-rpc-" + attempt;
const testFiles = ["tests/analysis-reports.test.ts"];
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
      result[path.basename(repo) + "/" + file] = hash(
        await readFile(path.join(repo, file)),
      );
  }
  return result;
}
process.loadEnvFile(path.join(platform, ".env"));
const databasePort = await new Promise((resolve, reject) => { const s=createServer();s.once("error",reject);s.listen(0,"127.0.0.1",()=>{const a=s.address();s.close(e=>e?reject(e):resolve(a.port));}); });
const databaseEnv = { COPYPASTE_NATIVE_DATABASE_DIR: ".data/native-qa/" + (await import("node:crypto")).randomUUID() };
for(const n of ["OWNER_DATABASE_URL","DATABASE_URL","CONTROL_DATABASE_URL","QUEUE_DATABASE_URL"]) { const u=new URL(process.env[n]);u.port=String(databasePort);databaseEnv[n]=u.href; }
const desktop = path.resolve("../copypaste-desktop"), pin = JSON.parse(await readFile(path.join(desktop,"contracts/local-codex-runtime.json"),"utf8")), binary = path.join(desktop,".data/runtime/windows-x64/codex.exe");
assert.equal(hash(await readFile(binary)),pin.windows_x64_sha256);
const before = await snapshot();
for (const [file, expected] of Object.entries(before)) {
  const base = path.resolve("..");
  const bytes = await readFile(path.join(base, file));
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
const preloaderName = "scripts/diagnose-dedicated-cloud-analysis-preload-v1.mjs";
const preloader = await readFile(preloaderName);
await writeFile(prefix + "-preload.mjs", preloader, { flag: "wx" });
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
      ...databaseEnv, ...env, ...(args.includes("scripts/run-tests-owned.mjs") ? { NODE_OPTIONS: "--import=tsx --import=" + pathToFileURL(path.resolve(preloaderName)).href } : {}),
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
    "Owned native PostgreSQL ready; running the unchanged analysis report file with bounded RPC metadata",
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
  const unchanged = JSON.stringify(before) === JSON.stringify(await snapshot()),
    passed =
      !error &&
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
        scope, preloader: { path: prefix + "-preload.mjs", sha256: hash(preloader) }, owned_native_port: databasePort, owned_native_directory: databaseEnv.COPYPASTE_NATIVE_DATABASE_DIR, native_codex: pin, verifier_sha256: hash(await readFile(import.meta.filename)),
        test_files: testFiles,
        counts,
        error,
        test_exit: code,
        owned_database_shutdown: shutdown === 0,
        source_unchanged: unchanged,
        source_files: before,
        raw_report: { path: prefix + ".tap", sha256: hash(raw) },
        not_validated: [
          "Actual live provider/customer professional qualification",
          "Actual Web and native Chrome Side Panel UI (qualified separately)",
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
