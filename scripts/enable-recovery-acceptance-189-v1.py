from pathlib import Path
from hashlib import sha256
import json

platform = Path(__file__).resolve().parents[2] / 'copypaste-platform'
source = platform / 'tests/scope-erasure-150-v10.test.ts'
raw = source.read_bytes()
text = raw.decode().replace('\r\n', '\n')
assert text.count('test.skip(') == 1
text = text.replace('test.skip(', 'test(')
text = text.replace('import {readFile,mkdir}', 'import {readFile,mkdir,readdir}')
comment = '''// The unchanged recovery implementation passed the real legacy145 backup /
// ledger2 restore in backend-05. Omit its expensive repeat under the explicit
// release-speed instruction; keep its full executable scenario and raw result.
'''
assert comment in text
text = text.replace(comment, '// Full acceptance includes a real native restore of a SQL145 backup and ledger2.\n')
old = "assert.equal((await restored.query('SELECT max(version)::int n FROM schema_migrations')).rows[0].n,148);"
assert text.count(old) == 1
text = text.replace(old, "const versions=(await readdir('migrations')).flatMap(name=>/^([0-9]+)-.*\\.sql$/.test(name)?[Number(name.split('-')[0])]:[]);\n assert.equal((await restored.query('SELECT max(version)::int n FROM schema_migrations')).rows[0].n,Math.max(...versions));")
target = platform / 'tests/scope-erasure-150-v11.test.ts'
new = text.encode()
with target.open('xb') as stream:
    stream.write(new)
record = dict(original=source.name, replacement=target.name,
              original_sha256=sha256(raw).hexdigest(), replacement_sha256=sha256(new).hexdigest(),
              reason='Re-enable the previously skipped real native backup restore. Require every current migration while preserving exact erasure and object-absence assertions.')
out = Path(__file__).resolve().parents[1] / '.data/acceptance-189/recovery-fixture-update-v1.json'
with out.open('x', encoding='utf8') as stream:
    json.dump(record, stream, indent=2)
    stream.write('\n')
print(json.dumps(record))
