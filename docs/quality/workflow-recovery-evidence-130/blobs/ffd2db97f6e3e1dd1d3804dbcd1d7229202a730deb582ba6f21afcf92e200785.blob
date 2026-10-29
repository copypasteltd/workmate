import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
assert.equal(process.argv.length, 3);
assert.equal(path.basename(process.cwd()), "copypaste-web-publication-125");
const prefix = `.data/publications-125/web-${attempt}`;
const sha = bytes => createHash("sha256").update(bytes).digest("hex");
await mkdir(path.dirname(prefix), { recursive: true });
for (const suffix of [".json", ".tap", "-verifier.mjs"]) {
  await assert.rejects(readFile(prefix + suffix), error => error.code === "ENOENT");
}
async function snapshot() {
  const names = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src", "renderer", "tests", "scripts", "contracts", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts"], { encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
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
const commands = [
  ["node_modules/typescript/bin/tsc", "--noEmit"],
  ["node_modules/vite/bin/vite.js", "build"],
  ["--import", "tsx", "--test", "tests/auth-return.test.ts", "tests/operation-key.test.ts", "tests/financial-notice.test.ts", "tests/cloud-agent-budget.test.ts", "tests/work-draft.test.ts", "tests/adoption-price.test.ts"],
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
const report = { at: new Date().toISOString(), status: passed ? "passed" : "failed", scope: "web_publication_source_typecheck_build_and_existing_client_regressions", error, commands: results, counts, source_unchanged: unchanged, source_files: before, raw_report: { path: prefix + ".tap", sha256: sha(raw) }, verifier_sha256: sha(await readFile(import.meta.filename)), not_validated: ["Actual browser publishing journey", "Four-width layout, accessibility and recordings", "Full product acceptance"] };
await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: report.status, counts, error, source_unchanged: unchanged }));
process.exitCode = passed ? 0 : 1;
