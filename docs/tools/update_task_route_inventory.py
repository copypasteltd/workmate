"""Export the actual isolated-app inventory retained by a passing test run."""
import argparse
from hashlib import sha256
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
parser = argparse.ArgumentParser()
parser.add_argument('--attempt', required=True)
args = parser.parse_args()
assert len(args.attempt) == 2 and args.attempt.isdigit()
delivery = root / 'dev/copypaste-delivery'
report = json.loads((delivery / f'evidence/canonical-task-integration-{args.attempt}.json').read_text(encoding='utf-8'))
assert report['status'] == 'passed' and report['source_unchanged'] and report['owned_database_shutdown']
raw = (delivery / report['raw_report']['path']).read_bytes()
assert sha256(raw).hexdigest() == report['raw_report']['sha256']
lines = [line for line in raw.decode('utf-8').splitlines() if 'canonical_task_route_inventory ' in line]
assert len(lines) == 1
inventory = json.loads(lines[0].split('canonical_task_route_inventory ', 1)[1])
pairs = {(r['method'], r['path']) for r in inventory['routes']}
assert len(pairs) == len(inventory['routes'])
assert {('GET', '/v1/tasks'), ('POST', '/v1/tasks'), ('GET', '/v1/tasks/:task_id'),
        ('POST', '/v1/tasks/:task_id/controls'), ('POST', '/v1/tasks/:task_id/inputs')}.issubset(pairs)
target = root / 'dev/copypaste-platform/contracts/implemented-routes.json'
previous = target.read_bytes()
inventory['generated_at'] = report['at']
inventory['previous_inventory_sha256'] = sha256(previous).hexdigest()
inventory['source_receipt'] = f'delivery:evidence/canonical-task-integration-{args.attempt}.json'
inventory['superseded_implementation_paths'] = [{'method': 'GET', 'path': '/v1/oauth/:provider/callback',
    'replacement': '/v1/connections/callback',
    'note': 'The previous implementation inventory predates the state-bound connector flow. The normative OpenAPI is unchanged.'}]
target.write_text(json.dumps(inventory, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({'method_path_pairs': len(pairs), 'previous_inventory_sha256': inventory['previous_inventory_sha256']}))
