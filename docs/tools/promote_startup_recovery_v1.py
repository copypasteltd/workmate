"""Fast-forward reviewed component checkouts and retain qualified working bytes."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUTPUT = ROOT / 'docs/quality/startup-recovery-promotion-128.json'


def git(repo, *args):
    return subprocess.check_output(['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', *args], cwd=repo)


def main():
    assert not OUTPUT.exists()
    receipt = json.loads((ROOT / 'dev/copypaste-delivery/evidence/startup-recovery-128/desktop-04.json').read_text(encoding='utf-8-sig'))
    assert receipt['status'] == 'passed' and receipt['source_unchanged'] and receipt['package_unchanged']
    pinned_attr = '82eabadd2ae6562e1a246a3458eedde1ba913ee9837ee40f464d60e5d8f9185e'
    desktop_attr = ROOT / 'dev/copypaste-desktop/.gitattributes'
    assert sha256(desktop_attr.read_bytes()).hexdigest() == pinned_attr
    changes = []
    for component, branch in [('platform', 'backend'), ('desktop', 'desktop')]:
        repo = ROOT / 'dev' / ('copypaste-' + component)
        candidate = ROOT / 'dev' / ('copypaste-' + component + '-publication-125')
        assert not git(repo, 'status', '--porcelain')
        assert not git(candidate, 'status', '--porcelain')
        assert git(repo, 'branch', '--show-current').decode().strip() == 'codex/' + branch
        assert git(candidate, 'branch', '--show-current').decode().strip() == 'codex/desktop-recovery-128'
        before = git(repo, 'rev-parse', 'HEAD').decode().strip()
        head = git(candidate, 'rev-parse', 'HEAD').decode().strip()
        git(repo, 'merge-base', '--is-ancestor', before, head)
        git(repo, 'merge', '--ff-only', head)
        restored = []
        prefix = 'copypaste-' + component + '/'
        qualified = {name.removeprefix(prefix): key for name, key in receipt['source_files'].items() if name.startswith(prefix)}
        for name, key in qualified.items():
            assert '..' not in Path(name).parts and not name.startswith('.')
            source = candidate / name
            target = repo / name
            expected = source.read_bytes()
            assert sha256(expected).hexdigest() == key, name
            actual = target.read_bytes()
            if sha256(actual).hexdigest() != key:
                assert actual.replace(b'\r\n', b'\n') == expected.replace(b'\r\n', b'\n'), name
                target.write_bytes(expected)
                restored.append(name)
        assert not git(repo, 'status', '--porcelain')
        assert git(repo, 'rev-parse', 'HEAD').decode().strip() == head
        assert git(candidate, 'rev-parse', 'HEAD').decode().strip() == head
        changes.append({'branch': branch, 'before': before, 'after': head, 'qualified_source_files': len(qualified), 'line_ending_restorations': restored})
    assert sha256(desktop_attr.read_bytes()).hexdigest() == pinned_attr
    value = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'fast_forwarded_and_qualified_bytes_preserved',
             'components': changes, 'primary_desktop_attributes_sha256': pinned_attr,
             'verifier_sha256': sha256(Path(__file__).read_bytes()).hexdigest()}
    with OUTPUT.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    print(json.dumps(value))


if __name__ == '__main__':
    main()
