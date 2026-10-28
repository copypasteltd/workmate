"""Integrate reviewed clients independently while the frozen backend continues."""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import argparse
import json
import re
from integrate_dedicated_cloud_sources import ROOT, DEV, RAW, OUT, checked, digest, git


def load(file):
    return json.loads(file.read_text(encoding='utf-8'))


def frozen_backend():
    plan = load(RAW / 'full-03-plan.json')
    for name, expected in plan['source_files'].items():
        assert digest(checked(DEV, name)) == expected, name
    return digest(RAW / 'full-03-plan.json')


def desktop_dependencies():
    """Keep the actual cross-repository desktop imports used by backend tests intact."""
    before, candidate = DEV / 'copypaste-desktop', DEV / 'copypaste-desktop-cloud-121'
    names = ['local-agent.ts', 'desktop-disconnect-contract.ts', 'desktop-pairing-contract.ts',
             'program-contract.ts', 'desktop-update-contract.ts']
    queue, seen = [before / 'src' / name for name in names], {}
    while queue:
        file = queue.pop()
        name = file.relative_to(before).as_posix()
        if name in seen:
            continue
        assert digest(file) == digest(checked(candidate, name)), name
        seen[name] = digest(file)
        body = file.read_text(encoding='utf-8')
        for relative in re.findall(r'''(?:from\s*|import\s*\(|require\s*\()\s*["'](\.[^"']+)["']''', body):
            target = file.parent / relative
            possibilities = [target]
            if target.suffix == '.js':
                possibilities = [target.with_suffix('.ts'), target.with_suffix('.tsx'), target]
            resolved = next((p.resolve() for p in possibilities if p.is_file()), None)
            assert resolved and resolved.is_relative_to(before.resolve()), (name, relative)
            queue.append(resolved)
    pin = 'contracts/local-codex-runtime.json'
    assert digest(before / pin) == digest(candidate / pin)
    seen[pin] = digest(before / pin)
    return seen


def integrate(mode):
    plan = load(OUT / 'plan.json')
    assert plan['verifier_sha256'] == digest(ROOT / 'docs/tools/integrate_dedicated_cloud_sources.py')
    output = OUT / (mode + '-applied.json')
    assert not output.exists(), 'Do not overwrite an integration receipt'
    plan_digest = frozen_backend()
    dependencies = desktop_dependencies() if mode == 'clients' else None
    if mode == 'backend':
        report = load(RAW / 'full-03.json')
        assert report['status'] == 'passed' and report['source_unchanged'] and report['owned_database_shutdown']
    selected = [r for r in plan['repositories'] if (r['component'] == 'platform') == (mode == 'backend')]
    # Check every target before any mutation; unrelated paths are never staged,
    # replaced, reset or deleted. Existing published-only files remain intact.
    for row in selected:
        source, target = ROOT / row['candidate'], ROOT / row['target']
        assert git(target, 'rev-parse', 'HEAD').decode().strip() == row['baseline']
        assert git(target, 'branch', '--show-current').decode().strip() == row['branch']
        for item in row['changed']:
            src, dst = checked(source, item['path']), checked(target, item['path'])
            assert digest(src) == item['after_sha256']
            assert (digest(dst) if dst.is_file() else None) == item['before_sha256'], dst
        for name, expected in row['retained_existing_files'].items():
            assert digest(checked(target, name)) == expected, name
    for row in selected:
        target = ROOT / row['target']
        for item in row['changed']:
            file = checked(target, item['path'])
            if file.is_file():
                backup = OUT / 'before-v2' / row['component'] / item['path']
                backup.parent.mkdir(parents=True, exist_ok=True)
                with backup.open('xb') as stream:
                    stream.write(file.read_bytes())
    for row in selected:
        source, target = ROOT / row['candidate'], ROOT / row['target']
        for item in row['changed']:
            file = checked(target, item['path']); file.parent.mkdir(parents=True, exist_ok=True)
            file.write_bytes(checked(source, item['path']).read_bytes())
            assert digest(file) == item['after_sha256'], file
        for name, expected in row['retained_existing_files'].items():
            assert digest(checked(target, name)) == expected
    assert frozen_backend() == plan_digest
    if dependencies:
        for name, expected in dependencies.items():
            assert digest(checked(DEV / 'copypaste-desktop', name)) == expected
    result = {'status': 'copied_and_verified', 'at': datetime.now(timezone.utc).isoformat(),
              'mode': mode, 'plan_sha256': digest(OUT / 'plan.json'),
              'frozen_backend_plan_sha256': plan_digest,
              'verifier_sha256': digest(Path(__file__)),
              'desktop_cross_repository_dependencies_preserved': dependencies,
              'components': [r['component'] for r in selected],
              'copied_files': sum(len(r['changed']) for r in selected),
              'retained_published_only_files': sum(len(r['retained_existing_files']) for r in selected),
              'deleted_files': 0, 'published': False,
              'qualification': 'Exact-byte source integration only; final builds/tests/publication remain separate'}
    with output.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2); stream.write('\n')
    print(json.dumps({k:v for k,v in result.items() if k != 'desktop_cross_repository_dependencies_preserved'}))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('mode', choices=['clients', 'backend'])
    integrate(parser.parse_args().mode)
