"""Retain exact changed source bytes of a completed feedback qualification."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--attempt', required=True)
    parser.add_argument('--kind', choices=['checks', 'ui', 'desktop'], default='checks')
    args = parser.parse_args()
    attempt = args.attempt
    assert re.fullmatch(r'\d{2}', attempt)
    stem = 'desktop-local-ui' if args.kind == 'desktop' else 'creative-feedback-' + args.kind
    report_file = DEV / f'copypaste-delivery/evidence/{stem}-{attempt}.json'
    report = json.loads(report_file.read_text(encoding='utf-8'))
    assert report['source_unchanged'] and report['owned_database_shutdown']
    target = ROOT / f'docs/quality/history/stage82-{args.kind}-{attempt}-sources'
    assert not target.exists()
    changed = set()
    for component in ['platform', 'web', 'admin', 'desktop', 'extension', 'delivery']:
        repo = DEV / ('copypaste-' + component)
        args = ['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false']
        for command in [['diff', '--name-only', '-z', 'HEAD'], ['ls-files', '--others', '--exclude-standard', '-z']]:
            changed.update('copypaste-' + component + '/' + p for p in
                subprocess.check_output(args + command, cwd=repo).decode().split('\0') if p)
    rows = []
    for name in sorted(changed & set(report['source_files'])):
        raw = (DEV / name).read_bytes()
        assert sha256(raw).hexdigest() == report['source_files'][name], name
        destination = target / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(raw)
        rows.append({'path': name, 'archive': destination.relative_to(ROOT).as_posix(), 'sha256': sha256(raw).hexdigest()})
    target.mkdir(parents=True, exist_ok=True)
    (target / 'receipt.json').write_text(json.dumps({'at': datetime.now(timezone.utc).isoformat(), 'status': 'archived',
        'run_status': report['status'], 'report': report_file.relative_to(ROOT).as_posix(),
        'report_sha256': sha256(report_file.read_bytes()).hexdigest(), 'changed_files': rows,
        'original_evidence_rewritten': False}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': 'archived', 'run_status': report['status'], 'changed_files': len(rows)}))


if __name__ == '__main__':
    main()
