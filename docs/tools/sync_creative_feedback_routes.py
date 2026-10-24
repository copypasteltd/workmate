"""Add observed creative-feedback operations to descriptive inventories."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ui', required=True)
    args = parser.parse_args()
    assert re.fullmatch(r'\d{2}', args.ui)
    source = ROOT / f'dev/copypaste-delivery/evidence/creative-feedback-ui-{args.ui}.json'
    report = json.loads(source.read_text(encoding='utf-8'))
    assert report['status'] == 'passed' and report['source_unchanged'] and report['owned_database_shutdown']
    actual = dict(report['journey']['route_inventory'])
    observed = actual['routes']
    actual['routes'] = [row for row in observed if row['path'] != '/v1/tenants/:tenant/demo-credit']
    assert len(observed) == len(actual['routes']) + 1
    assert actual['contract'] == 'actual_fastify_route_inventory' and actual['not_full_design_openapi']
    assert actual['data_mode'] == 'configured_services'
    target = ROOT / 'dev/copypaste-platform/contracts/implemented-routes.json'
    previous = target.read_bytes()
    old = json.loads(previous)
    before = {(item['method'], item['path']) for item in old['routes']}
    after = {(item['method'], item['path']) for item in actual['routes']}
    assert len(before) == 447 and len(after) == len(actual['routes']) == 454 and before <= after
    base = '/v1/tenants/:tenant/projects/:project/creative-feedback'
    assert after - before == {('GET', base + '/options'), ('GET', base + '/mappings'),
        ('POST', base + '/mappings'), ('POST', base + '/mappings/:id/confirm'),
        ('POST', base + '/mappings/:id/withdraw'), ('POST', base + '/reports'), ('GET', base + '/reports')}
    assert report['source_files']['copypaste-platform/contracts/implemented-routes.json'] == sha256(previous).hexdigest()
    result = {**old, 'generated_at': report['at'], 'routes': actual['routes'],
              'additive_inventory_validation': {'source': source.relative_to(ROOT).as_posix(), 'sha256': sha256(source.read_bytes()).hexdigest(),
                                                'scope': 'All configured-service method/path pairs observed in the actual passing app; descriptive inventory, not a replacement original OpenAPI.'}}
    output = ROOT / 'docs/quality/creative-feedback-route-inventory.json'
    assert not output.exists()
    records = []
    for file in [target, ROOT / 'docs/contracts/implemented-routes.json']:
        archive = ROOT / 'docs/quality/history/before-stage82-routes' / file.relative_to(ROOT)
        assert not archive.exists()
        archive.parent.mkdir(parents=True, exist_ok=True)
        original = file.read_bytes()
        archive.write_bytes(original)
        file.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
        records.append({'path': file.relative_to(ROOT).as_posix(), 'archive': archive.relative_to(ROOT).as_posix(),
                        'before_sha256': sha256(original).hexdigest(), 'after_sha256': sha256(file.read_bytes()).hexdigest()})
    output.write_text(json.dumps({'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed',
        'before_sha256': sha256(previous).hexdigest(), 'after_sha256': sha256(target.read_bytes()).hexdigest(),
        'configured_routes': len(after), 'conditional_routes': old['conditional_routes'], 'added': sorted(after - before),
        'records': records, 'source': source.relative_to(ROOT).as_posix(), 'source_sha256': sha256(source.read_bytes()).hexdigest(),
        'verifier_sha256': sha256(Path(__file__).read_bytes()).hexdigest()}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print('454 configured operations synchronized; 447 existing operations and the conditional demo declaration retained.')


if __name__ == '__main__':
    main()
