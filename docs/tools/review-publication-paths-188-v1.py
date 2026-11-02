"""Complete the stage188 source allowlist without rerunning acceptance or media capture."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json

ROOT = Path(__file__).resolve().parents[2]
PRIVATE = ROOT / 'dev/copypaste-delivery/.data/deployment-188'
REPORT = ROOT / 'docs/quality/live-acceptance-188.json'
PATHS = PRIVATE / 'publication-paths.json'
REVIEW = ROOT / 'docs/quality/live-acceptance-188/publication-path-review.json'


def digest(p):
    return sha256(p.read_bytes()).hexdigest()


def save(p, value):
    p.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n',
                 encoding='utf8', newline='\n')


report = json.loads(REPORT.read_bytes())
paths = json.loads(PATHS.read_bytes())
assert not REVIEW.exists(), 'This review has already run; preserve its source binding.'
for name, expected in report['sources'].items():
    assert digest(ROOT / name) == expected, name

added = ['scripts/run-current-tests-owned-v11.mjs',
         'scripts/run-current-tests-owned-v12.mjs']
for name in added:
    assert name not in paths['backend']
    assert (ROOT / 'dev/copypaste-platform' / name).is_file()

# Keep the original preparer's report and exact allowlist for audit/recovery.
for source, name in [(REPORT, 'acceptance-report.before-path-review-v1.json'),
                     (PATHS, 'publication-paths.before-path-review-v1.json')]:
    with (PRIVATE / name).open('xb') as destination:
        destination.write(source.read_bytes())

save(REVIEW, {
    'stage': 188,
    'at': datetime.now(timezone.utc).isoformat(),
    'original_report_sha256': digest(REPORT),
    'original_allowlist_sha256': digest(PATHS),
    'added_backend_paths': added,
    'reason': 'The tested npm entry references the v12 runner, and the retained '
              'v11 attempt is referenced by historical discovery tests. Their '
              'names lack 188 and were missed by the preparer glob.',
    'test_or_product_code_modified_by_this_review': False,
    'unrelated_untracked_files_preserved': True,
    'deployment_archive_unchanged': True,
})
paths['backend'] = sorted(set(paths['backend']) | set(added))
paths['docs'] = sorted(set(paths['docs']) | {
    REVIEW.relative_to(ROOT).as_posix(),
    Path(__file__).relative_to(ROOT).as_posix(),
})
for name in added:
    qualified = ROOT / 'dev/copypaste-platform' / name
    report['sources'][qualified.relative_to(ROOT).as_posix()] = digest(qualified)
for qualified in [REVIEW, Path(__file__)]:
    report['sources'][qualified.relative_to(ROOT).as_posix()] = digest(qualified)
report['publication_path_review'] = REVIEW.relative_to(ROOT).as_posix()
save(REPORT, report)
save(PATHS, paths)
print(json.dumps({'status': 'source_allowlist_completed',
                  'source_count': len(report['sources']),
                  'added_backend_paths': added}))
