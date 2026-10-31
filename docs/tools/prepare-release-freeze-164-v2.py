"""Qualify the existing seven successful builds using Windows-native ASAR paths."""
from pathlib import Path
from datetime import datetime, timezone
import importlib.util
import json
import shutil
import subprocess
import sys
import uuid

sys.dont_write_bytecode = True
ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
spec = importlib.util.spec_from_file_location('release164_build_functions', ROOT / 'docs/tools/prepare-release-freeze-164-v1.py')
helper = importlib.util.module_from_spec(spec)
spec.loader.exec_module(helper)
digest, write, git, snapshot = helper.digest, helper.write, helper.git, helper.snapshot

def main():
    out = DELIVERY / '.data/release-freeze-164' / ('qualification-' + str(uuid.uuid4()))
    out.mkdir(parents=True)
    result = {'stage': 164, 'release': 'v0.1.0-rc.4', 'schema_version': 155, 'status': 'running', 'started_at': datetime.now(timezone.utc).isoformat(), 'error': None}
    try:
        original_dir = DELIVERY / '.data/release-freeze-164/build-6f259d3e-eaa9-4d19-bff2-7e98c0d78c38'
        original_path = original_dir / 'receipt.json'
        original = json.loads(original_path.read_bytes())
        assert original['status'] == 'failed' and 'ASAR verification failed:' in original['error']
        assert len(original['build_commands']) == 7 and all(c['exit_code'] == 0 for c in original['build_commands'])
        assert digest(ROOT / 'docs/tools/prepare-release-freeze-164-v1.py') == original['verifier_sha256']
        assert digest(original_dir / 'commands.log') == original['private_log_sha256']
        baseline = json.loads((DELIVERY / '.data/release-freeze-164/baseline.json').read_bytes())
        cp163 = json.loads((ROOT / 'docs/quality/session-boundary-checkpoint-163.json').read_bytes())
        q162 = json.loads((DELIVERY / 'evidence/onboarding-162/qualification-01.json').read_bytes())
        for p, h in cp163['qualified_sources'].items():
            assert digest(ROOT / p) == h, p
        for p, h in q162['source_files'].items():
            assert digest(DEV / p) == h, p
        qualified = {}
        for b, c in helper.COMPONENTS.items():
            repo = DEV / ('copypaste-' + c)
            assert git(repo, 'rev-parse', 'HEAD') == baseline['heads'][c]
            changed = set(git(repo, 'diff', '--name-only', '-z', 'HEAD').split('\0')) - {''}
            assert changed.issubset({'README.md', 'README.en.md'}), c + ' runtime changed after build'
            selected = git(repo, 'ls-files', '-z', '--', 'src', 'scripts', 'catalog', 'skills', 'contracts', 'migrations', 'public', 'renderer/src', 'renderer/tsconfig.json', 'assets/fonts', 'assets/licenses', 'assets/browser-shell.html', 'assets/browser-shell.js', 'assets/browser-shell.css', 'package.json', 'package-lock.json', 'tsconfig.json', 'vite.config.ts', 'index.html', 'deployment.json').split('\0')
            for p in selected:
                if p and (repo / p).is_file():
                    qualified[(repo / p).relative_to(DEV).as_posix()] = digest(repo / p)
        package_out = original_dir / 'desktop'
        package_root = package_out / 'win-unpacked'
        # ASAR's directory traversal follows the host path separator on Windows.
        # Preserve path.relative() rather than converting nested paths to POSIX.
        verify = """const fs=require('node:fs'),path=require('node:path'),asar=require('@electron/asar');let count=0;function visit(dir,base){for(const e of fs.readdirSync(dir,{withFileTypes:true})){const f=path.join(dir,e.name);if(e.isDirectory())visit(f,base);else{const relative=path.relative(base,f);if(!fs.readFileSync(f).equals(asar.extractFile(process.argv[1],relative)))throw Error('ASAR differs: '+relative);count++;}}}visit('dist','.');visit('renderer-dist','.');console.log(JSON.stringify({packaged_files_verified:count,comparison:'all current main and renderer output bytes',path_format:'native Windows'}));"""
        p = subprocess.run([shutil.which('node.exe'), '-e', verify, str(package_root / 'resources/app.asar')], cwd=DEV / 'copypaste-desktop', stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        assert p.returncode == 0, p.stderr.decode(errors='replace')[-2000:]
        asar = json.loads(p.stdout)
        runtime = json.loads((DEV / 'copypaste-desktop/.data/runtime/windows-x64/runtime-manifest.json').read_bytes())
        assert runtime['runtime'] == '0.163.0-alpha.11'
        for n, facts in runtime['files'].items():
            assert digest(package_root / 'resources/local-codex' / n) == facts['sha256']
        installers = sorted(package_out.glob('*.exe'))
        assert len(installers) == 2 and any('Setup' in p.name for p in installers) and any('Portable' in p.name for p in installers)
        result.update(status='qualified', baseline=baseline, qualified_sources=qualified, build_commands=original['build_commands'], builds={c: snapshot(DEV / ('copypaste-' + c) / 'dist') for c in ['platform', 'web', 'admin', 'extension', 'delivery']}, desktop_renderer=snapshot(DEV / 'copypaste-desktop/renderer-dist'), desktop_main=snapshot(DEV / 'copypaste-desktop/dist'), package_root=str(package_root), package_files=snapshot(package_root), installers={p.name: {'path': str(p), 'sha256': digest(p), 'bytes': p.stat().st_size} for p in installers}, packaged_asar=asar, focused_session_qualification={'path': 'docs/quality/session-boundary-checkpoint-163.json', 'sha256': digest(ROOT / 'docs/quality/session-boundary-checkpoint-163.json'), 'http_results': 28, 'real_web_journeys': 3, 'all_sources_still_match': True}, focused_onboarding_qualification={'path': 'dev/copypaste-delivery/evidence/onboarding-162/qualification-01.json', 'sha256': digest(DELIVERY / 'evidence/onboarding-162/qualification-01.json'), 'checks': 9, 'all_sources_still_match': True}, original_failed_attempt={'path': str(original_path.relative_to(ROOT)), 'sha256': digest(original_path), 'receipt': original, 'reason': 'Verifier converted nested Windows ASAR paths to POSIX; actual CSS and JS entries are present and now byte-compared. Original failure is retained. All seven actual build commands passed before this verifier error.'}, scope='Six current builds plus unsigned Windows unpacked/portable/NSIS packaging; exact ASAR output binding and pinned runtime hashes. Inherits stage163 28 HTTP results/three real Web journeys and stage162 nine startup checks only with matching sources. Original ASAR verifier-path failure retained. No new native UI, production provider, professional full acceptance or broad historical regression.', new_full_acceptance_closures=0, mandatory_full_acceptance_open=88)
    except Exception as e:
        result.update(status='failed', error=type(e).__name__ + ': ' + str(e))
    finally:
        result['finished_at'] = datetime.now(timezone.utc).isoformat()
        result['verifier_sha256'] = digest(Path(__file__))
        write(out / 'receipt.json', result)
        write(DELIVERY / 'evidence/release-freeze-164' / (out.name + '.json'), result)
        if result['status'] == 'qualified':
            write(ROOT / 'docs/quality/release-freeze-checkpoint-164.json', result)
        print(json.dumps({'status': result['status'], 'receipt': str(out / 'receipt.json'), 'error': result['error']}, ensure_ascii=False), flush=True)
    assert result['status'] == 'qualified'

if __name__ == '__main__':
    main()
