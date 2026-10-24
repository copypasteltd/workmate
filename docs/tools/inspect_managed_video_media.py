"""Inspect actual recorded media without changing any original capture bytes."""
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
    args = parser.parse_args()
    assert re.fullmatch(r'\d{2}', args.ui)
    output = ROOT / 'docs/quality/managed-video-media-review.json'
    assert not output.exists()
    source = DEV / f'copypaste-delivery/evidence/managed-video-capability-ui-{args.ui}.json'
    report = json.loads(source.read_text(encoding='utf-8'))
    assert report['status'] == 'passed' and report['journey']['browser_closed']
    rows = []
    for capture in report['journey']['media']:
        assert capture['skipped_capture_errors'] == 0 and capture['distinct_frames'] >= 2
        files, durations = [], {}
        for item in capture['files']:
            file = (DEV / item['path']).resolve()
            assert file.is_relative_to(DEV / 'copypaste-admin/assets/screenshots')
            before = sha256(file.read_bytes()).hexdigest()
            assert before == item['sha256']
            probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-count_frames', '-show_format', '-show_streams', '-of', 'json', str(file)], cwd=ROOT).decode('utf-8'))
            subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-err_detect', 'explode', '-i', str(file), '-f', 'null', '-'], cwd=ROOT, capture_output=True, check=True)
            duration = float(probe['format']['duration'])
            video = [row for row in probe['streams'] if row['codec_type'] == 'video']
            assert len(video) == 1 and int(video[0]['nb_read_frames']) >= 2
            assert abs(duration - capture['seconds']) <= 0.25
            assert sha256(file.read_bytes()).hexdigest() == before
            durations[file.suffix] = duration
            files.append({**item, 'seconds': duration, 'width': video[0]['width'], 'height': video[0]['height'],
                          'decoded_frames': int(video[0]['nb_read_frames']), 'fully_decoded': True})
        assert set(durations) == {'.gif', '.mp4'} and abs(durations['.gif'] - durations['.mp4']) <= 0.25
        rows.append({'name': capture['name'], 'observed_frames': capture['observed_frames'], 'capture_errors': 0,
                     'capture_timing': capture['capture_timing'], 'recorded_seconds': capture['seconds'], 'files': files})
    assert len(rows) == 3
    output.write_text(json.dumps({'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed', 'raw_media_modified': False,
        'source': source.relative_to(ROOT).as_posix(), 'source_sha256': sha256(source.read_bytes()).hexdigest(), 'recordings': rows,
        'verifier_sha256': sha256(Path(__file__).read_bytes()).hexdigest()}, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print('Three original GIF/MP4 pairs fully decoded; actual timing retained, no original bytes changed.')


if __name__ == '__main__':
    main()
