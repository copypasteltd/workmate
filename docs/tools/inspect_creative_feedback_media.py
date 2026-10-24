"""Decode actual Web/native feedback recordings; never alter capture bytes."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--ui', required=True)
    parser.add_argument('--desktop', required=True)
    args = parser.parse_args()
    assert all(re.fullmatch(r'\d{2}', v) for v in [args.ui, args.desktop])
    output = ROOT / 'docs/quality/creative-feedback-media-review.json'
    assert not output.exists()
    sources = [DEV / f'copypaste-delivery/evidence/creative-feedback-ui-{args.ui}.json',
        DEV / f'copypaste-delivery/evidence/desktop-local-ui-{args.desktop}.json']
    captures, source_records = [], []
    for source in sources:
        report = json.loads(source.read_text(encoding='utf-8'))
        assert report['status'] == 'passed' and report['source_unchanged'] and report['owned_database_shutdown']
        journey = report['journey']
        if isinstance(journey, dict) and 'path' in journey:
            file = DEV / 'copypaste-delivery' / journey['path']
            assert sha256(file.read_bytes()).hexdigest() == journey['sha256']
            journey = json.loads(file.read_text(encoding='utf-8'))
        assert journey['browser_closed'] and not journey['errors']
        captures.extend([journey['creative_feedback_media']] if 'creative_feedback_media' in journey else journey['media'])
        source_records.append({'path': source.relative_to(ROOT).as_posix(), 'sha256': sha256(source.read_bytes()).hexdigest()})
    rows = []
    for capture in captures:
        assert capture['skipped_capture_errors'] == 0 and capture['distinct_frames'] > 1
        files, durations = [], {}
        for item in capture['files']:
            file = (DEV / item['path']).resolve()
            assert file.is_relative_to(DEV)
            before = sha256(file.read_bytes()).hexdigest()
            assert before == item['sha256']
            probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-count_frames', '-show_format', '-show_streams', '-of', 'json', str(file)], cwd=ROOT).decode('utf-8'))
            subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-err_detect', 'explode', '-i', str(file), '-f', 'null', '-'], cwd=ROOT, capture_output=True, check=True)
            video = [v for v in probe['streams'] if v['codec_type'] == 'video']
            assert len(video) == 1 and int(video[0]['nb_read_frames']) > 1
            duration = float(probe['format']['duration'])
            assert abs(duration - capture['seconds']) <= 0.25
            durations[file.suffix] = duration
            assert sha256(file.read_bytes()).hexdigest() == before
            files.append({**item, 'seconds': duration, 'width': video[0]['width'], 'height': video[0]['height'],
                'decoded_frames': int(video[0]['nb_read_frames']), 'fully_decoded': True})
        assert set(durations) == {'.gif', '.mp4'} and abs(durations['.gif'] - durations['.mp4']) <= 0.25
        rows.append({'name': capture['name'], 'recorded_seconds': capture['seconds'], 'capture_errors': 0,
            'observed_frames': capture['observed_frames'], 'capture_timing': capture['capture_timing'], 'files': files})
    assert len(rows) == 2
    output.write_text(json.dumps({'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'sources': source_records,
        'raw_media_modified': False, 'recordings': rows, 'verifier_sha256': sha256(Path(__file__).read_bytes()).hexdigest()}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print('Two original Web/Desktop GIF/MP4 pairs fully decoded; actual timing and original bytes retained.')


if __name__ == '__main__':
    main()
