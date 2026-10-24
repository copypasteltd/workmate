"""Preserve pre-edit audio inputs as opaque flat snapshots, never active Git rules."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / 'docs/quality/history/stage84-before-audio'
COMPONENTS = ['platform', 'web', 'admin', 'desktop', 'extension', 'delivery']


def git(repo, *args):
    return subprocess.run(['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', *args],
                          cwd=repo, capture_output=True, check=True).stdout


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--add', nargs='*', default=[])
    args = parser.parse_args()
    receipt_path = TARGET / 'receipt.json'
    if receipt_path.exists():
        result = json.loads(receipt_path.read_text(encoding='utf-8'))
    else:
        repositories = []
        for component in ['docs', *COMPONENTS]:
            repo = ROOT if component == 'docs' else ROOT / 'dev' / ('copypaste-' + component)
            if component != 'docs':
                assert not git(repo, 'status', '--porcelain'), component
            repositories.append({'component': component, 'head': git(repo, 'rev-parse', 'HEAD').decode().strip(),
                                 'branch': git(repo, 'branch', '--show-current').decode().strip()})
        sql = {p.name: digest(p) for p in (ROOT / 'dev/copypaste-platform/migrations').glob('*.sql')}
        assert len(sql) == 100
        result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'pre_audio_sources_preserved',
                  'repositories': repositories, 'published_migrations': sql,
                  'original_openapi': {name: digest(ROOT / name) for name in [
                      'docs/contracts/openapi.json', 'dev/copypaste-platform/catalog/openapi.json']},
                  'files': [], 'scope': 'Actual pre-edit source bytes, flattened with .snapshot suffix so captured Git attributes are inert. Additional files are accepted only when still equal to their baseline Git content, allowing declared CRLF/LF differences.'}
    known = {row['source']: row for row in result['files']}
    baseline = {item['component']: item['head'] for item in result['repositories']}
    for name in args.add:
        relative = Path(name)
        assert not relative.is_absolute() and '..' not in relative.parts
        if name in known:
            assert digest(ROOT / known[name]['archive']) == known[name]['sha256']
            continue
        component = 'docs'
        source_name = relative.as_posix()
        repo = ROOT
        if source_name.startswith('dev/copypaste-'):
            directory, source_name = source_name[len('dev/'):].split('/', 1)
            component = directory.removeprefix('copypaste-')
            assert component in COMPONENTS
            repo = ROOT / 'dev' / directory
        original = git(repo, 'show', baseline[component] + ':' + source_name)
        data = (ROOT / relative).read_bytes()
        assert original == data or original == data.replace(b'\r\n', b'\n'), name
        target = TARGET / 'files' / (component + '__' + source_name.replace('/', '__') + '.snapshot')
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as stream:
            stream.write(data)
        result['files'].append({'source': relative.as_posix(), 'archive': target.relative_to(ROOT).as_posix(),
                                'sha256': digest(target), 'baseline_git_blob_sha256': sha256(original).hexdigest(),
                                'declared_crlf_normalization_only': original != data})
    for row in result['files']:
        assert digest(ROOT / row['archive']) == row['sha256']
    result['verifier_sha256'] = digest(Path(__file__))
    receipt_path.parent.mkdir(parents=True, exist_ok=True)
    receipt_path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': result['status'], 'repositories': len(result['repositories']),
                      'published_migrations': len(result['published_migrations']), 'archived_files': len(result['files'])}))


if __name__ == '__main__':
    main()
