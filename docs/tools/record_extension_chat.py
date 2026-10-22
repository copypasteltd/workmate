"""Record actual native Side Panel evidence without promoting whole-product acceptance."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'

def read(path):
    return json.loads(path.read_text(encoding='utf-8'))

def digest(path):
    return sha256(path.read_bytes()).hexdigest()

def write(path, value):
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8', newline='\n') as file:
        file.write(json.dumps(value, ensure_ascii=False, indent=2) + '\n')

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--attempt', required=True)
    args = parser.parse_args()
    assert re.fullmatch(r'\d{2}', args.attempt)
    evidence = DELIVERY / 'evidence'
    report = read(evidence / f'extension-chat-{args.attempt}.json')
    journey = read(evidence / f'extension-chat-{args.attempt}-journey.json')
    assert report['status'] == journey['status'] == 'passed'
    assert report['counts'] == {'checks': 7, 'errors': 0}
    assert report['source_unchanged'] and report['compiled_unchanged']
    assert report['owned_database_shutdown'] and report['owned_preview_closed']
    assert all(c['exit_code'] == 0 for c in report['checks']) and len(report['checks']) == 6
    assert all(journey[k] for k in ('browser_closed', 'api_closed', 'fixture_closed'))
    cleanup = report['fixture_cleanup']
    assert cleanup['status'] == 'passed' and cleanup['workers_exited'] and cleanup['actual_filesystem_checked']
    assert all(r['reclaimed'] for r in cleanup['results'])
    for key in ('raw_report', 'verifier', 'journey_verifier', 'journey', 'fixture_cleanup'):
        proof = report[key]
        assert digest(DELIVERY / proof['path']) == proof['sha256']
    for name, expected in report['source_files'].items():
        assert digest(DEV / name) == expected, 'Current source differs: ' + name
    log = (DELIVERY / report['raw_report']['path']).read_text(encoding='utf-8')
    assert re.search(r'^# tests 32$', log, re.M) and re.search(r'^# pass 32$', log, re.M)
    assert re.search(r'^# fail 0$', log, re.M) and re.search(r'^# skipped 0$', log, re.M)
    assert len(journey['screenshots']) == 4
    for item in journey['screenshots'] + journey['media']['files']:
        assert digest(DEV / item['path']) == item['sha256']
    assert journey['media']['skipped_capture_errors'] == 0
    assert journey['media']['distinct_frames'] >= 2 and journey['media']['observed_frames'] >= 5
    for component, files in report['compiled'].items():
        for file, expected in files.items():
            assert digest(DEV / ('copypaste-' + component) / 'dist' / file) == expected
    for item in journey['media']['files']:
        subprocess.run(['ffmpeg', '-hide_banner', '-loglevel', 'error', '-i', str(DEV / item['path']), '-f', 'null', '-'], check=True, capture_output=True)
    sources = []
    archive = ROOT / 'docs/quality/history/extension-chat-qualified-sources'
    for name, expected in report['source_files'].items():
        if name.startswith('copypaste-extension/') or name in ('copypaste-delivery/scripts/qa-extension-chat.ts', 'copypaste-delivery/scripts/run-extension-chat.mjs', 'copypaste-delivery/scripts/record-workmate-media.ts'):
            target = archive / (name.replace('/', '__') + '.txt')
            target.parent.mkdir(parents=True, exist_ok=True)
            with target.open('xb') as file:
                file.write((DEV / name).read_bytes())
            assert digest(target) == expected
            sources.append({'source': 'dev/' + name, 'archive': target.relative_to(ROOT).as_posix(), 'sha256': expected})
    attempts = []
    for number in range(1, int(args.attempt) + 1):
        name = f'extension-chat-{number:02}.json'
        previous = read(evidence / name)
        attempts.append({'path': 'dev/copypaste-delivery/evidence/' + name, 'sha256': digest(evidence / name),
                         'status': previous['status'], 'counts': previous['counts'],
                         'scope': 'Recorded original attempt; only the selected attempt binds current sources'})
    for name in (f'extension-chat-{args.attempt}.json', f'extension-chat-{args.attempt}-journey.json'):
        with (ROOT / 'docs/quality' / name).open('xb') as file:
            file.write((evidence / name).read_bytes())
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'verified_native_conversation_subset',
              'requirement': 'CLIENT01 EXT-C01–EXT-C06', 'selected_attempt': args.attempt,
              'source_files_verified': len(report['source_files']), 'before_images': sources,
              'extension_tests': {'tests': 32, 'pass': 32, 'fail': 0, 'skipped': 0},
              'native_checks': journey['checks'], 'media': journey['media'], 'screenshots': journey['screenshots'],
              'media_full_decode': 'passed for MP4 and GIF', 'attempts': attempts,
              'limits': ['UI model turns are synthetic; real native Side Panel, identity, upload, Worker, files and billing',
                         'Desktop local Agent product integration is still pending',
                         'Full 102 REQ/102 TC, NFR, G01–G10 and all roles remain required'],
              'verifier_sha256': digest(Path(__file__))}
    write(ROOT / 'docs/quality/extension-chat-checkpoint.json', result)
    print(json.dumps({'status': result['status'], 'sources': len(report['source_files']), 'native_checks': 7, 'tests': 32, 'media_full_decode': 'passed'}))

if __name__ == '__main__':
    main()
