"""Bind bounded Stage 122 results to delivered sources without closing full acceptance."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import contextlib
import io
import json
import re

import archive_runtime_startup_evidence as evidence

ROOT, DEV = evidence.ROOT, evidence.DEV
Q = ROOT / 'docs/quality'
CP = Q / 'runtime-startup-checkpoint-122.json'
PREVIOUS = Q / 'history/stage122-previous-publication.json'
SCOPE = ('Bounded native Codex initialization recovery, exact thread/turn isolation, '
         'one original worker attempt and payer reservation, fresh-checkout Desktop test preparation, '
         'localized activity messages and actual packaged frameless Desktop UI. '
         'Native Windows processes and PostgreSQL; explicitly synthetic company model/media responses. '
         'This is not a new full backend run or full product acceptance.')


def read(file):
    return json.loads(file.read_text(encoding='utf-8-sig'))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def ref(file):
    return {'path': file.relative_to(ROOT).as_posix(), 'sha256': digest(file)}


def main():
    assert not CP.exists(), 'Never replace an executed checkpoint'
    with contextlib.redirect_stdout(io.StringIO()):
        evidence.verify(True)
    index = read(evidence.INDEX)
    def archived(original):
        return read(ROOT / index['entries'][original]['blob'])
    reports = {key: archived(name) for key, name in index['selected'].items()}
    def archived_bytes(original):
        return (ROOT / index['entries'][original]['blob']).read_bytes()
    billing_text = archived_bytes('dev/copypaste-delivery/' + reports['worker_billing']['raw_report']['path']).decode('utf-8')
    def timing(text, label):
        values = re.findall(label + r' (\{[^\r\n]+\})', text)
        assert len(values) == 1
        return json.loads(values[0])
    preparation = timing(billing_text, 'recovery_fixture_timing')
    execution = timing(billing_text, 'recovery_execution_timing')
    assert 0 < execution['elapsed_ms'] < execution['limit_ms'] == 120000
    ui = reports['desktop_ui']
    journey = archived('dev/copypaste-delivery/' + ui['journey']['path'])
    sources = dict(index['current_source_files'])
    for path, expected in {
        'dev/copypaste-platform/scripts/qualify-runtime-startup-v1.mjs': reports['cloud_native']['verifier_sha256'],
        'dev/copypaste-delivery/scripts/qualify-runtime-startup-v2.mjs': reports['desktop_native']['verifier_sha256'],
        'dev/copypaste-delivery/scripts/qualify-runtime-startup-v3.mjs': reports['web']['verifier_sha256'],
        'dev/copypaste-delivery/scripts/qualify-runtime-billing-v3.mjs': reports['worker_billing']['verifier_sha256'],
        'dev/copypaste-delivery/scripts/run-runtime-startup-desktop-v2.mjs': ui['verifier_sha256'],
        'dev/copypaste-delivery/scripts/qa-runtime-startup-desktop-v1.ts': ui['journey_verifier_sha256'],
    }.items():
        assert digest(ROOT / path) == expected
        assert path not in sources or sources[path] == expected
        sources[path] = expected
    media = []
    for item in journey['screenshots'] + journey['media']['files']:
        name = item['path']
        repo, relative = name.split('/', 1)
        canonical = 'dev/' + index['source_workspace_mapping'][repo] + '/' + relative
        assert digest(ROOT / canonical) == item['sha256']
        sources[canonical] = item['sha256']
        media.append({'path': canonical, 'sha256': item['sha256']})
    native = reports['cloud_native']['native_binary']
    assert native['sha256'] == ui['packaged']['native_binary_sha256']
    assert native['sha256'] == reports['desktop_native']['native_binary']['sha256']
    value = {
        'schema_version': 1, 'at': datetime.now(timezone.utc).isoformat(),
        'status': 'verified_bounded_runtime_startup_delivery', 'scope': SCOPE,
        'previous_publication': ref(PREVIOUS), 'evidence_index': ref(evidence.INDEX),
        'source_files': sources, 'native_runtime': {'version': native['version'], 'sha256': native['sha256']},
        'counts': {'cloud_native': 12, 'desktop_unit': 180, 'desktop_native': 25, 'web_unit': 20,
                   'worker_billing': reports['worker_billing']['counts'], 'packaged_desktop_ui': 8},
        'worker_billing_test_files': reports['worker_billing']['test_files'],
        'media': media, 'original_full_acceptance_open': 102,
        'mandatory_open': 101, 'optional_open': 1, 'fully_accepted': 0,
        'current_full_platform_regression_rerun': False,
        'historical_full_regression': ref(Q / 'dedicated-cloud-checkpoint.json'),
        'preserved_failure_records': [
            'dev/copypaste-delivery/.data/runtime-startup-122/desktop-01/receipt.json',
            'dev/copypaste-delivery/.data/runtime-startup-122/ui/desktop-ui-01-preflight-failure.json',
            'dev/copypaste-delivery/.data/runtime-billing-122/backend-01.json',
            'dev/copypaste-delivery/.data/runtime-billing-122/backend-02.json'],
        'integration_fixture': 'Real source-task preparation is separately timed before the 120-second recovery/ledger assertions. The original combined-fixture timeout remains archived.',
        'integration_fixture_timings_ms': {'preparation': preparation['elapsed_ms'],
                                          'recovery_and_ledger': execution['elapsed_ms'],
                                          'assertion_limit': execution['limit_ms']},
        'limitations': [
            'Historical initialize timeout root cause remains unproven; the bounded recovery mechanism is separately tested.',
            'Two initial integration attempts timed out or ended in a failed task. Their exact causes remain unproven; later passing diagnostics and full related-file results do not erase those failures.',
            'No signed installer, human native-dialog journey, live provider quality, physical Linux host or full production acceptance.',
            'Earlier full backend results remain bound to their original source version; only the listed scopes were rerun here.'],
        'verifier_sha256': digest(Path(__file__)),
    }
    for name in value['preserved_failure_records']:
        assert name in index['entries']
    with CP.open('x', encoding='utf-8', newline='\n') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write('\n')
    print(json.dumps({'status': value['status'], 'sources': len(sources), 'counts': value['counts']}))


if __name__ == '__main__':
    main()
