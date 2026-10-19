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
           ['cloud-files-contract-samples.json', 'skills-contract-samples.json', 'notifications-contract-samples.json', 'task-dependencies-contract-samples.json', 'admin-records-contract-samples.json', 'agent-templates-contract-samples.json', 'analysis-reports-contract-samples.json', 'file-imports-contract-samples.json']]
OUTPUT = ROOT / 'quality/runtime-contract-samples.json'


def main():
    spec = json.loads(SPEC.read_text(encoding='utf-8'))
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
              'scope': 'Captured cloud workspace, project Skill, notification, pre-execution dependency, scoped Admin cleanup page, role template, Report/Snapshot/Evidence responses and file ImportCreate requests only; not full API conformance',
              'sources': sources,
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
