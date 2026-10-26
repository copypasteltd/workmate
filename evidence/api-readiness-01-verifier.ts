import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { runCloudApiCheck } from "../../copypaste-platform/src/cloud-development-checks.js";

// Reproduce real module startup separately from the unchanged HTTP deadline.
// Each attempt retains its exact source, application bytes and native receipt.
const attempt = process.argv[2];
assert.match(attempt ?? "", /^\d{2}$/);
assert.equal(path.basename(process.cwd()), "copypaste-platform");
const prefix = path.resolve("../copypaste-delivery/evidence/api-readiness-" + attempt);
const source = "await new Promise(r=>setTimeout(r,5500));export default (q,s)=>s.end('ready after actual module initialization');";
const sha = (bytes: Buffer | string) => createHash("sha256").update(bytes).digest("hex");
for (const suffix of [".json", "-verifier.ts"])
  await assert.rejects(readFile(prefix + suffix), (e: any) => e.code === "ENOENT");
const before: Record<string, string> = {};
for (const file of ["src/cloud-development-checks.ts", "src/cloud-api-bootstrap.cjs", "src/cloud-program-executor.ts", "src/cloud-program-host.cs"])
  before[file] = sha(await readFile(file));
await writeFile(prefix + "-verifier.ts", await readFile(import.meta.filename), { flag: "wx" });
const result = await runCloudApiCheck(
  path.resolve(".data/api-readiness", randomUUID()),
  {
    entry: "delayed.mjs",
    timeout_ms: 15000,
    requests: [
      { name: "First request after actual 5.5 second initialization", method: "GET", path: "/", expect: { status: 200, text: "ready after actual module initialization" } },
      { name: "A fresh connection uses the same initialized application", method: "GET", path: "/second", expect: { status: 200, text: "ready after actual module initialization" } },
    ],
  },
  [{ path: "delayed.mjs", bytes: Buffer.from(source) }],
);
for (const [file, digest] of Object.entries(before)) assert.equal(sha(await readFile(file)), digest);
await writeFile(prefix + ".json", JSON.stringify({
  at: new Date().toISOString(), attempt, source_files: before,
  application_source: source, application_sha256: sha(source),
  startup_delay_ms: 5500, http_request_timeout_ms: 5000,
  isolation: "Actual native Windows process sandbox, no VM, no network, single-process job",
  source_unchanged: true, receipt: result.receipt,
}, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ attempt, passed: result.receipt.passed, error: result.receipt.check_result?.error, checks: result.receipt.check_result?.checks.length }));
assert.equal(result.receipt.passed, true, "A bounded application startup must finish before request timing begins");
assert.equal(result.receipt.check_result?.checks.length, 2);
assert.equal(result.receipt.workspace_deleted, true);
