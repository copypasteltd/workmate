import { readdir, readFile, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { removeOwnedUUIDDirectory } from "../src/owned-directory-cleanup.js";

const run = path.resolve(process.env.COPYPASTE_TEST_RECLAMATION_DIR ?? ""),
  parent = path.resolve(".data/test-fixture-reclamation"),
  base = path.resolve(".data/test-runs");
assert.equal(path.dirname(run), parent);
assert.match(
  path.basename(run),
  /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/,
);
assert.ok(!(await lstat(run)).isSymbolicLink());
const manifest = JSON.parse(
  await readFile(path.join(run, "manifest.json"), "utf8"),
);
assert.equal(manifest.owner_pid, process.ppid);
assert.equal(manifest.token, process.env.COPYPASTE_TEST_RECLAMATION_TOKEN);
const results: { id: string; reclaimed: boolean; error_code?: string }[] = [];
let workersExited = true;
for (const name of (await readdir(run)).sort()) {
  if (name === "manifest.json") continue;
  assert.match(name, /^[a-f0-9]{32}\.json$/);
  const file = path.join(run, name);
  assert.ok(!(await lstat(file)).isSymbolicLink());
  const item = JSON.parse(await readFile(file, "utf8"));
  assert.equal(item.id + ".json", name);
  assert.equal(item.token, manifest.token);
  assert.equal(path.resolve(item.directory), path.join(base, item.id));
  assert.ok(Number.isSafeInteger(item.worker_pid) && item.worker_pid > 0);
  try {
    let alive = true;
    try {
      process.kill(item.worker_pid, 0);
    } catch (error: any) {
      if (error.code === "ESRCH") alive = false;
      else {
        workersExited = false;
        throw error;
      }
    }
    if (alive) workersExited = false;
    assert.equal(alive, false, "Fixture worker must exit before reclamation");
    await removeOwnedUUIDDirectory(base, item.id);
    await assert.rejects(
      lstat(path.join(base, item.id)),
      (error: any) => error.code === "ENOENT",
    );
    results.push({ id: item.id, reclaimed: true });
  } catch (error: any) {
    results.push({
      id: item.id,
      reclaimed: false,
      error_code: ["EBUSY", "EPERM", "EACCES", "ENOTEMPTY"].includes(error.code)
        ? error.code
        : "FIXTURE_RECLAMATION_FAILED",
    });
  }
}
const passed = results.every((r) => r.reclaimed);
await writeFile(
  path.join(run, "result.json"),
  JSON.stringify(
    {
      at: new Date().toISOString(),
      status: passed ? "passed" : "failed",
      scope:
        "Only this launcher's newly created deferred fixture IDs; historical retained fixtures are untouched",
      workers_exited: workersExited,
      actual_filesystem_checked: true,
      results,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
process.exitCode = passed ? 0 : 1;
