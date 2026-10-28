import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "node:net";
import { randomUUID } from "node:crypto";
import path from "node:path";
import {
  parseCompleteTap,
  requirePassingCounts,
} from "./platform-qualification-state.mjs";

const attempt = process.argv[2], scope = "client-units";
assert.match(attempt ?? "", /^\d{2}$/);
assert.equal(scope, "client-units");
assert.equal(process.argv.length, 3);
const delivery = process.cwd(),
  platform = path.resolve("../copypaste-platform"),
  desktop = path.resolve("../copypaste-desktop"),
  prefix = "evidence/integrated-recovery-" + scope + "-" + attempt;
const hash = (b) => createHash("sha256").update(b).digest("hex");
const binary = path.join(desktop, ".data/runtime/windows-x64/codex.exe"),
  pin = JSON.parse(
    await readFile(
      path.join(desktop, "contracts/local-codex-runtime.json"),
      "utf8",
    ),
  );
assert.equal(hash(await readFile(binary)), pin.windows_x64_sha256);
for (const suffix of [".json", "-verifier.mjs"])
  await assert.rejects(readFile(prefix + suffix), (e) => e.code === "ENOENT");
async function snapshot() {
  const sources = {};
  for (const component of [
    "desktop",
    "web",
    "admin",
    "delivery",
  ]) {
    const repo = path.resolve("..", "copypaste-" + component);
    const names = execFileSync(
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
      { cwd: repo, encoding: "utf8", windowsHide: true },
    )
      .split("\0")
      .filter(Boolean);
    for (const name of [...new Set(names)].sort())
      sources["copypaste-" + component + "/" + name] = hash(
        await readFile(path.join(repo, name)),
      );
  }
  return Object.fromEntries(
    Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)),
  );
}
const before = await snapshot();
const rootBefore = {};
for (const n of ["publication_proofs.py", "test_publication_proofs.py", "audit_workmate_publication_v3.py"]) {
  const name = "docs/tools/" + n; rootBefore[name] = hash(await readFile(path.resolve("../..", name)));
}
for (const [name, expected] of Object.entries(before)) {
  const bytes = await readFile(path.resolve("..", name));
  assert.equal(hash(bytes), expected);
  const dest = prefix + "-sources/" + name;
  await mkdir(path.dirname(dest), { recursive: true });
  await writeFile(dest, bytes, { flag: "wx" });
}
await writeFile(
  prefix + "-verifier.mjs",
  await readFile(import.meta.filename),
  { flag: "wx" },
);
process.loadEnvFile(path.join(platform, ".env"));
const nativeId = randomUUID();
const port = await new Promise((resolve, reject) => {
  const server = createServer();
  server.once("error", reject);
  server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    server.close((error) => (error ? reject(error) : resolve(address.port)));
  });
});
const fixtureEnv = {
  COPYPASTE_NATIVE_DATABASE_DIR: ".data/native-qa/" + nativeId,
};
for (const name of [
  "OWNER_DATABASE_URL",
  "DATABASE_URL",
  "CONTROL_DATABASE_URL",
  "QUEUE_DATABASE_URL",
]) {
  const u = new URL(process.env[name]);
  u.port = String(port);
  fixtureEnv[name] = u.href;
}
const checks = [];
let database,
  databaseOutput = "",
  error = null,
  shutdown = null;
function launch(args, cwd, extra = {}) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: {
      ...process.env,
      COPYPASTE_LOCAL_CODEX_BIN: binary,
      COPYPASTE_LOCAL_CODEX_TEST_BIN: binary,
      CODEX_BIN: binary,
      CODEX_VERSION: pin.runtime_version,
      ...fixtureEnv,
      ...extra,
    },
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe", "ipc"],
  });
  let output = "";
  child.stdout.on("data", (b) => {
    output += b.toString();
    if (args.includes("scripts/run-tests-owned.mjs")) process.stdout.write(b);
  });
  child.stderr.on("data", (b) => {
    output += b.toString();
    if (args.includes("scripts/run-tests-owned.mjs")) process.stderr.write(b);
  });
  const closed = new Promise((resolve) => {
    child.once("close", (code) => resolve(code ?? 1));
    child.once("error", (e) => {
      output += String(e);
      resolve(1);
    });
  });
  return { child, closed, output: () => output };
}
async function check(name, args, cwd, tap = false) {
  console.log("Running " + name);
  const job = launch(args, cwd),
    code = await job.closed,
    raw = job.output(),
    file = prefix + "-" + name + (tap ? ".tap" : ".log");
  await writeFile(file, raw, { flag: "wx" });
  const row = {
    name,
    cwd: path.basename(cwd),
    args,
    exit_code: code,
    raw_report: { path: file, sha256: hash(Buffer.from(raw)) },
  };
  checks.push(row);
  if (tap) {
    row.counts = parseCompleteTap(raw);
    requirePassingCounts(row.counts);
  }
  assert.equal(code, 0, name + ": " + raw.slice(-5000));
}
try {
  for (const component of ["web", "admin"]) {
    await check(component + "-typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"], path.resolve("..", "copypaste-" + component));
  }
  for (const file of ["build-program-host.mjs", "build-update-host.mjs"])
    await check(file.replace(".mjs", ""), ["scripts/" + file], desktop);
  for (const component of ["web", "admin", "desktop", "delivery"]) {
    const repo = path.resolve("..", "copypaste-" + component);
    const files = (await readdir(path.join(repo, "tests"))).filter(n => /^[a-z0-9.-]+\.test\.(ts|mjs)$/.test(n)).sort().map(n => "tests/" + n);
    assert.ok(files.length > 0);
    const args = ["--test", "--test-concurrency=1", ...files];
    if (component !== "delivery") args.unshift("--import", "tsx");
    await check(component + "-unit", args, repo, true);
  }
} catch (e) {
  error = String(e);
} finally {
  if (database?.child.connected && database.child.exitCode === null)
    database.child.send({ action: "shutdown" });
  if (database) {
    shutdown = await database.closed;
    databaseOutput = database.output();
    await writeFile(prefix + "-database.log", databaseOutput, { flag: "wx" });
  }
  const unchanged = JSON.stringify(before) === JSON.stringify(await snapshot());
  const passed = !error && unchanged && (!database || shutdown === 0);
  const root_sources = {};
  for (const n of ["publication_proofs.py", "test_publication_proofs.py", "audit_workmate_publication_v3.py"]) {
    const name = "docs/tools/" + n, b = await readFile(path.resolve("../..", name));
    assert.equal(hash(b), rootBefore[name], "Root verifier bytes changed during qualification");
    const dest = prefix + "-root-sources/" + name; await mkdir(path.dirname(dest), { recursive: true }); await writeFile(dest, b, { flag: "wx" }); root_sources[name] = hash(b);
  }
  const report = {
    root_sources,
    at: new Date().toISOString(),
    status: passed ? "passed" : "failed",
    scope,
    checks,
    error,
    owned_database_shutdown: !database || shutdown === 0,
    source_unchanged: unchanged,
    source_files: before,
    owned_native_port: port,
    owned_native_directory: ".data/native-qa/" + nativeId,
    native_codex: {
      version: pin.runtime_version,
      sha256: pin.windows_x64_sha256,
      path: binary,
    },
    verifier_sha256: hash(await readFile(import.meta.filename)),
    limitations: [
      "Synthetic model answers and accounts",
      "All top-level unit test files in Web, Admin, Desktop and Delivery; Extension and backend are qualified separately; native Codex integration and full installed-product acceptance are not inferred",
    ],
  };
  await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", {
    flag: "wx",
  });
  console.log(
    JSON.stringify({
      status: report.status,
      checks: checks.map((c) => ({
        name: c.name,
        exit: c.exit_code,
        counts: c.counts,
      })),
      error,
      source_unchanged: unchanged,
      owned_database_shutdown: report.owned_database_shutdown,
    }),
  );
  assert.ok(
    passed,
    "Preserve this attempt and use a new attempt after repairing its cause",
  );
}
