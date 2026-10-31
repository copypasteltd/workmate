// Focused HTTP races and the three affected client builds; no historical suite.
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const attempt = process.argv[2]; assert.match(attempt ?? "", /^\d{2}$/); assert.equal(process.argv.length, 3);
const delivery = process.cwd(), base = "evidence/session-boundary-163", prefix = base + "/qualification-" + attempt;
await mkdir(base, { recursive: true });
for (const suffix of [".json", ".log", "-sources.json", "-verifier.mjs"]) await assert.rejects(readFile(prefix + suffix), e => e.code === "ENOENT");
const digest = b => createHash("sha256").update(b).digest("hex");
async function sources() {
  const result = {};
  for (const component of ["web", "desktop", "admin"]) {
    const repo = path.resolve("../copypaste-" + component);
    const names = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", repo, "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src", "renderer/src", "package.json", "package-lock.json", "tsconfig.json", "renderer/tsconfig.json", "vite.config.ts"], { cwd: delivery }).toString().split("\0").filter(Boolean);
    for (const name of names) result["copypaste-" + component + "/" + name] = digest(await readFile(path.join(repo, name)));
  }
  for (const name of ["tests/session-boundary-163-v1.test.mjs", "scripts/qualify-session-boundary-163-v1.mjs"]) result["copypaste-delivery/" + name] = digest(await readFile(name));
  return result;
}
const before = await sources();
await writeFile(prefix + "-sources.json", JSON.stringify(before, null, 2) + "\n", { flag: "wx" });
await writeFile(prefix + "-verifier.mjs", await readFile(import.meta.filename), { flag: "wx" });
const log = createWriteStream(prefix + ".log", { flags: "wx" }), commands = [];
let error = null;
async function run(name, args, cwd) {
  log.write("\n# " + name + "\n");
  const code = await new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    child.once("error", () => resolve(1)); child.once("close", resolve);
  });
  commands.push({ name, args, exit_code: code }); console.log(JSON.stringify(commands.at(-1))); assert.equal(code, 0, name);
}
try {
  await run("Actual HTTP request and sign-in races", ["--test", "tests/session-boundary-163-v1.test.mjs"], delivery);
  for (const component of ["web", "admin"]) {
    const repo = path.resolve("../copypaste-" + component);
    await run(component + " typecheck", ["node_modules/typescript/bin/tsc", "--noEmit"], repo);
    await run(component + " production build", ["node_modules/vite/bin/vite.js", "build"], repo);
  }
  const desktop = path.resolve("../copypaste-desktop");
  await run("Desktop renderer typecheck", ["node_modules/typescript/bin/tsc", "--noEmit", "-p", "renderer/tsconfig.json"], desktop);
  await run("Desktop renderer production build", ["node_modules/vite/bin/vite.js", "build", "--config", "vite.config.ts"], desktop);
} catch (e) { error = String(e); }
finally { await new Promise(resolve => log.end(resolve)); }
const after = await sources(), unchanged = JSON.stringify(before) === JSON.stringify(after), raw = await readFile(prefix + ".log");
const passed = !error && unchanged && commands.length === 7 && commands.every(x => x.exit_code === 0);
const report = { at: new Date().toISOString(), status: passed ? "passed" : "failed", error, commands, source_unchanged: unchanged, source_manifest: { path: prefix + "-sources.json", sha256: digest(await readFile(prefix + "-sources.json")) }, raw_log: { path: prefix + ".log", sha256: digest(raw) }, verifier_sha256: digest(await readFile(import.meta.filename)), scope: "Real loopback HTTP responses and controlled sign-in payloads; actual Web, Admin and Desktop renderer sources. Synthetic identity fixtures, no database/model/provider or installed Desktop qualification. All owned HTTP listeners are closed by the tests. Broad regression omitted by user request." };
await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: report.status, error, source_unchanged: unchanged, report: prefix + ".json" })); assert.ok(passed);
