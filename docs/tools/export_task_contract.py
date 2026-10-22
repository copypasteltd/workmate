"""Copy task schemas verbatim from the immutable normative OpenAPI document."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
source = root / 'docs/contracts/openapi.json'
raw = source.read_bytes()
expected = '51dd90f26137798dd23c4e881b7f9f0b20f99ad4b9fee0cce98686e11873aab4'
assert hashlib.sha256(raw).hexdigest() == expected
original = json.loads(raw)['components']['schemas']
names = ['TaskCreate', 'TaskAccepted', 'Task', 'TaskList', 'TaskControl', 'TaskInput']
schemas = {}

def include(name):
    if name in schemas:
        return
    value = original[name]
    schemas[name] = value
    def visit(node):
        if isinstance(node, dict):
            ref = node.get('$ref', '')
            if ref.startswith('#/components/schemas/'):
                include(ref.rsplit('/', 1)[-1])
            for child in node.values():
                visit(child)
        elif isinstance(node, list):
            for child in node:
                visit(child)
    visit(value)

for name in names:
    include(name)
target = root / 'dev/copypaste-platform/contracts/task-schemas.json'
target.write_text(json.dumps({'source': 'docs/contracts/openapi.json',
                            'source_sha256': expected, 'schemas': schemas},
                           indent=2, ensure_ascii=False) + '\n', encoding='utf-8', newline='\n')
print(f'Exported {len(schemas)} unchanged normative task schemas')
