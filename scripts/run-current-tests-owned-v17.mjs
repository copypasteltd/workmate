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
  const scoped = new Set(['tests/analysis-role-tools.test.ts','tests/cloud-workflows.test.ts','tests/paid-task-inputs.test.ts']);
  const pinned = files.filter(f => scoped.has(f)), ordinary = files.filter(f => !scoped.has(f));
  let pinEnv = {};
  if (pinned.length) {
    const { readFile } = await import('node:fs/promises'), { createHash } = await import('node:crypto'), { execFileSync } = await import('node:child_process'), path = await import('node:path');
    const pin = JSON.parse(await readFile('../copypaste-desktop/contracts/local-codex-runtime.json','utf8'));
    const binary = path.resolve(process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN ?? '../copypaste-desktop/.data/runtime/windows-x64/codex.exe');
    assert.equal(createHash('sha256').update(await readFile(binary)).digest('hex'),pin.windows_x64_sha256,'Prepare the actual locked native Codex before integration tests');
    assert.equal(execFileSync(binary,['--version'],{encoding:'utf8',windowsHide:true}).trim().replace(/^codex-cli\s+/,''),pin.runtime_version);
    pinEnv = { CODEX_BIN: binary, CODEX_VERSION: pin.runtime_version };
  }
  let exit = 0;
  for (const group of [...(ordinary.length ? [{ files: ordinary, env: {} }] : []), ...pinned.map(f => ({ files: [f], env: pinEnv }))]) {
    const child = spawn(process.execPath, ['scripts/run-tests-owned-v2.mjs', ...group.files], {
      stdio: 'inherit', windowsHide: true, env: { ...process.env, ...group.env },
    });
    const code = await new Promise((resolve,reject) => { child.once('error',reject); child.once('close',c=>resolve(c??1)); });
    if(code !== 0) exit = code;
  }
  process.exitCode = exit;
}
