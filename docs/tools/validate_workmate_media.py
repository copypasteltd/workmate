"""Decode the actual recorded MP4/GIF files and create local review contact sheets."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import subprocess
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--media", required=True)
    parser.add_argument("--report", required=True)
    args = parser.parse_args()
    assert args.media.isdigit() and len(args.media) == 2
    assert args.report.startswith("workmate-media-validation-") and args.report.endswith(".json") and "/" not in args.report and "\\" not in args.report
    report = ROOT / "docs/quality" / args.report
    assert not report.exists()
    source = ROOT / "dev/copypaste-delivery/evidence" / ("workmate-media-" + args.media + ".json")
    media = json.loads(source.read_text(encoding="utf-8"))
    assert media["status"] == "passed" and len(media["recordings"]) == 4
    review = ROOT / "dev/copypaste-delivery/.data/workmate-review" / str(uuid4())
    review.mkdir(parents=True)
    results = []
    for recording in media["recordings"]:
        assert recording["observed_frames"] >= 5 and recording["distinct_frames"] >= 2
        assert recording["skipped_capture_errors"] == 0
        for item in recording["files"]:
            file = ROOT / "dev" / item["path"]
            assert sha256(file.read_bytes()).hexdigest() == item["sha256"]
            assert file.stat().st_size < 100 * 1024 * 1024
            probe = json.loads(subprocess.check_output([
                "ffprobe", "-v", "error", "-count_frames", "-show_streams", "-show_format", "-of", "json", str(file),
            ]))
            stream = next(s for s in probe["streams"] if s["codec_type"] == "video")
            assert int(stream["nb_read_frames"]) >= 2
            assert stream["width"] > 250 and stream["height"] > 250
            assert float(probe["format"]["duration"]) > 0.5
            assert stream["codec_name"] == ("h264" if file.suffix == ".mp4" else "gif")
            decoded = subprocess.run([
                "ffmpeg", "-hide_banner", "-v", "error", "-i", str(file), "-f", "null", "-",
            ], capture_output=True, check=True)
            assert not decoded.stderr
            if file.suffix == ".mp4":
                # Both spellings are 8-bit planar 4:2:0. JPEG viewport inputs
                # retain full-range signaling as yuvj420p in ffprobe.
                assert stream["pix_fmt"] in {"yuv420p", "yuvj420p"}
                contact = review / (recording["component"] + "-contact.png")
                subprocess.run([
                    "ffmpeg", "-hide_banner", "-v", "error", "-n", "-i", str(file),
                    "-vf", "fps=1/2,scale=480:-2,tile=3x1", "-frames:v", "1", str(contact),
                ], capture_output=True, check=True)
            results.append({
                "path": file.relative_to(ROOT).as_posix(), "sha256": item["sha256"],
                "bytes": file.stat().st_size, "codec": stream["codec_name"],
                "frames_decoded": int(stream["nb_read_frames"]),
                "width": stream["width"], "height": stream["height"],
                "seconds": float(probe["format"]["duration"]), "decode_errors": 0,
                "pixel_format": stream["pix_fmt"], "color_range": stream.get("color_range"),
            })
    output = {
        "at": datetime.now(timezone.utc).isoformat(), "status": "passed",
        "scope": "Actual four-client MP4/GIF complete decode, frame count, dimensions, duration and retained hashes. Contact sheets only sample actual recordings for visual review; they are not product screenshots.",
        "verifier_sha256": sha256(Path(__file__).read_bytes()).hexdigest(),
        "source_report_sha256": sha256(source.read_bytes()).hexdigest(),
        "files": results, "review_directory": review.relative_to(ROOT).as_posix(),
    }
    report.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": "passed", "files": len(results), "review_directory": output["review_directory"]}))


if __name__ == "__main__":
    main()
