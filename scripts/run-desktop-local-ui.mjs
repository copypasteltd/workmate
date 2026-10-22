import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import path from "node:path";
const attempt = process.argv[2]; assert.match(attempt ?? "", /^\d{2}$/); assert.equal(process.argv.length, 3);
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), desktop = path.resolve("../copypaste-desktop"), web = path.resolve("../copypaste-web");
const prefix = "evidence/desktop-local-ui-" + attempt, sha = bytes => createHash("sha256").update(bytes).digest("hex");
for (const tail of [".json", ".tap", "-journey.json", "-verifier.mjs", "-journey-verifier.ts"]) await assert.rejects(access(prefix + tail), e => e.code === "ENOENT");
const binary = process.env.COPYPASTE_LOCAL_CODEX_BIN; assert.ok(binary && path.isAbsolute(binary));
async function occupied(port) { return new Promise(resolve => { const socket = createConnection({ host: "127.0.0.1", port }); socket.once("connect", () => { socket.destroy(); resolve(true); }); socket.once("error", () => resolve(false)); }); }
for (const port of [4310, 4317, 55432]) assert.equal(await occupied(port), false, "Keep all existing services untouched");
async function snapshot() {
  const result = {};
  for (const repo of ["platform", "desktop", "web", "delivery"]) {
    const folder = path.resolve("../copypaste-" + repo);
    const files = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src", "renderer", "scripts", "tests", "catalog", "contracts", "migrations", "skills", "public", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "renderer-source.json", "deployment.json"], { cwd: folder, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
    for (const file of [...new Set(files)].sort()) result["copypaste-" + repo + "/" + file] = sha(await readFile(path.join(folder, file)));
  }
  return result;
}
const before = await snapshot(), verifier = await readFile(import.meta.filename), journeyBytes = await readFile("scripts/qa-desktop-local.ts");
await writeFile(prefix + "-verifier.mjs", verifier, { flag: "wx" }); await writeFile(prefix + "-journey-verifier.ts", journeyBytes, { flag: "wx" });
const run = path.join(platform, ".data/test-fixture-reclamation", randomUUID()), token = randomUUID(), candidate = path.join(desktop, ".data/local-candidates", randomUUID());
await mkdir(run, { recursive: true }); await writeFile(path.join(run, "manifest.json"), JSON.stringify({ owner_pid: process.pid, token }), { flag: "wx" });
const log = createWriteStream(prefix + ".tap", { flags: "wx" });
function launch(args, cwd, env = {}, ipc = false) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, stdio: ipc ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const closed = new Promise(resolve => { child.once("close", c => resolve(c ?? 1)); child.once("error", () => resolve(1)); }); return { child, closed };
}
const checks = []; let database, preview, shutdown = null, cleanup = null, journey = null, journeyCode = null, error = null, built = null;
try {
  for (const [name, args, cwd] of [
    ["delivery typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"], delivery],
    ["platform typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"], platform],
    ["desktop typecheck main", ["node_modules/typescript/bin/tsc", "--noEmit"], desktop],
    ["desktop typecheck renderer", ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "renderer/tsconfig.json"], desktop],
    ["desktop unit tests", ["--import", "tsx", "--test", "tests/download.test.ts", "tests/files.test.ts", "tests/local-agent.test.ts", "tests/local-input.test.ts", "tests/native-code.test.ts", "tests/native-session.test.ts", "tests/vault.test.ts"], desktop],
    ["prepare pinned native runtime", ["scripts/prepare-local-codex.mjs"], desktop],
    ["desktop build main", ["node_modules/typescript/bin/tsc"], desktop],
    ["desktop build native host", ["scripts/build-native-host.mjs"], desktop],
    ["desktop build renderer", ["node_modules/vite/bin/vite.js", "build", "--config", "vite.config.ts"], desktop],
    ["web authorization preview build", ["node_modules/vite/bin/vite.js", "build"], web],
  ]) { const code = await launch(args, cwd).closed; checks.push({ name, exit_code: code }); assert.equal(code, 0, name); }
  const builder = JSON.parse(await readFile(path.join(desktop, "node_modules/electron-builder/package.json"))); const builderEntry = typeof builder.bin === "string" ? builder.bin : builder.bin["electron-builder"];
  const packaged = await launch([path.join(desktop, "node_modules/electron-builder", builderEntry), "--win", "--dir", "--config.directories.output=" + candidate], desktop).closed;
  checks.push({ name: "unsigned native Electron candidate packaging", exit_code: packaged }); assert.equal(packaged, 0);
  const executable = path.join(candidate, "win-unpacked/CopyPaste.exe"); await access(executable);
  const resources = path.join(candidate, "win-unpacked/resources"), lock = JSON.parse(await readFile(path.join(desktop, "contracts/local-codex-runtime.json")));
  assert.equal(sha(await readFile(path.join(resources, "local-codex/codex.exe"))), lock.windows_x64_sha256);
  built = { executable: path.relative(delivery, executable).replaceAll("\\", "/"), app_asar_sha256: sha(await readFile(path.join(resources, "app.asar"))), native_binary_sha256: lock.windows_x64_sha256,
    runtime_manifest_sha256: sha(await readFile(path.join(resources, "local-codex/runtime-manifest.json"))) };
  database = launch(["scripts/native-db-launch.mjs"], platform, { COPYPASTE_NATIVE_DATABASE_START_ONLY: "true" }, true); let output = "";
  database.child.stdout.on("data", b => { output = (output + b.toString()).slice(-16000); }); const until = Date.now() + 900000;
  while (!output.includes("Native PostgreSQL ready")) { assert.equal(database.child.exitCode, null); assert.ok(Date.now() < until); await new Promise(resolve => setTimeout(resolve, 200)); }
  preview = launch(["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4317", "--strictPort"], web); const previewEnd = Date.now() + 30000;
  while (!(await occupied(4317))) { assert.equal(preview.child.exitCode, null); assert.ok(Date.now() < previewEnd); await new Promise(resolve => setTimeout(resolve, 200)); }
  const env = { COPYPASTE_TEST_RECLAMATION_DIR: run, COPYPASTE_TEST_RECLAMATION_TOKEN: token,
    CHROME_BIN: process.env.CHROME_BIN ?? path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe"), COPYPASTE_LOCAL_DESKTOP_CANDIDATE: executable };
  console.log("Running actual packaged Desktop local execution and user-permission journey");
  const journeyRun = launch(["--env-file=" + path.join(platform, ".env"), "--import", "tsx", "scripts/qa-desktop-local.ts", attempt], delivery, env);
  // Only this isolated candidate/browser fixture belongs to the child. Bound
  // its lifetime so an unresolved operation cannot prevent DB reclamation.
  const journeyDeadline = setTimeout(() => {
    if (journeyRun.child.exitCode !== null || !journeyRun.child.pid) return;
    if (process.platform === "win32") {
      try { execFileSync("taskkill.exe", ["/PID", String(journeyRun.child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 15000 }); } catch {}
    } else journeyRun.child.kill("SIGKILL");
  }, 360000);
  try { journeyCode = await journeyRun.closed; } finally { clearTimeout(journeyDeadline); }
  const cleanupCode = await launch(["--import", "tsx", "scripts/reclaim-test-fixtures.ts"], platform, env).closed;
  const cleanupBytes = await readFile(path.join(run, "result.json")); await writeFile(prefix + "-fixture-cleanup.json", cleanupBytes, { flag: "wx" });
  cleanup = { path: prefix + "-fixture-cleanup.json", sha256: sha(cleanupBytes), exit_code: cleanupCode, ...JSON.parse(cleanupBytes) };
  journey = JSON.parse(await readFile(prefix + "-journey.json"));
} catch (e) { error = String(e); }
finally {
  if (preview?.child.exitCode === null) preview.child.kill(); if (preview) await preview.closed;
  if (database?.child.connected && database.child.exitCode === null) database.child.send({ action: "shutdown" }); if (database) shutdown = await database.closed;
  await new Promise(resolve => log.end(resolve));
  const unchanged = JSON.stringify(before) === JSON.stringify(await snapshot()), raw = await readFile(prefix + ".tap"), journeyRaw = await readFile(prefix + "-journey.json").catch(() => null);
  const passed = !error && journeyCode === 0 && journey?.status === "passed" && journey.checks.length >= 12 && journey.company_image_calls === 2 && journey.native_input_completions === 1
    && journey.checks.some(check => check.includes("native save-dialog selection")) && journey.checks.some(check => check.includes("edits the authorized source image"))
    && journey.checks.some(check => check.includes("800x600"))
    && journey.checks.some(check => check.includes("same task/thread/turn"))
    && journey.checks.some(check => check.includes("Stop stays usable during a native question"))
    && journey.checks.some(check => check.includes("Revoking full permission while waiting"))
    && journey.electron_closed && journey.browser_closed && journey.api_closed && journey.fixture_closed
    && cleanup?.exit_code === 0 && cleanup.status === "passed" && cleanup.results.every(r => r.reclaimed) && shutdown === 0 && unchanged;
  const report = { at: new Date().toISOString(), status: passed ? "passed" : "failed", error, checks, counts: { journey_checks: journey?.checks.length ?? 0, errors: journey?.errors.length ?? 1 },
    source_files: before, source_unchanged: unchanged, packaged: built, owned_database_shutdown: shutdown === 0, owned_preview_closed: !preview || preview.child.exitCode !== null || preview.child.signalCode !== null,
    journey_exit_code: journeyCode, fixture_cleanup: cleanup, raw_report: { path: prefix + ".tap", sha256: sha(raw) }, verifier: { path: prefix + "-verifier.mjs", sha256: sha(verifier) },
    journey_verifier: { path: prefix + "-journey-verifier.ts", sha256: sha(journeyBytes) }, journey: journeyRaw ? { path: prefix + "-journey.json", sha256: sha(journeyRaw) } : null,
    not_validated: ["human_native_dialog_clicks", "live_model_provider", "signed_production_installer", "all_18_native_role_and_media_tools", "entire_product_acceptance"] };
  await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, error, counts: report.counts, source_unchanged: unchanged, shutdown })); assert.ok(passed, "Inspect preserved Desktop local journey evidence");
}
