import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { createConnection } from "node:net";
import path from "node:path";
const attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
assert.equal(process.argv.length, 3);
const delivery = process.cwd(),
  platform = path.resolve("../copypaste-platform"),
  web = path.resolve("../copypaste-web"),
  admin = path.resolve("../copypaste-admin"),
  extension = path.resolve("../copypaste-extension"),
  prefix = "evidence/geo-observation-ui-" + attempt;
const sha = (b) => createHash("sha256").update(b).digest("hex");
const binary = process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN;
assert.ok(binary && path.isAbsolute(binary));
const pin = JSON.parse(await readFile("../copypaste-desktop/contracts/local-codex-runtime.json", "utf8"));
assert.equal(sha(await readFile(binary)), pin.windows_x64_sha256);
for (const suffix of [
  ".json",
  ".log",
  "-journey.json",
  "-verifier.mjs",
  "-journey-verifier.ts",
])
  await assert.rejects(readFile(prefix + suffix), (e) => e.code === "ENOENT");
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
for (const port of [4310, 4317, 4318, 55432])
  assert.equal(await occupied(port), false, "Keep existing services untouched");
async function snapshot() {
  const result = {};
  for (const repo of [platform, web, admin, delivery, path.resolve("../copypaste-desktop"), path.resolve("../copypaste-extension")]) {
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
        "renderer",
        "renderer-source.json",
        "scripts",
        "tests",
        "contracts",
        "catalog",
        "migrations",
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
    for (const f of [...new Set(files)].sort())
      result[path.basename(repo) + "/" + f] = sha(
        await readFile(path.join(repo, f)),
      );
  }
  return result;
}
async function built(dir, prefix = "") {
  const files = {};
  for (const e of await readdir(dir, { withFileTypes: true })) {
    assert.equal(e.isSymbolicLink(), false);
    if (e.isDirectory())
      Object.assign(
        files,
        await built(path.join(dir, e.name), prefix + e.name + "/"),
      );
    else files[prefix + e.name] = sha(await readFile(path.join(dir, e.name)));
  }
  return Object.fromEntries(
    Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
  );
}
const before = await snapshot();
await writeFile(
  prefix + "-verifier.mjs",
  await readFile(import.meta.filename),
  { flag: "wx" },
);
await writeFile(
  prefix + "-journey-verifier.ts",
  await readFile("scripts/qa-geo-observation-ui.ts"),
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
const log = createWriteStream(prefix + ".log", { flags: "wx" });
function launch(args, cwd, env = {}) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
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
  previews = [],
  builds,
  code,
  shutdown,
  cleanup,
  error,
  journey;
try {
  for (const repo of [platform, web, admin, extension, delivery])
    assert.equal(
      await launch(["node_modules/typescript/bin/tsc", "--noEmit"], repo)
        .closed,
      0,
    );
  for (const repo of [web, admin])
    assert.equal(
      await launch(["node_modules/vite/bin/vite.js", "build"], repo).closed,
      0,
    );
  assert.equal(await launch(["scripts/build.mjs"], extension).closed, 0);
  builds = {
    web: await built(path.join(web, "dist")),
    admin: await built(path.join(admin, "dist")),
    extension: await built(path.join(extension, "dist")),
  };
  database = launch(["scripts/native-db-launch.mjs"], platform, {
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
  for (const [repo, port] of [
    [web, 4317],
    [admin, 4318],
  ]) {
    const p = launch(
      [
        "node_modules/vite/bin/vite.js",
        "preview",
        "--host",
        "127.0.0.1",
        "--port",
        String(port),
        "--strictPort",
      ],
      repo,
    );
    previews.push(p);
    const end = Date.now() + 30000;
    while (!(await occupied(port))) {
      assert.equal(p.child.exitCode, null);
      assert.ok(Date.now() < end);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  const env = {
    COPYPASTE_TEST_RECLAMATION_DIR: run,
    COPYPASTE_TEST_RECLAMATION_TOKEN: token,
    CHROME_BIN:
      process.env.CHROME_BIN ??
      path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe"),
  };
  console.log("Running actual Web GEO observation");
  code = await launch(
    [
      "--env-file=" + path.join(platform, ".env"),
      "--import",
      "tsx",
      "scripts/qa-geo-observation-ui.ts",
      attempt,
    ],
    delivery,
    env,
  ).closed;
  const cleanupCode = await launch(
    ["--import", "tsx", "scripts/reclaim-test-fixtures.ts"],
    platform,
    env,
  ).closed;
  const bytes = await readFile(path.join(run, "result.json"));
  await writeFile(prefix + "-fixture-cleanup.json", bytes, { flag: "wx" });
  cleanup = { ...JSON.parse(bytes), exit_code: cleanupCode };
  journey = JSON.parse(await readFile(prefix + "-journey.json"));
} catch (e) {
  error = String(e);
} finally {
  for (const p of previews) {
    if (p.child.exitCode === null) p.child.kill();
    await p.closed;
  }
  if (database?.child.connected && database.child.exitCode === null)
    database.child.send({ action: "shutdown" });
  if (database) shutdown = await database.closed;
  await new Promise((r) => log.end(r));
  const stable = JSON.stringify(before) === JSON.stringify(await snapshot()),
    buildStable =
      !!builds &&
      JSON.stringify(builds) ===
        JSON.stringify({
          web: await built(path.join(web, "dist")),
          admin: await built(path.join(admin, "dist")),
          extension: await built(path.join(extension, "dist")),
        });
  const passed =
    !error &&
    code === 0 &&
    shutdown === 0 &&
    stable &&
    buildStable &&
    journey?.status === "passed" &&
    journey.checks.length === 13 &&
    journey.media.length === 3 &&
    journey.side_panel?.context_type === "SIDE_PANEL" &&
    journey.side_panel?.side === "right" &&
    journey.side_panel?.owned_context_closed === true &&
    journey.media.every((m) => m?.skipped_capture_errors === 0) &&
    journey.browser_closed &&
    journey.api_closed &&
    journey.fixture_closed &&
    cleanup?.exit_code === 0 &&
    cleanup.status === "passed" &&
    cleanup.results.every((r) => r.reclaimed);
  const report = {
    at: new Date().toISOString(),
    status: passed ? "passed" : "failed",
    error,
    source_unchanged: stable,
    compiled_unchanged: buildStable,
    source_files: before,
    native_binary: { path: binary, sha256: pin.windows_x64_sha256, version: pin.runtime_version },
    builds,
    journey_exit: code,
    journey,
    fixture_cleanup: cleanup,
    owned_database_shutdown: shutdown === 0,
    owned_previews_closed: previews.every(
      (p) => p.child.exitCode !== null || p.child.signalCode !== null,
    ),
    raw_log: {
      path: prefix + ".log",
      sha256: sha(await readFile(prefix + ".log")),
    },
  };
  await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(
    JSON.stringify({
      status: report.status,
      error,
      journey_errors: journey?.errors,
      checks: journey?.checks.length,
      source_unchanged: stable,
      shutdown,
    }),
  );
  process.exitCode = passed ? 0 : 1;
}
