"""Verify preserved Stage125 evidence without requiring its candidate worktrees."""
from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
from hashlib import sha256
from pathlib import Path
import json

from record_audio_accounting_v2 import ROOT, read, ref, digest

INDEX = ROOT / "docs/quality/controlled-publications-evidence-125/index.json"
ARCHIVE = INDEX.parent
CASES = {
    "backend_full_related_09": ("platform", True, 117),
    "admin_upgrade_cli_07": ("platform", True, 5),
    "analysis_native_08": ("platform", True, 12),
    "desktop_media_03": ("desktop", False, 21),
    "extension_02": ("extension", False, 70),
    "actual_web_admin_12": ("delivery", True, 14),
    "actual_native_02": ("delivery", True, 10),
}


def canonical(name):
    parts = Path(name).parts
    assert len(parts) >= 3 and parts[0] == "dev"
    assert parts[1].startswith("copypaste-")
    assert not any(part in (".", "..") for part in parts)
    return Path(parts[0], parts[1].removesuffix("-publication-125"), *parts[2:]).as_posix()


def verify_archive(cp):
    index = read(INDEX)
    assert cp["evidence_index"] == ref(INDEX)
    assert index["verifier_sha256"] == digest(ROOT / "docs/tools/archive_controlled_publications_evidence_v1.py")
    assert index["helper"] == ref(ROOT / "docs/tools/record_open_work_review_125_v6.py")
    assert index["previous_publication"] == cp["previous_publication"]
    assert index["entry_count"] == len(index["entries"])
    originals, blobs = {}, {}
    for entry in index["entries"]:
        name = entry["original"]
        assert name not in originals, "Duplicate archived original"
        originals[name] = entry
        file = ROOT / entry["blob"]
        assert file.resolve().is_relative_to(ARCHIVE.resolve()) and not file.is_symlink()
        assert file.stem == entry["sha256"] and file.suffix == ".blob"
        assert isinstance(entry["bytes"], int) and 0 <= entry["bytes"] < 100 * 1024 * 1024
        identity = (entry["sha256"], entry["bytes"])
        assert blobs.get(entry["blob"], identity) == identity, "Inconsistent archive alias"
        blobs[entry["blob"]] = identity
    assert len(blobs) == index["unique_blobs"]

    def check(item):
        name, (expected, length) = item
        body = (ROOT / name).read_bytes()
        assert len(body) == length and sha256(body).hexdigest() == expected, name

    with ThreadPoolExecutor(max_workers=6) as pool:
        for _ in pool.map(check, blobs.items()):
            pass

    def archived(reference):
        entry = originals[reference["path"]]
        assert entry["sha256"] == reference["sha256"]
        return json.loads((ROOT / entry["blob"]).read_bytes())

    bindings, media = {}, {}
    for key, (component, prefixed, expected_count) in CASES.items():
        latest = index["latest"][key]
        raw = archived(latest)
        assert raw["status"] == "passed" and raw["source_unchanged"]
        assert raw["counts"].get("pass", raw["counts"].get("journey_checks")) == expected_count
        assert not raw["counts"].get("fail", 0) and not raw["counts"].get("errors", 0)
        assert not raw["counts"].get("cancelled", 0) and not raw["counts"].get("skipped", 0)
        assert raw["raw_report"]["sha256"] == latest["raw_report"]["sha256"]
        assert originals[latest["raw_report"]["path"]]["sha256"] == latest["raw_report"]["sha256"]
        candidate = "copypaste-" + component + ("-publication-125" if component != "delivery" else "")
        for name, expected in raw["source_files"].items():
            if prefixed:
                label, suffix = name.split("/", 1)
                directory = label + ("-publication-125" if label != "copypaste-delivery" else "")
                source = "dev/" + directory + "/" + suffix
            else:
                source = "dev/" + candidate + "/" + name
            assert bindings.get(source, expected) == expected
            bindings[source] = expected
        if component == "platform":
            assert raw["owned_database_shutdown"] and raw["owned_database_port_closed"]
        if key not in ("actual_web_admin_12", "actual_native_02"):
            continue
        assert all(raw["ports_closed"].values()) and raw["owned_database_shutdown"] and raw["owned_previews_closed"]
        journey_ref = {"path": "dev/copypaste-delivery/" + raw["journey"]["path"], "sha256": raw["journey"]["sha256"]}
        journey = archived(journey_ref)
        assert journey["status"] == "passed" and not journey["errors"] and len(journey["checks"]) == expected_count
        assert journey["model_calls"] == 0
        assert all(journey[name] for name in ("browser_closed", "api_closed", "fixture_closed"))
        if key == "actual_web_admin_12":
            for component_name in ("web-preview", "admin-private-review"):
                selected = [item for item in journey["layouts"] if item["component"] == component_name]
                assert {item["width"] for item in selected} == {375, 768, 1024, 1440}
                assert all(item["page_fits"] and item["dialog_fits"] and item["fields_fit"] for item in selected)
        else:
            assert raw["package_unchanged"] and journey["desktop_closed"]
            selected = [item for item in journey["layouts"] if item["component"] == "native-desktop"]
            assert {item["width"] for item in selected} == {1000, 1240, 1440}
            assert all(not item["horizontal"] and not item["visible_scrollbars"] and not item["native"]["menu_visible"] for item in selected)
        for shot in journey["screenshots"]:
            assert shot["edited"] is False
            media["dev/" + shot["path"]] = shot["sha256"]
        for recording in journey["recordings"]:
            assert recording["observed_frames"] >= 5 and recording["distinct_frames"] >= 2
            assert recording["skipped_capture_errors"] == 0
            for item in recording["files"]:
                media["dev/" + item["path"]] = item["sha256"]
                assert (ROOT / canonical("dev/" + item["path"])).stat().st_size == item["bytes"]
    assert bindings == index["current_source_files"]
    assert media == index["actual_media_files"] and len(media) == 22
    assert {canonical(name): expected for name, expected in media.items()} == cp["actual_media_files"]
    for name, expected in {**bindings, **media}.items():
        current = canonical(name)
        assert digest(ROOT / current) == expected, current
        if name in bindings:
            assert cp["source_files"][current] == expected
    consent = archived(index["latest"]["browser_consent_03"])
    assert consent["status"] == "passed" and len(consent["checks"]) == 3 and not consent["errors"]
    assert consent["source_unchanged"] and consent["browser_closed"] and consent["fixture_closed"]
    assert all(consent["ports_closed"].values())
    assert consent["callback_requests"] == consent["web_landings"] == 2 and consent["hostile_posts"] == 0
    for name, expected in consent["source_files"].items():
        assert digest(ROOT / "dev" / name) == expected, name
    return {"entries": len(originals), "unique_blobs": len(blobs), "qualified_sources": len(bindings), "actual_media_files": len(media)}
