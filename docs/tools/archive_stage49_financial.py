"""Preserve current phase 49 evidence before implementing financial delivery."""
from pathlib import Path
import hashlib
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / 'dev/copypaste-delivery/evidence'
DEST = EVIDENCE / 'stage49-before-finance'
assert not DEST.exists()
sources = {p for p in EVIDENCE.iterdir() if p.is_file() and p.suffix in {'.json', '.tap', '.log'}}
quality = ROOT / 'docs/quality'
sources.update(p for p in quality.iterdir() if p.is_file())
for folder in [quality / 'current-ui', *ROOT.glob('dev/copypaste-*/assets/screenshots')]:
    if folder.is_dir():
        sources.update(p for p in folder.rglob('*') if p.is_file())
sources.update(ROOT.glob('dev/copypaste-*/README*.md'))
entries = []
for index, source in enumerate(sorted(sources), 1):
    assert source.resolve().is_relative_to(ROOT.resolve())
    target = DEST / f'{index:04d}-{source.stem[:50]}{source.suffix}'
    target.parent.mkdir(parents=True, exist_ok=True)
    data = source.read_bytes()
    target.write_bytes(data)
    entries.append({'source': source.relative_to(ROOT).as_posix(),
                    'archived': target.relative_to(ROOT).as_posix(),
                    'sha256': hashlib.sha256(data).hexdigest()})
heads = {name: subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT / f'dev/copypaste-{name}', text=True).strip()
         for name in ['platform', 'web', 'admin', 'desktop', 'extension', 'delivery']}
(DEST / 'archive-map.json').write_text(json.dumps({
    'scope': 'Exact phase 49 receipts, raw logs and captures before financial outbox changes. Flat short archive names preserve Windows clone compatibility; original paths and bytes remain explicit. No credentials or recursive archives.',
    'heads': heads, 'files': entries}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({'archived_files': len(entries)}))
