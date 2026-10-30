"""Install pinned native PostgreSQL utilities; never installs a service or VM."""
from pathlib import Path
from hashlib import sha256
import json, urllib.request, zipfile, sys

ROOT = Path(__file__).resolve().parents[1]
assert sys.platform == 'win32', 'Provision PostgreSQL 18 native utilities on other server platforms'
pin = json.loads((ROOT/'contracts/native-recovery-tools.json').read_text('utf-8-sig'))
base = ROOT/'.data/recovery-tools'
base.mkdir(parents=True, exist_ok=True)
assert not base.is_symlink()
archive = base/'postgresql-18.6-1-windows-x64-binaries.zip'
if not archive.exists():
    partial = base/'download.partial'
    with urllib.request.urlopen(pin['source'], timeout=60) as response, partial.open('xb') as output:
        total = 0
        while chunk := response.read(1024*1024):
            total += len(chunk)
            assert total <= pin['archive_bytes']
            output.write(chunk)
    assert total == pin['archive_bytes']
    assert sha256(partial.read_bytes()).hexdigest() == pin['archive_sha256']
    partial.rename(archive)
assert archive.stat().st_size == pin['archive_bytes']
assert sha256(archive.read_bytes()).hexdigest() == pin['archive_sha256']
target = base/'bin'
target.mkdir(exist_ok=True)
assert not target.is_symlink()
with zipfile.ZipFile(archive) as source:
    for name, digest in pin['files'].items():
        assert Path(name).name == name
        data = source.read('pgsql/bin/'+name)
        assert sha256(data).hexdigest() == digest
        destination = target/name
        if destination.exists(): assert sha256(destination.read_bytes()).hexdigest() == digest
        else: destination.write_bytes(data)
print(json.dumps({'status':'verified','version':pin['version'],'native_tools':len(pin['files'])}))
