"""Freeze current qualified code, rebuilding only the changed backend/Admin."""
from pathlib import Path
from datetime import datetime, timezone
import importlib.util
import json
import os
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
BASE = DELIVERY / '.data/release-freeze-173'
VERSION = 'v0.1.2'
COMPONENTS = {'backend': 'platform', 'web': 'web', 'admin': 'admin', 'desktop': 'desktop', 'extension': 'extension', 'delivery': 'delivery'}
spec = importlib.util.spec_from_file_location('freeze167', ROOT / 'docs/tools/prepare-final-freeze-167-v1.py')
common = importlib.util.module_from_spec(spec)
spec.loader.exec_module(common)
digest, snapshot, git = common.digest, common.snapshot, common.git


def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8', newline='\n') as f:
        f.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')


def main():
    BASE.mkdir(parents=True, exist_ok=True)
    out = BASE / ('build-' + str(uuid.uuid4()))
    out.mkdir()
    log = (out / 'commands.log').open('xb')
    result = {'at': datetime.now(timezone.utc).isoformat(), 'stage': 173, 'release': VERSION, 'status': 'running', 'build_commands': [], 'error': None}
    try:
        previous = json.loads((DELIVERY / '.data/admin-posting-period-172/baseline.json').read_bytes())
        publication = json.loads((DELIVERY / '.data/admin-posting-period-172/publication-d2094b67-b470-4438-9d9c-eea3c78c9fdb/receipt.json').read_bytes())
        refs = {s.split()[1]: s.split()[0] for s in git(ROOT, 'ls-remote', 'origin', *['refs/heads/' + b for b in [*COMPONENTS, 'docs', 'main']], 'refs/tags/v0.1.*').splitlines()}
        assert publication['status'] == 'published' and refs == publication['verified_refs'] and len(refs) == 106
        heads = {}
        for b, c in {**COMPONENTS, 'docs': 'docs'}.items():
            repo = ROOT if b == 'docs' else DEV / ('copypaste-' + c)
            heads[c] = git(repo, 'rev-parse', 'HEAD')
            assert heads[c] == refs['refs/heads/' + b]
            # Only the explicitly authored release handbooks/helpers may differ.
            assert not git(repo, 'diff', '--cached', '--name-only')
        for n, h in previous['preserved_user_files'].items():
            assert digest(ROOT / n) == h, n
        assert digest(DEV / 'copypaste-desktop/.gitattributes') == previous['desktop_attributes_sha256']
        for version, frozen in previous['frozen_releases'].items():
            directory = Path(frozen['directory'])
            assert digest(directory / 'release-manifest.json') == frozen['manifest_sha256'], version
            assert digest(directory / 'SHA256SUMS') == frozen['sums_sha256'], version
            assert digest(Path(frozen['complete_archive']['path'])) == frozen['complete_archive']['sha256'], version
        baseline = {'at': datetime.now(timezone.utc).isoformat(), 'heads': heads, 'remote_refs': refs, 'preserved_user_files': previous['preserved_user_files'], 'desktop_attributes_sha256': previous['desktop_attributes_sha256'], 'frozen_releases': previous['frozen_releases']}
        write(BASE / 'baseline.json', baseline)
        report_path = ROOT / 'docs/quality/admin-posting-period-172.json'
        report = json.loads(report_path.read_bytes())
        qualification_path = ROOT / report['qualification']['path']
        q = json.loads(qualification_path.read_bytes())
        ui_path = ROOT / report['actual_ui']['path']
        ui = json.loads(ui_path.read_bytes())
        assert report['status'] == 'qualified' and q['status'] == 'passed' and q['source_unchanged'] and q['owned_services_closed']
        assert report['fresh_native_sql_api_checks'] == 8 and report['fresh_exact_projection_checks'] == 1 and report['inherited_identical_source_legacy_checks'] == 6
        assert ui['status'] == 'passed' and ui['browser_closed'] and report['actual_admin_ui_checks'] == 7
        assert digest(qualification_path) == report['qualification']['sha256'] and digest(ui_path) == report['actual_ui']['sha256']
        for n, h in report['sources'].items():
            assert digest(DEV / n) == h, n
        before = common.sources()
        prior = json.loads((ROOT / 'docs/quality/release-freeze-checkpoint-170.json').read_bytes())
        for n, h in prior['qualified_sources'].items():
            if n.startswith(('copypaste-web/', 'copypaste-extension/', 'copypaste-desktop/', 'copypaste-delivery/')):
                assert before[n] == h, 'Reused runtime source changed: ' + n
        node = 'D:/Program Files/nodejs/node.exe'
        for command in q['build_commands']:
            repo = DEV / command['component']
            args = [node, *command['args']]
            log.write((json.dumps({'cwd': str(repo), 'args': args}) + '\n').encode()); log.flush()
            p = subprocess.run(args, cwd=repo, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}, stdout=log, stderr=log)
            row = {**command, 'exit_code': p.returncode}
            result['build_commands'].append(row)
            print(json.dumps({'phase': 'build', **row}), flush=True)
            assert p.returncode == 0, 'Build failed; original log retained'
        builds = {c: snapshot(DEV / ('copypaste-' + c) / 'dist') for c in ['platform', 'web', 'admin', 'extension', 'delivery']}
        for c in ['web', 'extension', 'delivery']:
            assert builds[c] == prior['builds'][c], 'Reused output changed: ' + c
        desktop_main = snapshot(DEV / 'copypaste-desktop/dist')
        desktop_renderer = snapshot(DEV / 'copypaste-desktop/renderer-dist')
        assert desktop_main == prior['desktop_main'] and desktop_renderer == prior['desktop_renderer']
        for n, h in prior['package_files'].items():
            assert digest(Path(prior['package_root']) / n) == h, n
        for n, v in prior['installers'].items():
            assert digest(Path(v['path'])) == v['sha256'], n
        assert common.sources() == before
        scope = 'Fresh backend/Admin production builds. Inherit exact-source stage172 qualification: 8 new native SQL/API cases, 1 exact-projection case, 6 legacy SQL/API cases previously passed with identical source, and 7 actual Admin UI/CSV journeys. No functional tests rerun in stage173. Unchanged Web/Extension/Desktop/Delivery runtime outputs match stage170; verify and reuse all 87 Windows files, Portable and Setup. Authorized synthetic services; unsigned Windows. Broad regression, production providers, signing/update, other OSes and full professional acceptance remain outside this freeze.'
        checkpoint = {'stage': 173, 'release': VERSION, 'schema_version': 156, 'status': 'qualified', 'at': datetime.now(timezone.utc).isoformat(), 'baseline': baseline, 'qualified_sources': before, 'source_unchanged': True, 'build_commands': result['build_commands'], 'builds': builds, 'desktop_main': desktop_main, 'desktop_renderer': desktop_renderer, 'package_root': prior['package_root'], 'package_files': prior['package_files'], 'installers': prior['installers'], 'windows_distribution': {'mode': 'reuse_byte_identical_qualified_unsigned_windows', 'source_and_outputs_identical_to170': True, 'package_files_verified': len(prior['package_files']), 'installer_count': 2, 'prior_checkpoint_sha256': digest(ROOT / 'docs/quality/release-freeze-checkpoint-170.json')}, 'focused_qualification': {'mode': 'inherit_exact_current_stage172_results_not_rerun', 'path': report['qualification']['path'], 'sha256': digest(qualification_path), 'fresh_native_sql_api_at172': 8, 'exact_projection_at172': 1, 'legacy_exact_source_inherited_at172': 6, 'actual_ui_checks_at172': 7, 'ui_path': report['actual_ui']['path'], 'ui_sha256': digest(ui_path), 'owned_services_closed': True}, 'scope': scope, 'new_full_acceptance_closures': 0, 'mandatory_full_acceptance_open': 88, 'virtualization_used': False, 'browser_created': False, 'verifier_sha256': digest(Path(__file__))}
        write(ROOT / 'docs/quality/release-freeze-checkpoint-173.json', checkpoint)
        result.update(status='qualified', source_files=len(before), source_unchanged=True, scope=scope)
    except Exception as e:
        result.update(status='failed', error=type(e).__name__ + ': ' + str(e))
    finally:
        log.close()
        result['finished_at'] = datetime.now(timezone.utc).isoformat()
        result['verifier_sha256'] = digest(Path(__file__))
        write(out / 'receipt.json', result)
        print(json.dumps({'status': result['status'], 'receipt': str(out / 'receipt.json'), 'error': result['error']}, ensure_ascii=False), flush=True)
    assert result['status'] == 'qualified'


if __name__ == '__main__':
    main()
