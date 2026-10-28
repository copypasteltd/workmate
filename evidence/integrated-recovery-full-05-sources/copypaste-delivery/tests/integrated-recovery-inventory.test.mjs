import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { fingerprint, hash, validateInventory, validateFileReceipt, sumCompleteInventory } from "../scripts/integrated-recovery-inventory.mjs";
const files = ["tests/a.test.ts", "tests/b.test.ts"], sources = { "copypaste-platform/src/a.ts": "f".repeat(64) }, verifier = "e".repeat(64);
const plan = { format: "source_bound_complete_inventory_v2", test_files: files, source_files: sources, source_fingerprint: fingerprint(sources), verifier_sha256: verifier };
const counts = { tests: 2, pass: 2, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
test("resumption rejects changed source, missing inventory and replacement verifier", () => {
  validateInventory(plan, files, sources, verifier);
  assert.throws(() => validateInventory(plan, files.slice(1), sources, verifier));
  assert.throws(() => validateInventory(plan, files, { ...sources, extra: "x" }, verifier));
  assert.throws(() => validateInventory(plan, files, sources, "d".repeat(64)));
});
test("complete inventory never duplicates, omits or reorders files", () => {
  const rows = files.map(test_file => ({ test_file, counts }));
  assert.equal(sumCompleteInventory(plan, rows).tests, 4);
  for (const changed of [rows.slice(1), [rows[0], rows[0]], [...rows].reverse()]) assert.throws(() => sumCompleteInventory(plan, changed));
});
test("only actual terminal exit, full TAP and matching successful filesystem cleanup permit skipping a file", async () => {
  await mkdir(".data", { recursive: true });
  const base = await mkdtemp(path.resolve(".data/copypaste-inventory-"));
  try {
    const cleanup = { path: ".data/test-fixture-reclamation/91c4ab40-8537-457b-948b-8bf862c87d34/result.json", exit_code: 0 };
    const cleanupBody = JSON.stringify({ status: "passed", workers_exited: true, actual_filesystem_checked: true, results: [{ reclaimed: true }] });
    await mkdir(path.dirname(path.join(base, cleanup.path)), { recursive: true });
    await writeFile(path.join(base, cleanup.path), cleanupBody); cleanup.sha256 = hash(cleanupBody);
    const raw = Object.entries(counts).map(([key, value]) => `# ${key} ${value}`).join("\n") + "\n# owned_fixture_cleanup " + JSON.stringify(cleanup) + "\n";
    await writeFile(path.join(base, "raw.tap"), raw);
    const row = { status: "passed", source_fingerprint: plan.source_fingerprint, verifier_sha256: verifier, test_file: files[0], args: ["--env-file=.env", "scripts/run-tests-owned.mjs", files[0]], exit_code: 0, source_unchanged: true, counts, raw_report: { path: "raw.tap", sha256: hash(raw) }, fixture_cleanup: cleanup, fixture_cleanup_report: cleanup };
    assert.deepEqual(await validateFileReceipt(plan, row, base, base), counts);
    for (const patch of [{ exit_code: null }, { source_unchanged: false }, { status: "interrupted" }, { counts: { ...counts, skipped: 1 } }, { raw_report: { path: "../raw.tap", sha256: hash(raw) } }])
      await assert.rejects(validateFileReceipt(plan, { ...row, ...patch }, base, base));
    await writeFile(path.join(base, "raw.tap"), raw.replace("# pass 2\n", ""));
    await assert.rejects(validateFileReceipt(plan, { ...row, raw_report: { path: "raw.tap", sha256: hash(raw.replace("# pass 2\n", "")) } }, base, base));
    await writeFile(path.join(base, "raw.tap"), raw);
    await writeFile(path.join(base, cleanup.path), "changed");
    await assert.rejects(validateFileReceipt(plan, row, base, base));
  } finally { await rm(base, { recursive: true, force: true }); }
});
