"""Verify the new package's compiled bytes while retaining its UI baseline scope."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[2]
DESKTOP = ROOT / 'dev/copypaste-desktop'
DELIVERY = ROOT / 'dev/copypaste-delivery'

def digest(file):
    with file.open('rb') as stream:
        return sha256_stream(stream)

def sha256_stream(stream):
    value = sha256()
    for chunk in iter(lambda: stream.read(1024 * 1024), b''):
        value.update(chunk)
    return value.hexdigest()

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--native', required=True)
    args = parser.parse_args()
    assert re.fullmatch(r'\d{2}', args.native)
    native_file = DELIVERY / ('evidence/paid-input-native-' + args.native + '.json')
    journey_file = DELIVERY / ('evidence/paid-input-native-' + args.native + '-journey.json')
    native = json.loads(native_file.read_text(encoding='utf-8'))
    journey = json.loads(journey_file.read_text(encoding='utf-8'))
    assert native['status'] == journey['status'] == 'passed'
    assert native['counts'] == {'checks': 32, 'errors': 0}
    assert journey['desktop_closed'] and journey['browser_closed'] and journey['extension_closed'] and journey['artifacts_unchanged_after_run']
    candidate = DESKTOP / 'release/client-direction-70-01'
    runtime = candidate / 'win-unpacked'
    tested = journey['tested_artifacts']['desktop']
    assert digest(runtime / 'CopyPaste.exe') == tested['executable_sha256']
    for item in tested['runtime_files']:
        assert digest(runtime / item['path']) == item['sha256']
    for item in tested['installer_files']:
        assert digest(candidate / item['path']) == item['sha256']
    for item in tested['source_files']:
        assert digest(DESKTOP / item['path']) == item['sha256']
    # Compare all current compiled main/preload/library and renderer bytes with
    # the actual immutable archive exercised by the journey, not merely an EXE.
    javascript = r'''
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
const desktop = process.argv[1], archive = process.argv[2];
const require = createRequire(path.join(desktop, "package.json"));
const { extractFile } = require("@electron/asar");
const entries = [];
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function walk(relative) {
  for (const entry of await readdir(path.join(desktop, relative), { withFileTypes: true })) {
    const name = relative + "/" + entry.name;
    if (entry.isSymbolicLink()) throw new Error("Unexpected symbolic link");
    if (entry.isDirectory()) await walk(name);
    else {
      const current = sha(await readFile(path.join(desktop, name)));
      const packed = sha(extractFile(archive, path.join(...name.split("/"))));
      if (current !== packed) throw new Error("Compiled bytes mismatch: " + name);
      entries.push({ path: name, sha256: packed });
    }
  }
}
await walk("dist"); await walk("renderer-dist");
if (!entries.some((entry) => entry.path === "dist/local-codex.js")) throw new Error("Missing local supervisor library");
process.stdout.write(JSON.stringify(entries));
'''
    result = subprocess.run(['node', '--input-type=module', '-e', javascript, str(DESKTOP), str(runtime / 'resources/app.asar')],
        cwd=DESKTOP, capture_output=True)
    if result.returncode:
        sys.stderr.buffer.write(result.stderr)
        raise RuntimeError('Compiled archive verification subprocess failed')
    entries = json.loads(result.stdout)
    artifacts = [{'path': file.relative_to(ROOT).as_posix(), 'sha256': digest(file), 'bytes': file.stat().st_size}
        for file in (runtime / 'CopyPaste.exe', runtime / 'resources/app.asar', candidate / 'CopyPaste-0.5.0-x64-Setup.exe',
                     candidate / 'CopyPaste-0.5.0-x64-Portable.exe')]
    report = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'package_bytes_verified_existing_UI_scope_only',
        'scope': 'New unsigned localhost candidate contains the compiled native supervisor library. Its Electron main entry point still runs the cloud/file-bridge UI. Native Codex executable bundling, local consent/billing and full local-Agent product flows are not qualified.',
        'native_journey': {'path': native_file.relative_to(ROOT).as_posix(), 'sha256': digest(native_file)},
        'journey_artifacts_unchanged': True, 'owned_clients_closed': True,
        'compiled_archive_files': entries, 'artifacts': artifacts, 'verifier_sha256': digest(Path(__file__))}
    output = ROOT / 'docs/quality/client-direction-package.json'
    with output.open('x', encoding='utf-8', newline='\n') as stream:
        stream.write(json.dumps(report, ensure_ascii=False, indent=2) + '\n')
    print(json.dumps({'status': report['status'], 'compiled_files': len(entries), 'artifacts': len(artifacts)}))

if __name__ == '__main__':
    main()
