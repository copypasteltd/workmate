"""Bind fixed-version delivery downloads to exact sources and retained original attempts."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
import argparse
import json
import re
from record_source_build_reproduction_v1 import credentials, scan

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"
RAW = DELIVERY / "evidence/delivery-package-137"
OUT = ROOT / "docs/quality/delivery-package-evidence-137"
CP = ROOT / "docs/quality/delivery-package-checkpoint-137.json"
PREVIOUS = DELIVERY / ".data/business-inputs-136/publication-764ae153-9734-4370-a046-17699de3d95a/receipt.json"

def sha(body): return sha256(body).hexdigest()
def read(file): return json.loads(file.read_bytes())
def ref(file): return {"path": file.relative_to(ROOT).as_posix(), "sha256": sha(file.read_bytes())}
def encoded(value): return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()

def report(stem):
    row = read(RAW / (stem + ".json"))
    for key in ["source_manifest", "raw_log", "verifier"]:
        item = row[key]
        assert sha((DELIVERY / item["path"]).read_bytes()) == item["sha256"]
    sources = read(DELIVERY / row["source_manifest"]["path"])
    def check(item):
        name, entry = item
        assert sha((DELIVERY / entry["path"]).read_bytes()) == entry["sha256"], name
    with ThreadPoolExecutor(max_workers=16) as pool: list(pool.map(check, sources.items()))
    return row, sources

def verify():
    cp, index = read(CP), read(OUT / "index.json")
    assert cp["status"] == "verified_fixed_version_delivery_packages"
    assert cp["evidence_index"] == ref(OUT / "index.json")
    assert index["recorder_sha256"] == sha(Path(__file__).read_bytes())
    needles = credentials()
    for item in index["originals"]:
        body = (OUT / item["archive"]).read_bytes()
        assert len(body) == item["bytes"] and sha(body) == item["sha256"]
        scan(item["source"], body, needles)
    def source(item):
        name, digest = item
        assert sha((ROOT / name).read_bytes()) == digest, name
    with ThreadPoolExecutor(max_workers=16) as pool:
        list(pool.map(source, [*cp["source_files"].items(), *cp["qualification_sources"].items()]))
    for item in cp["media_files"]: assert sha((DEV / item["path"]).read_bytes()) == item["sha256"]
    for stem in cp["selected_attempts"].values():
        row, _ = report(stem)
        assert row["status"] == "passed" and row["sources_unchanged"] and row["database_shutdown"] == 0
    assert cp["counts"]["actual_client_journey_checks"] == 10 and cp["counts"]["screenshots"] == 9
    assert cp["counts"]["recording_pairs"] == 3 and cp["counts"]["downloaded_archives"] == 3
    assert cp["new_full_acceptance_closures"] == 0
    return {"status": "verified", "checkpoint_sha256": sha(CP.read_bytes()), "source_files": len(cp["source_files"]),
            "originals": len(index["originals"]), "media_files": len(cp["media_files"]), "selected_attempts": cp["selected_attempts"]}

def record(backend, ui):
    assert not CP.exists() and not OUT.exists()
    selected = {"backend": "backend-" + backend, "ui": "ui-" + ui}
    b, bs = report(selected["backend"])
    u, us = report(selected["ui"])
    assert b["status"] == u["status"] == "passed" and b["sources_unchanged"] and u["sources_unchanged"]
    assert b["database_shutdown"] == u["database_shutdown"] == 0 and b["port_closed"] and all(u["ports_closed"].values())
    assert u["package_unchanged"] and u["fixture_cleanup"]["status"] == "passed"
    assert {k: v["sha256"] for k, v in bs.items()} == {k: v["sha256"] for k, v in us.items()}
    assert len(u["commands"]) == 11 and all(c["exit_code"] == 0 for c in u["commands"])
    journey = read(DELIVERY / u["journey"]["path"])
    assert sha((DELIVERY / u["journey"]["path"]).read_bytes()) == u["journey"]["sha256"]
    assert journey["status"] == "passed" and len(journey["checks"]) == 10 and len(journey["screenshots"]) == 9
    assert len(journey["recordings"]) == 3 and len(journey["layouts"]) == 7 and len(journey["archives"]) == 3
    assert all(journey[k] for k in ["browser_closed", "extension_closed", "desktop_closed", "api_closed", "fixture_closed"])
    assert all(r["distinct_frames"] > 1 and r["skipped_capture_errors"] == 0 for r in journey["recordings"])
    for item in journey["archives"]: assert sha((DELIVERY / item["path"]).read_bytes()) == item["sha256"]
    media = [*journey["screenshots"], *[f for r in journey["recordings"] for f in r["files"]]]
    before = read(PREVIOUS)
    assert before["status"] == "pushed_and_verified" and before["remote_after"]["docs"] == "def18d56886b020ab3dff6764394181070768adc"
    OUT.mkdir(parents=True)
    originals, attempts, needles = [], [], credentials()
    def retain(file):
        body = file.read_bytes()
        digest = sha(body)
        name = "blobs/" + digest + ".blob"
        target = OUT / name
        target.parent.mkdir(parents=True, exist_ok=True)
        scan(file.relative_to(ROOT).as_posix(), body, needles)
        if not target.exists():
            with target.open("xb") as stream: stream.write(body)
        else: assert target.read_bytes() == body
        originals.append({"source": file.relative_to(ROOT).as_posix(), "archive": name, "sha256": digest, "bytes": len(body)})
    for file in sorted(RAW.rglob("*")):
        if not file.is_file() or "objects" in file.relative_to(RAW).parts: continue
        retain(file)
        if re.fullmatch(r"(backend|ui)-\d{2}\.json", file.name): attempts.append({"source": file.relative_to(ROOT).as_posix(), "status": read(file)["status"]})
    # Preserve captures from every attempt, including failed qualification.
    for file in sorted(RAW.glob("ui-??-journey.json")):
        j = read(file)
        for item in [*j["screenshots"], *[f for r in j["recordings"] for f in r["files"]]]: retain(DEV / item["path"])
    for file in [PREVIOUS, PREVIOUS.with_name("commands.log"), ROOT / before["incremental_history_and_links"]["path"]]: retain(file)
    extra = {}
    for row in [b, u]:
        body = (DELIVERY / row["verifier"]["path"]).read_bytes()
        matched = [f for f in (DELIVERY / "scripts").glob("qualify-delivery-package*.mjs") if f.read_bytes() == body]
        assert len(matched) == 1
        extra[matched[0].relative_to(ROOT).as_posix()] = sha(body)
    body = (RAW / (selected["ui"] + "-journey-verifier.ts")).read_bytes()
    matched = [f for f in (DELIVERY / "scripts").glob("qa-delivery-package-137-v*.ts") if f.read_bytes() == body]
    assert len(matched) == 1
    extra[matched[0].relative_to(ROOT).as_posix()] = sha(body)
    for name in ["scripts/record-workmate-media.ts", "package.json", "package-lock.json", "tsconfig.json"]:
        file = DELIVERY / name
        extra[file.relative_to(ROOT).as_posix()] = sha(file.read_bytes())
    counts = [int(n) for n in re.findall(r"^# tests (\d+)\r?$", (DELIVERY / b["raw_log"]["path"]).read_text(encoding="utf-8"), re.M)]
    assert len(counts) == 3
    index = {"at": datetime.now(timezone.utc).isoformat(), "recorder_sha256": sha(Path(__file__).read_bytes()), "originals": originals,
             "attempts": attempts, "selected_attempts": selected, "source_archive_repository": "delivery",
             "source_archive_description": "Every original source manifest and content-addressed blob remains in delivery's immutable evidence. Failed attempts keep their own scope and conclusion.",
             "scope": "Fixed-version output packaging, authorization, real file integrity and three actual client downloads; synthetic business content."}
    (OUT / "index.json").write_bytes(encoded(index))
    cp = {"at": datetime.now(timezone.utc).isoformat(), "status": "verified_fixed_version_delivery_packages",
          "counts": {"backend_integration_tests": counts[0], "new_package_tests": 11, "extension_state_tests": counts[1], "desktop_download_tests": counts[2],
                     "native_binding_tests": 12, "actual_client_journey_checks": 10, "screenshots": 9, "recording_pairs": 3, "actual_layouts": 7, "downloaded_archives": 3,
                     "backend_commands": len(b["commands"]), "client_build_commands": len(u["commands"])},
          "selected_attempts": selected, "evidence_index": ref(OUT / "index.json"), "source_files": {"dev/" + name: row["sha256"] for name, row in bs.items()},
          "qualification_sources": extra, "media_files": media, "downloaded_archives": journey["archives"],
          "previous_checkpoint": ref(ROOT / "docs/quality/business-inputs-checkpoint-136.json"),
          "previous_publication_receipt": next({"archive": r["archive"], "sha256": r["sha256"]} for r in originals if r["source"] == PREVIOUS.relative_to(ROOT).as_posix()),
          "scope": journey["model_mode"], "new_full_acceptance_closures": 0, "whole_platform_runtime_rerun": False,
          "accepted_requirements_unchanged": ["REQ-095"], "required_open": 88, "unconfirmed_suggestions": 12, "optional_open": 1}
    CP.write_bytes(encoded(cp))
    print(json.dumps(verify()))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--record", action="store_true")
    group.add_argument("--verify", action="store_true")
    parser.add_argument("--backend", default="03")
    parser.add_argument("--ui", default="02")
    args = parser.parse_args()
    if args.record: record(args.backend, args.ui)
    else: print(json.dumps(verify()))
