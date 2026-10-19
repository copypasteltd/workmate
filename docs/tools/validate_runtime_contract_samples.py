"""Validate captured local HTTP payloads against the relevant design schemas.

This is bounded response-shape evidence, not complete API or product acceptance.
It starts no services, browsers or virtualization and never reads credentials.
"""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[1]
SPEC = ROOT / 'contracts/openapi.json'
SAMPLES = [ROOT.parent / 'dev/copypaste-delivery/evidence' / name for name in
           ['cloud-files-contract-samples.json', 'skills-contract-samples.json', 'notifications-contract-samples.json', 'task-dependencies-contract-samples.json', 'admin-records-contract-samples.json', 'agent-templates-contract-samples.json', 'analysis-reports-contract-samples.json', 'file-imports-contract-samples.json', 'auth-profile-contract-samples.json', 'membership-contract-samples.json', 'admin-membership-contract-samples.json', 'admin-account-contract-samples.json']]
OUTPUT = ROOT / 'quality/runtime-contract-samples.json'
AUTH_FIXTURE = ROOT.parent / 'dev/copypaste-platform/contracts/auth-schemas.json'


def main():
    spec = json.loads(SPEC.read_text(encoding='utf-8'))
    fixture = json.loads(AUTH_FIXTURE.read_text(encoding='utf-8'))
    if fixture['source_sha256'] != hashlib.sha256(SPEC.read_bytes()).hexdigest():
        raise ValueError('Authentication test fixture must track the original OpenAPI bytes')
    for name, schema in fixture['schemas'].items():
        if schema != spec['components']['schemas'][name]:
            raise ValueError(f'Authentication test fixture changed the original schema: {name}')
    if len(fixture['schemas']) != 10:
        raise ValueError('Expected all ten authentication schema dependencies')
    members = json.loads((AUTH_FIXTURE.parent / 'membership-schemas.json').read_text(encoding='utf-8'))
    if members['source_sha256'] != hashlib.sha256(SPEC.read_bytes()).hexdigest() or set(members['schemas']) != {'Role', 'InviteCreate', 'Invite', 'InviteAccept', 'Member', 'MemberList', 'Ack'}:
        raise ValueError('Membership fixture must retain all seven original schema dependencies')
    for name, schema in members['schemas'].items():
        if schema != spec['components']['schemas'][name]:
            raise ValueError(f'Membership fixture changed the original schema: {name}')
    admin_members = json.loads((AUTH_FIXTURE.parent / 'admin-membership-schemas.json').read_text(encoding='utf-8'))
    if admin_members['source_sha256'] != hashlib.sha256(SPEC.read_bytes()).hexdigest() or set(admin_members['schemas']) != {'Role', 'AdminMembershipChange', 'AdminOperation'}:
        raise ValueError('Admin membership fixture must retain the three original schema dependencies')
    for name, schema in admin_members['schemas'].items():
        if schema != spec['components']['schemas'][name]:
            raise ValueError(f'Admin membership fixture changed the original schema: {name}')
    admin_accounts = json.loads((AUTH_FIXTURE.parent / 'admin-account-schemas.json').read_text(encoding='utf-8'))
    if admin_accounts['source_sha256'] != hashlib.sha256(SPEC.read_bytes()).hexdigest() or set(admin_accounts['schemas']) != {'AdminUserProfileChange','AdminAccountStatusChange','AdminTenantStatusChange','AdminReason','AdminOperation'}:
        raise ValueError('Admin account fixture must retain the five original schema dependencies')
    for name, schema in admin_accounts['schemas'].items():
        if schema != spec['components']['schemas'][name]:
            raise ValueError(f'Admin account fixture changed the original schema: {name}')
    checks = []
    sources = []
    for source in SAMPLES:
        captured = json.loads(source.read_text(encoding='utf-8'))
        if not captured['samples']:
            raise ValueError(f'No captured responses in {source.name}')
        sources.append({'file': source.relative_to(ROOT.parent).as_posix(), 'at': captured['at'],
                        'origin': captured['origin'], 'sha256': hashlib.sha256(source.read_bytes()).hexdigest()})
        for index, item in enumerate(captured['samples']):
            name = item['schema']
            if name not in spec['components']['schemas']:
                raise ValueError(f'Unknown schema: {name}')
            schema = {'$schema': 'https://json-schema.org/draft/2020-12/schema',
                      '$ref': '#/components/schemas/' + name,
                      'components': spec['components']}
            errors = sorted(Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(item['response']),
                            key=lambda e: str(list(e.path)))
            checks.append({'source': source.name, 'sample': index + 1, 'schema': name,
                           'status': 'failed' if errors else 'passed',
                           'errors': [{'path': list(e.path), 'message': e.message} for e in errors]})
    if not checks:
        raise ValueError('No captured responses; empty evidence cannot pass')
    report = {'at': datetime.now(timezone.utc).isoformat(),
              'scope': 'Captured canonical User/Invite/Member/AdminOperation and cloud workspace, project Skill, notification, pre-execution dependency, scoped Admin cleanup page, role template, Report/Snapshot/Evidence responses and file ImportCreate requests only; not full API conformance',
              'sources': sources,
              'authentication_fixture': {
                  'file': AUTH_FIXTURE.relative_to(ROOT.parent).as_posix(),
                  'sha256': hashlib.sha256(AUTH_FIXTURE.read_bytes()).hexdigest(),
                  'schemas': len(fixture['schemas']), 'status': 'passed',
                  'scope': 'Exact original schema and source digest comparison; actual authentication wire checks are in the platform regression'},
              'membership_fixture': {'file': (AUTH_FIXTURE.parent / 'membership-schemas.json').relative_to(ROOT.parent).as_posix(), 'schemas': len(members['schemas']), 'status': 'passed', 'scope': 'Exact original schema and source digest comparison; actual wire checks are in the platform regression'},
              'admin_membership_fixture': {'file': (AUTH_FIXTURE.parent / 'admin-membership-schemas.json').relative_to(ROOT.parent).as_posix(), 'schemas': len(admin_members['schemas']), 'status': 'passed', 'scope': 'Exact original schema and source digest comparison; actual operations are covered by platform and real HTTP evidence'},
              'admin_account_fixture': {'file': (AUTH_FIXTURE.parent / 'admin-account-schemas.json').relative_to(ROOT.parent).as_posix(), 'schemas': len(admin_accounts['schemas']), 'status': 'passed', 'scope': 'Exact original schema and source digest comparison; account operations covered by isolated database and actual local HTTP'},
              'openapi_sha256': hashlib.sha256(SPEC.read_bytes()).hexdigest(),
              'checks': checks}
    OUTPUT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    passed = sum(c['status'] == 'passed' for c in checks)
    print(f'{passed}/{len(checks)} captured runtime response schemas passed.')
    if passed != len(checks):
        for c in checks:
            if c['status'] == 'failed':
                print(json.dumps(c, ensure_ascii=False))
        raise SystemExit(1)


if __name__ == '__main__':
    main()
