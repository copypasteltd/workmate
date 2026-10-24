"""Refresh descriptive inventories from the actual passing configured app."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
source = ROOT / 'dev/copypaste-delivery/evidence/generated-video-ui-05.json'
report = json.loads(source.read_text(encoding='utf-8'))
assert report['status'] == 'passed' and report['source_unchanged'] and report['owned_database_shutdown']
actual = report['journey']['route_inventory']
assert actual['contract'] == 'actual_fastify_route_inventory' and actual['not_full_design_openapi']
assert actual['data_mode'] == 'configured_services'
target = ROOT / 'dev/copypaste-platform/contracts/implemented-routes.json'
old_bytes = target.read_bytes()
old = json.loads(old_bytes)
before = {(item['method'], item['path']) for item in old['routes']}
after = {(item['method'], item['path']) for item in actual['routes']}
assert len(before) == 438 and len(after) == len(actual['routes']) == 445 and before <= after
assert len(after - before) == 7 and all('video' in path for method, path in after - before)
assert report['source_files']['copypaste-platform/contracts/implemented-routes.json'] == sha256(old_bytes).hexdigest()
result = {**old, 'generated_at': report['at'], 'routes': actual['routes'],
          'additive_inventory_validation': {'source': source.relative_to(ROOT).as_posix(), 'sha256': sha256(source.read_bytes()).hexdigest(),
                                            'scope': 'All configured-service method/path pairs observed in the actual passing isolated app; descriptive inventory only.'}}
receipt = ROOT / 'docs/quality/generated-video-route-inventory.json'
assert not receipt.exists()
records = []
for file in [target, ROOT / 'docs/contracts/implemented-routes.json']:
    archive = ROOT / 'docs/quality/history/before-stage80-routes' / file.relative_to(ROOT)
    assert not archive.exists()
    archive.parent.mkdir(parents=True, exist_ok=True)
    previous = file.read_bytes()
    archive.write_bytes(previous)
    file.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    records.append({'path': file.relative_to(ROOT).as_posix(), 'archive': archive.relative_to(ROOT).as_posix(),
                    'before_sha256': sha256(previous).hexdigest(), 'after_sha256': sha256(file.read_bytes()).hexdigest()})
receipt.write_text(json.dumps({'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'before_sha256': sha256(old_bytes).hexdigest(),
                              'after_sha256': sha256(target.read_bytes()).hexdigest(), 'configured_routes': 445,
                              'conditional_routes': old['conditional_routes'], 'conditional_scope': 'Existing demo-only operation retained; fresh full platform qualification separately checks its registration.',
                              'added': sorted(after - before), 'records': records, 'source': source.relative_to(ROOT).as_posix(),
                              'source_sha256': sha256(source.read_bytes()).hexdigest(), 'verifier_sha256': sha256(Path(__file__).read_bytes()).hexdigest()},
                             ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print('445 actual configured-service operations synchronized; all previous operations and the existing demo-only declaration retained.')
