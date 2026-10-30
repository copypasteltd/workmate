import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createServer, createConnection } from "node:net";
import path from "node:path";
const attempt = process.argv[2]; assert.match(attempt ?? "", /^\d{2}$/);
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), desktop = path.resolve("../copypaste-desktop"), extension = path.resolve("../copypaste-extension");
const base = "evidence/delivery-package-137", prefix = `${base}/backend-${attempt}`, sha = b => createHash("sha256").update(b).digest("hex");
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
for (const suffix of [".json", ".tap", "-sources.json", "-verifier.mjs"]) await assert.rejects(readFile(prefix + suffix), e => e.code === "ENOENT");
const before = await snapshot(true); await writeFile(prefix + "-sources.json", JSON.stringify(before, null, 2) + "\n", { flag: "wx" }); await writeFile(prefix + "-verifier.mjs", await readFile(import.meta.filename), { flag: "wx" });
assert.equal(before["copypaste-desktop/.gitattributes"].sha256, "82eabadd2ae6562e1a246a3458eedde1ba913ee9837ee40f464d60e5d8f9185e");
process.loadEnvFile(path.join(platform, ".env"));
const port = await new Promise((resolve, reject) => { const server = createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const p = server.address().port; server.close(e => e ? reject(e) : resolve(p)); }); });
const env = { ...process.env, COPYPASTE_NATIVE_DATABASE_DIR: ".data/native-qa/" + randomUUID(), COPYPASTE_NATIVE_DATABASE_START_ONLY: "true" };
for (const name of ["OWNER_DATABASE_URL", "DATABASE_URL", "CONTROL_DATABASE_URL", "QUEUE_DATABASE_URL"]) { const url = new URL(env[name]); assert.ok(["localhost", "127.0.0.1", "::1"].includes(url.hostname)); url.port = String(port); env[name] = url.href; }
const pinned = JSON.parse(await readFile(path.join(desktop, "contracts/local-codex-runtime.json"))), binary = path.join(desktop, ".data/runtime/windows-x64/codex.exe");
assert.equal(sha(await readFile(binary)), pinned.windows_x64_sha256); env.COPYPASTE_LOCAL_CODEX_BIN = binary; env.COPYPASTE_CODEX_TEST_BIN = binary;
const log = createWriteStream(prefix + ".tap", { flags: "wx" }), commands = [];
function launch(args, cwd = platform, ipc = false) {
  const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe", ...(ipc ? ["ipc"] : [])] }); let output = "";
  child.stdout.on("data", b => { output = (output + b).slice(-24000); }); child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const closed = new Promise(resolve => { child.once("error", () => resolve(1)); child.once("close", c => resolve(c ?? 1)); }); return { child, closed, output: () => output };
}
async function command(name, args, cwd) { const code = await launch(args, cwd).closed; commands.push({ name, arguments: args, exit_code: code }); console.log(name + ": " + code); assert.equal(code, 0, name); }
const occupied = () => new Promise(resolve => { const socket = createConnection({ host: "127.0.0.1", port }); socket.once("connect", () => { socket.destroy(); resolve(true); }); socket.once("error", e => { socket.destroy(); resolve(e.code !== "ECONNREFUSED"); }); });
let database, shutdown = null, error = null;
try {
  await command("backend compile", ["node_modules/typescript/bin/tsc", "--noEmit"], platform);
  await command("backend build", ["node_modules/typescript/bin/tsc"], platform);
  await command("backend cloud bootstrap", ["scripts/copy-cloud-check-bootstrap.mjs"], platform);
  database = launch(["scripts/native-db-launch.mjs"], platform, true);
  const deadline = Date.now() + 600000; while (!database.output().includes("Native PostgreSQL ready")) { assert.equal(database.child.exitCode, null, database.output()); assert.ok(Date.now() < deadline, "Owned native PostgreSQL startup"); await new Promise(r => setTimeout(r, 200)); }
  await command("delivery package and review/source regressions", ["scripts/run-tests-owned.mjs", "tests/delivery-package-137-v1.test.ts", "tests/business-quality.test.ts", "tests/task-source-visibility.test.ts", "tests/task-history-sources.test.ts"], platform);
  await command("extension compiler", ["node_modules/typescript/bin/tsc", "--noEmit"], extension);
  await command("extension existing state and upload regressions", ["--import", "tsx", "--test", "tests/delivery-download-137-v1.test.ts", "tests/conversation.test.ts", "tests/native-session.test.ts"], extension);
  for (const name of ["copypaste-web", "copypaste-desktop"]) await command(name + " renderer compiler", ["node_modules/typescript/bin/tsc", "--noEmit", ...(name.endsWith("desktop") ? ["-p", "renderer/tsconfig.json"] : [])], roots[name]);
} catch (e) { error = String(e); }
finally { if (database?.child.connected && database.child.exitCode === null) database.child.send({ action: "shutdown" }); if (database) shutdown = await database.closed; await new Promise(r => log.end(r)); }
const after = await snapshot(false), unchanged = Object.keys(before).length === Object.keys(after).length && Object.entries(before).every(([k, v]) => after[k]?.sha256 === v.sha256), portClosed = !await occupied();
const raw = await readFile(prefix + ".tap"), passed = !error && shutdown === 0 && unchanged && portClosed;
const report = { at: new Date().toISOString(), status: passed ? "passed" : "failed", error, commands, source_manifest: { path: prefix + "-sources.json", sha256: sha(await readFile(prefix + "-sources.json")) }, sources_unchanged: unchanged, database_shutdown: shutdown, port_closed: portClosed, raw_log: { path: prefix + ".tap", sha256: sha(raw) }, verifier: { path: prefix + "-verifier.mjs", sha256: sha(await readFile(import.meta.filename)) }, model_mode: "Controlled Codex runtime adapter with explicit synthetic task results. Real HTTP, permissions, native PostgreSQL, stored files and ZIP extraction. No paid model calls." };
await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" }); console.log(JSON.stringify({ status: report.status, report: prefix + ".json", error })); process.exitCode = passed ? 0 : 1;
