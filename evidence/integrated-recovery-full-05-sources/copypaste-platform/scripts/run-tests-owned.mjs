import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import path from "node:path";
import assert from "node:assert/strict";

// Reclaim locked fixtures only after all test workers have exited. The final
// filesystem check is part of this launcher's exit status, never a skipped hook.
const files = process.argv.slice(2);
assert.ok(files.length > 0);
for (const file of files) assert.match(file, /^tests\/[a-z0-9*-]+\.test\.ts$/);
const runId = process.env.COPYPASTE_TEST_RECLAMATION_ID ?? randomUUID();
assert.match(runId, /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/);
const directory = path.resolve(".data/test-fixture-reclamation", runId),
  token = randomUUID(),
  created = new Date().toISOString();
await mkdir(directory, { recursive: true });
await writeFile(
  path.join(directory, "manifest.json"),
  JSON.stringify({ owner_pid: process.pid, token, created_at: created }),
  { flag: "wx" },
);
console.log("# owned_fixture_owner " + JSON.stringify({
  path: path.relative(process.cwd(), directory).replaceAll("\\", "/"),
  owner_pid: process.pid,
}));
const env = {
  ...process.env,
  COPYPASTE_TEST_RECLAMATION_DIR: directory,
  COPYPASTE_TEST_RECLAMATION_TOKEN: token,
};
const suite = spawn(
  process.execPath,
  ["--import", "tsx", "--test", "--test-concurrency=1", ...files],
  {
    cwd: process.cwd(),
    env,
    windowsHide: true,
    stdio: ["ignore", "inherit", "inherit"],
  },
);
const wait = (child) =>
  new Promise((resolve, reject) => {
    child.once("close", (code) => resolve(code ?? 1));
    child.once("error", reject);
  });
const testCode = await wait(suite);
const cleanup = spawn(
  process.execPath,
  ["--import", "tsx", "scripts/reclaim-test-fixtures.ts"],
  {
    cwd: process.cwd(),
    env,
    windowsHide: true,
    stdio: ["ignore", "inherit", "inherit"],
  },
);
const cleanupCode = await wait(cleanup);
const report = path.join(directory, "result.json"),
  bytes = await readFile(report);
console.log(
  "# owned_fixture_cleanup " +
    JSON.stringify({
      path: path.relative(process.cwd(), report).replaceAll("\\", "/"),
      sha256: createHash("sha256").update(bytes).digest("hex"),
      exit_code: cleanupCode,
    }),
);
process.exitCode = testCode === 0 && cleanupCode === 0 ? 0 : 1;
