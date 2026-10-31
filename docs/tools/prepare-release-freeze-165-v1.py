"""Build current rc.5 distributions; preserve previous qualification and releases."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json
import os
import shutil
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
VERSION = 'v0.1.0-rc.5'
COMPONENTS = {'backend': 'platform', 'web': 'web', 'admin': 'admin', 'desktop': 'desktop', 'extension': 'extension', 'delivery': 'delivery'}

def digest(p):
    h = sha256()
    with p.open('rb') as f:
        for b in iter(lambda: f.read(4 * 1024 * 1024), b''):
            h.update(b)
    return h.hexdigest()

def write(p, value):
    p.parent.mkdir(parents=True, exist_ok=True)
    with p.open('x', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def git(p, *args):
    return subprocess.check_output(['git', '-c', 'core.fsmonitor=false', '-c', 'core.untrackedCache=false', '-C', str(p), *args], cwd=p).decode().strip()

def snapshot(directory):
    return {p.relative_to(directory).as_posix(): digest(p) for p in sorted(directory.rglob('*')) if p.is_file()}

def main():
    out = DELIVERY / '.data/release-freeze-165' / ('build-' + str(uuid.uuid4()))
    out.mkdir(parents=True)
    report = {'stage': 165, 'release': VERSION, 'schema_version': 155, 'started_at': datetime.now(timezone.utc).isoformat(), 'status': 'running', 'build_commands': [], 'error': None}
    evidence = DELIVERY / 'evidence/release-freeze-165'
    evidence.mkdir(parents=True, exist_ok=True)
    log_path = out / 'commands.log'
    try:
        baseline = json.loads((DELIVERY / '.data/functional-closure-165/baseline.json').read_bytes())
        for b, c in {**COMPONENTS, 'docs': 'docs'}.items():
            repo = ROOT if b == 'docs' else DEV / ('copypaste-' + c)
            assert git(repo, 'rev-parse', 'HEAD') == baseline['heads'][c], c
        patterns = ['refs/heads/' + b for b in [*COMPONENTS, 'docs', 'main']] + ['refs/tags/v0.1.0-rc.*']
        refs = {s.split()[1]: s.split()[0] for s in git(ROOT, 'ls-remote', 'origin', *patterns).splitlines()}
        assert refs == baseline['remote_refs'], 'Remote advanced before build'
        for n, h in {**baseline['preserved_user_files'], **baseline['frozen_files']}.items():
            assert digest(ROOT / n) == h, n
        assert digest(DEV / 'copypaste-desktop/.gitattributes') == baseline['desktop_attributes_sha256']
        for v in baseline['frozen_releases'].values():
            assert digest(Path(v['complete_archive']['path'])) == v['complete_archive']['sha256']
            assert digest(Path(v['directory']) / 'release-manifest.json') == v['manifest_sha256']
            assert digest(Path(v['directory']) / 'SHA256SUMS') == v['sums_sha256']
        qualified = {}
        for c in COMPONENTS.values():
            repo = DEV / ('copypaste-' + c)
            selected = git(repo, 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', 'src', 'scripts', 'catalog', 'skills', 'contracts', 'migrations', 'public', 'renderer/src', 'renderer/tsconfig.json', 'assets/fonts', 'assets/licenses', 'assets/browser-shell.html', 'assets/browser-shell.js', 'assets/browser-shell.css', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html', 'deployment.json').split('\0')
            for p in selected:
                if p and (repo / p).is_file():
                    qualified[(repo / p).relative_to(DEV).as_posix()] = digest(repo / p)
        node = shutil.which('node.exe')
        assert node
        npm = str(Path(node).parent / 'node_modules/npm/bin/npm-cli.js')
        assert Path(npm).is_file()
        env = {**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}
        for k in ['COPYPASTE_RELEASE_BUILD', 'COPYPASTE_UPDATE_TRUST_FILE', 'COPYPASTE_API_URL', 'COPYPASTE_WEB_URL', 'COPYPASTE_EXTENSION_ID', 'CSC_LINK', 'WIN_CSC_LINK', 'CSC_NAME', 'WIN_CSC_SUBJECT_NAME']:
            assert not env.get(k), 'Explicit candidate build requires clean deployment inputs: ' + k
        package_out = out / 'desktop'
        commands = [(c + ' production build', DEV / ('copypaste-' + c), [node, npm, 'run', 'build']) for c in ['platform', 'web', 'admin', 'desktop', 'extension', 'delivery']]
        commands.append(('Windows unpacked app, portable executable and NSIS installer', DEV / 'copypaste-desktop', [node, 'node_modules/electron-builder/cli.js', '--win', 'portable', 'nsis', '--x64', '--config.directories.output=' + str(package_out)]))
        with log_path.open('xb') as log:
            for name, cwd, argv in commands:
                print(json.dumps({'phase': 'building', 'name': name}), flush=True)
                log.write((json.dumps({'name': name, 'cwd': str(cwd), 'argv': argv}) + '\n').encode()); log.flush()
                p = subprocess.run(argv, cwd=cwd, env=env, stdout=log, stderr=subprocess.STDOUT)
                report['build_commands'].append({'name': name, 'cwd': str(cwd.relative_to(ROOT)), 'argv': argv, 'exit_code': p.returncode})
                assert p.returncode == 0, name + ' failed; retained commands.log'
        for p, h in qualified.items():
            assert digest(DEV / p) == h, 'Build changed bound source: ' + p
        package_root = package_out / 'win-unpacked'
        assert (package_root / 'CopyPaste.exe').is_file()
        installers = sorted(package_out.glob('*.exe'))
        assert len(installers) == 2 and any('Setup' in p.name for p in installers) and any('Portable' in p.name for p in installers)
        # Verify the actual packaged ASAR against every current native-main and renderer output.
        verify = """const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),asar=require('@electron/asar');let count=0;function visit(dir,base){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())visit(f,base);else{const relative=path.relative(base,f);const packaged=asar.extractFile(process.argv[1],relative);if(!fs.readFileSync(f).equals(packaged))throw Error('ASAR differs: '+relative);count++;}}}visit('dist','.');visit('renderer-dist','.');console.log(JSON.stringify({packaged_files_verified:count}));"""
        p = subprocess.run([node, '-e', verify, str(package_root / 'resources/app.asar')], cwd=DEV / 'copypaste-desktop', stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        assert p.returncode == 0, 'ASAR verification failed: ' + p.stderr.decode(errors='replace')[-1500:]
        asar_result = json.loads(p.stdout)
        runtime_manifest = json.loads((DEV / 'copypaste-desktop/.data/runtime/windows-x64/runtime-manifest.json').read_bytes())
        assert runtime_manifest['runtime'] == '0.163.0-alpha.11'
        for n, facts in runtime_manifest['files'].items():
            assert digest(package_root / 'resources/local-codex' / n) == facts['sha256'], n
        ui_path = DELIVERY / 'evidence/functional-closure-165/ui-qualification-02.json'
        ui = json.loads(ui_path.read_bytes())
        assert ui['status'] == 'passed' and ui['owned_services_closed'] and ui['source_unchanged']
        assert ui['focused_database_tests'] == 7 and ui['focused_helper_tests'] == 4 and len(ui['browser']) == 2
        report.update(status='qualified', baseline=baseline, qualified_sources=qualified,
            builds={c: snapshot(DEV / ('copypaste-' + c) / 'dist') for c in ['platform', 'web', 'admin', 'extension', 'delivery']},
            desktop_renderer=snapshot(DEV / 'copypaste-desktop/renderer-dist'), desktop_main=snapshot(DEV / 'copypaste-desktop/dist'),
            package_root=str(package_root), package_files=snapshot(package_root),
            installers={p.name: {'path': str(p), 'sha256': digest(p), 'bytes': p.stat().st_size} for p in installers},
            packaged_asar=asar_result,
            focused_qualification={'path': 'dev/copypaste-delivery/evidence/functional-closure-165/ui-qualification-02.json', 'sha256': digest(ui_path), 'database_cases': 7, 'helper_cases': 4, 'actual_ui_checks': len(ui['checks']), 'browser_receipts': ui['browser'], 'owned_services_closed': True},
            scope='Six current builds and fresh unsigned Windows unpacked/portable/NSIS. Current ASAR bytes and pinned Codex verified. Seven focused SQL tests, four helper cases, actual Web lost-reply recovery and Admin target/filter journeys. Broad repeat regression omitted by user; no production provider, signed update, full native/other OS or whole professional acceptance claim.',
            new_full_acceptance_closures=0, mandatory_full_acceptance_open=88)

    except Exception as e:
        report.update(status='failed', error=type(e).__name__ + ': ' + str(e))
    finally:
        report['finished_at'] = datetime.now(timezone.utc).isoformat()
        report['verifier_sha256'] = digest(Path(__file__))
        report['private_log'] = str(log_path.relative_to(DELIVERY))
        report['private_log_sha256'] = digest(log_path) if log_path.exists() else None
        write(out / 'receipt.json', report)
        write(evidence / ('build-' + out.name.removeprefix('build-') + '.json'), report)
        if report['status'] == 'qualified':
            write(ROOT / 'docs/quality/release-freeze-checkpoint-165.json', report)
        print(json.dumps({'status': report['status'], 'receipt': str(out / 'receipt.json'), 'error': report['error']}, ensure_ascii=False), flush=True)
    assert report['status'] == 'qualified'

if __name__ == '__main__':
    main()
