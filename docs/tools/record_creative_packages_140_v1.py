"""Retain original portable-project attempts and bind the passed client/source increment."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
from concurrent.futures import ThreadPoolExecutor
import argparse
import json
import re
from record_source_build_reproduction_v1 import credentials, scan
from record_native_team_release_139_v2 import check_sources

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"
RAW = DELIVERY / "evidence/creative-packages-140"
OUT = ROOT / "docs/quality/creative-packages-evidence-140"
CP = ROOT / "docs/quality/creative-packages-checkpoint-140.json"
PREVIOUS = DELIVERY / ".data/native-teams-139/publication-92f1c0e2-b35c-4f8b-aa27-a0e2812325df/receipt.json"

def sha(body): return sha256(body).hexdigest()
def read(file): return json.loads(file.read_bytes())
def encoded(value): return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()
def ref(file): return {"path": file.relative_to(ROOT).as_posix(), "sha256": sha(file.read_bytes())}

def report(stem):
    row = read(RAW / (stem + ".json"))
    for key in ["source_manifest", "raw_log", "verifier"]:
        entry = row[key]
        assert sha((DELIVERY / entry["path"]).read_bytes()) == entry["sha256"]
    sources = read(DELIVERY / row["source_manifest"]["path"])
    def check(item):
        name, entry = item
        assert sha((DELIVERY / entry["path"]).read_bytes()) == entry["sha256"], name
    with ThreadPoolExecutor(max_workers=16) as pool: list(pool.map(check, sources.items()))
    return row, sources

def verify():
    cp, index = read(CP), read(OUT / "index.json")
    assert cp["status"] == "verified_portable_creative_project_slice"
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
    with ThreadPoolExecutor(max_workers=16) as pool: list(pool.map(source, [*cp["source_files"].items(), *cp["qualification_sources"].items()]))
    for stem in cp["selected_attempts"].values():
        row, _ = report(stem)
        assert row["status"] == "passed" and row["sources_unchanged"] and row["database_shutdown"] == 0
    for item in cp["media_files"]: assert sha((DEV / item["path"]).read_bytes()) == item["sha256"]
    for item in cp["downloaded_archives"]: assert ref(ROOT / item["path"])["sha256"] == item["sha256"]
    proofs = check_sources(cp["source_files"], cp["qualification_sources"])
    if cp.get("git_source_proofs") is not None: assert cp["git_source_proofs"] == proofs
    assert cp["new_full_acceptance_closures"] == 0
    return {"status": "verified", "checkpoint_sha256": sha(CP.read_bytes()), "source_files": len(cp["source_files"]),
            "exact_git_paths": sum(r["exact_paths"] for r in proofs), "protected_desktop_vcs_metadata": 1,
            "originals": len(index["originals"]), "media_files": len(cp["media_files"]), "selected_attempts": cp["selected_attempts"]}

def record(backend, ui):
    assert not CP.exists() and not OUT.exists()
    selected = {"backend": "backend-" + backend, "ui": "ui-" + ui}
    b, bs = report(selected["backend"]); u, us = report(selected["ui"])
    assert b["status"] == u["status"] == "passed" and b["sources_unchanged"] and u["sources_unchanged"]
    assert b["database_shutdown"] == u["database_shutdown"] == 0 and b["port_closed"] and all(u["ports_closed"].values())
    assert u["package_unchanged"] and u["fixture_cleanup"]["status"] == "passed"
    assert {k: v["sha256"] for k,v in bs.items()} == {k: v["sha256"] for k,v in us.items()}
    journey = read(DELIVERY / u["journey"]["path"])
    assert sha((DELIVERY / u["journey"]["path"]).read_bytes()) == u["journey"]["sha256"]
    assert journey["status"] == "passed" and len(journey["checks"]) == 4 and len(journey["screenshots"]) == 5
    assert len(journey["recordings"]) == 3 and len(journey["layouts"]) == 3 and len(journey["archives"]) == 3
    assert all(journey[k] for k in ["browser_closed", "extension_closed", "desktop_closed", "api_closed", "fixture_closed"])
    assert all(r["distinct_frames"] > 1 and r["skipped_capture_errors"] == 0 for r in journey["recordings"])
    media = [*journey["screenshots"], *[f for r in journey["recordings"] for f in r["files"]]]
    previous = read(PREVIOUS); assert previous["status"] == "pushed_and_verified" and previous["remote_after"]["docs"] == "89f0bf1a3b847a85f976c7bdd631902f511d1a48"
    OUT.mkdir(parents=True); originals, attempts, needles = [], [], credentials()
    def retain(file):
        body = file.read_bytes(); digest = sha(body); name = "blobs/" + digest + ".blob"; target = OUT / name
        target.parent.mkdir(parents=True, exist_ok=True); scan(file.relative_to(ROOT).as_posix(), body, needles)
        if not target.exists():
            with target.open("xb") as stream: stream.write(body)
        else: assert target.read_bytes() == body
        entry = {"source": file.relative_to(ROOT).as_posix(), "archive": name, "sha256": digest, "bytes": len(body)}
        originals.append(entry); return entry
    for file in sorted(RAW.rglob("*")):
        if not file.is_file() or "objects" in file.relative_to(RAW).parts: continue
        retain(file)
        if re.fullmatch(r"(backend|ui)-\d{2}\.json", file.name): attempts.append({"source": file.relative_to(ROOT).as_posix(), "status": read(file)["status"]})
    archived_downloads = []
    for file in sorted(RAW.glob("ui-??-journey.json")):
        j = read(file)
        for item in [*j["screenshots"], *[f for r in j["recordings"] for f in r["files"]]]: retain(DEV / item["path"])
        for item in j.get("archives", []):
            entry = retain(DELIVERY / item["path"])
            if file.name == selected["ui"] + "-journey.json": archived_downloads.append({"path": (OUT / entry["archive"]).relative_to(ROOT).as_posix(), "sha256": item["sha256"], "files": item["files"], "kind": item["kind"]})
    for file in [PREVIOUS, PREVIOUS.with_name("commands.log"), ROOT / previous["incremental_history_and_links"]["path"]]: retain(file)
    prior_entry = next(r for r in originals if r["source"] == PREVIOUS.relative_to(ROOT).as_posix())
    extra = {}
    for pattern, body in [("qualify-creative-packages*.mjs", (DELIVERY / b["verifier"]["path"]).read_bytes()),
                          ("qualify-creative-packages*.mjs", (DELIVERY / u["verifier"]["path"]).read_bytes()),
                          ("qa-creative-packages-140-v*.ts", (RAW / (selected["ui"] + "-journey-verifier.ts")).read_bytes())]:
        matched = [f for f in (DELIVERY / "scripts").glob(pattern) if f.read_bytes() == body]
        assert len(matched) == 1
        extra[matched[0].relative_to(ROOT).as_posix()] = sha(body)
    for name in ["scripts/record-workmate-media.ts", "package.json", "package-lock.json", "tsconfig.json", ".gitattributes"]:
        file = DELIVERY / name; extra[file.relative_to(ROOT).as_posix()] = sha(file.read_bytes())
    counts = [int(n) for n in re.findall(r"^# tests (\d+)\r?$", (DELIVERY / b["raw_log"]["path"]).read_text(encoding="utf-8"), re.M)]
    assert counts == [6, 23, 3], counts
    reused_build = u.get("reused_build")
    if reused_build:
        build_file = DELIVERY / reused_build["report"]
        assert sha(build_file.read_bytes()) == reused_build["sha256"]
        build, build_sources = report(build_file.stem)
        assert len(build["commands"]) == 11 and all(c["exit_code"] == 0 for c in build["commands"])
        assert build["package_unchanged"] and build["package_files"] == u["package_files"]
        assert {k: v["sha256"] for k,v in build_sources.items()} == {k: v["sha256"] for k,v in bs.items()}
        body = (DELIVERY / build["verifier"]["path"]).read_bytes()
        matched = [f for f in (DELIVERY / "scripts").glob("qualify-creative-packages*.mjs") if f.read_bytes() == body]
        assert len(matched) == 1
        extra[matched[0].relative_to(ROOT).as_posix()] = sha(body)
    index = {"at": datetime.now(timezone.utc).isoformat(), "recorder_sha256": sha(Path(__file__).read_bytes()), "originals": originals,
             "attempts": attempts, "selected_attempts": selected, "scope": "Portable canvas/video project slice. Original passing and failing attempts keep their own scope and sources."}
    (OUT / "index.json").write_bytes(encoded(index))
    cp = {"at": datetime.now(timezone.utc).isoformat(), "status": "verified_portable_creative_project_slice", "selected_attempts": selected,
          "evidence_index": ref(OUT / "index.json"), "source_files": {"dev/" + name: row["sha256"] for name,row in bs.items()},
          "qualification_sources": extra, "counts": {"new_backend_integration_cases": 6, "existing_video_regressions": 23, "extension_download_boundary_cases": 3,
            "actual_client_journey_checks": 4, "screenshots": 5, "recording_pairs": 3, "actual_layouts": 3, "downloaded_archives": 3},
          "media_files": media, "downloaded_archives": archived_downloads, "reused_client_build": reused_build, "previous_publication_receipt": prior_entry,
          "previous_checkpoint": ref(ROOT / "docs/quality/native-teams-release-checkpoint-139.json"),
          "scope": journey["model_mode"], "new_full_acceptance_closures": 0, "whole_platform_runtime_rerun": False,
          "accepted_requirements_unchanged": ["REQ-095"], "required_open": 88, "unconfirmed_suggestions": 12, "optional_open": 1}
    cp["git_source_proofs"] = check_sources(cp["source_files"], extra)
    CP.write_bytes(encoded(cp)); print(json.dumps(verify()))

if __name__ == "__main__":
    parser = argparse.ArgumentParser(); group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--record", action="store_true"); group.add_argument("--verify", action="store_true")
    parser.add_argument("--backend", required=False); parser.add_argument("--ui", required=False); args = parser.parse_args()
    if args.record: record(args.backend, args.ui)
    else: print(json.dumps(verify()))
