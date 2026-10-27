import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { access, readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import { createConnection } from "node:net";
import path from "node:path";
const attempt = process.argv[2]; assert.match(attempt ?? "", /^\d{2}$/); assert.equal(process.argv.length, 3);
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), desktop = path.resolve("../copypaste-desktop"), web = path.resolve("../copypaste-web");
const prefix = "evidence/desktop-geo-ui-" + attempt, sha = bytes => createHash("sha256").update(bytes).digest("hex");
for (const tail of [".json", ".tap", "-journey.json", "-verifier.mjs", "-journey-verifier.ts"]) await assert.rejects(access(prefix + tail), e => e.code === "ENOENT");
const binary = process.env.COPYPASTE_LOCAL_CODEX_BIN; assert.ok(binary && path.isAbsolute(binary));
async function occupied(port) { return new Promise(resolve => { const socket = createConnection({ host: "127.0.0.1", port }); socket.once("connect", () => { socket.destroy(); resolve(true); }); socket.once("error", () => resolve(false)); }); }
for (const port of [4310, 4317, 55432]) assert.equal(await occupied(port), false, "Keep all existing services untouched");
async function snapshot() {
  const result = {};
  for (const repo of ["platform", "desktop", "web", "delivery"]) {
    const folder = path.resolve("../copypaste-" + repo);
    const files = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src", "renderer", "scripts", "tests", "catalog", "contracts", "migrations", "skills", "public", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "renderer-source.json", "deployment.json", "assets/browser-shell.html", "assets/browser-shell.css", "assets/browser-shell.js", ":(glob)assets/*.png", ":(glob)assets/*.ico", ":(glob)assets/*.cmd", "assets/licenses"], { cwd: folder, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
    for (const file of [...new Set(files)].sort()) result["copypaste-" + repo + "/" + file] = sha(await readFile(path.join(folder, file)));
  }
  return result;
}
const before = await snapshot(), verifier = await readFile(import.meta.filename), journeyBytes = await readFile("scripts/qa-desktop-geo-ui-v4.ts");
for(const [name,expected] of Object.entries(before)){const bytes=await readFile(path.resolve("..",name));assert.equal(sha(bytes),expected);const target=prefix+"-sources/"+name;await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes,{flag:"wx"});}
await writeFile(prefix + "-verifier.mjs", verifier, { flag: "wx" }); await writeFile(prefix + "-journey-verifier.ts", journeyBytes, { flag: "wx" });
const run = path.join(platform, ".data/test-fixture-reclamation", randomUUID()), token = randomUUID(), candidate = path.join(desktop, ".data/local-candidates", randomUUID());
await mkdir(run, { recursive: true }); await writeFile(path.join(run, "manifest.json"), JSON.stringify({ owner_pid: process.pid, token }), { flag: "wx" });
const log = createWriteStream(prefix + ".tap", { flags: "wx" });
function launch(args, cwd, env = {}, ipc = false) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, COPYPASTE_LOCAL_CODEX_TEST_BIN: binary, CODEX_BIN: binary, CODEX_VERSION: "0.163.0-alpha.11", ...env }, windowsHide: true, stdio: ipc ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"] });
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
    ["build native program guardian", ["scripts/build-program-host.mjs"], desktop],
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
  const guardianDir = path.join(resources, "local-program-host"), guardianManifest = JSON.parse(await readFile(path.join(guardianDir, "manifest.json")));
  assert.deepEqual((await readdir(guardianDir)).sort(), ["local-program-host.exe", "manifest.json"]);
  assert.equal(guardianManifest.schema, 1); assert.equal(guardianManifest.platform, "windows-x64");
  assert.equal(guardianManifest.source_sha256, sha(await readFile(path.join(desktop, "src/local-program-host.cs"))));
  assert.equal(guardianManifest.sha256, sha(await readFile(path.join(guardianDir, "local-program-host.exe"))));
  assert.equal(guardianManifest.sha256, sha(await readFile(path.join(desktop, ".data/native-program-host/local-program-host.exe"))));
  const archive = path.join(resources, "app.asar"), asar = createRequire(path.join(desktop, "package.json"))("@electron/asar");
  const entries = asar.listPackage(archive).map(name => name.replaceAll("\\", "/").replace(/^\/+/, ""));
  // ASAR's directory lookup splits on the host separator. Keep portable names
  // in receipts, but pass native paths to its Windows archive APIs.
  const assets = entries.filter(name => name.startsWith("assets/") && !asar.statFile(archive, path.normalize(name)).files);
  assert.ok(assets.length > 0);
  assert.ok(assets.every(name => /^assets\/(?:[^/]+\.(?:png|ico|cmd)|browser-shell\.(?:html|css|js)|licenses\/.+)$/.test(name)), "Repository media and test recordings must not ship inside the application");
  const required = ["assets/icon-256.png", "assets/browser-shell.html", "assets/browser-shell.css", "assets/browser-shell.js", "assets/native-host.cmd"];
  for (const name of required) assert.ok(assets.includes(name), "Required runtime asset: " + name);
  const sourceAssets = Object.keys(before).filter(name => name.startsWith("copypaste-desktop/assets/")).map(name => name.slice("copypaste-desktop/".length));
  assert.deepEqual([...assets].sort(), sourceAssets.sort(), "Every declared runtime asset and license must be packaged");
  for (const name of assets) {
    assert.equal(sha(asar.extractFile(archive, path.normalize(name))), sha(await readFile(path.join(desktop, name))), name);
  }
  built = { executable: path.relative(delivery, executable).replaceAll("\\", "/"), app_asar_sha256: sha(await readFile(path.join(resources, "app.asar"))), native_binary_sha256: lock.windows_x64_sha256,
    app_asar_bytes: (await stat(archive)).size, runtime_asset_files: assets, runtime_assets_match_source: true, repository_media_excluded: !assets.some(name => /(?:screenshots|workmate-current)\//.test(name)),
    runtime_manifest_sha256: sha(await readFile(path.join(resources, "local-codex/runtime-manifest.json"))),
    program_guardian: { sha256: guardianManifest.sha256, source_sha256: guardianManifest.source_sha256, manifest_sha256: sha(await readFile(path.join(guardianDir, "manifest.json"))) } };
  database = launch(["scripts/native-db-launch.mjs"], platform, { COPYPASTE_NATIVE_DATABASE_START_ONLY: "true" }, true); let output = "";
  database.child.stdout.on("data", b => { output = (output + b.toString()).slice(-16000); }); const until = Date.now() + 900000;
  while (!output.includes("Native PostgreSQL ready")) { assert.equal(database.child.exitCode, null); assert.ok(Date.now() < until); await new Promise(resolve => setTimeout(resolve, 200)); }
  preview = launch(["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4317", "--strictPort"], web); const previewEnd = Date.now() + 30000;
  while (!(await occupied(4317))) { assert.equal(preview.child.exitCode, null); assert.ok(Date.now() < previewEnd); await new Promise(resolve => setTimeout(resolve, 200)); }
  const env = { COPYPASTE_TEST_RECLAMATION_DIR: run, COPYPASTE_TEST_RECLAMATION_TOKEN: token,
    CHROME_BIN: process.env.CHROME_BIN ?? path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe"), COPYPASTE_LOCAL_DESKTOP_CANDIDATE: executable };
  console.log("Running actual packaged native GEO question preparation, local execution, capture, repetition and cancellation journey");
  const journeyRun = launch(["--env-file=" + path.join(platform, ".env"), "--import", "tsx", "scripts/qa-desktop-geo-ui-v4.ts", attempt], delivery, env);
  // Only this isolated candidate/browser fixture belongs to the child. Bound
  // its lifetime so an unresolved operation cannot prevent DB reclamation.
  const journeyDeadline = setTimeout(() => {
    if (journeyRun.child.exitCode !== null || !journeyRun.child.pid) return;
    if (process.platform === "win32") {
      try { execFileSync("taskkill.exe", ["/PID", String(journeyRun.child.pid), "/T", "/F"], { windowsHide: true, stdio: "ignore", timeout: 15000 }); } catch {}
    } else journeyRun.child.kill("SIGKILL");
  }, 1140000);
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
  let packagedUnchanged = false;
  if (built) {
    const root = path.join(path.dirname(path.resolve(delivery, built.executable)), "resources");
    const finalArchive = await readFile(path.join(root, "app.asar")).catch(() => null), finalCodex = await readFile(path.join(root, "local-codex/codex.exe")).catch(() => null);
    const finalGuardian = await readFile(path.join(root, "local-program-host/local-program-host.exe")).catch(() => null), finalGuardianManifest = await readFile(path.join(root, "local-program-host/manifest.json")).catch(() => null);
    packagedUnchanged = !!finalArchive && !!finalCodex && !!finalGuardian && !!finalGuardianManifest && sha(finalArchive) === built.app_asar_sha256 && sha(finalCodex) === built.native_binary_sha256
      && sha(finalGuardian) === built.program_guardian.sha256 && sha(finalGuardianManifest) === built.program_guardian.manifest_sha256;
  }
  const passed = !error && journeyCode === 0 && journey?.status === "passed" && journey.checks.length === 9
    && journey.native_tasks?.length === 8 && journey.native_tasks.every(t=>t.execution_location === "desktop") && journey.native_tasks.filter(t=>t.status === "succeeded" && t.charged_micros === "30").length === 4 && journey.native_tasks.filter(t=>t.status === "cancelled" && t.charged_micros === "0").length === 3
    && journey.native_tasks.filter(t=>t.status === "failed" && t.charged_micros === "0").length === 1
    && journey.gateway_rejections.some(r=>r.code === "AI_REQUEST_BUDGET_EXHAUSTED")
    && journey.provider_calls === 4 && journey.screenshots?.length === 5 && journey.media?.distinct_frames > 1 && journey.media.skipped_capture_errors === 0
    && journey.electron_closed && journey.browser_closed && journey.api_closed && journey.fixture_closed && journey.provider_closed
    && cleanup?.exit_code === 0 && cleanup.status === "passed" && cleanup.results.every(r=>r.reclaimed)
    && shutdown === 0 && unchanged && packagedUnchanged;
  const report = { at: new Date().toISOString(), status: passed ? "passed" : "failed", error, checks, counts: { journey_checks: journey?.checks.length ?? 0, errors: journey?.errors.length ?? 1 },
    source_files: before, source_unchanged: unchanged, packaged: built, packaged_unchanged: packagedUnchanged, owned_database_shutdown: shutdown === 0, owned_preview_closed: !preview || preview.child.exitCode !== null || preview.child.signalCode !== null,
    journey_exit_code: journeyCode, fixture_cleanup: cleanup, raw_report: { path: prefix + ".tap", sha256: sha(raw) }, verifier: { path: prefix + "-verifier.mjs", sha256: sha(verifier) },
    journey_verifier: { path: prefix + "-journey-verifier.ts", sha256: sha(journeyBytes) }, journey: journeyRaw ? { path: prefix + "-journey.json", sha256: sha(journeyRaw) } : null,
    not_validated: ["human_native_dialog_clicks", "live_model_provider", "signed_production_installer", "all_18_native_role_and_media_tools", "entire_product_acceptance"] };
  await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, error, counts: report.counts, source_unchanged: unchanged, shutdown })); assert.ok(passed, "Inspect preserved Desktop local journey evidence");
}
