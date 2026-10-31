"""Freeze current source for v0.1.0; reuse byte-identical qualified Windows apps."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json
import os
import re
import shutil
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
VERSION = 'v0.1.0'
COMPONENTS = {'backend': 'platform', 'web': 'web', 'admin': 'admin', 'desktop': 'desktop', 'extension': 'extension', 'delivery': 'delivery'}
BASE = DELIVERY / '.data/release-freeze-167'


def digest(p):
    h = sha256()
    with p.open('rb') as f:
        for b in iter(lambda: f.read(4 * 1024 * 1024), b''):
            h.update(b)
    return h.hexdigest()


def write(p, value):
    p.parent.mkdir(parents=True, exist_ok=True)
    text = value if isinstance(value, str) else json.dumps(value, ensure_ascii=False, indent=2) + '\n'
    with p.open('x', encoding='utf-8', newline='\n') as f:
        f.write(text)


def git(repo, *args):
    return subprocess.check_output(['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-c', 'gc.auto=0', '-C', str(repo), *args], cwd=repo).decode('utf-8').strip()


def snapshot(directory):
    return {p.relative_to(directory).as_posix(): digest(p) for p in sorted(directory.rglob('*')) if p.is_file()}


def sources():
    out = {}
    for c in COMPONENTS.values():
        repo = DEV / ('copypaste-' + c)
        paths = git(repo, 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'src', 'scripts', 'catalog', 'skills', 'contracts', 'migrations', 'public', 'renderer/src', 'renderer/tsconfig.json', 'assets/fonts', 'assets/licenses', 'assets/browser-shell.html', 'assets/browser-shell.js', 'assets/browser-shell.css', 'assets/icon.ico', 'assets/icon.png', 'assets/native-host.cmd', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html', 'deployment.json').split('\0')
        for p in paths:
            if p and (repo / p).is_file():
                out[(repo / p).relative_to(DEV).as_posix()] = digest(repo / p)
    return out


def main():
    out = BASE / ('build-' + str(uuid.uuid4()))
    out.mkdir(parents=True)
    report = {'stage': 167, 'release': VERSION, 'schema_version': 155, 'started_at': datetime.now(timezone.utc).isoformat(), 'status': 'running', 'build_commands': [], 'error': None}
    log_path = out / 'commands.log'
    try:
        prior = json.loads((DELIVERY / '.data/admin-user-resources-166/publication-54ac2049-2d87-4215-9635-2206e433d447/receipt.json').read_bytes())
        old = json.loads((DELIVERY / '.data/admin-user-resources-166/baseline.json').read_bytes())
        assert prior['status'] == 'published'
        refs = {s.split()[1]: s.split()[0] for s in git(ROOT, 'ls-remote', 'origin', *['refs/heads/' + b for b in [*COMPONENTS, 'docs', 'main']], 'refs/tags/v0.1.0*').splitlines()}
        assert refs == prior['verified_refs'] and len(refs) == 78
        heads = {}
        for b, c in {**COMPONENTS, 'docs': 'docs'}.items():
            repo = ROOT if b == 'docs' else DEV / ('copypaste-' + c)
            heads[c] = git(repo, 'rev-parse', 'HEAD')
            assert heads[c] == refs['refs/heads/' + b], b
            assert not git(repo, 'diff', 'HEAD', '--name-only'), 'Unrelated tracked changes: ' + b
            assert not git(repo, 'diff', '--cached', '--name-only')
        baseline = {'at': datetime.now(timezone.utc).isoformat(), 'heads': heads, 'remote_refs': refs, 'preserved_user_files': old['preserved_user_files'], 'desktop_attributes_sha256': old['desktop_attributes_sha256'], 'frozen_rc5': json.loads((DELIVERY / '.data/release-freeze-165/frozen-receipt.json').read_bytes())}
        for n, h in baseline['preserved_user_files'].items():
            assert digest(ROOT / n) == h
        assert digest(DEV / 'copypaste-desktop/.gitattributes') == baseline['desktop_attributes_sha256']
        frozen = baseline['frozen_rc5']
        assert digest(Path(frozen['directory']) / 'release-manifest.json') == frozen['manifest_sha256']
        assert digest(Path(frozen['directory']) / 'SHA256SUMS') == frozen['sums_sha256']
        assert Path(frozen['complete_archive']['path']).stat().st_size == frozen['complete_archive']['bytes']
        write(BASE / 'baseline.json', baseline)
        before = sources()
        node = shutil.which('node.exe')
        assert node
        npm = str(Path(node).parent / 'node_modules/npm/bin/npm-cli.js')
        env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}
        for k in ['COPYPASTE_RELEASE_BUILD', 'COPYPASTE_UPDATE_TRUST_FILE', 'COPYPASTE_API_URL', 'COPYPASTE_WEB_URL', 'COPYPASTE_EXTENSION_ID', 'CSC_LINK', 'WIN_CSC_LINK', 'CSC_NAME', 'WIN_CSC_SUBJECT_NAME']:
            assert not env.get(k), 'Unexpected deployment override: ' + k
        with log_path.open('xb') as log:
            for c in COMPONENTS.values():
                argv = [node, npm, 'run', 'build']
                print(json.dumps({'phase': 'building', 'component': c}), flush=True)
                p = subprocess.run(argv, cwd=DEV / ('copypaste-' + c), env=env, stdout=log, stderr=subprocess.STDOUT)
                report['build_commands'].append({'component': c, 'args': argv, 'exit_code': p.returncode})
                assert p.returncode == 0, c + ' build failed; original log retained'
        assert sources() == before, 'Build changed frozen source'
        previous_checkpoint = ROOT / 'docs/quality/release-freeze-checkpoint-165.json'
        previous = json.loads(previous_checkpoint.read_bytes())
        # Native product inputs did not change after the actual Windows qualification.
        for n, h in before.items():
            if n.startswith('copypaste-desktop/'):
                assert h == previous['qualified_sources'].get(n, h), n
        main_output = snapshot(DEV / 'copypaste-desktop/dist')
        renderer_output = snapshot(DEV / 'copypaste-desktop/renderer-dist')
        assert main_output == previous['desktop_main']
        assert renderer_output == previous['desktop_renderer']
        package_root = Path(previous['package_root'])
        assert snapshot(package_root) == previous['package_files'], 'Previously qualified Windows package changed'
        for v in previous['installers'].values():
            assert digest(Path(v['path'])) == v['sha256']
        extension = json.loads((DEV / 'copypaste-extension/dist/manifest.json').read_bytes())
        assert extension['side_panel']['default_path'] and not extension.get('action', {}).get('default_popup')
        focused_path = DELIVERY / 'evidence/admin-user-resources-166/qualification-02.json'
        focused = json.loads(focused_path.read_bytes())
        assert focused['status'] == 'passed' and focused['owned_services_closed'] and focused['source_unchanged']
        for n, h in focused['source_after'].items():
            assert digest(DEV / n) == h, n
        assert focused['inherited_checks']['database_tests'] == 8 and focused['ui']['checks'] == 8
        ui_path = DELIVERY / focused['ui']['path']
        assert digest(ui_path) == focused['ui']['sha256']
        report.update(status='qualified', baseline=baseline, qualified_sources=before,
            builds={c: snapshot(DEV / ('copypaste-' + c) / 'dist') for c in ['platform', 'web', 'admin', 'extension', 'delivery']},
            desktop_main=main_output, desktop_renderer=renderer_output,
            package_root=str(package_root), package_files=previous['package_files'], installers=previous['installers'],
            windows_distribution={'mode': 'reuse_byte_identical_previously_qualified_binaries', 'checkpoint': previous_checkpoint.relative_to(ROOT).as_posix(), 'sha256': digest(previous_checkpoint), 'native_main_and_renderer_rebuilt_and_identical': True, 'package_files_verified': len(previous['package_files']), 'installer_count': 2},
            focused_qualification={'mode': 'inherit_source_identical_recent_focused_results_not_rerun', 'path': focused_path.relative_to(ROOT).as_posix(), 'sha256': digest(focused_path), 'database_cases': 8, 'actual_ui_checks': 8, 'owned_services_closed': True},
            scope='Six fresh production builds; rebuilt native outputs match rc.5 exactly and its unpacked/Portable/Setup bytes are verified and reused. Stage166 eight native SQL/API cases and eight actual Admin checks retain exact source/evidence hashes; they are inherited, not rerun. No broad historical repeat, new installation/OS matrix or production-provider/professional acceptance claim.',
            new_full_acceptance_closures=0, mandatory_full_acceptance_open=88, browser_created=False, virtualization_used=False)
    except Exception as e:
        report.update(status='failed', error=type(e).__name__ + ': ' + str(e))
    finally:
        report['finished_at'] = datetime.now(timezone.utc).isoformat()
        report['verifier_sha256'] = digest(Path(__file__))
        report['private_log'] = str(log_path.relative_to(DELIVERY))
        report['private_log_sha256'] = digest(log_path) if log_path.exists() else None
        write(out / 'receipt.json', report)
        write(DELIVERY / 'evidence/release-freeze-167' / (out.name + '.json'), report)
        if report['status'] == 'qualified':
            write(ROOT / 'docs/quality/release-freeze-checkpoint-167.json', report)
        print(json.dumps({'status': report['status'], 'receipt': str(out / 'receipt.json'), 'error': report['error']}, ensure_ascii=False), flush=True)
    assert report['status'] == 'qualified'


if __name__ == '__main__':
    main()
