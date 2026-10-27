"""Verify the staged native renderer snapshot and normative GEO contract bytes."""
from pathlib import Path
from hashlib import sha1, sha256
from datetime import datetime, timezone
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DESKTOP = ROOT / 'dev/copypaste-desktop'
PLATFORM = ROOT / 'dev/copypaste-platform'
OUTPUT = ROOT / 'docs/quality/report-layout-git-roundtrip-01.json'
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
normative = staged(ROOT, ['docs/contracts/web-analytics.openapi.json'])['docs/contracts/web-analytics.openapi.json']
mirror = json.loads(staged(PLATFORM, ['contracts/web-analytics-schemas.json'])['contracts/web-analytics-schemas.json'])
assert digest(normative) == mirror['normative_source_sha256']
assert json.loads(normative)['components']['schemas'] == mirror['schemas']
cp = json.loads((ROOT/'docs/quality/report-layout-checkpoint.json').read_text('utf-8'))
for name, expected in cp['source_files'].items(): assert digest((ROOT/name).read_bytes()) == expected, name
result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed',
          'renderer_files_checked_from_actual_staged_blobs': len(names), 'normative_contract_sha256': digest(normative),
          'normative_schema_mirror_exact': True, 'qualified_source_files_rehashed': len(cp['source_files']),
          'scope': 'Actual Git index objects preserve every qualified renderer digest and the website-analysis normative contract digest after a fresh clone. Current qualified source bytes remain unchanged; explicit attributes preserve necessary CRLF bytes.',
          'verifier_sha256': digest(Path(__file__).read_bytes())}
with OUTPUT.open('x', encoding='utf-8', newline='\n') as stream:
    stream.write(json.dumps(result, ensure_ascii=False, indent=2)+'\n')
print(json.dumps({'status': 'passed', 'renderer_files': len(names), 'sources': len(cp['source_files'])}))
