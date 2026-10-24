"""Add only the two observed managed-video commands to descriptive inventories."""
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
    source = ROOT / f'dev/copypaste-delivery/evidence/managed-video-capability-ui-{args.ui}.json'
    report = json.loads(source.read_text(encoding='utf-8'))
    assert report['status'] == 'passed' and report['source_unchanged'] and report['owned_database_shutdown']
    actual = report['journey']['route_inventory']
    assert actual['contract'] == 'actual_fastify_route_inventory' and actual['not_full_design_openapi']
    assert actual['data_mode'] == 'configured_services'
    target = ROOT / 'dev/copypaste-platform/contracts/implemented-routes.json'
    previous = target.read_bytes()
    old = json.loads(previous)
    before = {(item['method'], item['path']) for item in old['routes']}
    after = {(item['method'], item['path']) for item in actual['routes']}
    assert len(before) == 445 and len(after) == len(actual['routes']) == 447 and before <= after
    assert after - before == {('POST', '/v1/admin/capability-releases/validations/:validation/' + suffix)
                             for suffix in ['video-cancellations', 'video-rechecks']}
    assert report['source_files']['copypaste-platform/contracts/implemented-routes.json'] == sha256(previous).hexdigest()
    result = {**old, 'generated_at': report['at'], 'routes': actual['routes'],
              'additive_inventory_validation': {'source': source.relative_to(ROOT).as_posix(), 'sha256': sha256(source.read_bytes()).hexdigest(),
                                                'scope': 'All configured-service method/path pairs observed in the actual passing app; descriptive inventory, not a replacement original OpenAPI.'}}
    output = ROOT / 'docs/quality/managed-video-route-inventory.json'
    assert not output.exists()
    records = []
    for file in [target, ROOT / 'docs/contracts/implemented-routes.json']:
        archive = ROOT / 'docs/quality/history/before-stage81-routes' / file.relative_to(ROOT)
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
    print('447 configured operations synchronized; 445 original operations and the conditional demo declaration retained.')


if __name__ == '__main__':
    main()
