"""Build an additive backend overlay. Frozen release files stay immutable."""
from pathlib import Path
import hashlib, json, zipfile

ROOT = Path(__file__).resolve().parents[3]
repo = ROOT / 'dev/copypaste-platform'
out = ROOT / 'dev/copypaste-delivery/.data/deployment-177'
archive = out / 'workmate-domain-runtime-177.zip'
rows = []
with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED, compresslevel=6) as z:
    for folder in ['dist', 'src']:
        for p in sorted((repo / folder).rglob('*')):
            if not p.is_file():
                continue
            name = p.relative_to(repo).as_posix()
            raw = p.read_bytes()
            z.writestr(name, raw)
            rows.append({'path': name, 'bytes': len(raw), 'sha256': hashlib.sha256(raw).hexdigest()})
    manifest = {
        'stage': 177, 'base_release': 'v0.1.3', 'files': rows,
        'dependency_lock_sha256': hashlib.sha256((repo / 'package-lock.json').read_bytes()).hexdigest(),
        'origins': {'web': 'https://agent.copypaste.hk', 'admin': 'https://agent-dashboard.copypaste.hk', 'api': 'https://ai-api.copypaste.hk'},
        'changes': 'Secure browser cookies follow the configured HTTPS audience, including authorized synthetic mode.',
    }
    z.writestr('manifest.json', json.dumps(manifest, ensure_ascii=False, indent=2) + '\n')
sha = hashlib.sha256(archive.read_bytes()).hexdigest()
receipt = {'archive': archive.name, 'bytes': archive.stat().st_size, 'sha256': sha, 'files': len(rows)}
with (out / 'runtime-package.json').open('x', encoding='utf-8') as f:
    json.dump(receipt, f, indent=2)
print(json.dumps(receipt))
