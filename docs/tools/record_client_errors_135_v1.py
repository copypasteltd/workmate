"""Retain original four-client attempts and bind the qualified current sources."""
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
RAW = DELIVERY / "evidence/client-errors-135"
OUT = ROOT / "docs/quality/client-errors-evidence-135"
CP = ROOT / "docs/quality/client-errors-checkpoint-135.json"
PREVIOUS = DELIVERY / ".data/support-recovery-134/publication-84a85c96-aaae-468c-98f8-a25d6b25ac08/receipt.json"
COUNTS = {"transport_and_audience_tests": 15, "native_binding_tests": 12, "native_bridge_tests": 1,
          "actual_four_client_journey_checks": 30, "current_build_commands": 4, "reused_identical_product_build_commands": 10,
          "screenshots": 20, "recording_pairs": 7, "actual_layouts": 11}


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
    assert row["source_unchanged"] and row["owned_database_shutdown"] and all(row["ports_closed"].values())
    cleanup = load(RAW / (stem + "-fixture-cleanup.json"))
    assert cleanup["status"] == "passed" and all(r["reclaimed"] for r in cleanup["results"])
    assert digest((RAW / (stem + "-fixture-cleanup.json")).read_bytes()) == row["fixture_cleanup"]["sha256"]
    return row, sources


def verify():
    cp, index = load(CP), load(OUT / "index.json")
    assert cp["status"] == "verified_four_client_transport_and_session_recovery" and cp["counts"] == COUNTS
    assert cp["evidence_index"] == ref(OUT / "index.json")
    assert index["recorder_sha256"] == digest(Path(__file__).read_bytes())
    needles, seen = credentials(), set()
    for row in index["originals"]:
        body = (OUT / row["archive"]).read_bytes()
        assert len(body) == row["bytes"] and digest(body) == row["sha256"]
        if row["sha256"] not in seen:
            scan(row["source"], body, needles)
            seen.add(row["sha256"])
    for name, identity in cp["source_files"].items():
        assert digest((ROOT / name).read_bytes()) == identity, name
    for item in [*cp["media_files"], *cp["failed_attempt_media"], *cp["intermediate_attempt_media"]]:
        assert digest((DEV / item["path"]).read_bytes()) == item["sha256"]
    assert cp["previous_checkpoint"] == ref(ROOT / "docs/quality/support-recovery-checkpoint-134.json")
    assert cp["previous_acceptance"] == ref(ROOT / "docs/quality/tc095-acceptance-134.json")
    original = next(row for row in index["originals"] if row["source"] == "dev/copypaste-delivery/evidence/client-errors-135/" + cp["qualified_attempts"][0] + "-journey.json")
    assert cp["extension_transport_observations"] == load(OUT / original["archive"])["extension_transport_observations"]
    assert cp["extension_notice_views"] == load(OUT / original["archive"])["extension_notice_views"]
    assert cp["required_open"] == 88 and cp["fully_accepted"] == 1 and cp["original_full_acceptance_open"] == 101
    return {"status": "passed", "original_entries": len(index["originals"]), "unique_original_blobs": len(seen),
            "qualified_sources": len(cp["source_files"]), "actual_media_files": len(cp["media_files"]),
            "failed_attempt_media_retained": len(cp["failed_attempt_media"]), "intermediate_attempt_media_retained": len(cp["intermediate_attempt_media"]), "new_full_acceptance_closures": 0}


def record(ui):
    assert not CP.exists() and not OUT.exists(), "Never rewrite original evidence"
    stems = sorted(p.stem for p in RAW.glob("*.json") if re.fullmatch(r"ui-\d{2}", p.stem))
    attempts = {name: check_attempt(name) for name in stems}
    selected = "ui-" + ui
    report, sources_ui = attempts[selected]
    journey = load(RAW / (selected + "-journey.json"))
    assert report["status"] == "passed" and report["source_unchanged"] and report["package_unchanged"]
    assert len(report["commands"]) == 4 and all(r["exit_code"] == 0 for r in report["commands"])
    reused = report["reused_build"]
    assert reused["path"] == "evidence/client-errors-135/ui-02.json"
    assert digest((DELIVERY / reused["path"]).read_bytes()) == reused["sha256"]
    full = load(DELIVERY / reused["path"])
    assert full["source_unchanged"] and full["package_unchanged"] and len(full["commands"]) == 17
    assert reused["commands"] == full["commands"] and all(r["exit_code"] == 0 for r in full["commands"])
    assert full["package_files"] == report["package_files"]
    old_sources = load(DELIVERY / full["source_manifest"]["path"])
    for name, item in sources_ui.items():
        if not name.startswith("copypaste-delivery/") and name not in ["copypaste-extension/src/panel.ts", "copypaste-extension/public/panel.css"]:
            assert item["sha256"] == old_sources[name]["sha256"], name
    tap = (DELIVERY / full["raw_report"]["path"]).read_text(encoding="utf-8")
    assert re.findall(r"^# tests (\d+)$", tap, re.M) == ["12", "15", "1"]
    assert re.findall(r"^# pass (\d+)$", tap, re.M) == ["12", "15", "1"]
    for field in ["fail", "cancelled", "skipped", "todo"]:
        assert re.findall(r"^# " + field + r" (\d+)$", tap, re.M) == ["0", "0", "0"]
    assert journey["status"] == "passed" and len(journey["checks"]) == 30 and not journey["errors"]
    assert journey["model_calls"] == 0 and all(journey[k] for k in ["browser_closed", "desktop_closed", "extension_closed", "api_closed", "fixture_closed"])
    observations = journey["extension_transport_observations"]
    assert observations["original_write_wire_requests"] >= 1
    assert observations["lost_write_replies"] == observations["original_write_wire_requests"]
    assert observations["total_write_wire_requests"] == observations["original_write_wire_requests"] + 1
    assert observations["terminal_write_failures"] >= 1 and observations["terminal_notification_failures"] >= 2
    assert observations["created_tasks"] == 1
    notice_views = journey["extension_notice_views"]
    assert len(notice_views) == 3 and all(not v["hidden"] and v["uncovered"] and not v["horizontal_overflow"] and v["height"] > 20 and v["top"] >= 0 and v["bottom"] <= v["viewport_height"] for v in notice_views)
    assert len(journey["screenshots"]) == 20 and len(journey["recordings"]) == 7 and len(journey["layouts"]) == 11
    sources = {"dev/" + name: item["sha256"] for name, item in sources_ui.items()}
    for name, identity in sources.items():
        assert digest((ROOT / name).read_bytes()) == identity, name
    previous = load(PREVIOUS)
    assert previous["status"] == "pushed_and_verified" and previous["raw_log_sha256"] == digest(PREVIOUS.with_name("commands.log").read_bytes())
    audit = ROOT / previous["incremental_history_and_links"]["path"]
    assert digest(audit.read_bytes()) == previous["incremental_history_and_links"]["sha256"]
    paths = sorted(p for p in RAW.rglob("*") if p.is_file()) + [PREVIOUS, PREVIOUS.with_name("commands.log"), audit]
    media, failed_media, intermediate_media, decode = [], [], [], []
    for stem in stems:
        file = RAW / (stem + "-journey.json")
        if not file.exists():
            continue
        original = load(file)
        destination = media if stem == selected else failed_media if attempts[stem][0]["status"] == "failed" else intermediate_media
        current = list(original["screenshots"])
        for recording in original["recordings"]:
            assert recording["observed_frames"] >= 5 and recording["distinct_frames"] >= 2
            if stem == selected:
                assert recording["skipped_capture_errors"] == 0
            # Failed captures retain their original skipped-frame count; they are never treated as accepted media.
            folder = DEV / recording["raw_capture_directory"]
            assert folder.resolve().is_relative_to(DELIVERY / ".data/workmate-media")
            paths.extend(p for p in folder.rglob("*") if p.is_file())
            current.extend(recording["files"])
        for item in current:
            actual = DEV / item["path"]
            assert digest(actual.read_bytes()) == item["sha256"]
            paths.append(actual)
            result = subprocess.run(["ffmpeg", "-hide_banner", "-v", "error", "-i", str(actual), "-f", "null", "-"], stdout=subprocess.PIPE, stderr=subprocess.PIPE)
            assert result.returncode == 0 and not result.stderr, actual.name
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
        (OUT / "blobs" / (identity + ".blob")).write_bytes(body)
    scope = "Actual four-client transport and HTML-401 recovery, current support regression; unsigned Windows package and real right Chrome SIDE_PANEL. Synthetic business data; no model or whole-platform production acceptance."
    index = {"at": datetime.now(timezone.utc).isoformat(), "status": "passed_four_client_recovery", "recorder_sha256": digest(Path(__file__).read_bytes()), "originals": originals,
             "failed_attempts": [name for name in stems if attempts[name][0]["status"] == "failed"], "qualified_attempts": [selected], "intermediate_passed_attempts": [name for name in stems if name != selected and attempts[name][0]["status"] == "passed"], "media_decode": decode, "scope": scope}
    (OUT / "index.json").write_bytes(encoded(index))
    cp = {"at": index["at"], "status": "verified_four_client_transport_and_session_recovery", "counts": COUNTS, "scope": scope,
          "evidence_index": ref(OUT / "index.json"), "previous_checkpoint": ref(ROOT / "docs/quality/support-recovery-checkpoint-134.json"),
          "previous_acceptance": ref(ROOT / "docs/quality/tc095-acceptance-134.json"),
          "previous_publication_receipt": {"sha256": digest(PREVIOUS.read_bytes()), "archive": next(r["archive"] for r in originals if r["source"] == PREVIOUS.relative_to(ROOT).as_posix())},
          "source_files": sources, "extension_transport_observations": observations, "extension_notice_views": notice_views, "media_files": media, "failed_attempt_media": failed_media, "intermediate_attempt_media": intermediate_media, "qualified_attempts": [selected],
          "required_open": 88, "unconfirmed_suggestions": 12, "optional_open": 1, "fully_accepted": 1, "original_full_acceptance_open": 101,
          "whole_platform_runtime_rerun": False, "new_full_acceptance_closures": 0, "original_failure_records_retained": True, "model_calls": 0,
          "historical_backend_reference": report["backend"], "identical_product_build_reused": report["reused_build"], "unsigned_native_package": True, "recorder": ref(Path(__file__))}
    CP.write_bytes(encoded(cp))
    print(json.dumps(verify()))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--record", action="store_true")
    group.add_argument("--verify", action="store_true")
    parser.add_argument("--ui-attempt")
    args = parser.parse_args()
    if args.record:
        assert re.fullmatch(r"\d{2}", args.ui_attempt or "")
        record(args.ui_attempt)
    else:
        print(json.dumps(verify()))
