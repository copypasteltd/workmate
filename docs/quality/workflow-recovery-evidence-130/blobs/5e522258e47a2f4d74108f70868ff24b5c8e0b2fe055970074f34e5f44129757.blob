import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, readdir, access } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { parseCompleteTap, requirePassingCounts } from "./platform-qualification-state.mjs";

const attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
assert.equal(process.argv.length, 3);
assert.equal(path.basename(process.cwd()), "copypaste-delivery-cloud-121");
const delivery = process.cwd(), prefix = `.data/dedicated-cloud-121/clients-${attempt}`;
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
for (const suffix of [".json", "-verifier.mjs"]) await assert.rejects(access(prefix + suffix), e => e.code === "ENOENT");
const repositories = ["copypaste-web-cloud-121", "copypaste-admin-cloud-121", "copypaste-delivery-cloud-121"];
async function snapshot() {
  const result = {};
  for (const name of repositories) {
    const root = path.resolve("..", name);
    const names = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src", "scripts", "tests", "native", "deployment", "contracts", "public", "package.json", "package-lock.json", "tsconfig.json", "vite.config.ts"], { cwd: root, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
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
const inventories = {}, checks = []; let error = null;
try {
  for (const name of repositories) {
    const root = path.resolve("..", name), javascript = name === "copypaste-delivery-cloud-121";
    const files = (await readdir(path.join(root, "tests"))).filter(file => javascript ? /^[a-z0-9.-]+\.test\.mjs$/.test(file) : /^[a-z0-9.-]+\.test\.ts$/.test(file)).sort().map(file => "tests/" + file);
    assert.ok(files.length > 0); inventories[name] = files;
    for (const [kind, args] of [
      ["types", ["node_modules/typescript/bin/tsc", "--noEmit"]],
      ["unit", [...(javascript ? [] : ["--import", "tsx"]), "--test", "--test-concurrency=1", ...files]],
    ]) {
      const child = spawn(process.execPath, args, { cwd: root, windowsHide: true, env: { ...process.env, GIT_CONFIG_COUNT: "2", GIT_CONFIG_KEY_0: "core.fsmonitor", GIT_CONFIG_VALUE_0: "false", GIT_CONFIG_KEY_1: "core.untrackedCache", GIT_CONFIG_VALUE_1: "false" }, stdio: ["ignore", "pipe", "pipe"] });
      const parts = []; child.stdout.on("data", b => parts.push(b)); child.stderr.on("data", b => parts.push(b));
      const exit = await new Promise(resolve => { child.once("close", (code, signal) => resolve({ exit_code: code, signal })); child.once("error", e => resolve({ exit_code: null, error: String(e) })); });
      const bytes = Buffer.concat(parts), file = prefix + "-" + name + "-" + kind + (kind === "unit" ? ".tap" : ".log");
      await writeFile(file, bytes, { flag: "wx" });
      const row = { repository: name, kind, args, ...exit, raw_report: { path: file, sha256: hash(bytes) } }; checks.push(row);
      assert.equal(row.exit_code, 0, name + " " + kind + ": " + bytes.toString().slice(-1800));
      if (kind === "unit") { row.counts = parseCompleteTap(bytes.toString()); requirePassingCounts(row.counts); }
      console.log(JSON.stringify({ repository: name, kind, exit_code: row.exit_code, counts: row.counts }));
    }
  }
} catch (e) { error = String(e); }
const stable = JSON.stringify(before) === JSON.stringify(await snapshot());
const result = { at: new Date().toISOString(), status: !error && stable ? "passed" : "failed", error, scope: "Complete current Web/Admin/Delivery unit-file inventories and TypeScript checks; no browser, database, external provider or actual Linux deployment is opened or qualified", inventories, checks, source_files: before, source_unchanged: stable, verifier_sha256: hash(verifier), browser_opened: false, database_opened: false };
await writeFile(prefix + ".json", JSON.stringify(result, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: result.status, error, source_unchanged: stable }));
assert.equal(result.status, "passed");
