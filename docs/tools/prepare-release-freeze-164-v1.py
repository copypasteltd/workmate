"""Build current rc.4 distributions; preserve previous qualification and releases."""
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
VERSION = 'v0.1.0-rc.4'
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
    out = DELIVERY / '.data/release-freeze-164' / ('build-' + str(uuid.uuid4()))
    out.mkdir(parents=True)
    report = {'stage': 164, 'release': VERSION, 'schema_version': 155, 'started_at': datetime.now(timezone.utc).isoformat(), 'status': 'running', 'build_commands': [], 'error': None}
    evidence = DELIVERY / 'evidence/release-freeze-164'
    evidence.mkdir(parents=True, exist_ok=True)
    log_path = out / 'commands.log'
    try:
        cp163 = json.loads((ROOT / 'docs/quality/session-boundary-checkpoint-163.json').read_bytes())
        assert cp163['status'] == 'qualified' and cp163['http_test_results'] == 28
        for p, h in cp163['qualified_sources'].items():
            assert digest(ROOT / p) == h, p
        q162 = json.loads((DELIVERY / 'evidence/onboarding-162/qualification-01.json').read_bytes())
        assert q162['status'] == 'passed' and len(q162['checks']) == 9
        for p, h in q162['source_files'].items():
            assert digest(DEV / p) == h, p
        base = cp163['baseline']
        previous = json.loads((DELIVERY / '.data/session-fence-163/git-sync-d3aab6a8-b0e3-4671-8f4d-9e695f871118/receipt.json').read_bytes())
        assert previous['status'] == 'published'
        baseline = {**base, 'at': report['started_at'], 'heads': {COMPONENTS.get(b, b): v['commit'] for b, v in previous['components'].items()}, 'remote_refs': previous['verified_refs']}
        for b, c in {**COMPONENTS, 'docs': 'docs'}.items():
            repo = ROOT if b == 'docs' else DEV / ('copypaste-' + c)
            assert git(repo, 'rev-parse', 'HEAD') == baseline['heads'][c], c
        patterns = ['refs/heads/' + b for b in [*COMPONENTS, 'docs', 'main']] + ['refs/tags/v0.1.0-rc.*']
        refs = {s.split()[1]: s.split()[0] for s in git(ROOT, 'ls-remote', 'origin', *patterns).splitlines()}
        assert refs == baseline['remote_refs'], 'Remote advanced before build'
        for n, h in {**base['preserved_user_files'], **base['frozen_files']}.items():
            assert digest(ROOT / n) == h, n
        assert digest(DEV / 'copypaste-desktop/.gitattributes') == base['desktop_attributes_sha256']
        frozen = {}
        for stage in [158, 161]:
            path = DELIVERY / f'.data/release-freeze-{stage}/frozen-receipt.json'
            v = json.loads(path.read_bytes())
            frozen[str(stage)] = {'receipt_sha256': digest(path), **v}
            assert digest(Path(v['complete_archive']['path'])) == v['complete_archive']['sha256']
            assert digest(Path(v['directory']) / 'release-manifest.json') == v['manifest_sha256']
            assert digest(Path(v['directory']) / 'SHA256SUMS') == v['sums_sha256']
        baseline['frozen_releases'] = frozen
        write(DELIVERY / '.data/release-freeze-164/baseline.json', baseline)
        qualified = {}
        for c in COMPONENTS.values():
            repo = DEV / ('copypaste-' + c)
            selected = git(repo, 'ls-files', '-z', '--', 'src', 'scripts', 'catalog', 'skills', 'contracts', 'migrations', 'public', 'renderer/src', 'renderer/tsconfig.json', 'assets/fonts', 'assets/licenses', 'assets/browser-shell.html', 'assets/browser-shell.js', 'assets/browser-shell.css', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html', 'deployment.json').split('\0')
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
        verify = """const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),asar=require('@electron/asar');let count=0;function visit(dir,base){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())visit(f,base);else{const relative=path.relative(base,f).replaceAll('\\\\','/');const packaged=asar.extractFile(process.argv[1],relative);if(!fs.readFileSync(f).equals(packaged))throw Error('ASAR differs: '+relative);count++;}}}visit('dist','.');visit('renderer-dist','.');console.log(JSON.stringify({packaged_files_verified:count}));"""
        p = subprocess.run([node, '-e', verify, str(package_root / 'resources/app.asar')], cwd=DEV / 'copypaste-desktop', stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        assert p.returncode == 0, 'ASAR verification failed: ' + p.stderr.decode(errors='replace')[-1500:]
        asar_result = json.loads(p.stdout)
        runtime_manifest = json.loads((DEV / 'copypaste-desktop/.data/runtime/windows-x64/runtime-manifest.json').read_bytes())
        assert runtime_manifest['runtime'] == '0.163.0-alpha.11'
        for n, facts in runtime_manifest['files'].items():
            assert digest(package_root / 'resources/local-codex' / n) == facts['sha256'], n
        report.update(status='qualified', baseline=baseline, qualified_sources=qualified, builds={c: snapshot(DEV / ('copypaste-' + c) / 'dist') for c in ['platform', 'web', 'admin', 'extension', 'delivery']}, desktop_renderer=snapshot(DEV / 'copypaste-desktop/renderer-dist'), desktop_main=snapshot(DEV / 'copypaste-desktop/dist'), package_root=str(package_root), package_files=snapshot(package_root), installers={p.name: {'path': str(p), 'sha256': digest(p), 'bytes': p.stat().st_size} for p in installers}, packaged_asar=asar_result, focused_session_qualification={'path': 'docs/quality/session-boundary-checkpoint-163.json', 'sha256': digest(ROOT / 'docs/quality/session-boundary-checkpoint-163.json'), 'http_results': 28, 'real_web_journeys': 3, 'all_sources_still_match': True}, focused_onboarding_qualification={'path': 'dev/copypaste-delivery/evidence/onboarding-162/qualification-01.json', 'sha256': digest(DELIVERY / 'evidence/onboarding-162/qualification-01.json'), 'checks': 9, 'all_sources_still_match': True}, scope='Six current builds plus unsigned Windows unpacked/portable/NSIS packaging; exact ASAR output binding and pinned runtime hashes. Inherits stage163 28 HTTP results/three real Web journeys and stage162 nine startup checks only while their exact sources match. No new native UI, production provider, professional full acceptance or broad historical regression.', new_full_acceptance_closures=0, mandatory_full_acceptance_open=88)
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
            write(ROOT / 'docs/quality/release-freeze-checkpoint-164.json', report)
        print(json.dumps({'status': report['status'], 'receipt': str(out / 'receipt.json'), 'error': report['error']}, ensure_ascii=False), flush=True)
    assert report['status'] == 'qualified'

if __name__ == '__main__':
    main()
