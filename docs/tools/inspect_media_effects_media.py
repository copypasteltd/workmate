"""Decode current media-effect recordings and rendered deliveries completely, retaining original bytes."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    output = ROOT / "docs/quality/media-effects-media-review-01.json"
    assert not output.exists()
    checkpoint_file = ROOT / "docs/quality/media-effects-checkpoint.json"
    expected = digest(checkpoint_file)
    checkpoint = json.loads(checkpoint_file.read_text(encoding="utf-8"))
    assert checkpoint["status"] == "verified_scoped_media_effects"
    rows = []
    for recording in checkpoint["recordings"]:
        assert recording["skipped_capture_errors"] == 0 and recording["distinct_frames"] > 1
        files, durations = [], {}
        for item in recording["files"]:
            file = ROOT / "dev" / item["path"]
            assert digest(file) == item["sha256"]
            probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-count_frames", "-show_format", "-show_streams", "-of", "json", str(file)], cwd=ROOT))
            subprocess.run(["ffmpeg", "-v", "error", "-xerror", "-err_detect", "explode", "-i", str(file), "-f", "null", "-"], cwd=ROOT, capture_output=True, check=True)
            videos = [v for v in probe["streams"] if v["codec_type"] == "video"]
            assert len(videos) == 1 and int(videos[0]["nb_read_frames"]) > 1
            duration = float(probe["format"]["duration"])
            assert abs(duration - recording["seconds"]) <= 0.25 and digest(file) == item["sha256"]
            durations[file.suffix] = duration
            files.append({**item, "seconds": duration, "width": videos[0]["width"], "height": videos[0]["height"],
                          "decoded_frames": int(videos[0]["nb_read_frames"]), "fully_decoded": True})
        assert set(durations) == {".gif", ".mp4"} and abs(durations[".gif"] - durations[".mp4"]) <= 0.25
        rows.append({"component": recording["component"], "name": recording["name"], "observed_frames": recording["observed_frames"],
                     "recorded_seconds": recording["seconds"], "files": files})
    rendered = []
    examples_file = ROOT / checkpoint['examples']['path']
    examples = json.loads(examples_file.read_text(encoding='utf-8'))
    assert digest(examples_file) == checkpoint['examples']['sha256'] and len(examples['examples']) == 10
    for item in examples['sources']:
        assert digest(examples_file.parent / item['file']) == item['sha256']
    candidates = [(examples_file.parent / item['video'], item['video_sha256'], item['request']['output']['seconds'], 'original_public_example') for item in examples['examples']]
    for item in examples['examples']:
        assert digest(examples_file.parent / item['preview']) == item['preview_sha256'] and item['probe']['full_decode'] is True
    seconds_by_sha = {file['sha256']: run['output']['probe']['seconds'] for run in checkpoint['executions']
                      for file in run['output']['files'] if file['mime_type'] == 'video/mp4'}
    candidates += [(ROOT / 'dev/copypaste-delivery' / item['path'], item['sha256'], seconds_by_sha[item['sha256']], 'actual_private_download') for item in checkpoint['output_files'] if item['path'].endswith('.mp4')]
    assert len(candidates) == 12
    for file, sha, seconds, kind in candidates:
        assert digest(file) == sha
        probe = json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-count_frames', '-show_format', '-show_streams', '-of', 'json', str(file)], cwd=ROOT))
        subprocess.run(['ffmpeg', '-v', 'error', '-xerror', '-err_detect', 'explode', '-i', str(file), '-f', 'null', '-'], cwd=ROOT, capture_output=True, check=True)
        assert len(probe['streams']) == 1
        video = probe['streams'][0]
        assert video['codec_name'] == 'h264' and video['pix_fmt'] == 'yuv420p' and int(video['nb_read_frames']) == seconds * 24
        assert abs(float(probe['format']['duration']) - seconds) < 0.05 and digest(file) == sha
        rendered.append({'path': file.relative_to(ROOT).as_posix(), 'sha256': sha, 'kind': kind, 'seconds': seconds,
                         'decoded_frames': int(video['nb_read_frames']), 'fully_decoded': True, 'silent': True})
    assert digest(checkpoint_file) == expected
    result = {"at": datetime.now(timezone.utc).isoformat(), "status": "passed",
              "checkpoint": {"path": checkpoint_file.relative_to(ROOT).as_posix(), "sha256": expected},
              "recordings": rows, "rendered_videos": rendered, "raw_media_modified": False, "verifier_sha256": digest(Path(__file__))}
    with output.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": "passed", "recordings": len(rows), "fully_decoded_files": sum(len(r["files"]) for r in rows)}))


if __name__ == "__main__":
    main()
