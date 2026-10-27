"""Verify staged local renderer and the runtime-derived Desktop recoverable pairing contract bytes."""
from pathlib import Path
from hashlib import sha1, sha256
from datetime import datetime, timezone
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DESKTOP = ROOT / 'dev/copypaste-desktop'
PLATFORM = ROOT / 'dev/copypaste-platform'
OUTPUT = ROOT / 'docs/quality/native-pairing-git-roundtrip-02.json'
assert not OUTPUT.exists()

def digest(data): return sha256(data).hexdigest()
def git(repo, *args):
    return subprocess.check_output(['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', *args], cwd=repo)

def staged(repo, names):
    index = {}
    for entry in git(repo, 'ls-files', '--stage', '-z').split(b'\0'):
        if not entry: continue
        meta, _, name = entry.partition(b'\t')
        mode, oid, stage = meta.split()
        assert stage == b'0'
        index[name.decode('utf-8')] = oid.decode()
    ids = list(dict.fromkeys(index[n] for n in names))
    raw = subprocess.check_output(['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', 'cat-file', '--batch'], cwd=repo, input=('\n'.join(ids)+'\n').encode())
    blobs, offset = {}, 0
    for oid in ids:
        end = raw.index(b'\n', offset)
        actual, kind, size = raw[offset:end].split()
        assert actual.decode() == oid and kind == b'blob'
        size = int(size); offset = end + 1
        body = raw[offset:offset+size]
        assert len(body) == size and raw[offset+size:offset+size+1] == b'\n'
        algorithm = sha1 if len(oid) == 40 else sha256
        assert algorithm(b'blob '+str(size).encode()+b'\0'+body).hexdigest() == oid
        blobs[oid] = body; offset += size+1
    assert offset == len(raw)
    return {name: blobs[index[name]] for name in names}

meta = json.loads(staged(DESKTOP, ['renderer-source.json'])['renderer-source.json'])
names = ['renderer/'+name for name in meta['files']]
source = staged(DESKTOP, names)
for name, expected in meta['files'].items():
    assert digest(source['renderer/'+name]) == digest((DESKTOP/'renderer'/name).read_bytes()) == expected, name
normative = staged(ROOT, ['docs/contracts/native-pairings.openapi.json'])['docs/contracts/native-pairings.openapi.json']
mirror = json.loads(staged(PLATFORM, ['contracts/desktop-pairing-schemas.json'])['contracts/desktop-pairing-schemas.json'])
assert json.loads(normative)['x-runtime-schema-sha256'] == digest(staged(PLATFORM, ['contracts/desktop-pairing-schemas.json'])['contracts/desktop-pairing-schemas.json'])
assert json.loads(normative)['components']['schemas'] == mirror['schemas']
assert staged(PLATFORM, ['src/desktop-pairing-contract.ts'])['src/desktop-pairing-contract.ts'] == staged(DESKTOP, ['src/desktop-pairing-contract.ts'])['src/desktop-pairing-contract.ts']
cp = json.loads((ROOT/'docs/quality/native-pairing-checkpoint.json').read_text('utf-8'))
for name, expected in cp['source_files'].items(): assert digest((ROOT/name).read_bytes()) == expected, name
delivery=ROOT/'dev/copypaste-delivery'
verifier_names=[name.removeprefix('dev/copypaste-delivery/') for name in cp['source_files'] if name.startswith('dev/copypaste-delivery/scripts/') and 'native-pairing' in name]
for name,body in staged(delivery,verifier_names).items():
    assert digest(body)==cp['source_files']['dev/copypaste-delivery/'+name],name
verifier_name = 'docs/tools/record_native_pairings.py'
assert digest(staged(ROOT, [verifier_name])[verifier_name]) == cp['verifier_sha256'] == digest((ROOT/verifier_name).read_bytes())
result = {'qualified_record_verifier_bytes_preserved': True, 'qualified_component_verifier_bytes_preserved': len(verifier_names), 'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed',
          'renderer_files_checked_from_actual_staged_blobs': len(names), 'normative_contract_sha256': digest(normative),
          'normative_schema_mirror_exact': True, 'qualified_source_files_rehashed': len(cp['source_files']),
          'scope': 'Actual Git index objects preserve every qualified renderer digest and the Desktop recoverable pairing normative contract digest after a fresh clone. Current qualified source bytes remain unchanged; explicit attributes preserve necessary CRLF bytes.',
          'verifier_sha256': digest(Path(__file__).read_bytes())}
with OUTPUT.open('x', encoding='utf-8', newline='\n') as stream:
    stream.write(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'status': 'passed', 'renderer_files': len(names), 'sources': len(cp['source_files'])}))
