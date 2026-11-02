"""Correct the declared total while retaining the same 44 reviewed additions."""
from pathlib import Path
import json

dev = Path(__file__).resolve().parents[2]
platform = dev / 'copypaste-platform'
contract = json.loads((platform / 'contracts/current-route-additions-189-v1.json').read_text(encoding='utf8'))
# The current declared baseline has 696 routes. 626 was an older dedicated
# computer fixture's count, not the current baseline used by the shared helper.
assert len(contract['routes']) == 44
contract['expected_current_routes'] = 740
raw = (json.dumps(contract, ensure_ascii=False, indent=2) + '\n').encode()
for target in [platform / 'contracts/current-route-additions-189-v2.json', dev.parent / 'docs/contracts/current-route-additions-189-v2.json']:
    with target.open('xb') as stream:
        stream.write(raw)
for base in ['route-inventory', 'brand-production', 'dedicated-cloud']:
    ext = '.ts' if base == 'route-inventory' else '.test.ts'
    source = platform / 'tests' / (base + '-189-v1' + ext)
    text = source.read_text(encoding='utf8').replace('current-route-additions-189-v1.json', 'current-route-additions-189-v2.json').replace('route-inventory-189-v1.js', 'route-inventory-189-v2.js')
    if base == 'dedicated-cloud':
        assert text.count('inventory.routes.length,670') == 1
        text = text.replace('inventory.routes.length,670', 'inventory.routes.length,740')
    with (platform / 'tests' / (base + '-189-v2' + ext)).open('x', encoding='utf8', newline='\n') as stream:
        stream.write(text)
print(json.dumps({'baseline_routes': 696, 'explicit_additions': 44, 'expected_total': 740}))
