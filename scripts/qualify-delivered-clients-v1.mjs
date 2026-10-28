import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, readdir, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { parseCompleteTap, requirePassingCounts } from "./platform-qualification-state.mjs";

const attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/); assert.equal(process.argv.length, 3);
assert.equal(path.basename(process.cwd()), "copypaste-delivery");
const delivery = process.cwd(), prefix = `.data/dedicated-delivered-121/clients-${attempt}`;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const ref = (file, bytes) => ({ path: file, sha256: hash(bytes) });
for (const suffix of [".json", "-verifier.mjs"]) await assert.rejects(access(prefix + suffix), e => e.code === "ENOENT");
await mkdir(path.dirname(prefix), { recursive: true });
const repositories = ["web", "admin", "extension", "desktop", "delivery"].map(n => "copypaste-" + n);
async function snapshot() {
  const result = {};
  for (const name of repositories) {
    const root = path.resolve("..", name);
    const names = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src", "scripts", "tests", "native", "deployment", "renderer", "contracts", "public", "assets/fonts", "assets/licenses", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts", "deployment.json", "renderer-source.json"], { cwd: root, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
    for (const file of [...new Set(names)].sort()) result[name + "/" + file] = hash(await readFile(path.join(root, file)));
  }
  return result;
}
const before = await snapshot(), verifier = await readFile(import.meta.filename);
await writeFile(prefix + "-verifier.mjs", verifier, { flag: "wx" });
for (const [file, expected] of Object.entries(before)) {
  const bytes = await readFile(path.resolve("..", file)); assert.equal(hash(bytes), expected);
  const output = prefix + "-sources/" + file; await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, bytes, { flag: "wx" });
}
const desktop = path.resolve("../copypaste-desktop"), pin = JSON.parse(await readFile(path.join(desktop, "contracts/local-codex-runtime.json"), "utf8"));
const binary = path.join(desktop, ".data/runtime/windows-x64/codex.exe");
assert.equal(hash(await readFile(binary)), pin.windows_x64_sha256);
const env = { ...process.env, CODEX_BIN: binary, CODEX_VERSION: pin.runtime_version,
  COPYPASTE_LOCAL_CODEX_BIN: binary, COPYPASTE_LOCAL_CODEX_TEST_BIN: binary,
  GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "core.fsmonitor", GIT_CONFIG_VALUE_0: "false",
  GIT_CONFIG_KEY_1: "core.untrackedCache", GIT_CONFIG_VALUE_1: "false" };
const inventories = {}, checks = []; let error = null;
async function run(name, kind, args, tap = false) {
  const root = path.resolve("..", name);
  console.log(JSON.stringify({ repository: name, running: kind }));
  const child = spawn(process.execPath, args, { cwd: root, windowsHide: true, env, stdio: ["ignore", "pipe", "pipe"] });
  const parts = []; child.stdout.on("data", b => parts.push(b)); child.stderr.on("data", b => parts.push(b));
  const exit = await new Promise(resolve => { child.once("close", (code, signal) => resolve({ exit_code: code, signal })); child.once("error", e => resolve({ exit_code: null, error: String(e) })); });
  const bytes = Buffer.concat(parts), file = prefix + "-" + name + "-" + kind + (tap ? ".tap" : ".log");
  await writeFile(file, bytes, { flag: "wx" });
  const row = { repository: name, kind, args, ...exit, raw_report: ref(file, bytes) }; checks.push(row);
  assert.equal(row.exit_code, 0, name + " " + kind + ": " + bytes.toString().slice(-2000));
  if (tap) { row.counts = parseCompleteTap(bytes.toString()); requirePassingCounts(row.counts); }
  console.log(JSON.stringify({ repository: name, kind, exit_code: row.exit_code, counts: row.counts }));
}
try {
  for (const name of repositories) {
    const root = path.resolve("..", name), javascript = name === "copypaste-delivery";
    const files = (await readdir(path.join(root, "tests"))).filter(file => javascript ? /^[a-z0-9.-]+\.test\.mjs$/.test(file) : /^[a-z0-9.-]+\.test\.ts$/.test(file)).sort().map(file => "tests/" + file);
    assert.ok(files.length > 0); inventories[name] = files;
    await run(name, "types", ["node_modules/typescript/bin/tsc", "--noEmit"]);
    if (name === "copypaste-desktop") {
      await run(name, "renderer-types", ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "renderer/tsconfig.json"]);
      for (const [kind, script] of [["deployment", "configure-deployment"], ["update-trust", "configure-update-trust"], ["update-guardian", "build-update-host"], ["program-guardian", "build-program-host"], ["native-host", "build-native-host"]]) await run(name, kind, ["scripts/" + script + ".mjs"]);
      await run(name, "build-main", ["node_modules/typescript/bin/tsc"]);
      await run(name, "build-renderer", ["node_modules/vite/bin/vite.js", "build", "--config", "vite.config.ts"]);
    } else if (name === "copypaste-extension") {
      await run(name, "build", ["scripts/build.mjs"]);
    } else {
      await run(name, "build", ["node_modules/typescript/bin/tsc"]);
      if (!javascript) await run(name, "build-web", ["node_modules/vite/bin/vite.js", "build"]);
    }
    await run(name, "unit", [...(javascript ? [] : ["--import", "tsx"]), "--test", "--test-concurrency=1", ...files], true);
    if (name === "copypaste-desktop") await run(name, "native-codex", ["--import", "tsx", "--test", "--test-concurrency=1", "tests/integration/local-codex.native.test.ts"], true);
  }
  await run("copypaste-delivery", "publisher-syntax", ["--check", "scripts/publish-workmate-v4.mjs"]);
  // Building the source distribution does not run or install a Linux service.
  await run("copypaste-delivery", "node-source-bundle", ["native/build-package.mjs", attempt]);
  const surfaces = JSON.parse(await readFile(path.join(desktop, "renderer-source.json"), "utf8"));
  assert.equal(surfaces.native_desktop, true);
  for (const [file, expected] of Object.entries(surfaces.files)) assert.equal(hash(await readFile(path.join(desktop, "renderer", file))), expected, file);
} catch (e) { error = String(e); }
const stable = JSON.stringify(before) === JSON.stringify(await snapshot());
const result = { at: new Date().toISOString(), status: !error && stable ? "passed" : "failed", error,
  scope: "All integrated Web/Admin/Extension/Desktop/Delivery unit inventories, actual native Codex tests, current builds and the native-node source distribution. No database, browser UI or actual Linux service is launched by this driver.",
  inventories, checks, source_files: before, source_unchanged: stable,
  native_codex: pin, verifier_sha256: hash(verifier),
  browser_opened: false, database_opened: false, linux_service_started: false, virtualization_used: false,
  not_validated: ["Full backend regression", "Real Linux physical node operation", "Live model/media quality", "Full product acceptance"] };
await writeFile(prefix + ".json", JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: result.status, error, source_unchanged: stable }));
assert.equal(result.status, "passed");
