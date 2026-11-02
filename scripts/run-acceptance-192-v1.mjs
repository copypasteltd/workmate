import { spawn } from 'node:child_process';
import { mkdir, writeFile, readFile, open } from 'node:fs/promises';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
import assert from 'node:assert/strict';

const delivery = fileURLToPath(new URL('../', import.meta.url));
const dev = path.dirname(delivery), platform = path.join(dev, 'copypaste-platform');
const args = process.argv.slice(2), full = args.length === 1 && args[0] === '--full';
const files = full ? [] : args;
assert.ok(full || files.length > 0);
assert.ok(files.every(n => /^tests\/[a-z0-9-]+\.test\.ts$/.test(n)));
const directory = path.join(delivery, '.data/acceptance-192', 'regression-' + randomUUID());
await mkdir(directory, { recursive: true });
const require = createRequire(path.join(platform, 'package.json')), pg = require('pg');
const pin = JSON.parse(await readFile(path.join(dev, 'copypaste-desktop/contracts/local-codex-runtime.json'), 'utf8'));
const codex = path.join(dev, 'copypaste-desktop/.data/runtime/windows-x64/codex.exe');
const digest = b => createHash('sha256').update(b).digest('hex');
assert.equal(digest(await readFile(codex)), pin.windows_x64_sha256);
const probe = createServer();
await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
const port = probe.address().port;
await new Promise(resolve => probe.close(resolve));
const env = {
  ...process.env, NODE_ENV: 'development', MASTER_KEY: randomBytes(32).toString('hex'),
  CODEX_BIN: codex, CODEX_VERSION: pin.runtime_version,
  COPYPASTE_LOCAL_CODEX_BIN: codex, COPYPASTE_LOCAL_CODEX_TEST_BIN: codex,
  COPYPASTE_NATIVE_DATABASE_DIR: '.data/native-qa/' + randomUUID(),
  GIT_CONFIG_COUNT: '2', GIT_CONFIG_KEY_0: 'core.fsmonitor', GIT_CONFIG_VALUE_0: 'false',
  GIT_CONFIG_KEY_1: 'core.untrackedCache', GIT_CONFIG_VALUE_1: 'false',
};
for (const [key, user] of [['DATABASE_URL', 'cp_app'], ['CONTROL_DATABASE_URL', 'cp_control'],
  ['QUEUE_DATABASE_URL', 'cp_queue'], ['OWNER_DATABASE_URL', 'cp_owner']]) {
  env[key] = `postgresql://${user}:${randomBytes(24).toString('hex')}@127.0.0.1:${port}/copypaste`;
}
await writeFile(path.join(directory, 'native-test.private.env'), Object.entries(env)
  .filter(([k]) => k.endsWith('DATABASE_URL') || k === 'MASTER_KEY')
  .map(([k, v]) => k + '=' + v).join('\n') + '\n', { flag: 'wx', mode: 0o600 });
const report = { stage: 192, status: 'running', at: new Date().toISOString(),
  scope: full ? 'Full current regression, all clients and builds' : 'Targeted regression for native execution, capacity and desktop error propagation',
  files, native_port: port, native_database_directory: env.COPYPASTE_NATIVE_DATABASE_DIR,
  checks: [], local_virtualization_used: false };
let database, databaseLog;
async function run(component, label, argv) {
  const logPath = path.join(directory, component + '-' + label + '.log');
  const log = await open(logPath, 'wx');
  console.log(JSON.stringify({ phase: 'started', component, label, receipt_directory: directory }));
  const child = spawn(process.execPath, argv, { cwd: path.join(dev, 'copypaste-' + component),
    env, windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
  const exitCode = await new Promise((resolve, reject) => {
    child.once('error', reject); child.once('close', code => resolve(code ?? 1));
  }).finally(() => log.close());
  const bytes = await readFile(logPath);
  const counts = Object.fromEntries([...bytes.toString().matchAll(
    /^# (tests|pass|fail|cancelled|skipped|todo) (\d+)$/gm)].map(m => [m[1], Number(m[2])]));
  const check = { component, label, exit_code: exitCode, counts, log_sha256: digest(bytes) };
  report.checks.push(check); console.log(JSON.stringify(check));
  return check;
}
try {
  databaseLog = await open(path.join(directory, 'native-postgres.log'), 'wx');
  database = spawn(process.execPath, ['scripts/native-db-launch.mjs'], { cwd: platform,
    env, windowsHide: true, stdio: ['ignore', databaseLog.fd, databaseLog.fd, 'ipc'] });
  let ready = false;
  for (let attempt = 0; attempt < 600; attempt++) {
    assert.equal(database.exitCode, null, 'Owned PostgreSQL exited before readiness');
    const client = new pg.Client({ connectionString: env.OWNER_DATABASE_URL, connectionTimeoutMillis: 1000 });
    try {
      await client.connect();
      const history=(await client.query('SELECT count(*)::int n,max(version)::int last FROM public.schema_migrations')).rows[0]; ready=history.n===162 && history.last===162;
    } catch {} finally { await client.end().catch(() => {}); }
    if (ready) break;
    await new Promise(resolve => setTimeout(resolve, 500));
  }
  assert.ok(ready, 'Owned PostgreSQL did not become ready');
  const npm = path.join(path.dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js');
  if (full) {
    const pkg = JSON.parse(await readFile(path.join(platform, 'package.json'), 'utf8'));
    const entry = /^node --env-file=\.env (scripts\/run-current-tests-owned-v\d+\.mjs)$/.exec(pkg.scripts.test);
    assert.ok(entry, 'Unsupported current test entry');
    await run('platform', 'current-tests', ['--env-file=.env', entry[1]]);
    for (const component of ['web', 'admin', 'extension', 'desktop']) {
      for (const label of ['test', 'build']) await run(component, label, [npm, 'run', label]);
    }
  } else {
    await run('platform', 'remaining-targets', ['scripts/run-tests-owned.mjs', ...files]);
  }
  await run('platform', 'build', [npm, 'run', 'build']);
  report.status = report.checks.every(c => c.exit_code === 0 && !c.counts.fail && !c.counts.cancelled) ? 'passed' : 'failed';
} catch (error) {
  report.status = 'failed'; report.error = String(error.message);
} finally {
  if (database?.connected) database.send({ action: 'shutdown' });
  if (database && database.exitCode === null) await new Promise(resolve => database.once('close', resolve));
  await databaseLog?.close();
  report.native_database_closed = !database || database.exitCode !== null;
  report.finished_at = new Date().toISOString();
  await writeFile(path.join(directory, 'receipt.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ status: report.status, receipt: path.join(directory, 'receipt.json') }));
}
assert.equal(report.status, 'passed');
