import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, readdir, mkdir } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { createConnection } from "node:net";
import path from "node:path";

const attempt = process.argv[2]; assert.match(attempt ?? "", /^\d{2}$/); assert.equal(process.argv.length, 3);
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), admin = path.resolve("../copypaste-admin"), prefix = "evidence/audio-accounting-ui-" + attempt;
const sha = bytes => createHash("sha256").update(bytes).digest("hex"), binary = process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN;
assert.ok(binary && path.isAbsolute(binary));
const pin = JSON.parse(await readFile("../copypaste-desktop/contracts/local-codex-runtime.json", "utf8")); assert.equal(sha(await readFile(binary)), pin.windows_x64_sha256);
for (const suffix of [".json", ".log", "-journey.json", "-verifier.mjs", "-journey-verifier.ts", "-fixture-cleanup.json"]) await assert.rejects(readFile(prefix + suffix), e => e.code === "ENOENT");
async function occupied(port) { return new Promise(resolve => { const socket = createConnection({ host: "127.0.0.1", port }); socket.once("connect", () => { socket.destroy(); resolve(true); }); socket.once("error", () => resolve(false)); }); }
for (const port of [4310, 4318, 55432]) assert.equal(await occupied(port), false, "Keep existing services untouched");
async function snapshot() {
  const result = {};
  for (const repo of [platform, admin, delivery, path.resolve("../copypaste-web"), path.resolve("../copypaste-extension"), path.resolve("../copypaste-desktop")]) {
    const names = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src", "renderer", "renderer-source.json", "scripts", "tests", "contracts", "catalog", "migrations", "skills", "assets/audio", "public", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts"], { cwd: repo, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
    for (const file of [...new Set(names)].sort()) result[path.basename(repo) + "/" + file] = sha(await readFile(path.join(repo, file)));
  }
  result["docs/contracts/audio-accounting.openapi.json"] = sha(await readFile("../../docs/contracts/audio-accounting.openapi.json")); return result;
}
async function built(dir, prefix = "") {
  const files = {};
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    assert.equal(entry.isSymbolicLink(), false);
    if (entry.isDirectory()) Object.assign(files, await built(path.join(dir, entry.name), prefix + entry.name + "/"));
    else files[prefix + entry.name] = sha(await readFile(path.join(dir, entry.name)));
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}
const before = await snapshot();
for (const [name, expected] of Object.entries(before)) {
  const source = name.startsWith("docs/") ? path.resolve("../..", name) : path.resolve("..", name);
  const bytes = await readFile(source); assert.equal(sha(bytes), expected);
  const target = path.resolve(prefix + "-sources", name);
  assert.ok(target.startsWith(path.resolve(prefix + "-sources") + path.sep));
  await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: "wx" });
}
await writeFile(prefix + "-verifier.mjs", await readFile(import.meta.filename), { flag: "wx" });
await writeFile(prefix + "-journey-verifier.ts", await readFile("scripts/qa-audio-accounting-ui.ts"), { flag: "wx" });
const run = path.join(platform, ".data/test-fixture-reclamation", randomUUID()), token = randomUUID(); await mkdir(run, { recursive: true });
await writeFile(path.join(run, "manifest.json"), JSON.stringify({ owner_pid: process.pid, token }), { flag: "wx" });
const log = createWriteStream(prefix + ".log", { flags: "wx" });
function launch(args, cwd, environment = {}) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...environment }, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const closed = new Promise(resolve => { child.once("close", code => resolve(code ?? 1)); child.once("error", () => resolve(1)); }); return { child, closed };
}
let database, preview, builds, code, shutdown, cleanup, error, journey;
try {
  for (const repo of [platform, admin, delivery, path.resolve("../copypaste-web"), path.resolve("../copypaste-extension"), path.resolve("../copypaste-desktop")]) assert.equal(await launch(["node_modules/typescript/bin/tsc", "--noEmit"], repo).closed, 0, path.basename(repo) + " typecheck");
  assert.equal(await launch(["node_modules/vite/bin/vite.js", "build"], admin).closed, 0); builds = await built(path.join(admin, "dist"));
  database = launch(["scripts/native-db-launch.mjs"], platform, { COPYPASTE_NATIVE_DATABASE_START_ONLY: "true" });
  let output = ""; database.child.stdout.on("data", bytes => { output = (output + bytes.toString()).slice(-16000); }); const deadline = Date.now() + 900000;
  while (!output.includes("Native PostgreSQL ready")) { assert.equal(database.child.exitCode, null); assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 200)); }
  preview = launch(["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4318", "--strictPort"], admin);
  const ready = Date.now() + 30000;
  while (!await occupied(4318)) { assert.equal(preview.child.exitCode, null); assert.ok(Date.now() < ready); await new Promise(resolve => setTimeout(resolve, 200)); }
  const environment = { COPYPASTE_TEST_RECLAMATION_DIR: run, COPYPASTE_TEST_RECLAMATION_TOKEN: token, CHROME_BIN: process.env.CHROME_BIN ?? path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe") };
  console.log("Running actual Admin managed-audio configuration, asynchronous progress, independent approval and cost recovery");
  code = await launch(["--env-file=" + path.join(platform, ".env"), "--import", "tsx", "scripts/qa-audio-accounting-ui.ts", attempt], delivery, environment).closed;
  const cleanupCode = await launch(["--import", "tsx", "scripts/reclaim-test-fixtures.ts"], platform, environment).closed;
  const bytes = await readFile(path.join(run, "result.json")); await writeFile(prefix + "-fixture-cleanup.json", bytes, { flag: "wx" });
  cleanup = { ...JSON.parse(bytes), exit_code: cleanupCode }; journey = JSON.parse(await readFile(prefix + "-journey.json"));
} catch (e) { error = String(e); }
finally {
  if (preview) { if (preview.child.exitCode === null) preview.child.kill(); await preview.closed; }
  if (database?.child.connected && database.child.exitCode === null) database.child.send({ action: "shutdown" }); if (database) shutdown = await database.closed;
  await new Promise(resolve => log.end(resolve));
  const stable = JSON.stringify(before) === JSON.stringify(await snapshot()), compiled = !!builds && JSON.stringify(builds) === JSON.stringify(await built(path.join(admin, "dist")));
  const passed = !error && code === 0 && shutdown === 0 && stable && compiled && journey?.status === "passed" && journey.checks.length === 8 && journey.media.length === 3
    && journey.media.every(m => m?.skipped_capture_errors === 0) && journey.browser_closed && journey.api_closed && journey.fixture_closed && journey.provider_closed
    && cleanup?.exit_code === 0 && cleanup.status === "passed" && cleanup.results.every(r => r.reclaimed);
  const report = { at: new Date().toISOString(), status: passed ? "passed" : "failed", error, source_unchanged: stable, compiled_unchanged: compiled, source_files: before, builds,
    native_binary: { path: binary, sha256: pin.windows_x64_sha256, version: pin.runtime_version }, journey_exit: code, journey, fixture_cleanup: cleanup,
    owned_database_shutdown: shutdown === 0, owned_preview_closed: !preview || preview.child.exitCode !== null || preview.child.signalCode !== null,
    raw_log: { path: prefix + ".log", sha256: sha(await readFile(prefix + ".log")) } };
  await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, error, journey_errors: journey?.errors, checks: journey?.checks.length, source_unchanged: stable, shutdown })); process.exitCode = passed ? 0 : 1;
}
