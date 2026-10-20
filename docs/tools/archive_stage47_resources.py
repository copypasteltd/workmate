"""Preserve the exact observed phase 47 receipts before quota repair."""
from pathlib import Path
import hashlib
import json
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEST = ROOT / 'dev/copypaste-delivery/evidence/stage47-before-resource-quotas'
assert not DEST.exists(), 'An observed archive must never be overwritten'
sources = set()
evidence = ROOT / 'dev/copypaste-delivery/evidence'
sources.update(p for p in evidence.iterdir() if p.is_file() and p.suffix in {'.json', '.tap', '.log'})
quality = ROOT / 'docs/quality'
sources.update(p for p in quality.iterdir() if p.is_file())
for folder in [quality / 'current-ui', *ROOT.glob('dev/copypaste-*/assets/screenshots')]:
    if folder.is_dir():
        sources.update(p for p in folder.rglob('*') if p.is_file())
heads = {name: subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT / f'dev/copypaste-{name}', text=True).strip()
         for name in ['platform', 'web', 'admin', 'desktop', 'extension', 'delivery']}
entries = []
for source in sorted(sources):
    relative = source.relative_to(ROOT)
    target = DEST / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(source, target)
    entries.append({'source': relative.as_posix(), 'archived': target.relative_to(ROOT).as_posix(),
                    'sha256': hashlib.sha256(source.read_bytes()).hexdigest()})
(DEST / 'archive-map.json').write_text(json.dumps({'scope': 'Exact current phase 47 receipts and screenshot sources before enterprise resource enforcement; no recursive archives or credentials',
                                                 'heads': heads, 'files': entries}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'archived_files': len(entries), 'manifest': str(DEST / 'archive-map.json')}, ensure_ascii=True))
