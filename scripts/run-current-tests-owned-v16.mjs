import assert from 'node:assert/strict';
import { readdir } from 'node:fs/promises';
import { spawn } from 'node:child_process';

// Named historical suites remain explicitly runnable. Replacements retain their
// assertions under the currently published administrator and task contracts.
const supersededBase = new Set([
  // Round205 exact-call recovery replaces historical tool-name recovery. Original files and failed evidence remain.
  'runtime-feedback-native-204-v1.test.ts', 'runtime-feedback-native-204-v2.test.ts',
  'desktop-executions.test.ts', 'admin-accounts.test.ts', 'admin-approvals.test.ts',
  'admin-fees.test.ts', 'provider-admin.test.ts', 'analytics-workbook.test.ts',
  'current-test-discovery-141-v1.test.ts', 'current-test-discovery-188-v1.test.ts',
  'current-test-discovery-188-v2.test.ts', 'audio-accounting.test.ts',
  'capability-audio-verification.test.ts', 'capability-video-verification.test.ts',
  'generated-video-jobs.test.ts', 'capability-releases.test.ts',
  'plan-versions.test.ts', 'financial-notifications.test.ts', 'project-configuration.test.ts',
  'vip-lifecycle.test.ts', 'vip-credit-combinations.test.ts', 'platform.test.ts',
  'notifications.test.ts', 'persistent-work.test.ts', 'migrations.test.ts',
  'canonical-tasks.test.ts', 'task-control.test.ts', 'demo.test.ts',
  'brand-production.test.ts', 'dedicated-cloud.test.ts', 'capability-bindings.test.ts',
  'seo-change-tasks.test.ts', 'desktop-browser-policy.test.ts', 'audio-authorization-upgrade.test.ts',
]);
const names = (await readdir('tests')).filter(n => n.endsWith('.test.ts')).sort();
const latest = new Map();
for (const name of names) {
  const match = /^(.+-\d+)-v([1-9]\d*)\.test\.ts$/.exec(name);
  if (!match) continue;
  const version = Number(match[2]);
  assert.ok(Number.isSafeInteger(version), 'Test attempt version is too large');
  if (!latest.has(match[1]) || latest.get(match[1]).version < version)
    latest.set(match[1], { version, name });
}
const current = names.filter(name => {
  if (supersededBase.has(name)) return false;
  const match = /^(.+-\d+)-v([1-9]\d*)\.test\.ts$/.exec(name);
  return !match || latest.get(match[1]).name === name;
});
const selected = new Set(current), files = current.map(n => 'tests/' + n);
if (process.argv[2] === '--list') {
  assert.equal(process.argv.length, 3, 'Only --list is supported');
  console.log(JSON.stringify({ current_test_files: files, retained_historical: names.filter(n => !selected.has(n)) }));
} else {
  assert.equal(process.argv.length, 2, 'Run explicit historical attempts through run-tests-owned.mjs');
  const child = spawn(process.execPath, ['scripts/run-tests-owned.mjs', ...files], {
    stdio: 'inherit', windowsHide: true, env: process.env,
  });
  child.once('error', () => { process.exitCode = 1; });
  child.once('close', code => { process.exitCode = code ?? 1; });
}
