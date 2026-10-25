"""Fully decode the five current recordings without editing original media."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("attempt")
    args = parser.parse_args()
    assert re.fullmatch(r"\d{2}", args.attempt)
    output = ROOT / f"docs/quality/shared-project-media-review-{args.attempt}.json"
    assert not output.exists()
    checkpoint_file = ROOT / "docs/quality/shared-project-checkpoint.json"
    checkpoint_sha = digest(checkpoint_file)
    checkpoint = json.loads(checkpoint_file.read_text(encoding="utf-8"))
    assert checkpoint["status"] == "verified_shared_project_guidance_and_private_chat"
    assert len(checkpoint["recordings"]) == 5
    rows = []
    for capture in checkpoint["recordings"]:
        assert capture["skipped_capture_errors"] == 0 and capture["distinct_frames"] > 1
        files, durations = [], {}
        for item in capture["files"]:
            file = (DEV / item["path"]).resolve()
            assert file.is_relative_to(DEV) and digest(file) == item["sha256"]
            probe = json.loads(subprocess.check_output([
                "ffprobe", "-v", "error", "-count_frames", "-show_format", "-show_streams", "-of", "json", str(file)
            ], cwd=ROOT))
            subprocess.run(["ffmpeg", "-v", "error", "-xerror", "-err_detect", "explode", "-i", str(file), "-f", "null", "-"],
                           cwd=ROOT, capture_output=True, check=True)
            videos = [row for row in probe["streams"] if row["codec_type"] == "video"]
            assert len(videos) == 1 and int(videos[0]["nb_read_frames"]) > 1
            duration = float(probe["format"]["duration"])
            assert abs(duration - capture["seconds"]) <= 0.25
            assert digest(file) == item["sha256"]
            durations[file.suffix] = duration
            files.append({**item, "seconds": duration, "width": videos[0]["width"], "height": videos[0]["height"],
                          "decoded_frames": int(videos[0]["nb_read_frames"]), "fully_decoded": True})
        assert set(durations) == {".gif", ".mp4"} and abs(durations[".gif"] - durations[".mp4"]) <= 0.25
        rows.append({"component": capture["component"], "name": capture["name"], "observed_frames": capture["observed_frames"],
                     "capture_errors": 0, "recorded_seconds": capture["seconds"], "files": files})
    assert digest(checkpoint_file) == checkpoint_sha
    result = {"at": datetime.now(timezone.utc).isoformat(), "status": "passed",
              "checkpoint": {"path": checkpoint_file.relative_to(ROOT).as_posix(), "sha256": checkpoint_sha},
              "raw_media_modified": False, "recordings": rows, "verifier_sha256": digest(Path(__file__))}
    with output.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": "passed", "original_recordings": len(rows), "fully_decoded_files": sum(len(r["files"]) for r in rows), "raw_media_modified": False}))


if __name__ == "__main__":
    main()
