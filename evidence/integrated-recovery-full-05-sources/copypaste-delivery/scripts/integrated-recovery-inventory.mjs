import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { parseCompleteTap, requirePassingCounts } from "./platform-qualification-state.mjs";

export const hash = bytes => createHash("sha256").update(bytes).digest("hex");
export const fingerprint = sources => hash(JSON.stringify(Object.fromEntries(Object.entries(sources).sort(([a], [b]) => a.localeCompare(b)))));
export function validateInventory(plan, files, sources, verifierHash) {
  assert.equal(plan.format, "source_bound_complete_inventory_v2");
  assert.deepEqual(plan.test_files, [...new Set(files)].sort());
  assert.ok(files.length > 0);
  files.forEach(file => assert.match(file, /^tests\/[a-z0-9-]+\.test\.ts$/));
  assert.deepEqual(plan.source_files, sources);
  assert.equal(plan.source_fingerprint, fingerprint(sources));
  assert.equal(plan.verifier_sha256, verifierHash);
}
export function within(base, relative) {
  assert.equal(typeof relative, "string");
  assert.ok(!path.isAbsolute(relative) && !relative.split(/[\\/]/).includes(".."));
  const resolved = path.resolve(base, relative);
  assert.ok(resolved.startsWith(path.resolve(base) + path.sep));
  return resolved;
}
export async function checkedReference(base, reference) {
  const file = within(base, reference.path);
  assert.ok(!(await lstat(file)).isSymbolicLink());
  const bytes = await readFile(file);
  assert.equal(hash(bytes), reference.sha256, reference.path);
  return bytes;
}
export async function validateFileReceipt(plan, row, delivery, platform) {
  assert.equal(row.status, "passed");
  assert.equal(row.source_fingerprint, plan.source_fingerprint);
  assert.equal(row.verifier_sha256, plan.verifier_sha256);
  assert.ok(plan.test_files.includes(row.test_file));
  assert.deepEqual(row.args, ["--env-file=.env", "scripts/run-tests-owned.mjs", row.test_file]);
  assert.equal(row.exit_code, 0);
  assert.equal(row.source_unchanged, true);
  const raw = (await checkedReference(delivery, row.raw_report)).toString("utf8");
  const counts = parseCompleteTap(raw); requirePassingCounts(counts); assert.deepEqual(row.counts, counts);
  const lines = [...raw.matchAll(/^# owned_fixture_cleanup (.+)\r?$/gm)];
  assert.equal(lines.length, 1, "A completed file requires exactly one real cleanup receipt");
  const cleanup = JSON.parse(lines[0][1]);
  assert.equal(cleanup.exit_code, 0);
  assert.match(cleanup.path, /^\.data\/test-fixture-reclamation\/[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}\/result\.json$/);
  assert.deepEqual(row.fixture_cleanup, cleanup);
  const cleanupBytes = await checkedReference(delivery, row.fixture_cleanup_report);
  assert.equal(hash(cleanupBytes), cleanup.sha256);
  const reclaimed = JSON.parse(cleanupBytes.toString("utf8"));
  assert.equal(reclaimed.status, "passed");
  assert.equal(reclaimed.workers_exited, true);
  assert.equal(reclaimed.actual_filesystem_checked, true);
  assert.ok(reclaimed.results.every(item => item.reclaimed === true));
  return counts;
}
export function sumCompleteInventory(plan, rows) {
  assert.deepEqual(rows.map(row => row.test_file), plan.test_files, "Every planned file must contribute once in inventory order");
  const total = Object.fromEntries(["tests", "pass", "fail", "cancelled", "skipped", "todo"].map(key => [key, 0]));
  for (const row of rows) { requirePassingCounts(row.counts); for (const key of Object.keys(total)) total[key] += row.counts[key]; }
  requirePassingCounts(total); return total;
}
