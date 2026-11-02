"""Package the current built backend without local data, keys or dependencies."""
from pathlib import Path
import hashlib
import json
import zipfile

root = Path(__file__).resolve().parents[3]
platform = root / 'dev/copypaste-platform'
directory = root / 'dev/copypaste-delivery/.data/deployment-189'
directory.mkdir(parents=True, exist_ok=True)
archive = directory / 'workmate-real-services-189-v2.zip'
rows = []
with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED, compresslevel=6) as output:
    for folder in ['src', 'dist', 'migrations']:
        for file in sorted((platform / folder).rglob('*')):
            if not file.is_file():
                continue
            name = 'backend/' + file.relative_to(platform).as_posix()
            raw = file.read_bytes()
            output.writestr(name, raw)
            rows.append(dict(path=name, bytes=len(raw), sha256=hashlib.sha256(raw).hexdigest()))
    manifest = dict(stage=189, schema_version=161, kernel='codex',
                    backend_dependency_lock_sha256=hashlib.sha256((platform / 'package-lock.json').read_bytes()).hexdigest(), files=rows)
    output.writestr('manifest.json', json.dumps(manifest, indent=2) + '\n')
digest = hashlib.sha256(archive.read_bytes()).hexdigest()
with archive.with_suffix('.zip.sha256').open('x', encoding='utf8') as stream:
    stream.write(digest + '  ' + archive.name + '\n')
print(json.dumps(dict(archive=str(archive), sha256=digest, files=len(rows), bytes=archive.stat().st_size)))
