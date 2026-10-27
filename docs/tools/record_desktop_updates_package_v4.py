"""Build unsigned development delivery without rewriting previous installer artifacts."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import json
import os
import shutil
import subprocess
import sys
from record_cloud_events import ROOT, DEV, L, read, digest, ref, write

D = DEV / 'copypaste-desktop'
OUT = L / 'evidence/desktop-updates-package-04.json'
LOG = L / 'evidence/desktop-updates-package-04-build.log'
TARGET = D / 'release/desktop-updates-116-final'
assert not OUT.exists() and not LOG.exists() and TARGET.is_dir()
prior_package = L / 'evidence/desktop-updates-package-03.json'
prior = read(prior_package)
assert prior['exit_code'] == 0 and prior['source_unchanged']
assert digest(L / prior['raw_report']['path']) == prior['raw_report']['sha256']
selected = read(L / 'evidence/desktop-updates-clients-02.json')
assert selected['status'] == 'passed' and selected['source_unchanged']
for name, expected in selected['source_files'].items(): assert digest(DEV / name) == expected, name
args = [os.environ['COMSPEC'], '/d', '/s', '/c',
        'npm.cmd run build']
runtime = D / '.data/runtime/windows-x64/codex.exe'
assert digest(runtime) == read(D / 'contracts/local-codex-runtime.json')['windows_x64_sha256']
package_env = {**os.environ, 'COPYPASTE_LOCAL_CODEX_BIN': str(runtime)}
with LOG.open('xb') as stream:
    result = subprocess.run(args, cwd=D, stdout=stream, stderr=subprocess.STDOUT, env=package_env)
unchanged = all(digest(DEV / n) == h for n, h in selected['source_files'].items())
error, packaged = None, None
try:
    assert result.returncode == 0, 'Development package command failed; inspect immutable build log'
    assert unchanged, 'Package build changed qualified source bytes'
    code = r'''
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { extractFile } from "@electron/asar";
const hash = b => createHash("sha256").update(b).digest("hex");
const directory = "release/desktop-updates-116-final/win-unpacked";
const archive = path.join(directory,"resources/app.asar");
const files = [];
async function walk(dir) {
 for(const e of await readdir(dir,{withFileTypes:true})) {
  const p=path.join(dir,e.name);
  if(e.isDirectory()) await walk(p);
  else {const expected=await readFile(p), actual=extractFile(archive,p);
   assert.equal(hash(actual),hash(expected),p);files.push({path:p.replaceAll("\\","/"),sha256:hash(actual)});}
 }
}
await walk("dist");await walk("renderer-dist");
const embedded=JSON.parse(extractFile(archive,"package.json").toString());
assert.equal(embedded.version,"0.6.0");
const runtime=JSON.parse(await readFile("contracts/local-codex-runtime.json","utf8"));
const codex=path.join(directory,"resources/local-codex/codex.exe");
assert.equal(hash(await readFile(codex)),runtime.windows_x64_sha256);
const manifest=JSON.parse(await readFile(".data/update-installer-host/manifest.json","utf8"));
const host=path.join(directory,"resources/update-installer-host/update-installer-host.exe");
assert.equal(hash(await readFile(host)),hash(await readFile(".data/update-installer-host/update-installer-host.exe")));
assert.equal(hash(await readFile(path.join(directory,"resources/update-installer-host/manifest.json"))),hash(await readFile(".data/update-installer-host/manifest.json")));
console.log(JSON.stringify({version:embedded.version,embedded_files:files,native_codex_sha256:hash(await readFile(codex)),native_update_helper_sha256:hash(await readFile(host)),native_helper_manifest:manifest}));
'''
    node = shutil.which('node')
    assert node
    verified = subprocess.run([node, '--input-type=module', '-e', code], cwd=D, capture_output=True)
    verify_log = L / 'evidence/desktop-updates-package-04-verify.log'
    verify_log.write_bytes(verified.stdout + verified.stderr)
    assert verified.returncode == 0, 'Finished artifact differs from the separate production build; inspect immutable verification log'
    packaged = json.loads(verified.stdout)
    artifacts = []
    for name in ['CopyPaste-0.6.0-x64-Setup.exe', 'CopyPaste-0.6.0-x64-Portable.exe', 'win-unpacked/CopyPaste.exe', 'win-unpacked/resources/app.asar']:
        p = TARGET / name
        assert p.is_file()
        artifacts.append({**ref(p), 'bytes': p.stat().st_size})
    packaged['artifacts'] = artifacts
except Exception as exc:
    error = str(exc)
write(OUT, {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed' if error is None else 'failed',
    'command': args[4], 'exit_code': result.returncode, 'raw_report': {'path': LOG.relative_to(L).as_posix(), 'sha256': digest(LOG)},
    'source_unchanged': unchanged, 'source_files': selected['source_files'], 'selected_builds': ref(L / 'evidence/desktop-updates-clients-02.json'),
    'packaged': packaged, 'error': error, 'installer_executed': False, 'company_signed': False,
    'retained_package_build': ref(prior_package), 'original_builder_exit_code': prior['exit_code'],
    'verification_log': ref(L / 'evidence/desktop-updates-package-04-verify.log') if (L / 'evidence/desktop-updates-package-04-verify.log').exists() else None,
    'scope': 'Restore the production build after completed QA-only renderer/preload builds, then verify the unchanged finished v3 installers and all 52 embedded files; prior failure is retained',
    'limitations': ['Unsigned development installers; installed-product upgrade and company release signature unqualified',
                    'Artifacts remain in ignored local release directory; no historical package overwritten'],
    'verifier_sha256': digest(Path(__file__))})
print(json.dumps({'status': 'passed' if error is None else 'failed', 'source_unchanged': unchanged,
                  'embedded_files': len((packaged or {}).get('embedded_files', [])), 'error': error}))
sys.exit(0 if error is None else 1)
