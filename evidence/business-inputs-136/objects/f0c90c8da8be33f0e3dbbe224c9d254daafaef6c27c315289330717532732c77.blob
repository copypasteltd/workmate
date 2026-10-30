import { readdir, readFile, writeFile, lstat } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";
import { removeOwnedUUIDDirectory } from "../src/owned-directory-cleanup.js";
import { processIsGone, validateFixtureOwner } from "./test-fixture-ownership.js";

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
const recovering = process.env.COPYPASTE_TEST_RECOVER_INTERRUPTED === "true";
if (recovering) assert.ok(processIsGone(manifest.owner_pid), "Interrupted launcher must be gone");
else assert.equal(manifest.owner_pid, process.ppid);
assert.equal(manifest.token, process.env.COPYPASTE_TEST_RECLAMATION_TOKEN);
const results: { id: string; reclaimed: boolean; error_code?: string }[] = [];
let workersExited = true;
const files = new Map<string, string>();
for (const name of (await readdir(run)).sort()) {
  if (["manifest.json", "owned"].includes(name)) continue;
  assert.match(name, /^[a-f0-9]{32}\.json$/);
  files.set(name, path.join(run, name));
}
const owned = path.join(run, "owned");
let ownedExists = false;
try {
  assert.ok(!(await lstat(owned)).isSymbolicLink());
  ownedExists = true;
} catch (error: any) { if (error.code !== "ENOENT") throw error; }
if (ownedExists) {
  for (const name of (await readdir(owned)).sort()) {
    assert.match(name, /^[a-f0-9]{32}\.json$/);
    const file = path.join(owned, name);
    assert.ok(!(await lstat(file)).isSymbolicLink());
    const item = validateFixtureOwner(JSON.parse(await readFile(file, "utf8")), manifest, base, name);
    if (files.has(name)) {
      const deferred = validateFixtureOwner(JSON.parse(await readFile(files.get(name)!, "utf8")), manifest, base, name);
      assert.equal(deferred.worker_pid, item.worker_pid);
    }
    files.set(name, file);
  }
}
for (const [name, file] of [...files].sort(([a], [b]) => a.localeCompare(b))) {
  assert.match(name, /^[a-f0-9]{32}\.json$/);
  assert.ok(!(await lstat(file)).isSymbolicLink());
  const item = validateFixtureOwner(JSON.parse(await readFile(file, "utf8")), manifest, base, name);
  try {
    const gone = processIsGone(item.worker_pid);
    if (!gone) workersExited = false;
    assert.ok(gone, "Fixture worker must exit before reclamation");
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
      interrupted_owner_recovery: recovering,
      results,
    },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
process.exitCode = passed ? 0 : 1;
