"""Retain all original history-reader attempts and bind the qualified bytes.

Record once. --verify is read-only. Failed runs remain failed; qualification is
bounded to the specified backend files and actual administrator browser journey.
"""
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
RAW = DELIVERY / "evidence/content-history-132"
OUT = ROOT / "docs/quality/content-history-evidence-132"
CP = ROOT / "docs/quality/content-history-checkpoint-132.json"
PREVIOUS = DELIVERY / ".data/receipt-sync-131/publication-37731296-0411-4ac6-9f08-145dbf385e68/receipt.json"
COUNTS = {"related_backend_tests": 54, "new_history_tests": 15,
          "actual_administrator_journey_checks": 9, "current_compiler_checks": 2,
          "current_build_checks": 3, "screenshots": 5, "recording_pairs": 2}


def digest(body):
    return sha256(body).hexdigest()


def load(file):
    return json.loads(file.read_bytes())


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def ref(file):
    return {"path": file.relative_to(ROOT).as_posix(), "sha256": digest(file.read_bytes())}


def check_attempt(stem):
    report = load(RAW / (stem + ".json"))
    for key in ["source_manifest", "raw_report", "verifier"]:
        item = report[key]
        assert digest((DELIVERY / item["path"]).read_bytes()) == item["sha256"]
    assert report["source_unchanged"] and report["owned_database_shutdown"] and report["owned_database_port_closed"]
    cleanup = load(RAW / (stem + "-fixture-cleanup.json"))
    assert cleanup["status"] == "passed" and all(r["reclaimed"] for r in cleanup["results"])
    assert report["fixture_cleanup"]["sha256"] == digest((RAW / (stem + "-fixture-cleanup.json")).read_bytes())
    if report["journey"]:
        item = report["journey"]
        assert digest((DELIVERY / item["path"]).read_bytes()) == item["sha256"]
    sources = load(DELIVERY / report["source_manifest"]["path"])
    for name, item in sources.items():
        assert digest((DELIVERY / item["path"]).read_bytes()) == item["sha256"], name
    return report, sources


def verify():
    index, cp = load(OUT / "index.json"), load(CP)
    assert index["recorder_sha256"] == digest(Path(__file__).read_bytes())
    assert index["status"] == "passed_bounded_admin_history" and cp["evidence_index"] == ref(OUT / "index.json")
    assert cp["counts"] == COUNTS and cp["required_open"] == 89 and cp["fully_accepted"] == 0
    needles, checked = credentials(), set()
    for row in index["originals"]:
        body = (OUT / row["archive"]).read_bytes()
        assert len(body) == row["bytes"] and digest(body) == row["sha256"]
        if row["sha256"] not in checked:
            scan(row["source"], body, needles)
            checked.add(row["sha256"])
    for name, identity in cp["source_files"].items():
        assert digest((ROOT / name).read_bytes()) == identity, name
    for item in [*cp["media_files"], *cp["failed_attempt_media"]]:
        assert digest((DEV / item["path"]).read_bytes()) == item["sha256"]
    assert cp["contract_supplement"] == ref(DEV / "copypaste-platform/contracts/admin-content-history-route-additions.json")
    assert cp["previous_checkpoint"] == ref(ROOT / "docs/quality/receipt-sync-checkpoint-131.json")
    return {"status": "passed", "original_entries": len(index["originals"]), "unique_original_blobs": len(checked),
            "qualified_sources": len(cp["source_files"]), "actual_media_files": len(cp["media_files"]),
            "failed_attempt_media_retained": len(cp["failed_attempt_media"])}


def record():
    assert not CP.exists() and not OUT.exists(), "Never overwrite an executed qualification archive"
    attempts = {name: check_attempt(name) for name in ["backend-01", "backend-02", "backend-03", "ui-01", "ui-02"]}
    assert [r[0]["status"] for r in attempts.values()] == ["failed", "failed", "passed", "failed", "passed"]
    for name, count in [("backend-01", (52, 51, 1)), ("backend-02", (54, 53, 1)), ("backend-03", (54, 54, 0))]:
        tap = (RAW / (name + ".tap")).read_text(encoding="utf-8")
        assert tuple(int(re.search(r"(?m)^# " + key + r" (\d+)\s*$", tap)[1]) for key in ["tests", "pass", "fail"]) == count
    failed, journey = [load(RAW / ("ui-" + n + "-journey.json")) for n in ["01", "02"]]
    assert failed["status"] == "failed" and len(failed["checks"]) == 7 and "strict mode violation" in failed["errors"][0]
    assert journey["status"] == "passed" and len(journey["checks"]) == 9 and not journey["errors"]
    assert journey["model_calls"] == 0 and all(journey[k] for k in ["browser_closed", "api_closed", "fixture_closed"])
    assert len(journey["screenshots"]) == 5 and len(journey["recordings"]) == 2 and len(journey["layouts"]) == 3
    assert all(row["document_width"] <= row["width"] + 1 for row in journey["layouts"])
    assert all(c["exit_code"] == 0 for c in attempts["ui-02"][0]["checks"])
    sources = {}
    for name in ["backend-03", "ui-02"]:
        for file, item in attempts[name][1].items():
            target = "dev/" + file
            assert target not in sources or sources[target] == item["sha256"]
            sources[target] = item["sha256"]
    for name, identity in sources.items():
        assert digest((ROOT / name).read_bytes()) == identity, name
    previous = load(PREVIOUS)
    assert previous["status"] == "pushed_and_verified"
    assert previous["raw_log_sha256"] == digest(PREVIOUS.with_name("commands.log").read_bytes())
    media, failed_media, decode, paths = [], [], [], sorted(p for p in RAW.rglob("*") if p.is_file())
    for original, dest in [(failed, failed_media), (journey, media)]:
        dest.extend(original["screenshots"])
        for recording in original["recordings"]:
            assert recording["observed_frames"] >= 5 and recording["distinct_frames"] >= 2 and recording["skipped_capture_errors"] == 0
            directory = DEV / recording["raw_capture_directory"]
            assert directory.resolve().is_relative_to(DELIVERY / ".data/workmate-media")
            paths.extend(p for p in directory.rglob("*") if p.is_file())
            dest.extend(recording["files"])
        for item in dest:
            file = DEV / item["path"]
            assert digest(file.read_bytes()) == item["sha256"]
            paths.append(file)
            if file.suffix in [".png", ".mp4", ".gif"]:
                result = subprocess.run(["ffmpeg", "-hide_banner", "-v", "error", "-i", str(file), "-f", "null", "-"],
                                        stdout=subprocess.PIPE, stderr=subprocess.PIPE)
                assert result.returncode == 0 and not result.stderr, "Media decode failed: " + file.name
                decode.append({"path": item["path"], "sha256": item["sha256"], "exit_code": result.returncode,
                               "scope": "Complete image or video decoding, no frame edits"})
    paths.extend([PREVIOUS, PREVIOUS.with_name("commands.log")])
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
        with (OUT / "blobs" / (identity + ".blob")).open("xb") as file:
            file.write(body)
    index = {"at": datetime.now(timezone.utc).isoformat(), "status": "passed_bounded_admin_history",
             "recorder_sha256": digest(Path(__file__).read_bytes()), "originals": originals,
             "failed_attempts": ["backend-01", "backend-02", "ui-01"],
             "qualified_attempts": ["backend-03", "ui-02"], "media_decode": decode,
             "scope": "Original native SQL/backend and actual browser history-reading evidence, exact source snapshots and real-time captures. Synthetic business data; no model execution or whole-platform rerun."}
    with (OUT / "index.json").open("xb") as file:
        file.write(encoded(index))
    checkpoint = {"at": index["at"], "status": "verified_bounded_admin_content_history", "counts": COUNTS,
                  "scope": index["scope"], "evidence_index": ref(OUT / "index.json"),
                  "previous_checkpoint": ref(ROOT / "docs/quality/receipt-sync-checkpoint-131.json"),
                  "previous_publication_receipt": {"sha256": digest(PREVIOUS.read_bytes()), "archive": next(r["archive"] for r in originals if r["source"] == PREVIOUS.relative_to(ROOT).as_posix())},
                  "source_files": sources, "media_files": media, "failed_attempt_media": failed_media,
                  "contract_supplement": ref(DEV / "copypaste-platform/contracts/admin-content-history-route-additions.json"),
                  "required_open": 89, "unconfirmed_suggestions": 12, "optional_open": 1, "fully_accepted": 0,
                  "original_full_acceptance_open": 102, "whole_platform_runtime_rerun": False,
                  "original_failure_records_retained": True, "customer_message_limit_unchanged": 80,
                  "customer_message_fixture": 66, "customer_version_fixture_per_kind": 205,
                  "model_calls": 0, "recorder": ref(Path(__file__))}
    with CP.open("xb") as file:
        file.write(encoded(checkpoint))
    print(json.dumps(verify()))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--record", action="store_true")
    group.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    if args.record:
        record()
    else:
        print(json.dumps(verify()))
