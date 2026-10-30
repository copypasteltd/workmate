import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
const attempt = process.argv[2]; assert.match(attempt ?? "", /^\d{2}$/);
const prefix = `evidence/test-discovery-141/attempt-${attempt}`, sha = b => createHash("sha256").update(b).digest("hex");
await mkdir(path.dirname(prefix), { recursive: true });
for (const suffix of [".json", ".tap"]) await assert.rejects(readFile(prefix + suffix), e => e.code === "ENOENT");
const names = ["package.json", "scripts/run-current-tests-owned-v10.mjs", "tests/current-test-discovery-141-v1.test.ts", "scripts/qualify-test-discovery-141-v1.mjs"];
const sources = Object.fromEntries(await Promise.all(names.map(async name => [name, sha(await readFile(name))])));
const log = createWriteStream(prefix + ".tap", { flags: "wx" }), commands = []; let error = null, listing = null;
async function command(name, args) {
  const child = spawn(process.execPath, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }); let output = "";
  child.stdout.on("data", b => { output += b; }); child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
  const code = await new Promise(resolve => { child.once("error", () => resolve(1)); child.once("close", c => resolve(c ?? 1)); });
  commands.push({ name, arguments: args, exit_code: code }); assert.equal(code, 0, name); return output;
}
try {
  await command("end-to-end default test selection", ["--import", "tsx", "--test", "tests/current-test-discovery-141-v1.test.ts"]);
  const npm = process.env.COPYPASTE_NPM_CLI ?? path.join(path.dirname(process.execPath), "node_modules/npm/bin/npm-cli.js");
  const output = await command("actual npm test inspection", [npm, "test", "--", "--list"]);
  listing = JSON.parse(output.split(/\r?\n/).find(line => line.startsWith('{"current_test_files"')));
  assert.ok(listing.current_test_files.includes("tests/creative-packages-140-v6.test.ts"));
  assert.ok(!listing.current_test_files.includes("tests/creative-packages-140-v1.test.ts"));
  await command("backend source compiler", ["node_modules/typescript/bin/tsc", "--noEmit"]);
} catch (e) { error = String(e); }
finally { await new Promise(resolve => log.end(resolve)); }
const unchanged = (await Promise.all(names.map(async name => sha(await readFile(name)) === sources[name]))).every(Boolean);
const report = { at: new Date().toISOString(), status: !error && unchanged ? "passed" : "failed", error, commands,
  sources, sources_unchanged: unchanged, listing, raw_log: { path: prefix + ".tap", sha256: sha(await readFile(prefix + ".tap")) },
  scope: "Six end-to-end test-entry checks, actual npm test -- --list, compiler. Runtime product sources are unchanged. This is not a whole-platform test rerun." };
await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" }); console.log(JSON.stringify({ status: report.status, report: prefix + ".json", error })); process.exitCode = report.status === "passed" ? 0 : 1;
