import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, mkdir, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

// Executed versions and their raw receipts are immutable. Fix this runner by
// adding a new version; use a fresh attempt for a changed product source.
const [scope, attempt] = process.argv.slice(2);
assert.ok(["platform", "desktop", "web"].includes(scope)); assert.match(attempt ?? "", /^\d{2}$/);
assert.equal(process.argv.length, 4);
const root = path.resolve(import.meta.dirname, "../../.."), platform = path.join(root, "dev/copypaste-platform-runtime-122");
assert.equal(path.basename(platform), "copypaste-platform-runtime-122");
const desktop = path.join(root, "dev/copypaste-desktop-runtime-122"), web = path.join(root, "dev/copypaste-web-runtime-122");
const output = path.join(root, "dev/copypaste-delivery/.data/runtime-startup-122", scope + "-" + attempt);
await mkdir(path.dirname(output), { recursive: true }); await mkdir(output);
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const startedAt = new Date().toISOString(), verifier = await readFile(import.meta.filename);
await writeFile(path.join(output, "verifier.mjs"), verifier, { flag: "wx" });
const repos = scope === "platform" ? [platform] : scope === "web" ? [web] : [platform, desktop, path.join(root, "dev/copypaste-platform")];
const paths = ["src", "tests", "scripts", "migrations", "catalog", "contracts", "skills", "renderer", "public", "assets/fonts",
  "package.json", "package-lock.json", "tsconfig.json", "renderer-source.json", "vite.config.ts"];
async function snapshot(copy) {
  const rows = {};
  for (const repo of repos) {
    const names = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false",
      "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", ...paths],
      { cwd: repo, encoding: "utf8", windowsHide: true, maxBuffer: 16000000 }).split("\0").filter(Boolean);
    for (const name of [...new Set(names)].sort()) {
      const key = path.basename(repo) + "/" + name, bytes = await readFile(path.join(repo, name));
      rows[key] = hash(bytes);
      if (copy) {
        const target = path.resolve(output, "sources", key);
        assert.ok(target.startsWith(path.resolve(output, "sources") + path.sep));
        await mkdir(path.dirname(target), { recursive: true });
        await writeFile(target, bytes, { flag: "wx" });
      }
    }
  }
  return rows;
}
const pinPath = path.join(root, "dev/copypaste-desktop/contracts/local-codex-runtime.json");
const pin = JSON.parse(await readFile(pinPath, "utf8"));
const binary = await realpath(path.join(root, "dev/copypaste-desktop/.data/runtime/windows-x64/codex.exe"));
const binaryHash = hash(await readFile(binary)); assert.equal(binaryHash, pin.windows_x64_sha256);
const before = await snapshot(true), steps = [];
await writeFile(path.join(output, "source-bindings.json"), JSON.stringify(before, null, 2) + "\n", { flag: "wx" });
const env = { ...process.env, CODEX_BIN: binary, CODEX_VERSION: pin.runtime_version,
  COPYPASTE_LOCAL_CODEX_TEST_BIN: binary, COPYPASTE_RUNTIME_STARTUP_TEST_BIN: binary,
  COPYPASTE_RUNTIME_STARTUP_TEST_SHA256: binaryHash, COPYPASTE_RUNTIME_STARTUP_TEST_VERSION: pin.runtime_version };
async function run(name, cwd, args, tests = false) {
  console.log("Starting " + scope + ": " + name);
  const logPath = path.join(output, name + ".tap"), log = createWriteStream(logPath, { flags: "wx" });
  const child = spawn(process.execPath, args, { cwd, env, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
  child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const start = Date.now(); let launchError;
  const code = await new Promise(resolve => { child.once("close", code => resolve(code ?? 1));
    child.once("error", error => { launchError = String(error); resolve(1); }); });
  await new Promise(resolve => log.end(resolve));
  const raw = await readFile(logPath), text = raw.toString();
  const counts = tests ? Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key =>
    [key, Number(text.match(new RegExp("^# " + key + " (\\d+)\\r?$", "m"))?.[1] ?? -1)])) : undefined;
  const passed = code === 0 && !launchError && (!tests || counts.tests > 0 && counts.pass === counts.tests
    && ["fail", "cancelled", "skipped", "todo"].every(key => counts[key] === 0));
  const step = { name, cwd, command: [process.execPath, ...args], code, duration_ms: Date.now() - start,
    sha256: hash(raw), bytes: raw.length, ...(counts ? { counts } : {}), passed, ...(launchError ? { error: launchError } : {}) };
  steps.push(step); console.log(JSON.stringify(step));
  assert.ok(passed, "Step failed; preserve this attempt and inspect " + logPath);
}
let error, unchanged = false;
try {
  if (scope === "platform") {
    await run("typecheck", platform, ["node_modules/typescript/bin/tsc", "--noEmit"]);
    await run("native-runtime", platform, ["--env-file=.env", "scripts/run-tests-owned.mjs",
      "tests/runtime-startup.test.ts", "tests/runtime.test.ts"], true);
  } else if (scope === "web") {
    await run("typecheck", web, ["node_modules/typescript/bin/tsc", "--noEmit"]);
    await run("unit", web, ["--import", "tsx", "--test", "tests/*.test.ts"], true);
    await run("build", web, ["node_modules/vite/bin/vite.js", "build"]);
  } else {
    await run("typecheck", desktop, ["node_modules/typescript/bin/tsc", "--noEmit"]);
    await run("renderer-typecheck", desktop, ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "renderer/tsconfig.json"]);
    await run("build-program-host", desktop, ["scripts/build-program-host.mjs"]);
    await run("build-update-host", desktop, ["scripts/build-update-host.mjs"]);
    await run("build-native-host", desktop, ["scripts/build-native-host.mjs"]);
    await run("unit", desktop, ["--import", "tsx", "--test", "tests/*.test.ts"], true);
    await run("native-runtime", desktop, ["--import", "tsx", "--test", "--test-concurrency=1",
      "tests/integration/local-codex.native.test.ts"], true);
  }
  unchanged = JSON.stringify(before) === JSON.stringify(await snapshot(false));
  assert.ok(unchanged, "Source changed during qualification");
} catch (caught) { error = String(caught); }
const receipt = { schema_version: 1, scope: "native_startup_and_turn_scope_only_synthetic_provider", component: scope,
  status: error ? "failed" : "passed", started_at: startedAt, finished_at: new Date().toISOString(),
  verifier_sha256: hash(verifier), source_count: Object.keys(before).length, source_unchanged: unchanged,
  bindings_sha256: hash(await readFile(path.join(output, "source-bindings.json"))),
  native_binary: { path: binary, sha256: binaryHash, version: pin.runtime_version }, steps,
  limits: ["Synthetic company inference responses; actual locked native Codex.",
    "Fault injection affects only captured owned process pipes; no Docker, WSL or virtual machines.",
    "Does not prove professional role quality, historical timeout root cause or full product acceptance."], ...(error ? { error } : {}) };
await writeFile(path.join(output, "receipt.json"), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: receipt.status, receipt: path.join(output, "receipt.json"), error }));
process.exitCode = error ? 1 : 0;
