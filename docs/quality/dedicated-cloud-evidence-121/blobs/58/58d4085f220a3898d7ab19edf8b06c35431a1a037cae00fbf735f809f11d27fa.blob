import { spawn, execFileSync } from "node:child_process";
import { createConnection, createServer } from "node:net";
import { createWriteStream } from "node:fs";
import { access, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";

const attempt = process.argv[2]; assert.match(attempt ?? "", /^\d{2}$/);
assert.equal(process.argv.length, 3);
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform-recovery-120"), web = path.resolve("../copypaste-web-cloud-121"), extension = path.resolve("../copypaste-extension-cloud-121"), prefix = `.data/dedicated-cloud-121/extension-ui-${attempt}`;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
for (const suffix of [".json", ".log", "-journey.json", "-verifier.mjs", "-journey-verifier.ts"]) await assert.rejects(access(prefix + suffix), e => e.code === "ENOENT");
async function occupied(port) { return new Promise(resolve => { const socket = createConnection({ host: "127.0.0.1", port }); socket.once("connect", () => { socket.destroy(); resolve(true); }); socket.once("error", () => resolve(false)); }); }
for (const port of [4310, 4317]) assert.equal(await occupied(port), false, "Keep existing services untouched");
async function snapshot() {
  const sources = {};
  for (const repoName of ["copypaste-platform-recovery-120", "copypaste-web-cloud-121", "copypaste-extension-cloud-121", "copypaste-delivery-cloud-121"]) {
    const repo = path.resolve("..", repoName);
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
      sources[repoName + "/" + name] = hash(
        await readFile(path.join(repo, name)),
      );
  }
  return Object.fromEntries(
    Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)),
  );
}
async function built(root, prefix = "") {
  const files = {};
  for (const entry of await readdir(root, { withFileTypes: true })) {
    assert.equal(entry.isSymbolicLink(), false);
    if (entry.isDirectory()) Object.assign(files, await built(path.join(root, entry.name), prefix + entry.name + "/"));
    else files[prefix + entry.name] = hash(await readFile(path.join(root, entry.name)));
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}
const before = await snapshot(), verifier = await readFile(import.meta.filename), workerBytes = await readFile("scripts/qa-dedicated-extension-ui-v1.ts");
for (const [name, expected] of Object.entries(before)) {
  const bytes = await readFile(path.resolve("..", name)); assert.equal(hash(bytes), expected);
  const dest = prefix + "-sources/" + name; await mkdir(path.dirname(dest), { recursive: true }); await writeFile(dest, bytes, { flag: "wx" });
}
const desktop = path.resolve("../copypaste-desktop"), pin = JSON.parse(await readFile(path.join(desktop, "contracts/local-codex-runtime.json"), "utf8")), binary = path.join(desktop, ".data/runtime/windows-x64/codex.exe");
assert.equal(hash(await readFile(binary)), pin.windows_x64_sha256);
await writeFile(prefix + "-verifier.mjs", verifier, { flag: "wx" }); await writeFile(prefix + "-journey-verifier.ts", workerBytes, { flag: "wx" });
const run = path.join(platform, ".data/test-fixture-reclamation", randomUUID()), token = randomUUID();
await mkdir(run, { recursive: true }); await writeFile(path.join(run, "manifest.json"), JSON.stringify({ owner_pid: process.pid, token }), { flag: "wx" });
process.loadEnvFile(path.join(platform, ".env"));
const databasePort = await new Promise((resolve,reject) => { const s=createServer(); s.once("error",reject); s.listen(0,"127.0.0.1",()=>{ const a=s.address();s.close(e=>e?reject(e):resolve(a.port)); }); });
const databaseEnv = { COPYPASTE_NATIVE_DATABASE_DIR: ".data/native-qa/" + randomUUID() };
for(const n of ["OWNER_DATABASE_URL","DATABASE_URL","CONTROL_DATABASE_URL","QUEUE_DATABASE_URL"]) { const u=new URL(process.env[n]);u.port=String(databasePort);databaseEnv[n]=u.href; }
const log = createWriteStream(prefix + ".log", { flags: "wx" });
function launch(args, cwd, env = {}) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...databaseEnv, ...env }, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const closed = new Promise(resolve => { child.once("close", code => resolve(code ?? 1)); child.once("error", () => resolve(1)); });
  return { child, closed };
}
let database, preview, shutdown = null, cleanupCode = null, journeyCode = null, error = null, journey = null, cleanup = null, binaries = null;
const checks = [];
try {
  for (const [name, args, cwd] of [
    ["delivery typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"], delivery],
    ["extension tests", ["--import", "tsx", "--test", "tests/conversation.test.ts", "tests/folder-import.test.ts", "tests/chat-upload.test.ts", "tests/financial-notice.test.ts", "tests/native-code.test.ts", "tests/native-session.test.ts"], extension],
    ["extension typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"], extension],
    ["extension build", ["scripts/build.mjs"], extension],
    ["web typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"], web],
    ["web preview build", ["node_modules/vite/bin/vite.js", "build"], web],
  ]) { const code = await launch(args, cwd).closed; checks.push({ name, exit_code: code }); assert.equal(code, 0, name); }
  binaries = { web: await built(path.join(web, "dist")), extension: await built(path.join(extension, "dist")) };
  database = launch(["scripts/native-db-launch.mjs"], platform, { COPYPASTE_NATIVE_DATABASE_START_ONLY: "true" });
  let output = ""; database.child.stdout.on("data", b => { output = (output + b.toString()).slice(-16000); });
  const dbEnd = Date.now() + 900000;
  while (!output.includes("Native PostgreSQL ready")) { assert.equal(database.child.exitCode, null); assert.ok(Date.now() < dbEnd); await new Promise(r => setTimeout(r, 200)); }
  preview = launch(["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4317", "--strictPort"], web);
  const previewEnd = Date.now() + 30000;
  while (!(await occupied(4317))) { assert.equal(preview.child.exitCode, null); assert.ok(Date.now() < previewEnd); await new Promise(r => setTimeout(r, 200)); }
  const env = { CODEX_BIN: binary, CODEX_VERSION: pin.runtime_version, COPYPASTE_TEST_RECLAMATION_DIR: run, COPYPASTE_TEST_RECLAMATION_TOKEN: token, CHROME_BIN: process.env.CHROME_BIN ?? path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe") };
  console.log("Running actual native right Side Panel chat journey");
  journeyCode = await launch(["--env-file=" + path.join(platform, ".env"), "--import", "tsx", "scripts/qa-dedicated-extension-ui-v1.ts", attempt], delivery, env).closed;
  cleanupCode = await launch(["--import", "tsx", "scripts/reclaim-test-fixtures.ts"], platform, env).closed;
  const cleanupBytes = await readFile(path.join(run, "result.json")); await writeFile(prefix + "-fixture-cleanup.json", cleanupBytes, { flag: "wx" }); cleanup = { path: prefix + "-fixture-cleanup.json", sha256: hash(cleanupBytes), ...JSON.parse(cleanupBytes) };
  journey = JSON.parse(await readFile(prefix + "-journey.json"));
} catch (e) { error = String(e); }
finally {
  if (preview && preview.child.exitCode === null) preview.child.kill(); if (preview) await preview.closed;
  if (database?.child.connected && database.child.exitCode === null) database.child.send({ action: "shutdown" }); if (database) shutdown = await database.closed;
  await new Promise(resolve => log.end(resolve));
  const stable = JSON.stringify(before) === JSON.stringify(await snapshot());
  const buildStable = !!binaries && JSON.stringify(binaries) === JSON.stringify({ web: await built(path.join(web, "dist")), extension: await built(path.join(extension, "dist")) });
  const passed = !error && journeyCode === 0 && cleanupCode === 0 && shutdown === 0 && stable && buildStable && journey?.status === "passed" && journey.checks.length === 8 && journey.recordings.length === 2 && journey.layouts.length === 6 && journey.actual_private_reads.length === 3 && journey.provider_closed && journey.browser_closed && journey.api_closed && journey.fixture_closed && cleanup?.status === "passed" && cleanup.workers_exited && cleanup.actual_filesystem_checked && cleanup.results.every(r => r.reclaimed);
  const logBytes = await readFile(prefix + ".log"), journeyBytes = await readFile(prefix + "-journey.json").catch(() => null);
  const result = { owned_database_port: databasePort, owned_database_directory: databaseEnv.COPYPASTE_NATIVE_DATABASE_DIR, status: passed ? "passed" : "failed", at: new Date().toISOString(), scope: "Actual dedicated-cloud handoff and unconfirmed-resource task rejection in the native right Side Panel; OTP/PKCE, browser folder review, explicit private upload, post-commit response-loss retry, relative-path index, real pinned native cloud Codex and three private tool reads; explicit synthetic model decisions/accounts/files", error, checks, journey_exit_code: journeyCode, counts: { checks: journey?.checks.length ?? 0, errors: journey?.errors.length ?? 1 }, native_codex: pin, source_files: before, source_unchanged: stable, compiled: binaries, compiled_unchanged: buildStable, raw_report: { path: prefix + ".log", sha256: hash(logBytes) }, verifier: { path: prefix + "-verifier.mjs", sha256: hash(verifier) }, journey_verifier: { path: prefix + "-journey-verifier.ts", sha256: hash(workerBytes) }, journey: journeyBytes ? { path: prefix + "-journey.json", sha256: hash(journeyBytes) } : null, fixture_cleanup: cleanup, cleanup_exit_code: cleanupCode, owned_database_shutdown: shutdown === 0, owned_preview_closed: !preview || preview.child.exitCode !== null || preview.child.signalCode !== null };
  await writeFile(prefix + ".json", JSON.stringify(result, null, 2) + "\n", { flag: "wx" }); console.log(JSON.stringify({ status: result.status, error, source_unchanged: stable, checks: result.counts, shutdown }));
  assert.ok(passed, "Inspect preserved source-bound native chat report");
}
