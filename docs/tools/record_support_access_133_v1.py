"""Archive original support attempts and bind actual qualified sources. Record once."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import json
import re
import subprocess
from record_source_build_reproduction_v1 import credentials, scan

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"
RAW = DELIVERY / "evidence/support-access-133"
OUT = ROOT / "docs/quality/support-access-evidence-133"
CP = ROOT / "docs/quality/support-access-checkpoint-133.json"
PREVIOUS = DELIVERY / ".data/content-history-132/publication-7d04f918-3b71-4719-a1cf-c1dd9c826063/receipt.json"
COUNTS = {"related_backend_tests": 59, "new_support_source_tests": 11,
          "actual_admin_web_native_journey_checks": 13, "current_build_commands": 10,
          "screenshots": 6, "recording_pairs": 3, "actual_layouts": 7}

def digest(body):
    return sha256(body).hexdigest()

def load(file):
    return json.loads(file.read_bytes())

def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()

def ref(file):
    return {"path": file.relative_to(ROOT).as_posix(), "sha256": digest(file.read_bytes())}

def check_attempt(stem):
    row = load(RAW / (stem + ".json"))
    for key in ["source_manifest", "raw_report", "verifier"]:
        item = row[key]
        assert digest((DELIVERY / item["path"]).read_bytes()) == item["sha256"]
    sources = load(DELIVERY / row["source_manifest"]["path"])
    for name, item in sources.items():
        assert digest((DELIVERY / item["path"]).read_bytes()) == item["sha256"], name
    if row.get("journey"):
        item = row["journey"]
        assert digest((DELIVERY / item["path"]).read_bytes()) == item["sha256"]
    assert row["source_unchanged"] and row["owned_database_shutdown"]
    assert row.get("owned_database_port_closed", all(row.get("ports_closed", {}).values()))
    cleanup = load(RAW / (stem + "-fixture-cleanup.json"))
    assert cleanup["status"] == "passed" and all(r["reclaimed"] for r in cleanup["results"])
    assert digest((RAW / (stem + "-fixture-cleanup.json")).read_bytes()) == row["fixture_cleanup"]["sha256"]
    return row, sources

def verify():
    cp, index = load(CP), load(OUT / "index.json")
    assert cp["status"] == "verified_bounded_controlled_support" and cp["counts"] == COUNTS
    assert cp["evidence_index"] == ref(OUT / "index.json")
    assert index["recorder_sha256"] == digest(Path(__file__).read_bytes())
    assert cp["required_open"] == 89 and cp["fully_accepted"] == 0
    needles, seen = credentials(), set()
    for row in index["originals"]:
        body = (OUT / row["archive"]).read_bytes()
        assert len(body) == row["bytes"] and digest(body) == row["sha256"]
        if row["sha256"] not in seen:
            scan(row["source"], body, needles)
            seen.add(row["sha256"])
    for name, identity in cp["source_files"].items():
        assert digest((ROOT / name).read_bytes()) == identity, name
    for item in [*cp["media_files"], *cp["failed_attempt_media"]]:
        assert digest((DEV / item["path"]).read_bytes()) == item["sha256"]
    assert cp["previous_checkpoint"] == ref(ROOT / "docs/quality/content-history-checkpoint-132.json")
    return {"status": "passed", "original_entries": len(index["originals"]), "unique_original_blobs": len(seen),
            "qualified_sources": len(cp["source_files"]), "actual_media_files": len(cp["media_files"]),
            "failed_attempt_media_retained": len(cp["failed_attempt_media"])}

def record(ui):
    assert not CP.exists() and not OUT.exists(), "Never overwrite an executed qualification archive"
    stems = sorted(p.stem for p in RAW.glob("*.json") if re.fullmatch(r"(?:baseline|backend|ui)-\d{2}", p.stem))
    attempts = {name: check_attempt(name) for name in stems}
    assert attempts["baseline-01"][0]["status"] == "failed"
    assert attempts["baseline-02"][0]["status"] == "failed"
    baseline = (RAW / "baseline-02.tap").read_text(encoding="utf-8")
    assert "A retained task result must not bypass its withdrawn original file" in baseline and "actual: 200" in baseline
    assert attempts["backend-03"][0]["status"] == "passed"
    assert attempts["backend-03"][0]["counts"] == {"tests": 59, "pass": 59, "fail": 0, "cancelled": 0, "skipped": 0, "todo": 0}
    qualified_ui = "ui-" + ui
    report = attempts[qualified_ui][0]
    journey = load(RAW / (qualified_ui + "-journey.json"))
    assert report["status"] == "passed" and report["package_unchanged"] and report["source_unchanged"]
    assert journey["status"] == "passed" and len(journey["checks"]) == 13 and not journey["errors"]
    assert journey["model_calls"] == 0 and all(journey[k] for k in ["browser_closed", "desktop_closed", "api_closed", "fixture_closed"])
    assert len(journey["screenshots"]) == 6 and len(journey["recordings"]) == 3 and len(journey["layouts"]) == 7
    assert len(report["commands"]) == 10 and all(r["exit_code"] == 0 for r in report["commands"])
    sources = {}
    for name in ["backend-03", qualified_ui]:
        for file, item in attempts[name][1].items():
            target = "dev/" + file
            assert target not in sources or sources[target] == item["sha256"]
            sources[target] = item["sha256"]
    for name, identity in sources.items():
        assert digest((ROOT / name).read_bytes()) == identity, name
    previous = load(PREVIOUS)
    assert previous["status"] == "pushed_and_verified"
    assert previous["raw_log_sha256"] == digest(PREVIOUS.with_name("commands.log").read_bytes())
    audit = ROOT / previous["incremental_history_and_links"]["path"]
    assert digest(audit.read_bytes()) == previous["incremental_history_and_links"]["sha256"]
    paths = sorted(p for p in RAW.rglob("*") if p.is_file()) + [PREVIOUS, PREVIOUS.with_name("commands.log"), audit]
    media, failed_media, decode = [], [], []
    for stem in stems:
        file = RAW / (stem + "-journey.json")
        if not file.exists():
            continue
        original = load(file)
        destination = media if stem == qualified_ui else failed_media
        current = list(original["screenshots"])
        for recording in original["recordings"]:
            assert recording["observed_frames"] >= 5 and recording["distinct_frames"] >= 2 and recording["skipped_capture_errors"] == 0
            folder = DEV / recording["raw_capture_directory"]
            assert folder.resolve().is_relative_to(DELIVERY / ".data/workmate-media")
            paths.extend(p for p in folder.rglob("*") if p.is_file())
            current.extend(recording["files"])
        for item in current:
            actual = DEV / item["path"]
            assert digest(actual.read_bytes()) == item["sha256"]
            paths.append(actual)
            if actual.suffix in [".png", ".gif", ".mp4"]:
                result = subprocess.run(["ffmpeg", "-hide_banner", "-v", "error", "-i", str(actual), "-f", "null", "-"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                assert result.returncode == 0 and not result.stderr, "Media decode failed: " + actual.name
                decode.append({"path": item["path"], "sha256": item["sha256"], "exit_code": 0})
        destination.extend(current)
    originals, bodies, needles = [], {}, credentials()
    for file in sorted(set(paths)):
        body, name = file.read_bytes(), file.relative_to(ROOT).as_posix()
        identity = digest(body)
        if identity not in bodies:
            scan(name, body, needles)
            bodies[identity] = body
        originals.append({"source": name, "archive": "blobs/" + identity + ".blob", "sha256": identity, "bytes": len(body)})
    (OUT / "blobs").mkdir(parents=True)
    for identity, body in bodies.items():
        with (OUT / "blobs" / (identity + ".blob")).open("xb") as stream:
            stream.write(body)
    index = {"at": datetime.now(timezone.utc).isoformat(), "status": "passed_bounded_controlled_support",
             "recorder_sha256": digest(Path(__file__).read_bytes()), "originals": originals,
             "failed_attempts": [name for name in stems if attempts[name][0]["status"] == "failed"],
             "qualified_attempts": ["backend-03", qualified_ui], "media_decode": decode,
             "scope": "Actual native SQL, administrator email/TOTP, customer OTP/PKCE, Admin/Web and unsigned packaged Desktop support journey. Synthetic business data and retained bodies; no model or whole-platform runtime rerun."}
    with (OUT / "index.json").open("xb") as stream:
        stream.write(encoded(index))
    previous_name = PREVIOUS.relative_to(ROOT).as_posix()
    cp = {"at": index["at"], "status": "verified_bounded_controlled_support", "counts": COUNTS, "scope": index["scope"],
          "evidence_index": ref(OUT / "index.json"), "previous_checkpoint": ref(ROOT / "docs/quality/content-history-checkpoint-132.json"),
          "previous_publication_receipt": {"sha256": digest(PREVIOUS.read_bytes()), "archive": next(r["archive"] for r in originals if r["source"] == previous_name)},
          "source_files": sources, "media_files": media, "failed_attempt_media": failed_media,
          "qualified_attempts": ["backend-03", qualified_ui], "required_open": 89, "unconfirmed_suggestions": 12, "optional_open": 1,
          "fully_accepted": 0, "original_full_acceptance_open": 102, "whole_platform_runtime_rerun": False,
          "original_failure_records_retained": True, "model_calls": 0, "unsigned_native_package": True, "recorder": ref(Path(__file__))}
    with CP.open("xb") as stream:
        stream.write(encoded(cp))
    print(json.dumps(verify()))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--record", action="store_true")
    group.add_argument("--verify", action="store_true")
    parser.add_argument("--ui-attempt", choices=[f"{i:02}" for i in range(1, 100)])
    args = parser.parse_args()
    if args.record:
        assert args.ui_attempt
        record(args.ui_attempt)
    else:
        print(json.dumps(verify()))
