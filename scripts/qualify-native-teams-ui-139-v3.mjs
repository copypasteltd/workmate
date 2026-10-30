import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createServer, createConnection } from "node:net";
import path from "node:path";
const attempt = process.argv[2]; assert.match(attempt ?? "", /^\d{2}$/);
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), desktop = path.resolve("../copypaste-desktop"), extension = path.resolve("../copypaste-extension");
const base = "evidence/native-teams-139", prefix = `${base}/ui-${attempt}`, sha = b => createHash("sha256").update(b).digest("hex");
await mkdir(base, { recursive: true });
const roots = { "copypaste-platform": platform, "copypaste-web": path.resolve("../copypaste-web"), "copypaste-admin": path.resolve("../copypaste-admin"), "copypaste-desktop": desktop, "copypaste-extension": extension };
async function snapshot(archive) {
  const files = {};
  for (const [name, root] of Object.entries(roots)) {
    const names = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", root, "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src", "renderer/src", "public", "scripts", "tests", "migrations", "contracts", "catalog", "skills", "package.json", "package-lock.json", "tsconfig.json", "renderer/tsconfig.json", "vite.config.ts", ".gitattributes"], { encoding: "utf8", maxBuffer: 16000000 }).split("\0").filter(Boolean);
    for (let offset = 0; offset < names.length; offset += 16) await Promise.all(names.slice(offset, offset + 16).map(async file => {
      const bytes = await readFile(path.join(root, file)), digest = sha(bytes), object = `${base}/objects/${digest}.blob`;
      if (archive) { await mkdir(path.dirname(object), { recursive: true }); try { await writeFile(object, bytes, { flag: "wx" }); } catch (e) { if (e.code !== "EEXIST") throw e; assert.deepEqual(await readFile(object), bytes); } }
      files[name + "/" + file] = { sha256: digest, ...(archive ? { path: object } : {}) };
    }));
  }
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b)));
}
for (const suffix of [".json", ".tap", "-sources.json", "-verifier.mjs", "-journey.json", "-journey-verifier.ts"]) await assert.rejects(readFile(prefix + suffix), e => e.code === "ENOENT");
const before = await snapshot(true); await writeFile(prefix + "-sources.json", JSON.stringify(before, null, 2) + "\n", { flag: "wx" }); await writeFile(prefix + "-verifier.mjs", await readFile(import.meta.filename), { flag: "wx" });
assert.equal(before["copypaste-desktop/.gitattributes"].sha256, "82eabadd2ae6562e1a246a3458eedde1ba913ee9837ee40f464d60e5d8f9185e");
await writeFile(prefix + "-journey-verifier.ts", await readFile("scripts/qa-native-teams-139-v2.ts"), { flag: "wx" });
process.loadEnvFile(path.join(platform, ".env"));
const port = await new Promise((resolve, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const p = server.address().port; server.close(e => e ? reject(e) : resolve(p)); }); });
const owned = path.resolve(".data/native-teams-139", randomUUID()), run = path.join(platform, ".data/test-fixture-reclamation", randomUUID()), token = randomUUID();
await mkdir(owned, { recursive: true }); await mkdir(run, { recursive: true }); await writeFile(path.join(run, "manifest.json"), JSON.stringify({ owner_pid: process.pid, token }), { flag: "wx" });
const env = { ...process.env, COPYPASTE_NATIVE_DATABASE_DIR: ".data/native-qa/" + randomUUID(), COPYPASTE_NATIVE_DATABASE_START_ONLY: "true", COPYPASTE_TEST_RECLAMATION_DIR: run, COPYPASTE_TEST_RECLAMATION_TOKEN: token,
  CHROME_BIN: path.resolve(".data/browsers/chromium-1248/chrome-win64/chrome.exe"), COPYPASTE_BUSINESS_INPUTS_OWNED: owned };
for (const name of ["OWNER_DATABASE_URL", "DATABASE_URL", "CONTROL_DATABASE_URL", "QUEUE_DATABASE_URL"]) { const url = new URL(env[name]); assert.ok(["localhost", "127.0.0.1", "::1"].includes(url.hostname)); url.port = String(port); env[name] = url.href; }
const pinned = JSON.parse(await readFile(path.join(desktop, "contracts/local-codex-runtime.json"))), binary = path.join(desktop, ".data/runtime/windows-x64/codex.exe");
assert.equal(sha(await readFile(binary)), pinned.windows_x64_sha256); env.COPYPASTE_LOCAL_CODEX_BIN = binary; env.COPYPASTE_CODEX_TEST_BIN = binary;
const log = createWriteStream(prefix + ".tap", { flags: "wx" }), commands = [], previews = [], packageFiles = {};
function launch(args, cwd = platform, extra = {}, ipc = false) {
  const child = spawn(process.execPath, args, { cwd, env: { ...env, ...extra }, windowsHide: true, stdio: ["ignore", "pipe", "pipe", ...(ipc ? ["ipc"] : [])] }); let output = "";
  child.stdout.on("data", b => { output = (output + b).slice(-20000); }); child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const closed = new Promise(resolve => { child.once("error", () => resolve(1)); child.once("close", c => resolve(c ?? 1)); }); return { child, closed, output: () => output };
}
async function command(name, args, cwd) { const code = await launch(args, cwd).closed; commands.push({ name, arguments: args, exit_code: code }); console.log(name + ": " + code); assert.equal(code, 0, name); }
const occupied = p => new Promise(resolve => { const socket = createConnection({ host: "127.0.0.1", port: p }); socket.once("connect", () => { socket.destroy(); resolve(true); }); socket.once("error", e => { socket.destroy(); resolve(e.code !== "ECONNREFUSED"); }); });
async function ready(child, probe, ms) { const end = Date.now() + ms; while (!await probe()) { assert.equal(child.child.exitCode, null, child.output()); assert.ok(Date.now() < end, "Owned process startup deadline"); await new Promise(r => setTimeout(r, 200)); } }
let database, shutdown = null, error = null, resultCode = null, journey = null, cleanup = null, reusedBuildReport = null, currentBackendQualification = null;
const packageRoot = path.join(desktop, "release/native-teams-139-02/win-unpacked");
try {
  for (const p of [4310, 4317]) assert.equal(await occupied(p), false, "Preserve existing services");
  const originalBytes=await readFile(`${base}/ui-02.json`), original=JSON.parse(originalBytes);
  assert.equal(original.commands.length,11);assert.ok(original.commands.every(c=>c.exit_code===0));
  assert.equal(original.sources_unchanged,true);assert.equal(original.package_unchanged,true);
  const originalSources=JSON.parse(await readFile(original.source_manifest.path));
  assert.equal(sha(await readFile(original.source_manifest.path)),original.source_manifest.sha256);
  const clients=files=>Object.fromEntries(Object.entries(files).filter(([k])=>!k.startsWith("copypaste-platform/")).map(([k,v])=>[k,v.sha256]));
  assert.deepEqual(clients(before),clients(originalSources));
  for(const [name,digest] of Object.entries(original.package_files))assert.equal(sha(await readFile(path.join(packageRoot,name))),digest);
  reusedBuildReport={path:`${base}/ui-02.json`,sha256:sha(originalBytes)};
  await command("current delivery compile",["node_modules/typescript/bin/tsc","--noEmit"],delivery);
  for (const name of ["CopyPaste.exe", "resources/app.asar", "resources/local-codex/codex.exe", "resources/local-codex/runtime-manifest.json"]) packageFiles[name] = sha(await readFile(path.join(packageRoot, name)));
  assert.equal(packageFiles["resources/local-codex/codex.exe"], pinned.windows_x64_sha256);
  // Build independently, then wait for the owning backend qualification to
  // finish before reusing its stopped native cluster. A failure blocks the journey.
  const backendDeadline=Date.now()+600000;
  for(;;){
    try{const b=JSON.parse(await readFile(`${base}/backend-09.json`));assert.equal(b.status,"passed","Current backend qualification");assert.equal(b.database_shutdown,0);assert.equal(b.port_closed,true);
      const exact=JSON.parse(await readFile(b.source_manifest.path));assert.deepEqual(Object.fromEntries(Object.entries(before).map(([k,v])=>[k,v.sha256])),Object.fromEntries(Object.entries(exact).map(([k,v])=>[k,v.sha256])));
      currentBackendQualification={path:`${base}/backend-09.json`,sha256:sha(await readFile(`${base}/backend-09.json`))};break;}
    catch(e){if(e.code!=="ENOENT")throw e;assert.ok(Date.now()<backendDeadline,"Backend qualification deadline");await new Promise(r=>setTimeout(r,250));}
  }
  const origin=JSON.parse(await readFile(`${base}/backend-02.json`));
  assert.equal(origin.database_shutdown,0);assert.equal(origin.port_closed,true);
  const startupLog=await readFile(origin.raw_log.path,"utf8");
  const cluster=/creating directory [^\r\n]*\/runtime\/(\.data\/native-qa\/[a-f0-9-]{36})/.exec(startupLog)?.[1];
  assert.ok(cluster,"Reuse only the stopped task-owned cluster");await readFile(path.join(platform,cluster,"PG_VERSION"));
  env.COPYPASTE_NATIVE_DATABASE_DIR=cluster;
  database = launch(["scripts/native-db-launch.mjs"], platform, {}, true); await ready(database, () => Promise.resolve(database.output().includes("Native PostgreSQL ready")), 600000);
  const preview = launch(["node_modules/vite/bin/vite.js", "preview", "--host", "127.0.0.1", "--port", "4317", "--strictPort"], roots["copypaste-web"]); previews.push(preview); await ready(preview, () => occupied(4317), 30000);
  resultCode = await launch(["--import", "tsx", "scripts/qa-native-teams-139-v2.ts", attempt], delivery, { COPYPASTE_LOCAL_DESKTOP_CANDIDATE: path.join(packageRoot, "CopyPaste.exe") }).closed;
  journey = JSON.parse(await readFile(prefix + "-journey.json"));
} catch (e) { error = String(e); }
finally {
  try { const code = await launch(["--import", "tsx", "scripts/reclaim-test-fixtures.ts"]).closed; const bytes = await readFile(path.join(run, "result.json")); await writeFile(prefix + "-fixture-cleanup.json", bytes, { flag: "wx" }); cleanup = { exit_code: code, sha256: sha(bytes), ...JSON.parse(bytes) }; } catch (e) { error ??= String(e); }
  for (const preview of previews) { if (preview.child.exitCode === null) preview.child.kill(); await preview.closed; }
  if (database?.child.connected && database.child.exitCode === null) database.child.send({ action: "shutdown" }); if (database) shutdown = await database.closed; await new Promise(r => log.end(r));
}
const after = await snapshot(false), unchanged = Object.keys(before).length === Object.keys(after).length && Object.entries(before).every(([k, v]) => after[k]?.sha256 === v.sha256), portsClosed = {};
for (const p of [port, 4310, 4317]) portsClosed[p] = !await occupied(p);
let packageUnchanged = Object.keys(packageFiles).length === 4; for (const [name, digest] of Object.entries(packageFiles)) if (sha(await readFile(path.join(packageRoot, name))) !== digest) packageUnchanged = false;
const raw = await readFile(prefix + ".tap"), passed = !error && resultCode === 0 && journey?.status === "passed" && shutdown === 0 && unchanged && Object.values(portsClosed).every(Boolean) && packageUnchanged && cleanup?.status === "passed" && cleanup.exit_code === 0;
const report = { at: new Date().toISOString(), status: passed ? "passed" : "failed", error, commands, result_exit_code: resultCode, journey: journey ? { path: prefix + "-journey.json", sha256: sha(await readFile(prefix + "-journey.json")), status: journey.status } : null,
  source_manifest: { path: prefix + "-sources.json", sha256: sha(await readFile(prefix + "-sources.json")) }, sources_unchanged: unchanged, database_shutdown: shutdown, ports_closed: portsClosed, package_directory: path.relative(delivery, packageRoot).replaceAll("\\", "/"), package_files: packageFiles, package_unchanged: packageUnchanged,
  fixture_cleanup: cleanup, reused_build_report: reusedBuildReport, current_backend_qualification: currentBackendQualification, raw_log: { path: prefix + ".tap", sha256: sha(raw) }, verifier: { path: prefix + "-verifier.mjs", sha256: sha(await readFile(import.meta.filename)) }, model_mode: "Synthetic business data and scripted tool calls in UI journeys; the packaged Desktop executes actual local Codex against a controlled OpenAI-compatible company gateway fixture." };
await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" }); console.log(JSON.stringify({ status: report.status, report: prefix + ".json", error })); process.exitCode = passed ? 0 : 1;
