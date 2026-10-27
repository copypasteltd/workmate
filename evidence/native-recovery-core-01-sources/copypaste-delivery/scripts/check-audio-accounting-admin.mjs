import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
assert.equal(process.argv.length, 3);
const admin = path.resolve("../copypaste-admin"), prefix = "evidence/audio-accounting-admin-" + attempt;
const sha = b => createHash("sha256").update(b).digest("hex");
for (const ext of [".json", ".log", ".tap", "-verifier.mjs"]) await assert.rejects(readFile(prefix + ext), e => e.code === "ENOENT");
const files = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src", "tests", "public", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts"], { cwd: admin, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
const sources = {};
for (const name of [...new Set(files)].sort()) {
  const bytes = await readFile(path.join(admin, name));
  sources["copypaste-admin/" + name] = sha(bytes);
  const target = prefix + "-sources/copypaste-admin/" + name;
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: "wx" });
}
await writeFile(prefix + "-verifier.mjs", await readFile(import.meta.filename), { flag: "wx" });
let raw = "", tap = "", error;
const checks = [];
function run(args) {
  try {
    const out = execFileSync(process.execPath, args, { cwd: admin, encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    raw += out; checks.push({ args, exit_code: 0 }); return out;
  } catch (e) {
    raw += String(e.stdout ?? "") + String(e.stderr ?? "");
    checks.push({ args, exit_code: e.status ?? 1 }); throw e;
  }
}
let counts;
try {
  run(["node_modules/typescript/bin/tsc", "--noEmit"]);
  tap = run(["--import", "tsx", "--test", "tests/audio-accounting.test.ts", "tests/capability-audio.test.ts", "tests/financial-money.test.ts"]);
  counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(k => [k, Number(tap.match(new RegExp("^# " + k + " (\\d+)$", "m"))?.[1] ?? -1)]));
  assert.equal(counts.tests, 9); assert.equal(counts.pass, 9);
  for (const k of ["fail", "cancelled", "skipped", "todo"]) assert.equal(counts[k], 0);
} catch (e) { error = String(e); }
let stable = true;
for (const [name, expected] of Object.entries(sources)) stable &&= sha(await readFile(path.resolve("..", name))) === expected;
await writeFile(prefix + ".log", raw, { flag: "wx" });
await writeFile(prefix + ".tap", tap, { flag: "wx" });
const report = { at: new Date().toISOString(), status: !error && stable ? "passed" : "failed", error, source_unchanged: stable, source_files: sources, checks, counts,
  raw_log: { path: prefix + ".log", sha256: sha(Buffer.from(raw)) }, raw_report: { path: prefix + ".tap", sha256: sha(Buffer.from(tap)) },
  scope: "Admin-only correction: saving immutable evidence refreshes the open record without unmounting its list. Full affected backend remains qualified by unchanged core-02; actual browser acceptance separately verifies the saved evidence remains visible." };
await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: report.status, counts, error }));
process.exitCode = report.status === "passed" ? 0 : 1;
