"""Review and copy exact candidate bytes without losing published source files."""
from pathlib import Path, PurePosixPath
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
RAW = DEV / 'copypaste-delivery-cloud-121/.data/dedicated-cloud-121'
OUT = DEV / 'copypaste-delivery/.data/dedicated-cloud-integration-121'
PAIRS = {'platform': 'copypaste-platform-recovery-120',
         **{name: f'copypaste-{name}-cloud-121' for name in ['web', 'admin', 'desktop', 'extension', 'delivery']}}
DIRECTORIES = {'src', 'tests', 'scripts', 'contracts', 'public', 'catalog', 'skills',
               'migrations', 'renderer', 'native', 'deployment', 'licenses'}
NAMES = {'package.json', 'package-lock.json', 'renderer-source.json', '.gitignore',
         '.gitattributes', '.env.example', 'vite.config.ts'}


def git(repo, *args):
    return subprocess.check_output(['git', '-c', 'core.fsmonitor=false', '-c',
                                    'core.untrackedCache=false', *args], cwd=repo)


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def checked(repo, name):
    assert '\\' not in name and ':' not in name
    p = PurePosixPath(name)
    assert not p.is_absolute() and all(part not in ['', '.', '..'] for part in p.parts)
    file = repo / p
    assert not file.is_symlink() and file.resolve().is_relative_to(repo.resolve()), file
    return file


def eligible(name):
    p = PurePosixPath(name)
    return (p.parts[0] in DIRECTORIES or name in NAMES or
            (len(p.parts) == 1 and p.name.startswith('tsconfig') and p.suffix == '.json') or
            (p.parts[0] == 'assets' and (len(p.parts) == 2 or p.parts[1] != 'screenshots')))


def inventory(repo):
    rows = git(repo, 'ls-files', '--cached', '--others', '--exclude-standard', '-z').split(b'\0')
    return sorted({row.decode('utf-8') for row in rows if row and eligible(row.decode('utf-8'))})


def selected_media():
    result = {name: set() for name in PAIRS}
    for run in ['desktop-ui-06', 'ui-12', 'extension-ui-03']:
        value = json.loads((RAW / (run + '-journey.json')).read_text(encoding='utf-8'))
        assert value['status'] == 'passed' and len(value['checks']) == 8 and not value['errors']
        movies = [value['media']] if 'media' in value else value['recordings']
        for item in value['screenshots'] + [f for m in movies for f in m['files']]:
            p = PurePosixPath(item['path'])
            component = next(name for name, directory in PAIRS.items() if p.parts[0] == directory)
            assert p.parts[1:3] == ('assets', 'screenshots')
            assert digest(checked(DEV, item['path'])) == item['sha256']
            result[component].add(PurePosixPath(*p.parts[1:]).as_posix())
    return result


def plan():
    assert not (OUT / 'plan.json').exists(), 'Use the immutable existing plan'
    media, repos = selected_media(), []
    for component, candidate in PAIRS.items():
        source, target = DEV / candidate, DEV / ('copypaste-' + component)
        assert not git(target, 'status', '--porcelain'), component
        changed, unchanged, absent = [], 0, []
        names = sorted(set(inventory(source)) | media[component])
        present = set()
        for name in names:
            src, dst = checked(source, name), checked(target, name)
            if not src.is_file():
                absent.append(name)
                continue
            present.add(name)
            old = digest(dst) if dst.is_file() else None
            new = digest(src)
            if old == new:
                unchanged += 1
                continue
            body, before = src.read_bytes(), dst.read_bytes() if dst.is_file() else None
            changed.append({'path': name, 'before_sha256': old, 'after_sha256': new,
                            'bytes': len(body), 'new_file': before is None,
                            'line_endings_only': before is not None and before.replace(b'\r\n', b'\n') == body.replace(b'\r\n', b'\n')})
        retained = {name: digest(checked(target, name)) for name in inventory(target)
                    if name not in present and checked(target, name).is_file()}
        repos.append({'component': component, 'candidate': source.relative_to(ROOT).as_posix(),
                      'target': target.relative_to(ROOT).as_posix(),
                      'baseline': git(target, 'rev-parse', 'HEAD').decode().strip(),
                      'branch': git(target, 'branch', '--show-current').decode().strip(),
                      'changed': changed, 'unchanged_files': unchanged,
                      'retained_existing_files': retained, 'sparse_candidate_paths_not_copied': absent})
    value = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'reviewable_plan',
             'scope': 'Exact candidate source and selected actual media; existing published-only files are retained',
             'verifier_sha256': digest(Path(__file__)), 'repositories': repos}
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / 'plan.json').write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': value['status'], 'repositories': [
        {'component': r['component'], 'copy_files': len(r['changed']),
         'content_changes': sum(not c['line_endings_only'] for c in r['changed']),
         'retain_existing_files': len(r['retained_existing_files'])} for r in repos]}))


def apply():
    value = json.loads((OUT / 'plan.json').read_text(encoding='utf-8'))
    assert value['verifier_sha256'] == digest(Path(__file__))
    assert not (OUT / 'applied.json').exists()
    # Finish qualification before changing paths used by native integration tests.
    full = json.loads((RAW / 'full-03.json').read_text(encoding='utf-8'))
    assert full['status'] == 'passed' and full['source_unchanged'] and full['owned_database_shutdown']
    for repo in value['repositories']:
        source, target = ROOT / repo['candidate'], ROOT / repo['target']
        assert git(target, 'rev-parse', 'HEAD').decode().strip() == repo['baseline']
        assert not git(target, 'status', '--porcelain'), repo['component']
        for item in repo['changed']:
            src, dst = checked(source, item['path']), checked(target, item['path'])
            assert digest(src) == item['after_sha256']
            assert (digest(dst) if dst.is_file() else None) == item['before_sha256']
        for name, expected in repo['retained_existing_files'].items():
            assert digest(checked(target, name)) == expected
    # Back up every overwritten byte before the first mutation; never delete files.
    for repo in value['repositories']:
        source, target = ROOT / repo['candidate'], ROOT / repo['target']
        for item in repo['changed']:
            dst = checked(target, item['path'])
            if dst.is_file():
                backup = OUT / 'before' / repo['component'] / item['path']
                backup.parent.mkdir(parents=True, exist_ok=True)
                with backup.open('xb') as stream:
                    stream.write(dst.read_bytes())
    for repo in value['repositories']:
        source, target = ROOT / repo['candidate'], ROOT / repo['target']
        for item in repo['changed']:
            dst = checked(target, item['path']); dst.parent.mkdir(parents=True, exist_ok=True)
            dst.write_bytes(checked(source, item['path']).read_bytes())
    verify(value)
    result = {'status': 'copied_and_verified', 'at': datetime.now(timezone.utc).isoformat(),
              'plan_sha256': digest(OUT / 'plan.json'), 'verifier_sha256': digest(Path(__file__)),
              'files': sum(len(r['changed']) for r in value['repositories']), 'deleted_files': 0}
    (OUT / 'applied.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(result))


def verify(value=None):
    value = value or json.loads((OUT / 'plan.json').read_text(encoding='utf-8'))
    assert value['verifier_sha256'] == digest(Path(__file__))
    for repo in value['repositories']:
        target = ROOT / repo['target']
        for item in repo['changed']:
            assert digest(checked(target, item['path'])) == item['after_sha256']
        for name, expected in repo['retained_existing_files'].items():
            assert digest(checked(target, name)) == expected


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('action', choices=['plan', 'apply', 'verify'])
    action = parser.parse_args().action
    {'plan': plan, 'apply': apply, 'verify': verify}[action]()
