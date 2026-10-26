import assert from 'node:assert/strict';

export function partitionTests(files, size = 4) {
  assert.ok(Number.isSafeInteger(size) && size > 0 && size <= 8);
  assert.ok(Array.isArray(files) && files.length > 0);
  files.forEach(file => assert.match(file, /^tests\/[a-z0-9-]+\.test\.ts$/));
  assert.deepEqual(files, [...new Set(files)].sort(), 'Inventory must be sorted and unique');
  const batches = [];
  for (let offset = 0; offset < files.length; offset += size) batches.push({ id: String(batches.length + 1).padStart(2, '0'), files: files.slice(offset, offset + size) });
  return batches;
}

export function parseCompleteTap(raw) {
  const counts = {};
  for (const key of ['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo']) {
    const matches = [...raw.matchAll(new RegExp('^# ' + key + ' (\\d+)\\r?$', 'gm'))];
    assert.equal(matches.length, 1, 'Exactly one terminal TAP summary required: ' + key);
    counts[key] = Number(matches[0][1]);
    assert.ok(Number.isSafeInteger(counts[key]));
  }
  assert.ok(counts.tests > 0);
  return counts;
}

export function requirePassingCounts(counts) {
  assert.ok(counts && Number.isSafeInteger(counts.tests) && counts.tests > 0);
  assert.equal(counts.pass, counts.tests);
  for (const key of ['fail', 'cancelled', 'skipped', 'todo']) assert.equal(counts[key], 0, key);
}

export function qualifyBatchReceipts(plan, planHash, receipts, complete = false) {
  assert.deepEqual(plan.batches, partitionTests(plan.files, plan.batch_size));
  assert.match(planHash, /^[a-f0-9]{64}$/);
  const selected = new Map();
  for (const receipt of receipts) {
    const batch = plan.batches.find(item => item.id === receipt.batch);
    assert.ok(batch, 'Unplanned batch');
    assert.equal(receipt.plan_sha256, planHash);
    assert.deepEqual(receipt.files, batch.files, 'Cannot omit, replace or reorder planned files');
    assert.ok(['passed', 'failed', 'interrupted'].includes(receipt.status));
    if (receipt.status === 'interrupted') continue;
    assert.equal(receipt.status, 'passed', 'A failed batch requires a reviewed new qualification');
    assert.equal(receipt.source_unchanged, true);
    assert.equal(receipt.source_fingerprint, plan.source_fingerprint);
    assert.equal(receipt.owned_database_shutdown, true);
    assert.equal(receipt.fixture_cleanup?.status, 'passed');
    requirePassingCounts(receipt.counts);
    assert.ok(!selected.has(batch.id), 'A batch cannot contribute twice');
    selected.set(batch.id, receipt);
  }
  if (complete) assert.equal(selected.size, plan.batches.length, 'Every planned file must have a complete passing batch');
  return selected;
}
