import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
assert.equal(process.argv.length, 3);
assert.equal(path.basename(process.cwd()), "copypaste-platform-publication-125");
const root = process.cwd(), prefix = path.resolve(".data/publications-125", "protocol-" + attempt);
await mkdir(path.dirname(prefix), { recursive: true });
for (const suffix of [".json", ".tap", "-verifier.mjs"])
  await assert.rejects(readFile(prefix + suffix), e => e.code === "ENOENT");
const digest = b => createHash("sha256").update(b).digest("hex");
async function sources(copy = false) {
  const names = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false",
    "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--",
    "src", "tests", "scripts", "migrations", "catalog", "contracts", "package.json", "package-lock.json", "tsconfig.json"],
    { cwd: root, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
  const result = {};
  for (const name of [...new Set(names)].sort()) {
    const bytes = await readFile(path.join(root, name)); result[name] = digest(bytes);
    if (copy) {
      const target = path.resolve(prefix + "-sources", name);
      assert.ok(target.startsWith(prefix + "-sources" + path.sep));
      await mkdir(path.dirname(target), { recursive: true });
      await writeFile(target, bytes, { flag: "wx" });
    }
  }
  return result;
}
const before = await sources(true), started = new Date().toISOString();
await writeFile(prefix + "-verifier.mjs", await readFile(import.meta.filename), { flag: "wx" });
const log = createWriteStream(prefix + ".tap", { flags: "wx" });
async function run(args) {
  return await new Promise(resolve => {
    const child = spawn(process.execPath, args, { cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    child.once("error", () => resolve(1)); child.once("close", code => resolve(code ?? 1));
  });
}
let typecheck = null, tests = null, error = null;
try {
  typecheck = await run(["node_modules/typescript/bin/tsc", "--noEmit"]);
  if (typecheck === 0) tests = await run(["--import", "tsx", "--test", "--test-reporter=tap", "tests/publication-protocol.test.ts"]);
} catch (e) { error = String(e); }
await new Promise(resolve => log.end(resolve));
const raw = await readFile(prefix + ".tap"), text = raw.toString("utf8"), after = await sources();
const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(name => [name,
  Number(text.match(new RegExp("^# " + name + " (\\d+)\\r?$", "m"))?.[1] ?? -1)]));
const stable = JSON.stringify(before) === JSON.stringify(after);
const passed = !error && stable && typecheck === 0 && tests === 0 && counts.tests > 0 &&
  counts.pass === counts.tests && ["fail", "cancelled", "skipped", "todo"].every(k => counts[k] === 0);
const result = { schema_version: 1, started_at: started, finished_at: new Date().toISOString(),
  status: passed ? "passed_bounded_protocol" : "failed", source_stable: stable, source_sha256: before,
  verifier_sha256: digest(await readFile(import.meta.filename)), tap_sha256: digest(raw),
  typecheck_exit: typecheck, test_exit: tests, counts, error,
  scope: "Eight-format pure planner and real owned HTTP transport failure tests; full publication service, SQL migration, UI and real Meta eligibility are not qualified by this run.",
  migration_executed: false, browser_used: false, owned_http_servers_closed: tests === 0,
};
await writeFile(prefix + ".json", JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: result.status, counts, source_stable: stable, typecheck, tests,
  report: path.relative(root, prefix + ".json") }));
process.exitCode = passed ? 0 : 1;
