"""Keep the observed incomplete browser run and exact verifier before correction."""
from pathlib import Path
import hashlib
import json
import sys

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
EVIDENCE = DEV / 'copypaste-delivery/evidence'
name = sys.argv[1] if len(sys.argv) > 1 else 'vip-credit-ui-missing-tenant-context'
assert name in {'vip-credit-ui-missing-tenant-context', 'vip-credit-ui-wrong-user-page'}
DEST = EVIDENCE / name
assert not DEST.exists()
files = [EVIDENCE / name for name in [
    'admin-vip-credit.json', 'admin-vip-credit-contract-samples.json',
    'admin-vip-credit-screenshots.json',
    'admin-vip-credit-final.log' if name.endswith('wrong-user-page') else 'admin-vip-credit-initial.log']]
files.append(DEV / 'copypaste-delivery/scripts/qa-admin-vip-credit.ts')
report = json.loads((EVIDENCE / 'admin-vip-credit-screenshots.json').read_bytes())
files.extend(ROOT / item['file'] for item in report['screenshots'])
entries = []
for source in files:
    relative = source.relative_to(ROOT)
    target = DEST / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(source.read_bytes())
    entries.append({'source': relative.as_posix(), 'archived': target.relative_to(ROOT).as_posix(),
                    'sha256': hashlib.sha256(source.read_bytes()).hexdigest()})
(DEST / 'archive-map.json').write_text(json.dumps({
    'scope': ('Five completed browser checks, then the verifier opened settings instead of the usage page containing entitlements. Timeout, closed browser, successful earlier combination and exact source retained.' if name.endswith('wrong-user-page') else 'Five completed browser checks, then the verifier omitted the required tenant header on its own user-rights read. Actual 400 response, closed browser, successful earlier combination and exact source retained; this is not a product success receipt.'),
    'files': entries}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print(json.dumps({'archived_files': len(entries)}))
