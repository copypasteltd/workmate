import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createServer } from "node:net";
import path from "node:path";
const attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
assert.equal(process.argv.length, 3);
const delivery = process.cwd(),
  platform = path.resolve("../copypaste-platform"),
  admin = path.resolve("../copypaste-admin"),
  prefix = "evidence/native-pairing-ui-" + attempt;
const sha = (b) => createHash("sha256").update(b).digest("hex");
for (const name of [
  ".json",
  "-journey.json",
  "-verifier.mjs",
  "-journey-verifier.ts",
])
  await assert.rejects(access(prefix + name), (e) => e.code === "ENOENT");
async function snapshot() {
  const files = {};
  for (const component of [
    "platform",
    "web",
    "admin",
    "desktop",
    "extension",
    "delivery",
  ]) {
    const root = path.resolve("../copypaste-" + component),
      names = execFileSync(
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
          "tests",
          "scripts",
          "migrations",
          "catalog",
          "contracts",
          "skills",
          "public",
          "package.json",
          "package-lock.json",
          "tsconfig.json",
          "vite.config.ts",
        ],
        { cwd: root, encoding: "utf8", windowsHide: true },
      )
        .split("\0")
        .filter(Boolean);
    for (const name of [...new Set(names)].sort())
      files["copypaste-" + component + "/" + name] = sha(
        await readFile(path.join(root, name)),
      );
  }
  return Object.fromEntries(
    Object.entries(files).sort(([a], [b]) => a.localeCompare(b)),
  );
}
const before = await snapshot();
for (const [name, expected] of Object.entries(before)) {
  const b = await readFile(path.resolve("..", name));
  assert.equal(sha(b), expected);
  const target = prefix + "-sources/" + name;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, b, { flag: "wx" });
}
await writeFile(
  prefix + "-verifier.mjs",
  await readFile(import.meta.filename),
  { flag: "wx" },
);
await writeFile(
  prefix + "-journey-verifier.ts",
  await readFile("scripts/qa-native-pairing-ui-v3.ts"),
  { flag: "wx" },
);
process.loadEnvFile(path.join(platform, ".env"));
const allocated = new Set();
async function port() {
  while (true) {
    const n = await new Promise((resolve, reject) => {
      const s = createServer();
      s.once("error", reject);
      s.listen(0, "127.0.0.1", () => {
        const p = s.address().port;
        s.close((e) => (e ? reject(e) : resolve(p)));
      });
    });
    if (!allocated.has(n)) {
      allocated.add(n);
      return n;
    }
  }
}
const [pgPort, apiPort, adminPort, webPort] = await Promise.all([
  port(),
  port(),
  port(),
  port(),
]);
const nativeId = randomUUID(),
  env = {
    COPYPASTE_NATIVE_DATABASE_DIR: ".data/native-qa/" + nativeId,
    COPYPASTE_RECOVERY_API_ORIGIN: "http://localhost:" + apiPort,
    COPYPASTE_RECOVERY_ADMIN_ORIGIN: "http://localhost:" + adminPort,
    COPYPASTE_RECOVERY_WEB_ORIGIN: "http://localhost:" + webPort,
  };
for (const key of [
  "OWNER_DATABASE_URL",
  "DATABASE_URL",
  "CONTROL_DATABASE_URL",
  "QUEUE_DATABASE_URL",
]) {
  const u = new URL(process.env[key]);
  u.port = String(pgPort);
  env[key] = u.href;
}
for (const file of [
  path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe"),
  process.env.CHROME_BIN,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean)) {
  try {
    await access(file);
    env.CHROME_BIN = file;
    break;
  } catch {}
}
assert.ok(env.CHROME_BIN, "A native browser must be provisioned");
const binary = path.resolve(
    "../copypaste-desktop/.data/runtime/windows-x64/codex.exe",
  ),
  pin = JSON.parse(
    await readFile(
      path.resolve("../copypaste-desktop/contracts/local-codex-runtime.json"),
      "utf8",
    ),
  );
assert.equal(sha(await readFile(binary)), pin.windows_x64_sha256);
env.CODEX_BIN = binary;
env.CODEX_VERSION = pin.runtime_version;
function launch(args, cwd, extra = {}) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env, ...extra },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let output = "";
  child.stdout.on("data", (b) => {
    output += b;
  });
  child.stderr.on("data", (b) => {
    output += b;
  });
  const closed = new Promise((resolve) => {
    child.once("error", (e) => {
      output += String(e);
      resolve(1);
    });
    child.once("close", (c) => resolve(c ?? 1));
  });
  return { child, closed, output: () => output };
}
const previews = [];
const checks = [];
let database,
  preview,
  failure = null,
  journey = null,
  shutdown = null,
  previewClosed = false;
async function check(name, args, cwd, extra) {
  console.log("Running " + name);
  const job = launch(args, cwd, extra),
    code = await job.closed,
    log = prefix + "-" + name + ".log";
  await writeFile(log, job.output(), { flag: "wx" });
  checks.push({
    name,
    exit_code: code,
    raw_report: { path: log, sha256: sha(Buffer.from(job.output())) },
  });
  assert.equal(code, 0, job.output().slice(-4000));
}
try {
  await check(
    "delivery-typecheck",
    ["node_modules/typescript/bin/tsc", "--noEmit"],
    delivery,
  );
  await check("platform-build", ["node_modules/typescript/bin/tsc"], platform);
  for (const component of ["web"]) {
    const repo = path.resolve("../copypaste-" + component);
    await check(
      component + "-typecheck",
      ["node_modules/typescript/bin/tsc", "--noEmit"],
      repo,
    );
    await check(
      component + "-preview-build",
      component === "extension"
        ? ["scripts/build.mjs"]
        : ["node_modules/vite/bin/vite.js", "build"],
      repo,
      {
        VITE_API_BASE: env.COPYPASTE_RECOVERY_API_ORIGIN,
        COPYPASTE_API_ORIGIN: env.COPYPASTE_RECOVERY_API_ORIGIN,
        COPYPASTE_WEB_ORIGIN: env.COPYPASTE_RECOVERY_WEB_ORIGIN,
      },
    );
  }
  const desktop = path.resolve("../copypaste-desktop");
  await check(
    "desktop-native-helper",
    ["scripts/build-update-host.mjs"],
    desktop,
  );
  await check("desktop-build", ["node_modules/typescript/bin/tsc"], desktop);
  await check(
    "desktop-renderer-build",
    ["node_modules/vite/bin/vite.js", "build", "--config", "vite.config.ts"],
    desktop,
  );
  database = launch(["scripts/native-db-launch.mjs"], platform, {
    COPYPASTE_NATIVE_DATABASE_START_ONLY: "true",
  });
  const deadline = Date.now() + 900000;
  while (!database.output().includes("Native PostgreSQL ready")) {
    assert.equal(database.child.exitCode, null);
    assert.ok(Date.now() < deadline);
    await new Promise((r) => setTimeout(r, 200));
  }
  for (const [component, chosen] of [["web", webPort]]) {
    preview = launch(
      [
        "node_modules/vite/bin/vite.js",
        "preview",
        "--host",
        "127.0.0.1",
        "--port",
        String(chosen),
        "--strictPort",
      ],
      path.resolve("../copypaste-" + component),
    );
    previews.push(preview);
    const ready = Date.now() + 30000;
    while (true) {
      try {
        if ((await fetch("http://127.0.0.1:" + chosen)).ok) break;
      } catch {}
      assert.equal(preview.child.exitCode, null);
      assert.ok(Date.now() < ready);
      await new Promise((r) => setTimeout(r, 200));
    }
  }
  await check(
    "journey",
    ["--import", "tsx", "scripts/qa-native-pairing-ui-v3.ts", attempt],
    delivery,
  );
  journey = JSON.parse(await readFile(prefix + "-journey.json", "utf8"));
  assert.equal(journey.status, "passed");
  assert.ok(
    journey.electron_closed &&
      journey.browser_closed &&
      journey.api_closed &&
      journey.fixture_closed,
  );
} catch (e) {
  failure = String(e);
} finally {
  for (let i = 0; i < previews.length; i++) {
    const p = previews[i];
    if (p.child.exitCode === null) p.child.kill();
    await p.closed;
    await writeFile(prefix + "-preview-" + i + ".log", p.output(), {
      flag: "wx",
    });
  }
  previewClosed = true;
  if (database?.child.connected && database.child.exitCode === null)
    database.child.send({ action: "shutdown" });
  if (database) {
    shutdown = await database.closed;
    await writeFile(prefix + "-database.log", database.output(), {
      flag: "wx",
    });
  }
  const unchanged = JSON.stringify(before) === JSON.stringify(await snapshot()),
    passed = !failure && unchanged && shutdown === 0 && previewClosed;
  const journeyPath = prefix + "-journey.json";
  let journeyRef = null;
  try {
    journeyRef = {
      path: journeyPath,
      sha256: sha(await readFile(journeyPath)),
    };
  } catch {}
  const report = {
    at: new Date().toISOString(),
    status: passed ? "passed" : "failed",
    error: failure,
    checks,
    source_unchanged: unchanged,
    source_files: before,
    journey: journeyRef,
    owned_database_shutdown: !database || shutdown === 0,
    owned_preview_closed: !preview || previewClosed,
    owned_native_port: pgPort,
    owned_native_directory: env.COPYPASTE_NATIVE_DATABASE_DIR,
    verifier_sha256: sha(await readFile(import.meta.filename)),
    journey_verifier_sha256: sha(
      await readFile("scripts/qa-native-pairing-ui-v3.ts"),
    ),
  };
  await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(
    JSON.stringify({
      status: report.status,
      error: failure,
      checks,
      source_unchanged: unchanged,
      owned_database_shutdown: report.owned_database_shutdown,
    }),
  );
  assert.ok(passed);
}
