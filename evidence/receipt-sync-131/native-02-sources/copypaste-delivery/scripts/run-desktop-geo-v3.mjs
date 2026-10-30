import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import path from "node:path";
import { parseCompleteTap, requirePassingCounts } from "./platform-qualification-state.mjs";

const attempt = process.argv[2], scope = process.argv[3];
assert.match(attempt ?? "", /^\d{2}$/); assert.ok(["focused", "core", "native", "clients"].includes(scope)); assert.equal(process.argv.length, 4);
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), desktop = path.resolve("../copypaste-desktop"), prefix = "evidence/desktop-geo-" + scope + "-" + attempt;
const hash = b => createHash("sha256").update(b).digest("hex");
const binary = path.join(desktop, ".data/runtime/windows-x64/codex.exe"), pin = JSON.parse(await readFile(path.join(desktop, "contracts/local-codex-runtime.json"), "utf8"));
assert.equal(hash(await readFile(binary)), pin.windows_x64_sha256);
for (const suffix of [".json", "-verifier.mjs"]) await assert.rejects(readFile(prefix + suffix), e => e.code === "ENOENT");
async function snapshot() {
  const sources = {};
  for (const component of ["platform", "desktop", "web", "admin", "extension", "delivery"]) {
    const repo = path.resolve("..", "copypaste-" + component);
    const names = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src", "renderer", "renderer-source.json", "tests", "scripts", "migrations", "catalog", "contracts", "skills", "public", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts"], { cwd: repo, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
    for (const name of [...new Set(names)].sort()) sources["copypaste-" + component + "/" + name] = hash(await readFile(path.join(repo, name)));
  }
  return Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)));
}
const before = await snapshot();
for (const [name, expected] of Object.entries(before)) {
  const bytes = await readFile(path.resolve("..", name)); assert.equal(hash(bytes), expected);
  const dest = prefix + "-sources/" + name; await mkdir(path.dirname(dest), { recursive: true }); await writeFile(dest, bytes, { flag: "wx" });
}
await writeFile(prefix + "-verifier.mjs", await readFile(import.meta.filename), { flag: "wx" });
const checks = []; let database, databaseOutput = "", error = null, shutdown = null;
function launch(args, cwd, extra = {}) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, COPYPASTE_LOCAL_CODEX_BIN: binary, COPYPASTE_LOCAL_CODEX_TEST_BIN: binary, CODEX_BIN: binary, CODEX_VERSION: pin.runtime_version, ...extra }, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  let output = ""; child.stdout.on("data", b => { output += b.toString(); }); child.stderr.on("data", b => { output += b.toString(); });
  const closed = new Promise(resolve => { child.once("close", code => resolve(code ?? 1)); child.once("error", e => { output += String(e); resolve(1); }); });
  return { child, closed, output: () => output };
}
async function check(name, args, cwd, tap = false) {
  console.log("Running " + name); const job = launch(args, cwd), code = await job.closed, raw = job.output(), file = prefix + "-" + name + (tap ? ".tap" : ".log");
  await writeFile(file, raw, { flag: "wx" }); const row = { name, cwd: path.basename(cwd), args, exit_code: code, raw_report: { path: file, sha256: hash(Buffer.from(raw)) } }; checks.push(row);
  if (tap) { row.counts = parseCompleteTap(raw); requirePassingCounts(row.counts); }
  assert.equal(code, 0, name + ": " + raw.slice(-5000));
}
try {
  await check("platform-typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"], platform);
  await check("desktop-typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"], desktop);
  await check("renderer-typecheck", ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "renderer/tsconfig.json"], desktop);
  if (["focused", "core"].includes(scope)) {
    const occupied = await new Promise(resolve => { const sock = createConnection({ host: "127.0.0.1", port: 55432 }); sock.once("connect", () => { sock.destroy(); resolve(true); }); sock.once("error", () => resolve(false)); });
    assert.equal(occupied, false, "Do not adopt an existing database");
    database = launch(["scripts/native-db-launch.mjs"], platform, { COPYPASTE_NATIVE_DATABASE_START_ONLY: "true" });
    const deadline = Date.now() + 900000;
    while (!database.output().includes("Native PostgreSQL ready")) { assert.equal(database.child.exitCode, null); assert.ok(Date.now() < deadline); await new Promise(r => setTimeout(r, 200)); }
    const files = scope === "focused" ? ["desktop-geo", "geo-model", "geo-observations"] : ["desktop-geo", "geo-model", "geo-observations", "desktop-executions", "desktop-workflows", "project-configuration", "internal-ai-gateway", "migrations", "task-history-sources"];
    await check("backend", ["--env-file=.env", "scripts/run-tests-owned.mjs", ...files.map(n => "tests/" + n + ".test.ts")], platform, true);
  }
  if (["native", "core"].includes(scope)) {
    await check("desktop-unit", ["--import", "tsx", "--test", "tests/local-geo.test.ts", "tests/local-agent.test.ts"], desktop, true);
    await check("native-codex", ["--import", "tsx", "--test", "--test-concurrency=1", "tests/integration/local-geo.native.test.ts", ...(scope === "core" ? ["tests/integration/local-codex.native.test.ts"] : [])], desktop, true);
  }
  if (scope === "clients") {
    for (const component of ["web", "admin", "extension"]) {
      const repo = path.resolve("..", "copypaste-" + component);
      await check(component + "-typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"], repo);
      await check(component + "-build", component === "extension" ? ["scripts/build.mjs"] : ["node_modules/vite/bin/vite.js", "build"], repo);
    }
    await check("desktop-build", ["node_modules/typescript/bin/tsc"], desktop);
    await check("desktop-renderer-build", ["node_modules/vite/bin/vite.js", "build", "--config", "vite.config.ts"], desktop);
  }
} catch (e) { error = String(e); }
finally {
  if (database?.child.connected && database.child.exitCode === null) database.child.send({ action: "shutdown" });
  if (database) { shutdown = await database.closed; databaseOutput = database.output(); await writeFile(prefix + "-database.log", databaseOutput, { flag: "wx" }); }
  const unchanged = JSON.stringify(before) === JSON.stringify(await snapshot());
  const passed = !error && unchanged && (!database || shutdown === 0);
  const report = { at: new Date().toISOString(), status: passed ? "passed" : "failed", scope, checks, error, owned_database_shutdown: !database || shutdown === 0,
    source_unchanged: unchanged, source_files: before, native_codex: { version: pin.runtime_version, sha256: pin.windows_x64_sha256, path: binary },
    verifier_sha256: hash(await readFile(import.meta.filename)), limitations: ["Synthetic model answers and accounts", "Affected functionality only; no full-product or live-model acceptance"] };
  await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, checks: checks.map(c => ({ name: c.name, exit: c.exit_code, counts: c.counts })), error, source_unchanged: unchanged, owned_database_shutdown: report.owned_database_shutdown }));
  assert.ok(passed, "Preserve this attempt and use a new attempt after repairing its cause");
}
