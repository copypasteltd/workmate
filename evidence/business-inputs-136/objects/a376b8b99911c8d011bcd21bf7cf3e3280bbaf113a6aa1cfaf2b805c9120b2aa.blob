import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { createServer, createConnection } from "node:net";
import path from "node:path";

const attempt = process.argv[2]; assert.match(attempt ?? "", /^\d{2}$/); assert.equal(process.argv.length, 3);
const delivery = process.cwd(), desktop = path.resolve("../copypaste-desktop-publication-125"), platform = path.resolve("../copypaste-platform-publication-125"), web = path.resolve("../copypaste-web");
const prefix = path.resolve("evidence/startup-recovery-128/desktop-" + attempt), sha = bytes => createHash("sha256").update(bytes).digest("hex");
await mkdir(path.dirname(prefix), { recursive: true });
for (const suffix of [".json", ".tap", "-journey.json", "-verifier.mjs", "-journey-verifier.mjs"])
  await assert.rejects(readFile(prefix + suffix), error => error.code === "ENOENT");
const occupied = port => new Promise(resolve => { const socket = createConnection({ host: "127.0.0.1", port }); socket.once("connect", () => { socket.destroy(); resolve(true); }); socket.once("error", () => resolve(false)); });
for (const port of [4310, 4317]) assert.equal(await occupied(port), false, "Preserve existing services");
process.loadEnvFile(path.join(platform, ".env"));
const binary = path.resolve("../copypaste-desktop/.data/runtime/windows-x64/codex.exe"), pin = JSON.parse(await readFile(path.join(desktop, "contracts/local-codex-runtime.json"), "utf8"));
assert.equal(sha(await readFile(binary)), pin.windows_x64_sha256);
const logicReceipts = {};
// Native/controller execution sources are unchanged. Current compilation and
// actual packaged UI qualify the presentation fix; SQL qualifies its fixture.
const allowedDifferences = [{
  repository: "copypaste-desktop",
  path: "renderer/src/local-agent.tsx",
  native_sha256: "87469d32f97ad1f60ecae09146c3e608c4a04226a9773576409c217ea369a80c",
  current_sha256: "2306a7695fe2f5f4eb654af9c40482fd27470bf49b9dde3ab6f589f5c3303648",
  reason: "Renderer-only presentation removes a duplicated answer and maps stopped/expired local permission; current compilation and packaged UI qualify it",
}, {
  repository: "copypaste-platform",
  path: "tests/desktop-startup-recovery.test.ts",
  native_sha256: "79b46d5a6c0ca9c2b1d5d057dcd2f4122c09152018f62b5f5fe7d65530d1ef1c",
  current_sha256: "1512cf992499f8f8c25490dc9847cf32be93b78c00a84b0d6994d3629c12cf0e",
  reason: "SQL-only test adds explicit unscoped denial and owner-scoped state-guard assertion; no product source changed",
}];
const logicSourceDifferences = [];
for (const [label, file] of [
  ['controller', path.join(desktop, '.data/startup-recovery-128/probe-12.json')],
  ['native', path.join(desktop, '.data/startup-recovery-128/probe-13.json')],
  ['sql', path.join(platform, '.data/startup-recovery-128/backend-07.json')],
  ['types', path.join(desktop, '.data/startup-recovery-128/probe-15.json')],
]) {
  const bytes = await readFile(file), row = JSON.parse(bytes);
  assert.equal(row.status, 'passed'); assert.equal(row.source_unchanged, true);
  if (label === 'types') { assert.equal(row.mode, 'types'); assert.equal(row.commands.length, 3); assert.ok(row.commands.every(command => command.code === 0)); }
  if (label === 'sql') {
    assert.equal(row.owned_database_shutdown, true); assert.equal(row.owned_database_port_closed, true);
    for (const [name, expected] of Object.entries(row.source_files)) assert.equal(sha(await readFile(path.join(platform, name.slice('copypaste-platform/'.length)))), expected, name);
  } else {
    assert.equal(row.original_fixture_set_restored, true);
    for (const [repository, cwd] of Object.entries({ desktop, backend: platform }))
      for (const [name, expected] of Object.entries(row.source_files[repository])) {
        const actual = sha(await readFile(path.join(cwd, name)));
        if (actual === expected) continue;
        assert.ok(["controller", "native"].includes(label));
        const component = repository === "backend" ? "copypaste-platform" : "copypaste-desktop";
        const difference = allowedDifferences.find(row => row.repository === component && row.path === name);
        assert.ok(difference, name); assert.equal(expected, difference.native_sha256); assert.equal(actual, difference.current_sha256);
        logicSourceDifferences.push({ qualification: label, ...difference });
      }
  }
  logicReceipts[label] = { path: path.relative(delivery, file).replaceAll('\\', '/'), sha256: sha(bytes), counts: row.counts };
}
assert.deepEqual(logicSourceDifferences.map(row => row.qualification), ["controller", "controller", "native", "native"]);
assert.equal(logicReceipts.types.counts, null);
const roots = { "copypaste-desktop": desktop, "copypaste-platform": platform, "copypaste-web": web, "copypaste-delivery": delivery };
async function sources() {
  const values = {};
  for (const [label, repo] of Object.entries(roots)) {
    const selected = label === "copypaste-delivery" ? ["scripts/run-desktop-recovery-v4.mjs", "scripts/qa-desktop-recovery-v4.mjs", "scripts/record-workmate-media.ts"]
      : ["src", "renderer", "tests", "scripts", "catalog", "migrations", "contracts", "skills", "public", "assets", ":(exclude)assets/screenshots/**", "deployment.json", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts"];
    const files = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...selected], { cwd: repo, windowsHide: true, encoding: "utf8" }).split("\0").filter(Boolean);
    for (const name of [...new Set(files)].sort()) values[label + "/" + name] = sha(await readFile(path.join(repo, name)));
  }
  return values;
}
const before = await sources();
const previousPackageFile = path.resolve('evidence/startup-recovery-128/desktop-02.json');
const previousPackageBytes = await readFile(previousPackageFile), previousPackage = JSON.parse(previousPackageBytes);
assert.equal(previousPackage.source_unchanged, true); assert.equal(previousPackage.package_unchanged, true);
assert.equal(previousPackage.commands.length, 10); assert.ok(previousPackage.commands.every(command => command.exit_code === 0));
for (const component of ['copypaste-desktop/', 'copypaste-platform/', 'copypaste-web/']) {
  const subset = values => Object.fromEntries(Object.entries(values).filter(([name]) => name.startsWith(component) && name !== 'copypaste-desktop/renderer/src/local-agent.tsx'));
  assert.deepEqual(subset(before), subset(previousPackage.source_files), component);
}
const rendererChange = { path: 'copypaste-desktop/renderer/src/local-agent.tsx', previous_sha256: '6110444ebb24607726bcdb6244b358f2878170e849f9021e20a360cbebff01ba', current_sha256: '2306a7695fe2f5f4eb654af9c40482fd27470bf49b9dde3ab6f589f5c3303648' };
assert.equal(previousPackage.source_files[rendererChange.path], rendererChange.previous_sha256); assert.equal(before[rendererChange.path], rendererChange.current_sha256);
const packageOrigin = { kind: 'renderer_rebuild', attempt: '02', previous_report: path.relative(delivery, previousPackageFile).replaceAll('\\', '/'), sha256: sha(previousPackageBytes), renderer_change: rendererChange, reason: 'Rebuild renderer and a fresh unsigned package; other product sources remain identical to the prior compiled package' };
for (const [name, expected] of Object.entries(before)) {
  const split = name.indexOf("/"), bytes = await readFile(path.join(roots[name.slice(0, split)], name.slice(split + 1))); assert.equal(sha(bytes), expected);
  const target = path.resolve(prefix + "-sources", name); assert.ok(target.startsWith(prefix + "-sources" + path.sep));
  await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: "wx" });
}
await writeFile(prefix + "-verifier.mjs", await readFile(import.meta.filename), { flag: "wx" });
await writeFile(prefix + "-journey-verifier.mjs", await readFile("scripts/qa-desktop-recovery-v4.mjs"), { flag: "wx" });
const databasePort = await new Promise((resolve, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const port = server.address().port; server.close(error => error ? reject(error) : resolve(port)); }); });
const databaseEnv = { COPYPASTE_NATIVE_DATABASE_DIR: ".data/native-qa/" + randomUUID() };
for (const name of ["OWNER_DATABASE_URL", "DATABASE_URL", "CONTROL_DATABASE_URL", "QUEUE_DATABASE_URL"]) { const url = new URL(process.env[name]); url.port = String(databasePort); databaseEnv[name] = url.href; }
const run = path.join(platform, ".data/test-fixture-reclamation", randomUUID()), token = randomUUID();
await mkdir(run, { recursive: true }); await writeFile(path.join(run, "manifest.json"), JSON.stringify({ owner_pid: process.pid, token }), { flag: "wx" });
const log = createWriteStream(prefix + ".tap", { flags: "wx" }), commands = [], packageFiles = {};
function launch(args, cwd, env = {}, ipc = false) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...databaseEnv, COPYPASTE_LOCAL_CODEX_BIN: binary, ...env }, windowsHide: true, stdio: ipc ? ["ignore", "pipe", "pipe", "ipc"] : ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const closed = new Promise(resolve => { child.once("error", () => resolve(1)); child.once("close", code => resolve(code ?? 1)); }); return { child, closed };
}
const packageRoot = path.join(desktop, "release/startup-recovery-128-" + attempt + "/win-unpacked");
let database, preview, error, journey, journeyCode, cleanup, shutdown;
try {
  for (const [name, args, cwd] of [
    ["build Desktop renderer", ["node_modules/vite/bin/vite.js", "build", "--config", "vite.config.ts"], desktop],
    ["package unsigned Desktop", ["node_modules/electron-builder/out/cli/cli.js", "--win", "--dir", "--config.directories.output=release/startup-recovery-128-" + attempt], desktop],
    ["build web sign-in", ["node_modules/vite/bin/vite.js", "build"], web],
  ]) { const code = await launch(args, cwd).closed; commands.push({ name, exit_code: code }); assert.equal(code, 0, name); }
  for (const name of ["CopyPaste.exe", "resources/app.asar", "resources/local-codex/codex.exe", "resources/local-codex/runtime-manifest.json"]) packageFiles[name] = sha(await readFile(path.join(packageRoot, name)));
  for (const name of ["resources/local-codex/codex.exe", "resources/local-codex/runtime-manifest.json"]) assert.equal(packageFiles[name], previousPackage.package_files[name]);
  assert.equal(packageFiles["resources/local-codex/codex.exe"], pin.windows_x64_sha256);
  const asar = createRequire(path.join(desktop, "package.json"))("@electron/asar");
  const previousArchive = path.join(desktop, "release/startup-recovery-128-02/win-unpacked/resources/app.asar");
  assert.equal(sha(await readFile(previousArchive)), previousPackage.package_files["resources/app.asar"]);
  for (const name of ["dist/main.js", "dist/local-agent.js", "dist/local-codex.js", "dist/local-startup.js"]) {
    const compiled = sha(await readFile(path.join(desktop, name)));
    assert.equal(sha(asar.extractFile(previousArchive, path.normalize(name))), compiled, name + ' unchanged compiled main');
    assert.equal(sha(asar.extractFile(path.join(packageRoot, "resources/app.asar"), path.normalize(name))), compiled, name);
  }
  database = launch(["scripts/native-db-launch.mjs"], platform, {}, true); let output = "";
  database.child.stdout.on("data", bytes => { output = (output + bytes).slice(-16000); });
  await until(() => output, value => value.includes("Native PostgreSQL ready"), "owned native database", 900000, database);
  preview = launch(["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4317", "--strictPort"], web);
  await until(() => occupied(4317), Boolean, "sign-in preview", 40000, preview);
  const env = { COPYPASTE_TEST_RECLAMATION_DIR: run, COPYPASTE_TEST_RECLAMATION_TOKEN: token, CHROME_BIN: path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe"), COPYPASTE_LOCAL_DESKTOP_CANDIDATE: path.join(packageRoot, "CopyPaste.exe") };
  const action = launch(["--import", "tsx", "scripts/qa-desktop-recovery-v4.mjs", attempt], delivery, env);
  const timeout = setTimeout(() => { if (action.child.exitCode === null && action.child.pid) try { execFileSync("taskkill.exe", ["/PID", String(action.child.pid), "/T", "/F"], { windowsHide: true, timeout: 15000, stdio: "ignore" }); } catch {} }, 900000);
  try { journeyCode = await action.closed; } finally { clearTimeout(timeout); }
  const code = await launch(["--import", "tsx", "scripts/reclaim-test-fixtures.ts"], platform, env).closed;
  const bytes = await readFile(path.join(run, "result.json")); await writeFile(prefix + "-fixture-cleanup.json", bytes, { flag: "wx" }); cleanup = { ...JSON.parse(bytes), exit_code: code, sha256: sha(bytes) };
  journey = JSON.parse(await readFile(prefix + "-journey.json"));
} catch (failure) { error = String(failure); }
finally {
  if (preview) { if (preview.child.exitCode === null) preview.child.kill(); await preview.closed; }
  if (database?.child.connected && database.child.exitCode === null) database.child.send({ action: "shutdown" });
  if (database) shutdown = await database.closed;
  await new Promise(resolve => log.end(resolve));
  const portsClosed = {}; for (const port of [databasePort, 4310, 4317]) portsClosed[port] = !(await occupied(port));
  const unchanged = JSON.stringify(before) === JSON.stringify(await sources()), raw = await readFile(prefix + ".tap");
  let packageUnchanged = Object.keys(packageFiles).length === 4;
  for (const [name, expected] of Object.entries(packageFiles)) if (sha(await readFile(path.join(packageRoot, name))) !== expected) packageUnchanged = false;
  const passed = !error && journeyCode === 0 && journey?.status === "passed" && journey.checks.length === 6 && journey.errors.length === 0 && journey.recordings.length === 2 && journey.screenshots.length === 3
    && journey.recordings.every(row => row.distinct_frames > 1 && row.skipped_capture_errors === 0) && journey.layouts.length === 3
    && journey.browser_closed && journey.desktop_closed && journey.api_closed && journey.fixture_closed && journey.provider_closed
    && cleanup?.status === "passed" && cleanup.exit_code === 0 && cleanup.actual_filesystem_checked && cleanup.results.every(row => row.reclaimed)
    && shutdown === 0 && Object.values(portsClosed).every(Boolean) && unchanged && packageUnchanged;
  const report = { at: new Date().toISOString(), status: passed ? "passed" : "failed", error, commands, journey_exit_code: journeyCode, source_files: before, source_unchanged: unchanged,
    package_files: packageFiles, package_unchanged: packageUnchanged, package_origin: packageOrigin, package_directory: path.relative(delivery, packageRoot).replaceAll('\\', '/'), logic_receipts: logicReceipts, logic_source_differences: logicSourceDifferences, native_codex: pin, fixture_cleanup: cleanup,
    owned_database_shutdown: shutdown === 0, owned_database_port_closed: portsClosed[databasePort], owned_native_port: databasePort, owned_native_directory: databaseEnv.COPYPASTE_NATIVE_DATABASE_DIR, ports_closed: portsClosed,
    raw_report_sha256: sha(raw), verifier_sha256: sha(await readFile(import.meta.filename)), journey_verifier_sha256: sha(await readFile("scripts/qa-desktop-recovery-v4.mjs")),
    limits: ["Unsigned Windows package; synthetic provider and local dialog decisions", "One bounded pre-turn recovery only; no full crash or professional-role acceptance"] };
  await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, source_unchanged: unchanged, package_unchanged: packageUnchanged, error, journey_checks: journey?.checks.length ?? 0 })); process.exitCode = passed ? 0 : 1;
}
async function until(read, ok, name, duration, child) {
  const deadline = Date.now() + duration;
  while (!ok(await read())) { assert.equal(child.child.exitCode, null, name + " exited"); assert.ok(Date.now() < deadline, name + " deadline"); await new Promise(resolve => setTimeout(resolve, 200)); }
}
