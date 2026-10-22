import assert from "node:assert/strict";
import { spawn, execFileSync } from "node:child_process";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";

const attempt = process.argv[2], probe = process.argv.includes("--probe");
assert.match(attempt ?? "", /^\d{2}$/);
const desktop = path.resolve("../copypaste-desktop");
const binary = process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN;
assert.ok(binary && path.isAbsolute(binary), "Set an absolute COPYPASTE_LOCAL_CODEX_TEST_BIN. This launcher does not search PATH.");
const prefix = "evidence/local-codex-native-" + attempt;
await assert.rejects(readFile(prefix + ".json"), (error) => error.code === "ENOENT");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function snapshot() {
  const names = execFileSync("git", ["-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--",
    "src", "tests", "scripts", "contracts", "package.json", "package-lock.json", "tsconfig.json"], { cwd: desktop, encoding: "utf8", windowsHide: true }).split("\0").filter(Boolean);
  const result = {};
  for (const file of [...new Set(names)].sort()) result[file] = sha(await readFile(path.join(desktop, file)));
  return result;
}
const before = await snapshot(), verifier = await readFile(import.meta.filename), locked = JSON.parse(await readFile(path.join(desktop, "contracts/local-codex-runtime.json")));
await writeFile(prefix + "-verifier.mjs", verifier, { flag: "wx" });
for (const [file, expected] of Object.entries(before)) {
  const bytes = await readFile(path.join(desktop, file));
  assert.equal(sha(bytes), expected);
  const output = path.resolve(prefix + "-sources", file);
  assert.ok(output.startsWith(path.resolve(prefix + "-sources") + path.sep));
  await mkdir(path.dirname(output), { recursive: true });
  await writeFile(output, bytes, { flag: "wx" });
}
const log = createWriteStream(prefix + ".tap", { flags: "wx" });
const child = spawn(process.execPath, ["--import", "tsx", "--test", "--test-concurrency=1", ...(probe ? ["--test-name-pattern", "native full access edits"] : []), "tests/integration/local-codex.native.test.ts"],
  { cwd: desktop, env: { ...process.env, COPYPASTE_LOCAL_CODEX_TEST_BIN: binary }, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
const exitCode = await new Promise((resolve, reject) => { child.once("close", resolve); child.once("error", reject); });
await new Promise((resolve) => log.end(resolve));
const raw = await readFile(prefix + ".tap");
const counts = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map((key) => [key, Number(raw.toString().match(new RegExp("^# " + key + " (\\d+)\\r?$", "m"))?.[1] ?? -1)]));
const unchanged = JSON.stringify(before) === JSON.stringify(await snapshot());
const passed = exitCode === 0 && unchanged && counts.tests === (probe ? 1 : 8) && counts.pass === counts.tests
  && ["fail", "cancelled", "skipped", "todo"].every((key) => counts[key] === 0);
const report = { at: new Date().toISOString(), status: passed ? "passed" : "failed", scope: probe ? "native_supervisor_single_probe" : "native_supervisor_integration_only",
  counts, exit_code: exitCode, source_unchanged: unchanged, source_files: before,
  runtime_version: locked.runtime_version, native_binary_sha256: locked.windows_x64_sha256,
  raw_report: prefix + ".tap", raw_sha256: sha(raw), verifier_sha256: sha(verifier),
  not_validated: ["Electron_main_process_and_IPC_integration", "user_full_permission_UI", "company_billing_and_scoped_credentials", "installer_bundling_and_signing", "complete_role_business_qualification", "entire_product_acceptance"] };
await writeFile(prefix + ".json", JSON.stringify(report, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ status: report.status, counts, source_unchanged: unchanged }));
process.exitCode = passed ? 0 : 1;
