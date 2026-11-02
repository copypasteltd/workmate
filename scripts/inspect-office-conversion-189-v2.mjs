import { readFile, writeFile, mkdir, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import assert from 'node:assert/strict';
import { campaignWorkbook } from '../tests/document-fixtures-146-v2.ts';

const root = path.resolve('.data/document-preview/diagnostic-189-' + randomUUID());
await mkdir(root, { recursive: true });
const runtime = JSON.parse(await readFile('.data/document-preview/runtime.json', 'utf8'));
for (const [file, expected] of [[runtime.office_path, runtime.office_sha256], [runtime.host_path, runtime.host_sha256]])
  assert.equal(createHash('sha256').update(await readFile(file)).digest('hex'), expected);
const results = [];
for (const [full, logged] of [[true, false], [true, true], [false, false], [false, true]]) {
  const directory = path.join(root, `case-${full ? 'full' : 'macro'}-${logged ? 'logged' : 'ignored'}`);
  const profile = path.join(directory, 'profile'), output = path.join(directory, 'output'), input = path.join(directory, 'input.xlsx');
  await mkdir(path.join(profile, 'user'), { recursive: true }); await mkdir(output);
  await writeFile(input, campaignWorkbook());
  await writeFile(path.join(profile, 'user/registrymodifications.xcu'), '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>' + (full ? '<item oor:path="/org.openoffice.Office.Common/Load"><prop oor:name="UpdateDocMode" oor:op="fuse"><value>0</value></prop></item><item oor:path="/org.openoffice.Office.Calc/Content/Update"><prop oor:name="Link" oor:op="fuse"><value>0</value></prop></item>' : '') + '</oor:items>');
  const log = logged ? await open(path.join(directory, 'converter.log'), 'wx') : undefined;
  const started = Date.now();
  const child = spawn(runtime.host_path, [String(process.pid), runtime.office_path,
    pathToFileURL(profile).href, output, input, directory], { windowsHide: true, stdio: logged ? ['ignore', log.fd, log.fd] : 'ignore' });
  const result = { full_security_profile: full, logged, host_pid: child.pid };
  const timer = setTimeout(() => child.kill('SIGKILL'), 55000);
  try {
    result.exit_code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    try { const bytes = await readFile(path.join(output, 'input.pdf')); result.pdf_bytes = bytes.length; result.pdf_sha256 = createHash('sha256').update(bytes).digest('hex'); } catch {}
  } finally {
    clearTimeout(timer); await log?.close();
    result.native_job_closed = child.exitCode !== null || child.signalCode !== null;
    result.elapsed_ms = Date.now() - started;
    results.push(result); console.log(JSON.stringify(result));
  }
}
await writeFile(path.join(root, 'receipt.json'), JSON.stringify({ stage: 189, results }, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ directory: root }));
