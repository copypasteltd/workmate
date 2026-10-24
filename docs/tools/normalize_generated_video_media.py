"""Derive a bounded GIF from the actual MP4 without altering raw evidence."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / 'dev'
DELIVERY = DEV / 'copypaste-delivery'
OUTPUT = ROOT / 'docs/quality/generated-video-media-normalization.json'


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def probe(file):
    return json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries',
        'format=duration:stream=codec_name,nb_frames', '-of', 'json', str(file)], timeout=45))


def main():
    assert not OUTPUT.exists()
    report_file = DELIVERY / 'evidence/desktop-local-ui-38-journey.json'
    report = json.loads(report_file.read_text(encoding='utf-8'))
    recording = report['native_browser_media']
    assert report['status'] == 'passed' and recording['skipped_capture_errors'] == 0
    mp4, original = [DEV / next(item['path'] for item in recording['files'] if item['path'].endswith(suffix)) for suffix in ['.mp4', '.gif']]
    for file in [mp4, original]:
        assert digest(file) == next(item['sha256'] for item in recording['files'] if item['path'] == file.relative_to(DEV).as_posix())
    source_probe, original_probe = probe(mp4), probe(original)
    seconds = float(source_probe['format']['duration'])
    assert source_probe['streams'][0]['codec_name'] == 'h264' and seconds == recording['seconds']
    assert abs(float(original_probe['format']['duration']) - seconds) >= 0.35
    target = original.with_stem(original.stem + '-timing')
    assert not target.exists()
    temp = DELIVERY / '.data/generated-video-media-normalization-38'
    temp.mkdir(exist_ok=False)
    palette = temp / 'palette.png'
    frames = "setpts=PTS-STARTPTS,fps=6,scale=w='trunc(min(1000,iw)/2)*2':h=-2:flags=lanczos"
    commands = [
        ['-hide_banner', '-loglevel', 'error', '-n', '-i', str(mp4), '-an', '-filter_threads', '1',
         '-vf', frames + ',palettegen=max_colors=160:stats_mode=diff', '-frames:v', '1', '-threads', '2', str(palette)],
        ['-hide_banner', '-loglevel', 'error', '-n', '-i', str(mp4), '-i', str(palette), '-an',
         '-filter_complex_threads', '1', '-filter_complex', '[0:v]' + frames + '[frames];[frames][1:v]paletteuse=dither=bayer:bayer_scale=3',
         '-t', str(seconds), '-fps_mode', 'passthrough', '-threads', '2', '-loop', '0', str(target)],
    ]
    for arguments in commands:
        result = subprocess.run(['ffmpeg', *arguments], capture_output=True, check=True, timeout=120)
        assert not result.stderr
    target_probe = probe(target)
    assert target_probe['streams'][0]['codec_name'] == 'gif'
    assert int(target_probe['streams'][0]['nb_frames']) > 1
    assert abs(float(target_probe['format']['duration']) - seconds) < 0.35
    for file in [mp4, original]:
        assert digest(file) == next(item['sha256'] for item in recording['files'] if item['path'] == file.relative_to(DEV).as_posix())
    result = {'at': datetime.now(timezone.utc).isoformat(), 'status': 'passed',
        'source_journey': {'path': report_file.relative_to(DELIVERY).as_posix(), 'sha256': digest(report_file)},
        'mp4': {'path': mp4.relative_to(DEV).as_posix(), 'sha256': digest(mp4), 'probe': source_probe},
        'original_gif': {'path': original.relative_to(DEV).as_posix(), 'sha256': digest(original), 'probe': original_probe},
        'derived_gif': {'path': target.relative_to(DEV).as_posix(), 'sha256': digest(target), 'bytes': target.stat().st_size, 'probe': target_probe},
        'scope': 'A separate GIF is encoded from the actual MP4 using unchanged source-frame timing, a reset zero origin and an explicit source-duration bound. It does not accelerate playback, introduce response frames, repaint screenshots or overwrite the original GIF, MP4, journey or raw capture. The source GIF has an extra encoder tail and remains archived with its original hash.',
        'ffmpeg_arguments': commands, 'raw_evidence_modified': False,
        'verifier': {'path': Path(__file__).relative_to(ROOT).as_posix(), 'sha256': digest(Path(__file__))}}
    OUTPUT.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'status': 'passed', 'actual_mp4_seconds': seconds, 'original_gif_seconds': float(original_probe['format']['duration']), 'derived_gif_seconds': float(target_probe['format']['duration'])}))


if __name__ == '__main__':
    main()
