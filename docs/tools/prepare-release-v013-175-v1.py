"""Rebuild changed services, verify immutable clients and current delivery scope."""
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
BASE = DELIVERY / '.data/release-freeze-175'
VERSION = 'v0.1.3'
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
    result = {'at': datetime.now(timezone.utc).isoformat(), 'stage': 175, 'release': VERSION, 'status': 'running', 'build_commands': [], 'error': None}
    try:
        previous = json.loads((DELIVERY / '.data/admin-team-usage-174/baseline.json').read_bytes())
        refs = {s.split()[1]: s.split()[0] for s in git(ROOT, 'ls-remote', 'origin', *['refs/heads/' + b for b in [*COMPONENTS, 'docs', 'main']], 'refs/tags/v0.1.*').splitlines()}
        assert refs == previous['remote_refs'] and len(refs) == 120
        for b, c in {**COMPONENTS, 'docs': 'docs'}.items():
            repo = ROOT if b == 'docs' else DEV / ('copypaste-' + c)
            assert git(repo, 'rev-parse', 'HEAD') == previous['heads'][c] == refs['refs/heads/' + b]
            assert not git(repo, 'diff', '--cached', '--name-only')
        for n, h in previous['preserved_user_files'].items():
            assert digest(ROOT / n) == h, n
        assert digest(DEV / 'copypaste-desktop/.gitattributes') == previous['desktop_attributes_sha256']
        assert len(previous['frozen_releases']) == 4
        for version, frozen in previous['frozen_releases'].items():
            directory = Path(frozen['directory'])
            assert digest(directory / 'release-manifest.json') == frozen['manifest_sha256'], version
            assert digest(directory / 'SHA256SUMS') == frozen['sums_sha256'], version
            assert digest(Path(frozen['complete_archive']['path'])) == frozen['complete_archive']['sha256'], version
        baseline = {**previous, 'at': datetime.now(timezone.utc).isoformat()}
        write(BASE / 'baseline.json', baseline)
        report = json.loads((ROOT / 'docs/quality/admin-team-usage-174.json').read_bytes())
        qualification_path = ROOT / report['qualification']['path']
        q = json.loads(qualification_path.read_bytes())
        ui_path = ROOT / report['actual_ui']['path']
        ui = json.loads(ui_path.read_bytes())
        assert report['status'] == 'qualified' and q['status'] == 'passed' and q['source_unchanged'] and q['owned_services_closed']
        assert report['current_sql_api_cases'] == 21 and report['native_team_checks'] == 6
        assert ui['status'] == 'passed' and ui['browser_closed'] and report['actual_admin_ui_checks'] == 7
        assert digest(qualification_path) == report['qualification']['sha256'] and digest(ui_path) == report['actual_ui']['sha256']
        for n, h in report['sources'].items():
            assert digest(DEV / n) == h, n
        before = common.sources()
        prior_path = ROOT / 'docs/quality/release-freeze-checkpoint-173.json'
        prior = json.loads(prior_path.read_bytes())
        for n, h in prior['qualified_sources'].items():
            if n.startswith(('copypaste-web/', 'copypaste-extension/', 'copypaste-desktop/', 'copypaste-delivery/')):
                assert before[n] == h, 'Reused runtime source changed: ' + n
        node = 'D:/Program Files/nodejs/node.exe'
        original = json.loads((DELIVERY / 'evidence/admin-team-usage-174/qualification-01.json').read_bytes())
        assert original['database_tests'] == 21
        for command in original['build_commands']:
            repo = DEV / command['component']
            args = [node, *command['args']]
            log.write((json.dumps({'cwd': str(repo), 'args': args}) + '\n').encode()); log.flush()
            p = subprocess.run(args, cwd=repo, env={**os.environ, 'PYTHONDONTWRITEBYTECODE': '1'}, stdout=log, stderr=log)
            row = {**command, 'exit_code': p.returncode}
            result['build_commands'].append(row)
            print(json.dumps({'phase': 'build', **row}), flush=True)
            assert p.returncode == 0, 'Build failed; original log retained'
        audit_args = [node, 'scripts/audit-release-scope-175-v1.mjs']
        p = subprocess.run(audit_args, cwd=DELIVERY, stdout=log, stderr=log)
        assert p.returncode == 0, 'Scope inspection failed; original log retained'
        scope_path = DELIVERY / 'evidence/release-freeze-175/source-scope-01.json'
        scope_report = json.loads(scope_path.read_bytes())
        assert scope_report['status'] == 'source_scope_checked' and scope_report['role_count'] >= 12
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
        scope = 'Current source and synthetic frozen delivery closed at user request; server information and live services follow later. Fresh backend/Admin production builds include current team billing and CSS. Inherit stage174 21 native SQL/API cases (6 new team, 15 report regression) and 7 actual current Admin/CSV journeys; no functional tests rerun at175. Actual installed Catalog/Skill digest inspection, source contracts and native Side Panel manifest checked. Unchanged Web/Extension/Desktop/Delivery sources/outputs match173; 87 Windows files, Portable and Setup verified/reused. Authorized synthetic services; unsigned Windows. Full production/professional ledger remains unchanged and is not represented as accepted.'
        checkpoint = {'stage': 175, 'release': VERSION, 'schema_version': 156, 'status': 'qualified', 'at': datetime.now(timezone.utc).isoformat(), 'baseline': baseline, 'qualified_sources': before, 'source_unchanged': True, 'build_commands': result['build_commands'], 'builds': builds, 'desktop_main': desktop_main, 'desktop_renderer': desktop_renderer, 'package_root': prior['package_root'], 'package_files': prior['package_files'], 'installers': prior['installers'], 'windows_distribution': {'mode': 'reuse_byte_identical_qualified_unsigned_windows', 'source_and_outputs_identical_to173': True, 'package_files_verified': len(prior['package_files']), 'installer_count': 2, 'prior_checkpoint_sha256': digest(prior_path)}, 'focused_qualification': {'mode': 'inherit_current_stage174_results_not_rerun', 'path': report['qualification']['path'], 'sha256': digest(qualification_path), 'native_sql_api_at174': 21, 'new_team_sql_api_at174': 6, 'legacy_report_sql_api_at174': 15, 'actual_ui_checks_at174': 7, 'ui_path': report['actual_ui']['path'], 'ui_sha256': digest(ui_path), 'owned_services_closed': True, 'initial_interrupted_capture_retained': True}, 'source_scope_inspection': {'path': scope_path.relative_to(ROOT).as_posix(), 'sha256': digest(scope_path), 'role_count': scope_report['role_count']}, 'scope': scope, 'new_full_acceptance_closures': 0, 'mandatory_full_acceptance_open': 88, 'virtualization_used': False, 'browser_created': False, 'verifier_sha256': digest(Path(__file__))}
        write(ROOT / 'docs/quality/release-freeze-checkpoint-175.json', checkpoint)
        result.update(status='qualified', source_files=len(before), source_unchanged=True, scope=scope, role_count=scope_report['role_count'])
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
