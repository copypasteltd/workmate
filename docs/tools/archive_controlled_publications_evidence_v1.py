"""Archive exact Stage125 attempts; preserve failures and bounded source scope."""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from itertools import islice
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
OUT = ROOT / "docs/quality/controlled-publications-evidence-125"
INDEX = OUT / "index.json"
HELPER = ROOT / "docs/tools/record_open_work_review_125_v6.py"
spec = importlib.util.spec_from_file_location("preserved_stage125_reader", HELPER)
assert spec and spec.loader
base = importlib.util.module_from_spec(spec)
spec.loader.exec_module(base)


def digest(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def reference(file: Path) -> dict:
    return {"path": file.relative_to(ROOT).as_posix(), "sha256": digest(file.read_bytes())}


def read(file: Path) -> dict:
    return json.loads(file.read_text(encoding="utf-8-sig"))


def conditions() -> tuple[dict, dict, dict]:
    cases = {
        "backend_full_related_09": ("backend", ".data/publications-125/backend-09.json", True, 117),
        "admin_upgrade_cli_07": ("backend", ".data/publications-125/backend-07.json", True, 5),
        "analysis_native_08": ("backend", ".data/publications-125/backend-08.json", True, 12),
        "desktop_media_03": ("desktop", ".data/publications-125/media-03.json", False, 21),
        "extension_02": ("extension", ".data/publications-125/extension-02.json", False, 70),
        "actual_web_admin_12": ("delivery", "evidence/publications-ui-12.json", True, 14),
        "actual_native_02": ("delivery", "evidence/native-publications-02.json", True, 10),
    }
    latest, bindings = {}, {}
    for key, (repo, name, prefixed, count) in cases.items():
        file = base.REPOS[repo] / name
        checked = base.receipt(repo, name, prefixed)
        raw = read(file)
        assert checked["status"] == "passed" and checked["captured_files_match_now"]
        assert raw["source_unchanged"]
        assert raw["counts"].get("pass", raw["counts"].get("journey_checks")) == count
        if "ports_closed" in raw:
            assert all(raw["ports_closed"].values()) and raw["owned_database_shutdown"] and raw["owned_previews_closed"]
            journey = read(base.REPOS[repo] / raw["journey"]["path"])
            assert journey["status"] == "passed" and not journey["errors"] and journey["model_calls"] == 0
            assert all(journey[name] for name in ["browser_closed", "api_closed", "fixture_closed"])
            if key == "actual_web_admin_12":
                for component in ["web-preview", "admin-private-review"]:
                    assert {row["width"] for row in journey["layouts"] if row["component"] == component} == {375, 768, 1024, 1440}
            else:
                assert journey["desktop_closed"] and raw["package_unchanged"]
                for name, expected in raw["package_files"].items():
                    assert base.digest(base.REPOS["desktop"] / "release/publications-125-02/win-unpacked" / name) == expected
                assert {row["width"] for row in journey["layouts"] if row["component"] == "native-desktop"} == {1000, 1240, 1440}
            for shot in journey["screenshots"]:
                assert digest((DEV / shot["path"]).read_bytes()) == shot["sha256"] and shot["edited"] is False
            for recording in journey["recordings"]:
                assert recording["observed_frames"] >= 5 and recording["distinct_frames"] >= 2 and recording["skipped_capture_errors"] == 0
                for media in recording["files"]:
                    body = (DEV / media["path"]).read_bytes()
                    assert len(body) == media["bytes"] and digest(body) == media["sha256"]
        else:
            if repo == "backend":
                assert raw["owned_database_shutdown"] and raw["owned_database_port_closed"]
        for source, expected in raw["source_files"].items():
            if prefixed:
                label, suffix = source.split("/", 1)
                current = base.PREFIXES[label] / suffix
            else:
                current = base.REPOS[repo] / source
            name = current.relative_to(ROOT).as_posix()
            assert bindings.get(name, expected) == expected
            bindings[name] = expected
        latest[key] = checked
    consent_path = base.REPOS["delivery"] / "evidence/publication-consent-03.json"
    consent = read(consent_path)
    assert consent["status"] == "passed" and len(consent["checks"]) == 3 and not consent["errors"]
    assert consent["source_unchanged"] and consent["browser_closed"] and consent["fixture_closed"] and all(consent["ports_closed"].values())
    assert consent["callback_requests"] == consent["web_landings"] == 2 and consent["hostile_posts"] == 0
    latest["browser_consent_03"] = reference(consent_path)
    media = {}
    for attempt in ["publications-ui-12", "native-publications-02"]:
        journey = read(base.REPOS["delivery"] / f"evidence/{attempt}-journey.json")
        for shot in journey["screenshots"]:
            media["dev/" + shot["path"]] = shot["sha256"]
        for recording in journey["recordings"]:
            for file in recording["files"]:
                media["dev/" + file["path"]] = file["sha256"]
    return latest, bindings, media


def inputs() -> list[Path]:
    files = set()
    for repo, directory, prefixes in [
        ("backend", ".data/publications-125", ["backend-"]),
        ("desktop", ".data/publications-125", ["media-", "desktop-build-02", "desktop-package-02"]),
        ("extension", ".data/publications-125", ["extension-"]),
        ("delivery", "evidence", ["publications-ui-", "native-publications-", "publication-consent-"]),
    ]:
        for item in (base.REPOS[repo] / directory).iterdir():
            if not any(item.name.startswith(prefix) for prefix in prefixes):
                continue
            if item.is_file():
                files.add(item)
            elif item.is_dir() and item.name.endswith("-sources"):
                files.update(file for file in item.rglob("*") if file.is_file())
    assert files
    for file in files:
        assert file.resolve().is_relative_to(ROOT.resolve())
        assert file.stat().st_size < 100 * 1024 * 1024, file
    return sorted(files)


def archive() -> None:
    assert not INDEX.exists(), "Never overwrite an executed archive index"
    latest, bindings, media = conditions()
    entries = []
    iterator = iter(inputs())
    with ThreadPoolExecutor(max_workers=8) as pool:
        pending = deque((file, pool.submit(file.read_bytes)) for file in islice(iterator, 16))
        while pending:
            file, future = pending.popleft()
            body = future.result()
            key = digest(body)
            blob = OUT / "blobs" / key[:2] / (key + ".blob")
            blob.parent.mkdir(parents=True, exist_ok=True)
            if blob.exists():
                assert blob.read_bytes() == body
            else:
                with blob.open("xb") as stream:
                    stream.write(body)
            entries.append({"original": file.relative_to(ROOT).as_posix(), "sha256": key, "bytes": len(body), "blob": blob.relative_to(ROOT).as_posix()})
            other = next(iterator, None)
            if other is not None:
                pending.append((other, pool.submit(other.read_bytes)))
    previous = ROOT / "docs/quality/history/stage125-previous-publication.json"
    original = (ROOT / "docs/quality/workmate-publication.json").read_bytes()
    assert not previous.exists()
    previous.parent.mkdir(parents=True, exist_ok=True)
    with previous.open("xb") as stream:
        stream.write(original)
    value = {"schema_version": 1, "at": datetime.now(timezone.utc).isoformat(), "scope": "controlled_publications_bounded_backend_actual_web_admin_and_packaged_native_clients",
             "verifier_sha256": digest(Path(__file__).read_bytes()), "helper": reference(HELPER),
             "latest": latest, "current_source_files": bindings, "actual_media_files": media,
             "previous_publication": reference(previous), "entries": entries,
             "entry_count": len(entries), "unique_blobs": len({entry["sha256"] for entry in entries}),
             "limits": ["All prior attempts and their source snapshots remain original, including failures and invalid verifier claims.",
                        "Only the listed current terminal scopes pass; historical failures are not relabeled.",
                        "No live provider, signed installer, new Codex publication-tool invocation or twelve professional-role qualification.",
                        "The complete original requirement ledger remains open; this is not full-product acceptance."]}
    INDEX.parent.mkdir(parents=True, exist_ok=True)
    with INDEX.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print(json.dumps({"status": "archived", "entries": value["entry_count"], "unique_blobs": value["unique_blobs"], "current_sources": len(bindings), "media_files": len(media), "index": reference(INDEX)}, ensure_ascii=False))


def verify() -> None:
    value = read(INDEX)
    assert value["verifier_sha256"] == digest(Path(__file__).read_bytes()) and value["helper"] == reference(HELPER)
    assert value["entry_count"] == len(value["entries"])
    checked = set()
    for entry in value["entries"]:
        if entry["blob"] not in checked:
            body = (ROOT / entry["blob"]).read_bytes()
            assert digest(body) == entry["sha256"] and len(body) == entry["bytes"]
            checked.add(entry["blob"])
    latest, bindings, media = conditions()
    assert value["current_source_files"] == bindings and value["actual_media_files"] == media
    assert value["latest"] == latest
    assert len(checked) == value["unique_blobs"]
    print(json.dumps({"status": "passed", "entries": len(value["entries"]), "unique_blobs": len(checked), "current_sources": len(bindings), "media_files": len(media)}, ensure_ascii=False))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("mode", choices=["archive", "verify"])
    args = parser.parse_args()
    archive() if args.mode == "archive" else verify()
