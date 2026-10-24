"""Validate the additive contract against captured, successful real UI HTTP reads."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import sys
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[2]


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def main():
    attempt = sys.argv[1]
    assert re.fullmatch(r'\d{2}', attempt) and len(sys.argv) == 2
    source = ROOT / f'dev/copypaste-delivery/evidence/audio-production-ui-{attempt}.json'
    receipt = json.loads(source.read_text(encoding='utf-8'))
    assert receipt['status'] == 'passed' and receipt['source_unchanged'] and receipt['compiled_unchanged']
    journey = receipt['journey']
    assert journey['status'] == 'passed' and journey['browser_closed'] and journey['provider_closed']
    spec_path = ROOT / 'docs/contracts/audio-production-openapi.json'
    assert spec_path.read_bytes() == (ROOT / 'dev/copypaste-platform/contracts/audio-production-openapi.json').read_bytes()
    spec = json.loads(spec_path.read_text(encoding='utf-8'))
    Draft202012Validator(json.loads((ROOT / 'docs/contracts/vendor/openapi-3.1-meta.schema.json').read_text(encoding='utf-8'))).validate(spec)
    schemas = spec['components']['schemas']
    for schema in schemas.values():
        Draft202012Validator.check_schema(schema)
    samples = journey['response_samples']
    assert len(samples) >= 10
    assert {sample['schema'] for sample in samples} >= {'Job', 'JobList', 'Preview', 'AdminJobList', 'AdminBody'}
    for sample in samples:
        schema = {'$ref': '#/components/schemas/' + sample['schema'], 'components': spec['components']}
        Draft202012Validator(schema, format_checker=FormatChecker()).validate(sample['body'])
    actual = {(row['method'], row['path']) for row in journey['route_inventory']['routes']}
    expected = {(method.upper(), re.sub(r'\{([^}]+)\}', r':\1', route)) for route, operations in spec['paths'].items() for method in operations}
    assert len(expected) == 7 and expected <= actual
    baseline = json.loads((ROOT / 'docs/quality/history/stage84-before-audio/receipt.json').read_text(encoding='utf-8'))
    for name, expected_sha in baseline['original_openapi'].items():
        assert digest(ROOT / name) == expected_sha
    output = ROOT / f'docs/quality/audio-production-contract-{attempt}.json'
    assert not output.exists()
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed_real_audio_http_samples',
              'source': source.relative_to(ROOT).as_posix(), 'source_sha256': digest(source), 'contract_sha256': digest(spec_path),
              'validated_samples': len(samples), 'schema_roots': sorted({sample['schema'] for sample in samples}),
              'registered_audio_operations': 7, 'original_openapi_preserved': True,
              'verifier_sha256': digest(Path(__file__)), 'scope': 'Captured synthetic-service UI HTTP shapes and actual registered route subset; not complete production or professional voice acceptance.'}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({key: result[key] for key in ['status', 'validated_samples', 'registered_audio_operations']}))


if __name__ == '__main__':
    main()
