import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import path from "node:path";
const attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
assert.equal(process.argv.length, 3);
const delivery = process.cwd(),
  platform = path.resolve("../copypaste-platform"),
  admin = path.resolve("../copypaste-admin"),
  prefix = "evidence/admin-data-ui-" + attempt,
  sha = (b) => createHash("sha256").update(b).digest("hex");
assert.equal(path.basename(delivery), "copypaste-delivery");
for (const tail of [
  ".json",
  ".tap",
  "-journey.json",
  "-verifier.mjs",
  "-journey-verifier.ts",
])
  await assert.rejects(readFile(prefix + tail), (e) => e.code === "ENOENT");
async function occupied(port) {
  return new Promise((resolve) => {
    const s = createConnection({ host: "127.0.0.1", port });
    s.once("connect", () => {
      s.destroy();
      resolve(true);
    });
    s.once("error", () => resolve(false));
  });
}
for (const port of [4310, 4318, 55432])
  assert.equal(await occupied(port), false, "Preserve all existing services");
async function snapshot() {
  const result = {};
  for (const repo of [platform, admin]) {
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
        "contracts",
        "public",
        "package.json",
        "package-lock.json",
        "tsconfig.json",
        "vite.config.ts",
      ],
      { cwd: repo, encoding: "utf8", windowsHide: true },
    )
      .split("\0")
      .filter(Boolean);
    for (const file of [...new Set(files)].sort())
      result[path.basename(repo) + "/" + file] = sha(
        await readFile(path.join(repo, file)),
      );
  }
  for (const name of [
    "scripts/run-admin-data-ui.mjs",
    "scripts/qa-admin-data-ui.ts",
    "scripts/record-workmate-media.ts",
  ])
    result["copypaste-delivery/" + name] = sha(await readFile(name));
  return result;
}
const before = await snapshot();
for (const [file, expected] of Object.entries(before)) {
  const bytes = await readFile(path.resolve("..", file));
  assert.equal(sha(bytes), expected);
  const target = path.resolve(prefix + "-sources", file);
  assert.ok(target.startsWith(path.resolve(prefix + "-sources") + path.sep));
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" });
}
await writeFile(
  prefix + "-verifier.mjs",
  await readFile(import.meta.filename),
  { flag: "wx" },
);
await writeFile(
  prefix + "-journey-verifier.ts",
  await readFile("scripts/qa-admin-data-ui.ts"),
  { flag: "wx" },
);
const run = path.join(platform, ".data/test-fixture-reclamation", randomUUID()),
  token = randomUUID();
await mkdir(run, { recursive: true });
await writeFile(
  path.join(run, "manifest.json"),
  JSON.stringify({ owner_pid: process.pid, token }),
  { flag: "wx" },
);
const log = createWriteStream(prefix + ".tap", { flags: "wx" }),
  checks = [];
function launch(args, cwd, env = {}, ipc = false) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: {
      ...process.env,
      COPYPASTE_LOCAL_CODEX_BIN: path.resolve(
        "../copypaste-desktop/.data/runtime/windows-x64/codex.exe",
      ),
      ...env,
    },
    windowsHide: true,
    stdio: ipc ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"],
  });
  child.stdout.pipe(log, { end: false });
  child.stderr.pipe(log, { end: false });
  const closed = new Promise((resolve) => {
    child.once("close", (c) => resolve(c ?? 1));
    child.once("error", () => resolve(1));
  });
  return { child, closed };
}
let database,
  preview,
  error = null,
  journey = null,
  journeyCode = null,
  cleanup = null,
  shutdown = null;
try {
  for (const [name, args, cwd] of [
    [
      "platform typecheck",
      ["node_modules/typescript/bin/tsc", "--noEmit"],
      platform,
    ],
    ["platform build", ["node_modules/typescript/bin/tsc"], platform],
    [
      "platform cloud bootstrap",
      ["scripts/copy-cloud-check-bootstrap.mjs"],
      platform,
    ],
    ["admin typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"], admin],
    ["admin build", ["node_modules/vite/bin/vite.js", "build"], admin],
    [
      "delivery typecheck",
      ["node_modules/typescript/bin/tsc", "--noEmit"],
      delivery,
    ],
  ]) {
    const code = await launch(args, cwd).closed;
    checks.push({ name, exit_code: code });
    assert.equal(code, 0, name);
  }
  database = launch(
    ["scripts/native-db-launch.mjs"],
    platform,
    { COPYPASTE_NATIVE_DATABASE_START_ONLY: "true" },
    true,
  );
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
  preview = launch(
    [
      "node_modules/vite/bin/vite.js",
      "preview",
      "--host",
      "127.0.0.1",
      "--port",
      "4318",
      "--strictPort",
    ],
    admin,
  );
  const end = Date.now() + 30000;
  while (!(await occupied(4318))) {
    assert.equal(preview.child.exitCode, null);
    assert.ok(Date.now() < end);
    await new Promise((r) => setTimeout(r, 200));
  }
  console.log(
    "Running actual Admin email/MFA, frozen preview, partial results, child retry, cancellation, CSV/manifest download and responsive browser journey",
  );
  const env = {
    COPYPASTE_TEST_RECLAMATION_DIR: run,
    COPYPASTE_TEST_RECLAMATION_TOKEN: token,
    CHROME_BIN: path.resolve(
      ".data/browsers/chromium-1248/chrome-win64/chrome.exe",
    ),
  };
  const action = launch(
    [
      "--env-file=" + path.join(platform, ".env"),
      "--import",
      "tsx",
      "scripts/qa-admin-data-ui.ts",
      attempt,
    ],
    delivery,
    env,
  );
  const timeout = setTimeout(() => {
    if (action.child.exitCode === null && action.child.pid)
      try {
        execFileSync(
          "taskkill.exe",
          ["/PID", String(action.child.pid), "/T", "/F"],
          { windowsHide: true, stdio: "ignore", timeout: 15000 },
        );
      } catch {}
  }, 600000);
  try {
    journeyCode = await action.closed;
  } finally {
    clearTimeout(timeout);
  }
  const cleanupCode = await launch(
    ["--import", "tsx", "scripts/reclaim-test-fixtures.ts"],
    platform,
    env,
  ).closed;
  const cleanupBytes = await readFile(path.join(run, "result.json"));
  await writeFile(prefix + "-fixture-cleanup.json", cleanupBytes, {
    flag: "wx",
  });
  cleanup = {
    path: prefix + "-fixture-cleanup.json",
    sha256: sha(cleanupBytes),
    exit_code: cleanupCode,
    ...JSON.parse(cleanupBytes),
  };
  journey = JSON.parse(await readFile(prefix + "-journey.json"));
} catch (e) {
  error = String(e);
} finally {
  if (preview?.child.exitCode === null) preview.child.kill();
  if (preview) await preview.closed;
  if (database?.child.connected && database.child.exitCode === null)
    database.child.send({ action: "shutdown" });
  if (database) shutdown = await database.closed;
  await new Promise((r) => log.end(r));
  const unchanged = JSON.stringify(before) === JSON.stringify(await snapshot()),
    raw = await readFile(prefix + ".tap"),
    journeyBytes = await readFile(prefix + "-journey.json").catch(() => null);
  const passed =
    !error &&
    journeyCode === 0 &&
    journey?.status === "passed" &&
    journey.checks.length === 7 &&
    journey.errors.length === 0 &&
    journey.model_calls === 0 &&
    journey.screenshots.length === 6 &&
    journey.recordings.length === 2 &&
    journey.recordings.every(
      (r) => r.distinct_frames > 1 && r.skipped_capture_errors === 0,
    ) &&
    journey.browser_closed &&
    journey.api_closed &&
    journey.fixture_closed &&
    cleanup?.status === "passed" &&
    cleanup.exit_code === 0 &&
    cleanup.results.every((r) => r.reclaimed) &&
    shutdown === 0 &&
    unchanged;
  const report = {
    at: new Date().toISOString(),
    status: passed ? "passed" : "failed",
    error,
    checks,
    journey_exit_code: journeyCode,
    counts: {
      journey_checks: journey?.checks.length ?? 0,
      errors: journey?.errors.length ?? 1,
    },
    source_files: before,
    source_unchanged: unchanged,
    owned_database_shutdown: shutdown === 0,
    owned_preview_closed:
      !preview ||
      preview.child.exitCode !== null ||
      preview.child.signalCode !== null,
    fixture_cleanup: cleanup,
    raw_report: { path: prefix + ".tap", sha256: sha(raw) },
    verifier: {
      path: prefix + "-verifier.mjs",
      sha256: sha(await readFile(import.meta.filename)),
    },
    journey_verifier: {
      path: prefix + "-journey-verifier.ts",
      sha256: sha(await readFile("scripts/qa-admin-data-ui.ts")),
    },
    journey: journeyBytes
      ? { path: prefix + "-journey.json", sha256: sha(journeyBytes) }
      : null,
    not_validated: [
      "live_model_or_media_provider",
      "new_desktop_or_extension_behavior",
      "complete_product_acceptance",
    ],
  };
  await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(
    JSON.stringify({
      status: report.status,
      checks: report.counts,
      source_unchanged: unchanged,
      error,
    }),
  );
  if (!passed) process.exitCode = 1;
}
