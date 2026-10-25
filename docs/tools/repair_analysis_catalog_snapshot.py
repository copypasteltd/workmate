"""Retain the first documentation write and restore the protected legacy catalog bytes."""
from datetime import datetime, timezone
import json
from pathlib import Path
from record_folder_work import ROOT, DEV, digest, read, ref

out = ROOT / 'docs/quality/analysis-roles-documentation-refresh.json'
old = read(out)
writer = ROOT / 'docs/tools/sync_analysis_role_docs.py'
assert old['verifier_sha256'] == digest(writer)
archive = ROOT / 'docs/quality/history/stage90-documentation-first-write'
archive.mkdir()
for file in [out, writer]:
    with (archive / file.name).open('xb') as stream: stream.write(file.read_bytes())
catalog = ROOT / 'docs/contracts/role-preset-catalog-current.json'
original = ROOT / 'docs/quality/history/stage90-current-documents/files/docs__contracts__role-preset-catalog-current.json.snapshot'
new = ROOT / 'docs/contracts/role-preset-catalog-analysis-1.1.0.json'
assert not new.exists()
assert catalog.read_bytes() == (DEV / 'copypaste-platform/catalog/role-preset-catalog.json').read_bytes()
with new.open('xb') as stream: stream.write(catalog.read_bytes())
catalog.write_bytes(original.read_bytes())
text = writer.read_text(encoding='utf-8')
before = "    current = ROOT / 'docs/contracts/role-preset-catalog-current.json'\n    write(current, (DEV / 'copypaste-platform/catalog/role-preset-catalog.json').read_text(encoding='utf-8'))"
after = "    current = ROOT / 'docs/contracts/role-preset-catalog-analysis-1.1.0.json'\n    assert not current.exists()\n    with current.open('xb') as stream: stream.write((DEV / 'copypaste-platform/catalog/role-preset-catalog.json').read_bytes())"
assert text.count(before) == 1
writer.write_text(text.replace(before, after), encoding='utf-8', newline='\n')
old['at'] = datetime.now(timezone.utc).isoformat()
for row in old['changes']:
    if row['path'] == catalog.relative_to(ROOT).as_posix():
        row['after_sha256'] = digest(catalog)
        row['restored_original_bytes'] = True
old['catalog_snapshot'] = ref(new)
old['first_documentation_write'] = ref(archive / out.name)
old['first_documentation_writer'] = ref(archive / writer.name)
old['future_writer'] = ref(writer)
old['legacy_catalog_restored'] = ref(catalog)
old['verifier_sha256'] = digest(Path(__file__))
out.write_text(json.dumps(old, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({'status': 'corrected', 'legacy_catalog_bytes_restored': True, 'current_role_snapshot': new.relative_to(ROOT).as_posix()}))
