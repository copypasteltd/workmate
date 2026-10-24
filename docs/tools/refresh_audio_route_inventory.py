"""Refresh only the descriptive route inventory from an actual configured app."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def main():
    output = ROOT / 'docs/quality/audio-production-route-inventory.json'
    assert not output.exists()
    source = ROOT / 'dev/copypaste-delivery/evidence/audio-production-ui-03.json'
    report = json.loads(source.read_text(encoding='utf-8'))
    assert report['status'] == 'passed' and report['source_unchanged'] and report['compiled_unchanged']
    for name, expected in report['source_files'].items():
        assert digest(ROOT / 'dev' / name) == expected, name
    platform = ROOT / 'dev/copypaste-platform/contracts/implemented-routes.json'
    documentation = ROOT / 'docs/contracts/implemented-routes.json'
    assert platform.read_bytes() == documentation.read_bytes()
    old_bytes = platform.read_bytes()
    old = json.loads(old_bytes)
    identity = lambda row: (row['method'], row['path'])
    previous = {identity(row) for row in old['routes']}
    conditional = {identity(row) for row in old['conditional_routes']}
    observed = report['journey']['route_inventory']
    assert observed['data_mode'] == 'configured_services'
    actual = {identity(row) for row in observed['routes']}
    assert len(actual) == len(observed['routes']) and previous <= actual and not actual & conditional
    added = actual - previous
    assert len(added) == 7 and all('audio-jobs' in path for method, path in added)
    assert len(actual) == 472 and len(conditional) == 1
    baseline_path = ROOT / 'docs/quality/history/stage84-before-audio/receipt.json'
    baseline = json.loads(baseline_path.read_text(encoding='utf-8'))
    for name in ['docs/contracts/implemented-routes.json', 'dev/copypaste-platform/contracts/implemented-routes.json']:
        archived = next(row for row in baseline['files'] if row['source'] == name)
        assert digest(ROOT / archived['archive']) == sha256(old_bytes).hexdigest() == archived['sha256']
    for name, expected in baseline['original_openapi'].items():
        assert digest(ROOT / name) == expected
    result = {'generated_at': datetime.now(timezone.utc).isoformat(), 'contract': 'actual_fastify_route_inventory', 'not_full_design_openapi': True,
              'routes': [{'method': method, 'path': path} for method, path in sorted(actual, key=lambda row: (row[1], row[0]))],
              'conditional_routes': old['conditional_routes'],
              'additive_inventory_validation': {'source': source.relative_to(ROOT).as_posix(), 'sha256': digest(source),
                                                'scope': 'Actual configured-services app before this descriptive refresh. All old configured and conditional routes are retained. Full platform qualification remains separate.'}}
    raw = (json.dumps(result, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    platform.write_bytes(raw)
    documentation.write_bytes(raw)
    receipt = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'refreshed_from_actual_audio_app',
               'configured_routes': len(actual), 'conditional_routes': len(conditional), 'old_sha256': sha256(old_bytes).hexdigest(),
               'new_sha256': digest(platform), 'added_operations': [{'method': method, 'path': path} for method, path in sorted(added)],
               'source': source.relative_to(ROOT).as_posix(), 'source_sha256': digest(source),
               'baseline_receipt': baseline_path.relative_to(ROOT).as_posix(), 'baseline_receipt_sha256': digest(baseline_path),
               'verifier_sha256': digest(Path(__file__)), 'original_openapi_preserved': True}
    output.write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({key: receipt[key] for key in ['status', 'configured_routes', 'conditional_routes']}))


if __name__ == '__main__':
    main()
