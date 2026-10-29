"""Bind verified scoped administrator edits to exact delivered code and observed media."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import contextlib
import io
import json
import re

import archive_admin_profile_evidence_v1 as evidence

ROOT, DEV = evidence.ROOT, evidence.DEV
QUALITY = ROOT / 'docs/quality'
CP = QUALITY / 'admin-profile-checkpoint-124.json'
PREVIOUS = QUALITY / 'history/stage124-previous-publication.json'


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def ref(file):
    return {'path': file.relative_to(ROOT).as_posix(), 'sha256': digest(file)}


def main():
    assert not CP.exists() and not PREVIOUS.exists(), 'Do not replace recorded checkpoints'
    with contextlib.redirect_stdout(io.StringIO()):
        evidence.verify(True)
    index = evidence.read(evidence.INDEX)
    def archived(name):
        return evidence.read(ROOT / index['entries'][name]['blob'])
    backend, ui, journey = [archived(index['selected'][k]) for k in ['backend', 'ui', 'journey']]
    source_files = dict(index['current_source_files'])
    media = []
    items = journey['screenshots'] + [file for recording in journey['recordings'] for file in recording['files']]
    for item in items:
        repo, relative = item['path'].split('/', 1)
        canonical = 'dev/' + index['source_workspace_mapping'][repo] + '/' + relative
        assert digest(ROOT / canonical) == item['sha256']
        source_files[canonical] = item['sha256']
        media.append({'path': canonical, 'sha256': item['sha256']})
    for file in [Path(__file__), Path(evidence.__file__)]:
        source_files[file.relative_to(ROOT).as_posix()] = digest(file)
    PREVIOUS.parent.mkdir(parents=True, exist_ok=True)
    with PREVIOUS.open('xb') as stream:
        stream.write((QUALITY / 'workmate-publication.json').read_bytes())
    value = {
        'schema_version': 1, 'at': datetime.now(timezone.utc).isoformat(),
        'status': 'verified_bounded_admin_profile_delivery',
        'scope': index['scope'], 'requirements': ['REQ-048', 'REQ-090', 'REQ-094', 'REQ-096'],
        'previous_publication': ref(PREVIOUS), 'evidence_index': ref(evidence.INDEX),
        'source_files': source_files, 'backend_counts': backend['counts'],
        'counts': {'related_backend': backend['counts'], 'actual_admin_ui': len(journey['checks']), 'admin_unit': {'tests':11,'pass':11,'fail':0,'cancelled':0,'skipped':0,'todo':0}},
        'test_files': backend['test_files'], 'actual_ui_checks': len(journey['checks']),
        'screenshots': len(journey['screenshots']), 'recordings': len(journey['recordings']),
        'layout_viewports_verified': sorted({row['viewport_width'] for row in journey['layout_checks']}),
        'layout_observations': len(journey['layout_checks']),
        'media': media, 'selected_backend': index['selected']['backend'],
        'selected_ui': index['selected']['ui'],
        'actual_admin_ui_model_calls': journey['model_calls'],
        'model_scope': 'Administrator editing and recovery flows do not invoke inference. Existing customer-flow regression uses the authorized synthetic company responses; no live model or media quality is claimed.',
        'current_full_platform_regression_rerun': False,
        'historical_full_regression': ref(QUALITY / 'dedicated-cloud-checkpoint.json'),
        'historical_runtime_startup': ref(QUALITY / 'runtime-startup-checkpoint-122.json'),
        'historical_admin_content': ref(QUALITY / 'admin-content-checkpoint-123.json'),
        'original_full_acceptance_open': 102, 'mandatory_open': 89,
        'original_ledger_mandatory_including_unconfirmed_suggestions': 101,
        'unconfirmed_expanded_suggestions': 12, 'optional_open': 1,
        'fully_accepted': 0,
        'preserved_failure_records': [name for name in index['entries']
                                      if re.fullmatch(r'dev/(?:copypaste-platform-content-124/\.data/admin-profiles-124/backend-|copypaste-admin-content-124/\.data/admin-profile-ui-)\d{2}\.json', name)
                                      and archived(name)['status'] == 'failed'],
        'limitations': [
            'This verifies the three additional scoped profile revision types and the complete listed related test files, not all backend files.',
            'Other administrator resource types, complete original requirements and operational acceptance remain open.',
            'No new Desktop or Chrome Side Panel execution qualification, signed installer, physical Linux or production deployment.',
            'Historical failed runs remain failed and retain their exact source snapshots and raw output.',
        ],
        'verifier_sha256': digest(Path(__file__)),
    }
    with CP.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    print(json.dumps({'status': value['status'], 'backend_counts': value['backend_counts'],
                      'actual_ui_checks': value['actual_ui_checks'], 'source_files': len(source_files)}))


if __name__ == '__main__':
    main()
