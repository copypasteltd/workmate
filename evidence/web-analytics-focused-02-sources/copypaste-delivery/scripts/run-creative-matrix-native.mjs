import { spawn, execFileSync } from "node:child_process";
import { createConnection } from "node:net";
import { createWriteStream } from "node:fs";
import { access, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";

const attempt = process.argv[2],
  platform = path.resolve("../copypaste-platform"),
  admin = path.resolve("../copypaste-web"),
  hash = (bytes) => createHash("sha256").update(bytes).digest("hex"),
  prefix = `evidence/creative-matrix-native-${attempt}`;
assert.match(attempt ?? "", /^\d{2}$/);
for (const suffix of [".json", ".log", "-journey.json"])
  await assert.rejects(access(prefix + suffix), (e) => e.code === "ENOENT");
async function snapshot() {
  const result = {};
  for (const repo of [
    "copypaste-platform",
    "copypaste-web",
    "copypaste-desktop",
    "copypaste-extension",
    "copypaste-delivery",
  ]) {
    const directory = path.resolve("..", repo),
      files = execFileSync(
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
          "--", "src", "scripts", "tests", "contracts", "catalog", "migrations", "public", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "vite.config.json",
        ],
        { cwd: directory, windowsHide: true, encoding: "utf8" },
      )
        .split("\0")
        .filter(
          (f) =>
            /^(src|scripts|tests|contracts|catalog|migrations|public)\//.test(
              f,
            ) || /^(package(-lock)?|tsconfig|vite\.config)\.(json|ts)$/.test(f),
        );
    for (const file of [...new Set(files)].sort())
      result[repo + "/" + file] = hash(
        await readFile(path.join(directory, file)),
      );
  }
  result["docs/contracts/agent-adoption.openapi.json"] = hash(
    await readFile(
      path.resolve("../../docs/contracts/agent-adoption.openapi.json"),
    ),
  );
  return result;
}
async function occupied(port) {
  return new Promise((resolve) => {
    const socket = createConnection({ host: "127.0.0.1", port });
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("error", () => resolve(false));
  });
}
async function builtSnapshot(
  directory = path.join(admin, "dist"),
  prefix = "",
) {
  const files = {};
  for (const item of await readdir(directory, { withFileTypes: true })) {
    assert.equal(item.isSymbolicLink(), false);
    const name = prefix + item.name,
      file = path.join(directory, item.name);
    if (item.isDirectory())
      Object.assign(files, await builtSnapshot(file, name + "/"));
    else files[name] = hash(await readFile(file));
  }
  return Object.fromEntries(
    Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
  );
}
for (const port of [4310, 4317, 4318, 4319, 55432])
  assert.equal(
    await occupied(port),
    false,
    "Keep other services untouched; owned UI ports must be free",
  );
const before = await snapshot(),
  verifier = await readFile(import.meta.filename),
  worker = await readFile("scripts/qa-creative-matrix-native.ts");
await writeFile(prefix + "-verifier.mjs", verifier, { flag: "wx" });
await writeFile(prefix + "-journey-verifier.ts", worker, { flag: "wx" });
const run = path.join(platform, ".data/test-fixture-reclamation", randomUUID()),
  token = randomUUID();
await mkdir(run, { recursive: true });
await writeFile(
  path.join(run, "manifest.json"),
  JSON.stringify({ owner_pid: process.pid, token }),
  { flag: "wx" },
);
const log = createWriteStream(prefix + ".log", { flags: "wx" }),
  children = [];
function launch(args, cwd, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  children.push(child);
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const closed = new Promise((resolve) => {
    child.once("close", (code) => resolve(code ?? 1));
    child.once("error", () => resolve(1));
  });
  return { child, closed };
}
let database,
  preview,
  journey,
  cleanup,
  journeyCode = null,
  cleanupCode = null,
  shutdownCode = null,
  sourceStable = false,
  failure = null,
  result = null,
  cleanupReceipt = null;
let adminBuild = null;
try {
  const typecheck = launch(
      ["node_modules/typescript/bin/tsc", "--noEmit"],
      admin,
    ),
    typecheckCode = await typecheck.closed;
  assert.equal(typecheckCode, 0);
  const build = launch(["node_modules/vite/bin/vite.js", "build"], admin),
    buildCode = await build.closed;
  assert.equal(buildCode, 0);
  adminBuild = {
    typecheck_exit_code: typecheckCode,
    build_exit_code: buildCode,
    dist_files: await builtSnapshot(),
  };
  database = launch(["scripts/native-db-launch.mjs"], platform, {
    COPYPASTE_NATIVE_DATABASE_START_ONLY: "true",
  });
  const databaseDeadline = Date.now() + 120000;
  while (!(await occupied(55432))) {
    assert.equal(database.child.exitCode, null);
    assert.ok(
      Date.now() < databaseDeadline,
      "Native database readiness timed out",
    );
    await new Promise((r) => setTimeout(r, 200));
  }
  preview = launch(
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      "4317",
      "--strictPort",
    ],
    admin,
  );
  const previewDeadline = Date.now() + 30000;
  while (!(await occupied(4317))) {
    assert.equal(preview.child.exitCode, null);
    assert.ok(
      Date.now() < previewDeadline,
      "Built Admin preview readiness timed out",
    );
    await new Promise((r) => setTimeout(r, 200));
  }
  journey = launch(
    [
      "--env-file=" + path.join(platform, ".env"),
      "--import",
      "tsx",
      "scripts/qa-creative-matrix-native.ts",
      attempt,
    ],
    process.cwd(),
    {
      COPYPASTE_TEST_RECLAMATION_DIR: run,
      COPYPASTE_TEST_RECLAMATION_TOKEN: token,
      CHROME_BIN:
        process.env.CHROME_BIN ??
        path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe"),
    },
  );
  journeyCode = await journey.closed;
  cleanup = launch(
    ["--import", "tsx", "scripts/reclaim-test-fixtures.ts"],
    platform,
    {
      COPYPASTE_TEST_RECLAMATION_DIR: run,
      COPYPASTE_TEST_RECLAMATION_TOKEN: token,
      CHROME_BIN:
        process.env.CHROME_BIN ??
        path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe"),
    },
  );
  cleanupCode = await cleanup.closed;
  const cleanupBytes = await readFile(path.join(run, "result.json"));
  await writeFile(prefix + "-fixture-cleanup.json", cleanupBytes, {
    flag: "wx",
  });
  cleanupReceipt = {
    path: prefix + "-fixture-cleanup.json",
    sha256: hash(cleanupBytes),
    ...JSON.parse(cleanupBytes),
  };
  result = JSON.parse(await readFile(prefix + "-journey.json"));
} catch (error) {
  failure = error.name + ": " + error.message;
} finally {
  if (preview && preview.child.exitCode === null) preview.child.kill();
  if (preview) await preview.closed;
  if (database?.child.connected && database.child.exitCode === null)
    database.child.send({ action: "shutdown" });
  if (database) shutdownCode = await database.closed;
  sourceStable = JSON.stringify(before) === JSON.stringify(await snapshot());
  const buildStable =
    !!adminBuild &&
    JSON.stringify(adminBuild.dist_files) ===
      JSON.stringify(await builtSnapshot());
  const passed =
    !failure &&
    journeyCode === 0 &&
    cleanupCode === 0 &&
    shutdownCode === 0 &&
    sourceStable &&
    buildStable &&
    result?.status === "passed" &&
    result?.checks.length >= 13 &&
    result?.browser_closed &&
    result?.desktop_closed &&
    result?.extension_closed &&
    result?.artifacts_unchanged_after_run &&
    result?.owned_api_closed &&
    cleanupReceipt?.status === "passed" &&
    cleanupReceipt?.workers_exited &&
    cleanupReceipt?.actual_filesystem_checked &&
    cleanupReceipt?.results.every((r) => r.reclaimed);
  await new Promise((resolve) => log.end(resolve));
  const journeyBytes = await readFile(prefix + "-journey.json").catch(
      () => null,
    ),
    raw = await readFile(prefix + ".log");
  await writeFile(
    prefix + ".json",
    JSON.stringify(
      {
        at: new Date().toISOString(),
        status: passed ? "passed" : "failed",
        scope:
          "New packaged frameless Desktop and actual Chrome toolbar Side Panel; native browser PKCE, current design matrices, model/rate comparisons, controlled workspace entry, bilingual UI and owned process cleanup; isolated native PostgreSQL with labelled simulated AI",
        failure,
        exit_code: journeyCode,
        cleanup_exit_code: cleanupCode,
        counts: {
          checks: result?.checks.length ?? 0,
          errors: result?.errors.length ?? 1,
        },
        source_files: before,
        source_unchanged: sourceStable,
        web_build: adminBuild,
        web_build_unchanged: buildStable,
        journey: journeyBytes
          ? { path: prefix + "-journey.json", sha256: hash(journeyBytes) }
          : null,
        raw_report: { path: prefix + ".log", sha256: hash(raw) },
        verifier: { path: prefix + "-verifier.mjs", sha256: hash(verifier) },
        journey_verifier: {
          path: prefix + "-journey-verifier.ts",
          sha256: hash(worker),
        },
        fixture_cleanup: cleanupReceipt,
        owned_database_shutdown: shutdownCode === 0,
        database_shutdown_exit_code: shutdownCode,
        owned_web_preview_closed:
          !preview ||
          preview.child.exitCode !== null ||
          preview.child.signalCode !== null,
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
      checks: result?.checks.length ?? 0,
      errors: result?.errors,
      failure,
      source_unchanged: sourceStable,
      owned_database_shutdown: shutdownCode === 0,
    }),
  );
  assert.ok(
    passed,
    "Inspect the preserved actual UI journey and source snapshot",
  );
}
