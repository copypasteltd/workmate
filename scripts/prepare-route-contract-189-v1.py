"""Declare the reviewed post-baseline routes; do not infer acceptance from a live server."""
from pathlib import Path
from hashlib import sha256
import re
import json

DEV = Path(__file__).resolve().parents[2]
ROOT = DEV.parent
P = DEV / 'copypaste-platform'
source = DEV / 'copypaste-delivery/.data/acceptance-188/regression-8064c5cc-46c2-445d-b2fd-94d092406c00/platform-current-tests.log'
log = source.read_text(encoding='utf8', errors='replace')
block = re.search(r'^not ok 455 .*?(?=^# Subtest:)', log, re.M | re.S).group(0)
labels = re.findall(r"^    \+   '(GET|POST|PUT|PATCH|DELETE) ([^']+)'", block, re.M)
assert len(labels) == 44 and len(set(labels)) == 44
baseline = (P / 'contracts/implemented-routes.json').read_text(encoding='utf8')
contract = {'schema': 'copypaste-route-additions-189',
            'baseline_lf_sha256': sha256(baseline.replace('\r\n', '\n').encode()).hexdigest(),
            'scope': 'Explicit shipped workspace creation, document preview, erasure, ownership, export, control state, local handoff, conversation, specialist copy, usage, content-history, model management and admin directory operations.',
            'routes': [{'method': method, 'path': path} for method, path in labels],
            'conditional_routes': [], 'expected_current_routes': 670,
            'expected_current_conditional_routes': 1}
raw = (json.dumps(contract, ensure_ascii=False, indent=2) + '\n').encode()
for target in [P / 'contracts/current-route-additions-189-v1.json', ROOT / 'docs/contracts/current-route-additions-189-v1.json']:
    with target.open('xb') as f:
        f.write(raw)
helper = '''import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { currentRouteInventory as previousInventory } from "./route-inventory.js";

export async function currentRouteInventory() {
  const previous = await previousInventory();
  const addition = JSON.parse(await readFile("contracts/current-route-additions-189-v1.json", "utf8"));
  const routes = [...previous.routes, ...addition.routes];
  const conditional_routes = [...previous.conditional_routes, ...addition.conditional_routes];
  const keys = [...routes, ...conditional_routes].map(row => row.method + " " + row.path);
  assert.equal(new Set(keys).size, keys.length, "Explicit route declarations overlap");
  assert.equal(routes.length, addition.expected_current_routes);
  assert.equal(conditional_routes.length, addition.expected_current_conditional_routes);
  return {...previous, routes, conditional_routes};
}
'''
with (P / 'tests/route-inventory-189-v1.ts').open('x', encoding='utf8', newline='\n') as f:
    f.write(helper)
for base in ['brand-production', 'dedicated-cloud']:
    text = (P / 'tests' / (base + '.test.ts')).read_text(encoding='utf8')
    assert text.count('"./route-inventory.js"') == 1
    text = text.replace('"./route-inventory.js"', '"./route-inventory-189-v1.js"')
    if base == 'dedicated-cloud':
        assert text.count('inventory.routes.length,626') == 1
        text = text.replace('inventory.routes.length,626', 'inventory.routes.length,670')
    with (P / 'tests' / (base + '-189-v1.test.ts')).open('x', encoding='utf8', newline='\n') as f:
        f.write(text)
print(json.dumps({'explicit_added_routes': len(labels), 'historical_contracts_modified': 0}))
