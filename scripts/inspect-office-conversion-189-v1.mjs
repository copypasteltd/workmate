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
const profile = path.join(root, 'profile'), output = path.join(root, 'output'), input = path.join(root, 'input.xlsx');
await mkdir(path.join(profile, 'user'), { recursive: true }); await mkdir(output);
await writeFile(input, campaignWorkbook());
await writeFile(path.join(profile, 'user/registrymodifications.xcu'), '<?xml version="1.0"?><oor:items xmlns:oor="http://openoffice.org/2001/registry"><item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item></oor:items>');
const log = await open(path.join(root, 'converter.log'), 'wx');
const child = spawn(runtime.host_path, [String(process.pid), runtime.office_path,
  pathToFileURL(profile).href, output, input, root], { windowsHide: true, stdio: ['ignore', log.fd, log.fd] });
const report = { stage: 189, scope: 'Owned native Office conversion of synthetic workbook; existing Office applications untouched.', host_pid: child.pid };
const timer = setTimeout(() => child.kill('SIGKILL'), 55000);
try {
  report.exit_code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
  try { const bytes = await readFile(path.join(output, 'input.pdf')); report.pdf_bytes = bytes.length; report.pdf_sha256 = createHash('sha256').update(bytes).digest('hex'); } catch {}
} finally {
  clearTimeout(timer); await log.close();
  report.native_job_closed = child.exitCode !== null || child.signalCode !== null;
  await writeFile(path.join(root, 'receipt.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ directory: root, ...report }));
}
