"""Preserve preflight failures and prepare the collected observation correction."""
from pathlib import Path
from datetime import datetime, timezone
import ast, json

R = Path(__file__).resolve().parents[2]
L = R / 'dev/copypaste-delivery'
scripts = L / 'scripts'
failed = L / '.data/acceptance-204/marketing-correction-v1'
assert failed.is_dir() and not list(failed.iterdir())
prior = json.loads((L / '.data/acceptance-203/real-specialists-v4/receipt.json').read_text('utf-8'))
assert next(x for x in prior['items'] if x['role'] == 'marketing-analyst')['status'] == 'failed_or_requires_investigation'
source = (scripts / 'qualify-marketing-correction-204-v1.py').read_text('utf-8-sig')
old = "assert all(next(x for x in previous['items'] if x['role']==c['role'])['status']!='passed_controlled_functional_sample' for c in cases)\ncases=[next(c for c in cases if c['role']=='marketing-analyst')]"
new = "cases=[next(c for c in cases if c['role']=='marketing-analyst')]\nassert len(cases)==1\nassert all(next(x for x in previous['items'] if x['role']==c['role'])['status']!='passed_controlled_functional_sample' for c in cases)"
assert source.count(old) == 1
source = source.replace(old, new).replace('marketing-correction-v1', 'marketing-correction-v2')
ast.parse(source)
with (scripts / 'qualify-marketing-correction-204-v2.py').open('x', encoding='utf-8', newline='\n') as f:
    f.write(source)
live = (scripts / 'qualify-live-marketing-review-204-v1.mjs').read_text('utf-8-sig')
assert (L / 'node_modules/tsx/dist/loader.mjs').is_file()
with (scripts / 'qualify-live-marketing-review-204-v2.mjs').open('x', encoding='utf-8', newline='\n') as f:
    f.write('// Run with node --import tsx: the shared recording helper contains TypeScript.\n' + live)
report = {
    'stage': 204, 'status': 'retained_preflight_failures',
    'recorded_at': datetime.now(timezone.utc).isoformat(),
    'scope': 'Operator-observed command failures before any business task, client session or model call; original executed scripts remain unchanged.',
    'items': [
        {'script': 'qualify-marketing-correction-204-v1.py', 'error': 'AssertionError before role filtering; three retained successful roles were incorrectly included in the precondition.', 'business_posts': 0, 'paid_tasks_submitted': 0, 'correction': 'v2 selects the single previously failed marketing role before applying the original guard; successful roles remain excluded.'},
        {'script': 'qualify-live-marketing-review-204-v1.mjs', 'error': 'ERR_UNKNOWN_FILE_EXTENSION for record-workmate-media.ts, before module evaluation.', 'browser_created': False, 'business_posts': 0, 'correction': 'v2 runs with the existing package-defined node --import tsx loader; no application source changes.'}
    ]
}
with (failed / 'receipt.json').open('x', encoding='utf-8') as f:
    json.dump(report['items'][0], f, indent=2); f.write('\n')
preflight = L / '.data/acceptance-204/observation-preflight-v1.json'
with preflight.open('x', encoding='utf-8') as f:
    json.dump(report, f, indent=2); f.write('\n')
collector = R / 'docs/tools/document-integrated-round-204-v1.py'
text = collector.read_text('utf-8-sig')
assert text.count('marketing-correction-v1/receipt.json') == 2
text = text.replace('marketing-correction-v1/receipt.json', 'marketing-correction-v2/receipt.json')
needle = "put('backup-client-provenance.json',deployment['backup_client'])"
assert text.count(needle) == 1
text = text.replace(needle, needle + "\nput('retained-observation-preflight-failures.json',load(L/'.data/acceptance-204/observation-preflight-v1.json'))")
collector.write_text(text, encoding='utf-8', newline='\n')
print(json.dumps({'status': 'prepared', 'paid_replays': 0, 'application_source_changed': False}))
