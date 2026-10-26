import test from 'node:test';
import assert from 'node:assert/strict';
import { partitionTests, parseCompleteTap, requirePassingCounts, qualifyBatchReceipts } from '../scripts/platform-qualification-state.mjs';

const counts = { tests: 3, pass: 3, fail: 0, cancelled: 0, skipped: 0, todo: 0 };
const hash = '1'.repeat(64), fingerprint = '2'.repeat(64);
const files = ['tests/a.test.ts', 'tests/b.test.ts', 'tests/c.test.ts'];
const plan = { files, batch_size: 2, batches: partitionTests(files, 2), source_fingerprint: fingerprint };
const receipt = (id = '01') => ({ batch: id, files: plan.batches.find(x => x.id === id).files, status: 'passed', plan_sha256: hash,
  source_fingerprint: fingerprint, source_unchanged: true, owned_database_shutdown: true, fixture_cleanup: { status: 'passed' }, counts });

test('the complete inventory cannot lose files, duplicate them, follow traversal or silently change order', () => {
  assert.deepEqual(plan.batches.flatMap(x => x.files), files);
  for (const invalid of [[], [files[0], files[0]], [...files].reverse(), ['tests/../a.test.ts'], ['tests/nested/a.test.ts']]) assert.throws(() => partitionTests(invalid));
  assert.throws(() => qualifyBatchReceipts({ ...plan, batches: plan.batches.slice(0, 1) }, hash, []));
});
test('partial TAP and concatenated summaries cannot be qualified as a completed worker', () => {
  const tap = Object.entries(counts).map(([key, value]) => '# ' + key + ' ' + value).join('\n') + '\n';
  assert.deepEqual(parseCompleteTap(tap), counts);
  assert.deepEqual(parseCompleteTap(tap.replaceAll('\n', '\r\n')), counts);
  assert.throws(() => parseCompleteTap('ok 1 - still running\n'));
  assert.throws(() => parseCompleteTap(tap + tap));
});
test('failure, cancellation, skips and todo cannot become passing coverage', () => {
  requirePassingCounts(counts);
  for (const key of ['fail', 'cancelled', 'skipped', 'todo']) assert.throws(() => requirePassingCounts({ ...counts, [key]: 1 }));
  assert.throws(() => requirePassingCounts({ ...counts, pass: 2 }));
  assert.throws(() => requirePassingCounts({ ...counts, tests: 0, pass: 0 }));
});
test('a resumed run can retain completed batches but cannot finalize before all files pass', () => {
  assert.equal(qualifyBatchReceipts(plan, hash, [receipt()]).size, 1);
  assert.throws(() => qualifyBatchReceipts(plan, hash, [receipt()], true));
  assert.equal(qualifyBatchReceipts(plan, hash, [receipt(), receipt('02')], true).size, 2);
});
test('an interrupted batch contributes no coverage and its complete retry contributes once', () => {
  const interrupted = { ...receipt(), status: 'interrupted', source_unchanged: null, counts: null };
  assert.equal(qualifyBatchReceipts(plan, hash, [interrupted]).size, 0);
  assert.equal(qualifyBatchReceipts(plan, hash, [interrupted, receipt()]).size, 1);
  assert.throws(() => qualifyBatchReceipts(plan, hash, [receipt(), receipt()]));
});
test('changed plan, files, source or cleanup cannot reuse an earlier passing receipt', () => {
  for (const changed of [{ plan_sha256: '3'.repeat(64) }, { files: [files[0]] }, { source_fingerprint: hash }, { source_unchanged: false },
    { owned_database_shutdown: false }, { fixture_cleanup: { status: 'failed' } }, { batch: '99' }, { status: 'failed' }]) {
    assert.throws(() => qualifyBatchReceipts(plan, hash, [{ ...receipt(), ...changed }]));
  }
});
