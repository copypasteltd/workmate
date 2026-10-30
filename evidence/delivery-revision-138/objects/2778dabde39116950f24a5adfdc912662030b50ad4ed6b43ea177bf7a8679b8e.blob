import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, mkdir, readdir } from "node:fs/promises";
import path from "node:path";

const attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
assert.equal(process.argv.length, 3);
assert.equal(path.basename(process.cwd()), "copypaste-extension-publication-125");
const prefix = `.data/publications-125/extension-${attempt}`;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
await mkdir(path.dirname(prefix), { recursive: true });
for (const suffix of [".json", ".tap", "-verifier.mjs"])
  await assert.rejects(readFile(prefix + suffix), error => error.code === "ENOENT");
async function snapshot() {
  const names = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src", "public", "tests", "scripts", "manifest-key.txt", "package.json", "package-lock.json", "tsconfig.json"], { encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
  const result = {};
  for (const name of [...new Set(names)].sort()) result[name] = sha(await readFile(name));
  return result;
}
const before = await snapshot();
for (const [name, expected] of Object.entries(before)) {
  const bytes = await readFile(name);
  assert.equal(sha(bytes), expected);
  const destination = path.resolve(prefix + "-sources", name);
  assert.ok(destination.startsWith(path.resolve(prefix + "-sources") + path.sep));
  await mkdir(path.dirname(destination), { recursive: true });
  await writeFile(destination, bytes, { flag: "wx" });
}
await writeFile(prefix + "-verifier.mjs", await readFile(import.meta.filename), { flag: "wx" });
const log = createWriteStream(prefix + ".tap", { flags: "wx" });
const files = (await readdir("tests")).filter(name => name.endsWith(".test.ts")).sort().map(name => "tests/" + name);
const commands = [
  ["node_modules/typescript/bin/tsc", "--noEmit"],
  ["scripts/build.mjs"],
  ["--import", "tsx", "--test", ...files],
];
const results = [];
let error;
try {
  for (const args of commands) {
    const child = spawn(process.execPath, args, { cwd: process.cwd(), windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    const exit = await new Promise((resolve, reject) => { child.once("error", reject); child.once("close", (code, signal) => resolve({ code, signal })); });
    results.push({ args, ...exit });
    assert.equal(exit.code, 0, args.join(" "));
  }
} catch (failure) { error = String(failure); }
await new Promise(resolve => log.end(resolve));
const raw = await readFile(prefix + ".tap"), text = raw.toString();
const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => [key, Number(text.match(new RegExp("^# " + key + " (\\d+)\\r?$", "m"))?.[1] ?? -1)]));
const unchanged = JSON.stringify(before) === JSON.stringify(await snapshot());
const passed = !error && results.length === commands.length && unchanged && counts.tests > 0 && counts.pass === counts.tests && ["fail", "cancelled", "skipped", "todo"].every(key => counts[key] === 0);
await writeFile(prefix + ".json", JSON.stringify({
  at: new Date().toISOString(), status: passed ? "passed" : "failed",
  scope: "extension_publishing_handoff_typecheck_build_and_all_existing_unit_tests",
  error, commands: results, counts, source_unchanged: unchanged, source_files: before,
  raw_report: { path: prefix + ".tap", sha256: sha(raw) }, verifier_sha256: sha(await readFile(import.meta.filename)),
  not_validated: ["Actual Chrome native Side Panel journey", "Actual Web media and customer confirmation", "Full product acceptance"],
}, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: passed ? "passed" : "failed", counts, error, source_unchanged: unchanged }));
process.exitCode = passed ? 0 : 1;
