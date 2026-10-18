"""Collect executed release evidence; never change planned acceptance states."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import re
import shutil
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DOCS = ROOT / 'docs'
DELIVERY = ROOT / 'dev/copypaste-delivery'
EVIDENCE = DELIVERY / 'evidence'


def read(file):
    return json.loads(file.read_text(encoding='utf-8'))


def checksum(file):
    return hashlib.sha256(file.read_bytes()).hexdigest()


manifest_file = DELIVERY / 'release/release-manifest.json'
manifest = read(manifest_file)
version = manifest['version']
if not re.fullmatch(r'\d+\.\d+\.\d+', version):
    raise RuntimeError('Invalid release version')
verification = read(EVIDENCE / 'verification.json')
restore = read(EVIDENCE / 'release-restore.json')
if verification['status'] != 'passed' or restore['status'] != 'passed':
    raise RuntimeError('Both native verification and offline restoration must pass')
if restore.get('version') != version or restore.get('manifest_sha256') != checksum(manifest_file):
    raise RuntimeError('Offline restore evidence describes another release')
for repo in manifest['repositories']:
    actual = subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT / 'dev' / repo['name']).decode().strip()
    if actual != repo['commit']:
        raise RuntimeError('Release no longer matches a source checkout')
for item in manifest['evidence']:
    if checksum(DELIVERY / item['file']) != item['sha256']:
        raise RuntimeError('Evidence changed after release creation')

native = []
for item in verification['checks']:
    if item['exit_code'] != 0:
        raise RuntimeError('A native check failed')
    result = {'repository': item['repo'], 'command': item['command'], 'exit_code': 0}
    if item['command'].endswith(' test'):
        stats = dict((key, int(value)) for key, value in re.findall(
            r'^# (tests|pass|fail|cancelled|skipped) (\d+)$', item['output'].replace('\r\n', '\n'), re.MULTILINE))
        if not stats or stats.get('pass') != stats.get('tests') or any(stats.get(k, 0) for k in ['fail', 'cancelled', 'skipped']):
            raise RuntimeError('Functional test evidence is incomplete')
        result.update(stats)
    native.append(result)

clients = []
for filename in ['web-admin.json', 'persistent-work.json', 'admin-identities.json', 'extension.json', 'desktop.json',
                 'packaged-windows.json', 'native-controller.json', 'repository-review.json']:
    report = read(EVIDENCE / filename)
    if report.get('status') == 'failed' or report.get('errors') or any(
            item.get('status') != 'passed' for item in report.get('checks', [])):
        raise RuntimeError('Client/lifecycle evidence failed')
    clients.append({'evidence': f'copypaste-delivery/evidence/{filename}',
                    'at': report['at'], 'status': 'passed', 'checks': report.get('checks', []),
                    'browser_closed': report.get('browser_closed'),
                    'electron_closed': report.get('electron_closed')})

current = DOCS / 'quality/implementation-evidence.json'
if current.exists():
    previous_version = read(current)['version']
    if previous_version != version:
        if not re.fullmatch(r'\d+\.\d+\.\d+', previous_version):
            raise RuntimeError('Invalid historical version')
        archive = DOCS / 'quality/versions' / previous_version
        archive.mkdir(parents=True, exist_ok=True)
        for filename in ['implementation-evidence.json', 'release-restore-check.json']:
            if not (archive / filename).exists():
                shutil.copyfile(DOCS / 'quality' / filename, archive / filename)
validation = read(DOCS / 'quality/validation-report.json')
roles = read(ROOT / 'dev/copypaste-platform/catalog/role-preset-catalog.json')['roles']
skills = read(ROOT / 'dev/copypaste-platform/catalog/skill-packages.json')
report = {
    'at': datetime.now(timezone.utc).isoformat(), 'version': version,
    'status': 'native_local_pilot_checks_passed', 'root': str(ROOT),
    'code_root': str(ROOT / 'dev'), 'documentation_root': str(DOCS),
    'agent_kernel': manifest['agent_kernel'],
    'company_live_ai_qualified': manifest['company_live_ai_qualified'],
    'production_deployed': manifest['production_deployed'],
    'installed_roles': len(roles), 'installed_skill_packages': len(skills),
    'role_qualification': 'pending_live_validation',
    'native_verification': native, 'client_and_lifecycle_checks': clients,
    'release': manifest, 'release_restore_evidence': 'release-restore-check.json',
    'documentation_validation_evidence': {
        'file': 'validation-report.json', 'checked_at': validation['checked_at'],
        'status': validation['status'], 'checks_passed': validation['checks_passed'],
        'scope': validation['scope'],
    },
    'scope_limits': manifest['pending'] + [
        'Local fixtures are not qualification of company models or live customer workflows',
        'The 102 planned integrated acceptance cases remain not_run',
        'Bounded code/browser checks do not prove absence of all possible defects',
    ],
}
current.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
(DOCS / 'quality/release-restore-check.json').write_text(
    json.dumps(restore, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(f'Collected {version}: {len(native)} native steps, {len(clients)} client/lifecycle reports and verified offline restore.')
