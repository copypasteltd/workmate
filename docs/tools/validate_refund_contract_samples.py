"""Check supplemental refund payloads independently of the unchanged OpenAPI."""
from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
from jsonschema import Draft202012Validator, FormatChecker

ROOT = Path(__file__).resolve().parents[2]
EVIDENCE = ROOT / 'dev/copypaste-delivery/evidence'


def main():
    spec_path = ROOT / 'docs/contracts/openapi.json'
    fixture_path = ROOT / 'dev/copypaste-platform/contracts/admin-refund-schemas.json'
    sample_path = EVIDENCE / 'refund-contract-samples.json'
    spec = json.loads(spec_path.read_text(encoding='utf-8'))
    fixture = json.loads(fixture_path.read_text(encoding='utf-8'))
    assert fixture['kind'] == 'supplemental-extension'
    assert fixture['normative_source_sha256'] == hashlib.sha256(spec_path.read_bytes()).hexdigest()
    assert set(fixture['schemas']) == {'AdminRefund','AdminRefundList','AdminRefundDetail','AdminRefundOutcome'}
    defs = json.loads(json.dumps(spec['components']['schemas']).replace('#/components/schemas/', '#/$defs/'))
    defs.update(fixture['schemas'])
    samples = json.loads(sample_path.read_text(encoding='utf-8'))['samples']
    assert len(samples) >= 10
    checks = []
    for index, sample in enumerate(samples):
        for direction, name in [('response', sample['schema']), ('request', sample.get('request_schema'))]:
            if not name:
                continue
            assert name in fixture['schemas'] or name == 'AdminOperation'
            schema = {'$defs': defs, '$ref': '#/$defs/' + name}
            errors = list(Draft202012Validator(schema, format_checker=FormatChecker()).iter_errors(sample[direction]))
            checks.append({'sample':index+1,'direction':direction,'schema':name,'status':'failed' if errors else 'passed',
                           'errors':[{'path':list(e.path),'message':e.message} for e in errors]})
    states = {s['response']['refund']['state'] for s in samples if s['schema'] == 'AdminRefundDetail'}
    assert {'compensated','reconciling_unknown','partially_paid','reconciling_mismatch','partially_paid_closed'} <= states
    assert {'paid','not_paid','unknown'} <= {s['request']['outcome'] for s in samples if s.get('request_schema')}
    result = {'at':datetime.now(timezone.utc).isoformat(),'status':'failed' if any(c['status']=='failed' for c in checks) else 'passed',
              'scope':'Supplemental refund payload shapes and actual captured state coverage; original OpenAPI unchanged; not full financial acceptance',
              'checks':checks,'source_files':{p.relative_to(ROOT).as_posix():hashlib.sha256(p.read_bytes()).hexdigest() for p in [spec_path,fixture_path,sample_path]},
              'verifier_sha256':hashlib.sha256(Path(__file__).read_bytes()).hexdigest()}
    (ROOT/'docs/quality/refund-contract-samples.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'status':result['status'],'checks':len(checks),'states':sorted(states)}))
    if result['status'] != 'passed':
        raise SystemExit(1)


if __name__ == '__main__':
    main()
