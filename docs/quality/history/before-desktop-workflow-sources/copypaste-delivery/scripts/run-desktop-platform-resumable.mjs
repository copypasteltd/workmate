import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createWriteStream } from 'node:fs';
import { readFile, writeFile, readdir, lstat, unlink, mkdir } from 'node:fs/promises';
import { createHash, randomUUID } from 'node:crypto';
import { createConnection } from 'node:net';
import path from 'node:path';
import { partitionTests, parseCompleteTap, requirePassingCounts, qualifyBatchReceipts } from './platform-qualification-state.mjs';

const attempt = process.argv[2], action = process.argv[3];
assert.match(attempt ?? '', /^\d{2}$/);
assert.ok(['--init', '--next', '--finish'].includes(action) && process.argv.length === 4);
const delivery = process.cwd(), platform = path.resolve('../copypaste-platform'), desktop = path.resolve('../copypaste-desktop');
const prefix = 'evidence/desktop-execution-control-' + attempt, planPath = prefix + '-plan.json', lockPath = '.data/desktop-platform-' + attempt + '.lock';
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const save = (file, value) => writeFile(file, JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
async function freePort() {
  const occupied = await new Promise(resolve => { const socket = createConnection({ host: '127.0.0.1', port: 55432 }); socket.once('connect', () => { socket.destroy(); resolve(true); }); socket.once('error', () => resolve(false)); });
  assert.equal(occupied, false, 'Never adopt an occupied database');
}
async function inventory() {
  const entries = (await readdir(path.join(platform, 'tests'), { withFileTypes: true })).filter(entry => entry.name.endsWith('.test.ts'));
  entries.forEach(entry => assert.ok(entry.isFile() && !entry.isSymbolicLink()));
  const files = entries.map(entry => 'tests/' + entry.name).sort(); partitionTests(files); return files;
}
async function snapshot() {
  const source = {};
  for (const repo of [platform, desktop, delivery]) {
    const files = execFileSync('git', ['-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--',
      'src', 'renderer', 'renderer-source.json', 'vite.config.ts', 'tests', 'scripts', 'migrations', 'catalog', 'contracts', 'skills', 'package.json', 'package-lock.json', 'tsconfig.json'], { cwd: repo, encoding: 'utf8', windowsHide: true }).split('\0').filter(Boolean);
    for (const file of [...new Set(files)].sort()) source[path.basename(repo) + '/' + file] = sha(await readFile(path.join(repo, file)));
  }
  for (const file of await inventory()) assert.equal(source['copypaste-platform/' + file], sha(await readFile(path.join(platform, file))), 'All actual test files must be source-bound');
  return source;
}
async function binary() {
  const file = process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN; assert.ok(file && path.isAbsolute(file));
  const pin = await json(path.join(desktop, 'contracts/local-codex-runtime.json'));
  const digest = sha(await readFile(file)); assert.equal(digest, pin.windows_x64_sha256);
  return { path: file, sha256: digest, version: pin.runtime_version };
}
async function exists(file) { try { await lstat(file); return true; } catch (error) { if (error.code === 'ENOENT') return false; throw error; } }
await mkdir('.data', { recursive: true });
if (action === '--init') {
  for (const file of [planPath, prefix + '.json', prefix + '-verifier.mjs', lockPath]) assert.equal(await exists(file), false, 'Use a new attempt ID');
  await freePort();
  const source = await snapshot(), files = await inventory(), verifier = await readFile(import.meta.filename);
  const plan = { at: new Date().toISOString(), version: 1, execution_strategy: 'resumable_complete_file_inventory', files, batch_size: 4, batches: partitionTests(files, 4),
    source_files: source, source_fingerprint: sha(JSON.stringify(source)), native_binary: await binary(),
    verifier: { path: prefix + '-verifier.mjs', sha256: sha(verifier) } };
  await writeFile(plan.verifier.path, verifier, { flag: 'wx' }); await save(planPath, plan);
}
const plan = await json(planPath), planHash = sha(await readFile(planPath));
assert.equal(plan.version, 1);
assert.deepEqual(plan.files, await inventory());
assert.deepEqual(plan.batches, partitionTests(plan.files, plan.batch_size));
assert.equal(sha(await readFile(import.meta.filename)), plan.verifier.sha256, 'Resume with the exact verifier');
assert.equal(process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN, plan.native_binary.path);
assert.deepEqual(await snapshot(), plan.source_files, 'Covered source changed: use a new qualification');

// The lock establishes one active invocation. A dead invocation may only be
// recorded as interrupted after its port is free; its partial TAP never counts.
if (await exists(lockPath)) {
  const previousBytes = await readFile(lockPath), previous = JSON.parse(previousBytes);
  assert.equal(previous.plan_sha256, planHash);
  assert.ok(Number.isSafeInteger(previous.pid) && previous.pid > 0, 'Only inspect an explicit positive owner PID');
  if (previous.batch !== null) {
    const planned = plan.batches.find(batch => batch.id === previous.batch);
    assert.ok(planned); assert.deepEqual(previous.files, planned.files);
  } else assert.deepEqual(previous.files, []);
  let alive = true;
  try { process.kill(previous.pid, 0); } catch (error) { if (error.code === 'ESRCH') alive = false; else throw error; }
  assert.equal(alive, false, 'Wait for the current owning invocation'); await freePort();
  assert.match(previous.receipt, new RegExp('^' + prefix + '-(?:setup|batch-\\d{2})-attempt-\\d{2}\\.json$'));
  if (!(await exists(previous.receipt))) {
    const raw = previous.receipt.replace(/\.json$/, '.tap'), bytes = await readFile(raw).catch(error => { if (error.code === 'ENOENT') return null; throw error; });
    await save(previous.receipt, { at: new Date().toISOString(), status: 'interrupted', plan_sha256: planHash, batch: previous.batch, files: previous.files,
      counts: null, source_unchanged: null, owned_database_shutdown: null, raw_report: bytes ? { path: raw, sha256: sha(bytes) } : null,
      note: 'Owner no longer exists and the port is free. No final TAP/source/cleanup result; this attempt contributes no coverage.' });
  }
  assert.deepEqual(await readFile(lockPath), previousBytes); await unlink(lockPath);
}
const token = randomUUID();
await save(lockPath, { pid: process.pid, token, plan_sha256: planHash, receipt: prefix + '-setup-attempt-00.json', files: [], batch: null });
async function replaceLock(value) {
  await writeFile(lockPath, JSON.stringify({ pid: process.pid, token, plan_sha256: planHash, ...value }));
}
const evidenceNames = () => readdir('evidence');
async function receipts(kind) {
  const pattern = new RegExp('^desktop-execution-control-' + attempt + '-' + kind + '-attempt-\\d{2}\\.json$');
  const found = [];
  for (const name of (await evidenceNames()).filter(name => pattern.test(name)).sort()) found.push({ file: 'evidence/' + name, data: await json('evidence/' + name) });
  return found;
}
async function passingSetup() {
  const rows = await receipts('setup');
  assert.ok(!rows.some(row => row.data.status === 'failed'), 'Review the failed setup before a new qualification');
  const passed = rows.filter(row => row.data.status === 'passed'); assert.ok(passed.length <= 1);
  if (!passed.length) return null;
  const value = passed[0].data; assert.equal(value.plan_sha256, planHash); assert.equal(value.source_fingerprint, plan.source_fingerprint);
  assert.equal(value.source_unchanged, true); requirePassingCounts(value.counts);
  assert.ok(value.checks.length === 2 && value.checks.every(check => check.exit_code === 0));
  assert.equal(sha(await readFile(value.raw_report.path)), value.raw_report.sha256);
  assert.deepEqual(parseCompleteTap(await readFile(value.raw_report.path, 'utf8')), value.counts); return passed[0];
}
async function runStep(batch) {
  await freePort();
  const label = batch ? 'batch-' + batch.id : 'setup', rows = await receipts(label);
  assert.ok(!rows.some(row => row.data.status === 'failed'), 'Review the failed batch before a new qualification');
  const started = (await evidenceNames()).filter(name => new RegExp('^desktop-execution-control-' + attempt + '-' + label + '-attempt-\\d{2}-started\\.json$').test(name));
  const step = prefix + '-' + label + '-attempt-' + String(started.length + 1).padStart(2, '0');
  const start = { at: new Date().toISOString(), pid: process.pid, plan_sha256: planHash, batch: batch?.id ?? null, files: batch?.files ?? [] };
  await save(step + '-started.json', start); await replaceLock({ receipt: step + '.json', files: start.files, batch: start.batch });
  const log = createWriteStream(step + '.tap', { flags: 'wx' });
  function launch(args, cwd, env = {}) {
    const child = spawn(process.execPath, args, { cwd, env: { ...process.env, ...env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    const closed = new Promise(resolve => { child.once('close', code => resolve(code ?? 1)); child.once('error', () => resolve(1)); }); return { child, closed };
  }
  let database, shutdown = null, error = null, counts = null, cleanup = null;
  const checks = [];
  try {
    if (!batch) {
      for (const [name, args, cwd] of [['platform typecheck', ['node_modules/typescript/bin/tsc', '--noEmit'], platform],
        ['qualification-state unit tests', ['--test', 'tests/platform-qualification-state.test.mjs'], delivery]]) {
        const code = await launch(args, cwd).closed; checks.push({ name, exit_code: code }); assert.equal(code, 0, name);
      }
    } else {
      database = launch(['scripts/native-db-launch.mjs'], platform, { COPYPASTE_NATIVE_DATABASE_START_ONLY: 'true' }); let output = '';
      database.child.stdout.on('data', bytes => { output = (output + bytes.toString()).slice(-16000); }); const end = Date.now() + 900000;
      while (!output.includes('Native PostgreSQL ready')) { assert.equal(database.child.exitCode, null); assert.ok(Date.now() < end); await new Promise(resolve => setTimeout(resolve, 200)); }
      const code = await launch(['--env-file=.env', 'scripts/run-tests-owned.mjs', ...batch.files], platform).closed;
      checks.push({ name: 'complete planned batch', exit_code: code }); assert.equal(code, 0);
    }
  } catch (caught) { error = String(caught); }
  finally {
    if (database?.child.connected && database.child.exitCode === null) database.child.send({ action: 'shutdown' });
    if (database) shutdown = await database.closed;
    await new Promise(resolve => log.end(resolve));
    const raw = await readFile(step + '.tap'), text = raw.toString(), unchanged = JSON.stringify(await snapshot()) === JSON.stringify(plan.source_files);
    try {
      counts = parseCompleteTap(text); requirePassingCounts(counts);
      if (batch) {
        const match = text.match(/^# owned_fixture_cleanup (.+)\r?$/m); assert.ok(match); const marker = JSON.parse(match[1]); assert.equal(marker.exit_code, 0);
        const file = path.resolve(platform, marker.path), allowed = path.join(platform, '.data/test-fixture-reclamation');
        assert.ok(file.startsWith(allowed + path.sep) && path.basename(file) === 'result.json');
        const bytes = await readFile(file); assert.equal(sha(bytes), marker.sha256);
        const result = JSON.parse(bytes); assert.equal(result.status, 'passed'); assert.equal(result.workers_exited, true); assert.ok(result.results.every(item => item.reclaimed));
        await writeFile(step + '-fixture-cleanup.json', bytes, { flag: 'wx' }); cleanup = { path: step + '-fixture-cleanup.json', sha256: sha(bytes), status: result.status };
      }
    } catch (caught) { error = [error, String(caught)].filter(Boolean).join('\n'); }
    const passed = !error && unchanged && (!batch || shutdown === 0) && !!counts;
    const report = { ...start, at: new Date().toISOString(), status: passed ? 'passed' : 'failed', error, checks, counts,
      source_unchanged: unchanged, source_fingerprint: sha(JSON.stringify(await snapshot())), owned_database_shutdown: batch ? shutdown === 0 : null,
      fixture_cleanup: cleanup, raw_report: { path: step + '.tap', sha256: sha(raw) } };
    await save(step + '.json', report); console.log(JSON.stringify({ status: report.status, batch: batch?.id ?? 'setup', counts, error }));
    assert.equal(report.status, 'passed', 'Inspect the immutable step receipt'); return report;
  }
}
async function finish(setup, batches) {
  const selected = qualifyBatchReceipts(plan, planHash, batches.map(row => row.data), true);
  assert.deepEqual(await snapshot(), plan.source_files); assert.deepEqual(await binary(), plan.native_binary); await freePort();
  const totals = Object.fromEntries(['tests', 'pass', 'fail', 'cancelled', 'skipped', 'todo'].map(key => [key, [...selected.values()].reduce((sum, row) => sum + row.counts[key], 0)])); requirePassingCounts(totals);
  let combined = '';
  for (const value of selected.values()) {
    const raw = await readFile(value.raw_report.path); assert.equal(sha(raw), value.raw_report.sha256); assert.deepEqual(parseCompleteTap(raw.toString()), value.counts); combined += raw.toString() + '\n';
    const bytes = await readFile(value.fixture_cleanup.path); assert.equal(sha(bytes), value.fixture_cleanup.sha256);
    const cleanup = JSON.parse(bytes); assert.equal(cleanup.status, 'passed'); assert.ok(cleanup.results.every(item => item.reclaimed));
  }
  const required = ['all seventeen connected native roles', 'native company tools recheck owner', 'native designer generation and editing', 'native company namespace rejects altered schemas',
    'an unknown native company image result fences', 'real native Codex edits local files, uses company Image 2 and same-thread edits'];
  required.forEach(name => assert.ok(combined.split(/\r?\n/).some(line => /^ok \d+ - /.test(line) && line.includes(name)), name));
  const chosen = [...selected.values()].map(data => { const row = batches.find(item => item.data === data); return { path: row.file, sha256: null, batch: data.batch, files: data.files, counts: data.counts }; });
  for (const row of chosen) row.sha256 = sha(await readFile(row.path));
  const index = { plan: { path: planPath, sha256: planHash }, setup: { path: setup.file, sha256: sha(await readFile(setup.file)) }, batches: chosen,
    note: 'All fixed test files executed with one isolated database-owning invocation per batch. Raw TAP files are separate and are never presented as a fabricated single TAP stream.' };
  await save(prefix + '-index.json', index);
  const report = { at: new Date().toISOString(), status: 'passed', execution_strategy: plan.execution_strategy,
    scope: 'all_platform_tests_including_cloud_business_tools_and_native_execution', counts: totals, checks: setup.data.checks,
    source_files: plan.source_files, source_unchanged: true, source_fingerprint: plan.source_fingerprint, owned_database_shutdown: true,
    native_binary_exercised: true, native_binary: plan.native_binary, required_scenarios: required,
    coverage: index, raw_report: { path: prefix + '-index.json', sha256: sha(await readFile(prefix + '-index.json')) }, verifier: plan.verifier,
    error: null, qualification_state_test_counts: setup.data.counts,
    not_validated: ['live_model_and_image_quality', 'human_native_dialog_clicks', 'signed_installer', 'all_roles_and_tools', 'entire_product_acceptance'] };
  await save(prefix + '.json', report); console.log(JSON.stringify({ status: 'passed', counts: totals, files: plan.files.length, batches: selected.size }));
}
try {
  const setup = await passingSetup();
  if (!setup) { assert.notEqual(action, '--finish'); await runStep(null); }
  else {
    const batches = await receipts('batch-\\d{2}'), selected = qualifyBatchReceipts(plan, planHash, batches.map(row => row.data));
    const next = plan.batches.find(batch => !selected.has(batch.id));
    if (action === '--finish' || !next) await finish(setup, batches);
    else await runStep(next);
  }
} finally {
  const lock = await json(lockPath); assert.equal(lock.pid, process.pid); assert.equal(lock.token, token); await unlink(lockPath);
}
