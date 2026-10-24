"""Decode original audio UI recordings and check their observed timing."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--ui", required=True)
    parser.add_argument("--desktop", required=True)
    args = parser.parse_args()
    assert all(re.fullmatch(r"\d{2}", value) for value in [args.ui, args.desktop])
    output = ROOT / "docs/quality/audio-production-media-review.json"
    assert not output.exists()
    captures, sources = [], []
    for name in [f"audio-production-ui-{args.ui}", f"desktop-local-ui-{args.desktop}"]:
        file = DEV / "copypaste-delivery/evidence" / (name + ".json")
        report = json.loads(file.read_text(encoding="utf-8"))
        assert report["status"] == "passed" and report["source_unchanged"] and report["owned_database_shutdown"]
        journey = report["journey"]
        if "path" in journey:
            target = DEV / "copypaste-delivery" / journey["path"]
            assert sha256(target.read_bytes()).hexdigest() == journey["sha256"]
            journey = json.loads(target.read_text(encoding="utf-8"))
        assert journey["browser_closed"] and not journey["errors"]
        captures.extend([journey["audio_media"]] if "audio_media" in journey else journey["media"])
        sources.append({"path": file.relative_to(ROOT).as_posix(), "sha256": sha256(file.read_bytes()).hexdigest()})
    rows = []
    for capture in captures:
        assert capture["skipped_capture_errors"] == 0 and capture["distinct_frames"] > 1
        files, durations = [], {}
        for item in capture["files"]:
            file = (DEV / item["path"]).resolve()
            assert file.is_relative_to(DEV)
            before = sha256(file.read_bytes()).hexdigest()
            assert before == item["sha256"]
            probe = json.loads(subprocess.check_output(["ffprobe", "-v", "error", "-count_frames", "-show_format", "-show_streams", "-of", "json", str(file)], cwd=ROOT))
            subprocess.run(["ffmpeg", "-v", "error", "-xerror", "-err_detect", "explode", "-i", str(file), "-f", "null", "-"], cwd=ROOT, capture_output=True, check=True)
            videos = [row for row in probe["streams"] if row["codec_type"] == "video"]
            assert len(videos) == 1 and int(videos[0]["nb_read_frames"]) > 1
            duration = float(probe["format"]["duration"])
            assert abs(duration - capture["seconds"]) <= 0.25
            durations[file.suffix] = duration
            assert sha256(file.read_bytes()).hexdigest() == before
            files.append({**item, "seconds": duration, "width": videos[0]["width"], "height": videos[0]["height"], "decoded_frames": int(videos[0]["nb_read_frames"]), "fully_decoded": True})
        assert set(durations) == {".gif", ".mp4"} and abs(durations[".gif"] - durations[".mp4"]) <= 0.25
        rows.append({"component": capture["component"], "name": capture["name"], "observed_frames": capture["observed_frames"], "capture_errors": 0, "recorded_seconds": capture["seconds"], "files": files})
    assert len(rows) == 4
    output.write_text(json.dumps({"at": datetime.now(timezone.utc).isoformat(), "status": "passed", "sources": sources,
        "raw_media_modified": False, "recordings": rows, "verifier_sha256": sha256(Path(__file__).read_bytes()).hexdigest()}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": "passed", "original_recordings": 4, "fully_decoded_files": 8, "raw_media_modified": False}))


if __name__ == "__main__":
    main()
