import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createConnection } from "node:net";
import path from "node:path";
import { parseCompleteTap, requirePassingCounts } from "./platform-qualification-state.mjs";

const attempt = process.argv[2], phase = process.argv[3] ?? "core";
assert.match(attempt ?? "", /^\d{2}$/); assert.ok(["core", "compatibility"].includes(phase)); assert.ok(process.argv.length <= 4);
const delivery = process.cwd(), platform = path.resolve("../copypaste-platform"), prefix = "evidence/geo-observation-checks-" + attempt;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
const binary = process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN;
assert.ok(binary && path.isAbsolute(binary));
const pin = JSON.parse(await readFile("../copypaste-desktop/contracts/local-codex-runtime.json", "utf8"));
assert.equal(sha(await readFile(binary)), pin.windows_x64_sha256);
await assert.rejects(readFile(prefix + ".json"), e => e.code === "ENOENT");
const files = phase === "core" ? ["tests/geo-model.test.ts", "tests/geo-observations.test.ts"] : ["tests/creative-feedback.test.ts", "tests/task-history-sources.test.ts", "tests/migrations.test.ts"];
async function snapshot() {
  const result = {};
  for (const name of ["copypaste-platform", "copypaste-admin", "copypaste-web", "copypaste-desktop", "copypaste-extension", "copypaste-delivery"]) {
    const repo = path.resolve("..", name);
    const names = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--",
      "src", "renderer", "renderer-source.json", "tests", "scripts", "migrations", "catalog", "contracts", "skills", "public", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts"], { cwd: repo, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
    for (const file of [...new Set(names)].sort()) result[name + "/" + file] = sha(await readFile(path.join(repo, file)));
  }
  result["docs/requirements/01-srs.md"] = sha(await readFile("../../docs/requirements/01-srs.md"));
  return result;
}
assert.equal(await new Promise(resolve => {
  const socket = createConnection({ host: "127.0.0.1", port: 55432 });
  socket.once("connect", () => { socket.destroy(); resolve(true); }); socket.once("error", () => resolve(false));
}), false, "Never adopt an occupied native database");
const sources = await snapshot(), verifier = await readFile(import.meta.filename);
await writeFile(prefix + "-verifier.mjs", verifier, { flag: "wx" });
const log = createWriteStream(prefix + ".tap", { flags: "wx" }), checks = [];
function launch(args, cwd, environment = {}) {
  const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...environment }, windowsHide: true, stdio: ["ignore", "pipe", "pipe", "ipc"] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const closed = new Promise(resolve => { child.once("close", code => resolve(code ?? 1)); child.once("error", () => resolve(1)); });
  return { child, closed };
}
let database, shutdown = null, testExit = null, error = null, counts = null;
try {
  for (const [name, cwd] of [["platform", platform], ["admin", path.resolve("../copypaste-admin")]]) {
    const code = await launch(["node_modules/typescript/bin/tsc", "--noEmit"], cwd).closed;
    checks.push({ name: name + " typecheck", exit_code: code }); assert.equal(code, 0, name);
  }
  const build = await launch(["node_modules/typescript/bin/tsc"], platform).closed;
  checks.push({ name: "platform build", exit_code: build }); assert.equal(build, 0);
  database = launch(["scripts/native-db-launch.mjs"], platform, { COPYPASTE_NATIVE_DATABASE_START_ONLY: "true" });
  let output = ""; database.child.stdout.on("data", bytes => { output = (output + bytes.toString()).slice(-16000); });
  const deadline = Date.now() + 900000;
  while (!output.includes("Native PostgreSQL ready")) { assert.equal(database.child.exitCode, null); assert.ok(Date.now() < deadline); await new Promise(resolve => setTimeout(resolve, 200)); }
  console.log("Owned native PostgreSQL ready; running GEO observation " + phase + " verification");
  testExit = await launch(["--env-file=.env", "scripts/run-tests-owned.mjs", ...files], platform).closed;
  assert.equal(testExit, 0);
} catch (e) { error = String(e); }
finally {
  if (database?.child.connected && database.child.exitCode === null) database.child.send({ action: "shutdown" });
  if (database) shutdown = await database.closed;
  await new Promise(resolve => log.end(resolve));
  const raw = await readFile(prefix + ".tap");
  try { counts = parseCompleteTap(raw.toString()); requirePassingCounts(counts); } catch (e) { error ??= String(e); }
  const unchanged = JSON.stringify(sources) === JSON.stringify(await snapshot());
  const passed = !error && testExit === 0 && shutdown === 0 && unchanged && raw.toString().includes("# owned_fixture_cleanup");
  const report = { at: new Date().toISOString(), status: passed ? "passed" : "failed", phase, files, counts, error, checks,
    test_exit_code: testExit, owned_database_shutdown: shutdown === 0, source_unchanged: unchanged, source_files: sources,
    native_binary: { path: binary, sha256: pin.windows_x64_sha256, version: pin.runtime_version },
    raw_report: { path: prefix + ".tap", sha256: sha(raw) }, verifier: { path: prefix + "-verifier.mjs", sha256: sha(verifier) },
    limitations: ["synthetic company gateway only", "not full platform regression", "no professional or production acceptance", "browser UI not covered by this receipt"] };
  await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify({ status: report.status, phase, counts, source_unchanged: unchanged, owned_database_shutdown: shutdown === 0, error }));
  assert.ok(passed, "Retain failed evidence; use a new attempt after correcting its cause");
}
