"""Bind the native-input increment to current sources and actual run bytes."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import subprocess

from record_desktop_company_tools import tap_counts, verify_complete_inventory

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"


def read(file):
    return json.loads(file.read_text(encoding="utf-8"))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def bound(item):
    file = (DELIVERY / item["path"]).resolve()
    assert file.is_relative_to(DELIVERY) and digest(file) == item["sha256"]
    return file


def exclusive(file, data):
    file.parent.mkdir(parents=True, exist_ok=True)
    with file.open("xb") as stream:
        stream.write(data)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--native", required=True)
    parser.add_argument("--ui", required=True)
    parser.add_argument("--visually-reviewed-ui", required=True)
    args = parser.parse_args()
    assert args.ui == args.visually_reviewed_ui
    parent_path = ROOT / "docs/quality/desktop-company-tools-checkpoint.json"
    parent = read(parent_path)
    assert parent["status"] == "verified_native_company_tool_subset"
    control_id = parent["selected"]["control"]
    control_path = DELIVERY / f"evidence/desktop-execution-control-{control_id}.json"
    control = read(control_path)
    assert control["counts"] == {"tests": 818, "pass": 818, "fail": 0, "cancelled": 0, "skipped": 0, "todo": 0}
    coverage = verify_complete_inventory(control, control_id)
    unchanged_backend = {name: expected for name, expected in control["source_files"].items() if name.startswith("copypaste-platform/")}
    assert unchanged_backend
    for name, expected in unchanged_backend.items():
        assert digest(DEV / name) == expected, name
    native_name = f"local-codex-native-{args.native}.json"
    ui_name = f"desktop-local-ui-{args.ui}.json"
    journey_name = f"desktop-local-ui-{args.ui}-journey.json"
    native, ui, journey = [read(DELIVERY / "evidence" / name) for name in (native_name, ui_name, journey_name)]
    for report in (native, ui):
        assert report["status"] == "passed" and report["source_unchanged"]
    native_raw = DELIVERY / native["raw_report"]
    assert digest(native_raw) == native["raw_sha256"]
    assert tap_counts(native_raw.read_text(encoding="utf-8")) == native["counts"]
    assert native["counts"]["tests"] == 17
    assert digest(DELIVERY / f"evidence/local-codex-native-{args.native}-verifier.mjs") == native["verifier_sha256"]
    assert tap_counts(bound(ui["raw_report"]).read_text(encoding="utf-8"))["tests"] == 47
    for item in (ui["verifier"], ui["journey_verifier"], ui["journey"], ui["fixture_cleanup"]):
        bound(item)
    cleanup = read(bound(ui["fixture_cleanup"]))
    assert cleanup["status"] == "passed" and cleanup["workers_exited"] and all(row["reclaimed"] for row in cleanup["results"])
    assert ui["owned_database_shutdown"] and ui["owned_preview_closed"]
    assert len(ui["checks"]) == 11 and all(check["exit_code"] == 0 for check in ui["checks"])
    assert journey["status"] == "passed" and not journey["errors"] and len(journey["checks"]) == 12
    assert journey["company_image_calls"] == 2 and journey["native_input_completions"] == 1
    assert all(journey[key] for key in ("electron_closed", "browser_closed", "api_closed", "fixture_closed"))
    for required in ("same task/thread/turn", "Stop stays usable during a native question", "Revoking full permission while waiting"):
        assert any(required in check for check in journey["checks"])
    assert journey["media"]["observed_frames"] > 30 and journey["media"]["distinct_frames"] > 10 and journey["media"]["skipped_capture_errors"] == 0
    sources = {}
    for report in (native, ui):
        for name, expected in report["source_files"].items():
            relative = "copypaste-desktop/" + name if report is native else name
            assert relative not in sources or sources[relative] == expected, relative
            assert digest(DEV / relative) == expected, relative
            sources[relative] = expected
    for name, expected in native["source_files"].items():
        assert digest(DELIVERY / f"evidence/local-codex-native-{args.native}-sources" / name) == expected
    for item in journey["screenshots"] + journey["media"]["files"]:
        assert digest(DEV / item["path"]) == item["sha256"]
    for item in journey["media"]["files"]:
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-xerror", "-err_detect", "explode", "-i", str(DEV / item["path"]), "-f", "null", "-"], capture_output=True, check=True)
    candidate = (DELIVERY / ui["packaged"]["executable"]).resolve()
    assert candidate.is_relative_to(DEV) and candidate.is_file()
    resources = candidate.parent / "resources"
    assert digest(resources / "app.asar") == ui["packaged"]["app_asar_sha256"]
    assert digest(resources / "local-codex/codex.exe") == ui["packaged"]["native_binary_sha256"] == native["native_binary_sha256"]
    source_names = [name for name in sources if name.startswith("copypaste-desktop/") and any(part in name for part in (
        "src/local-", "src/main.ts", "local-input.test.ts", "local-agent.test.ts", "local-codex.native.test.ts"))]
    source_names += ["copypaste-delivery/scripts/" + name for name in ("qa-desktop-local.ts", "run-desktop-local-ui.mjs", "run-local-codex-checks.mjs")]
    archives, documentation_media, copies = [], [], []
    archive = ROOT / "docs/quality/history/desktop-native-input-qualified-sources"
    assert not archive.exists()
    for name in sorted(set(source_names)):
        target = archive / (name.replace("/", "__") + ".txt")
        assert digest(DEV / name) == sources[name]
        copies.append((target, (DEV / name).read_bytes()))
        archives.append({"source": "dev/" + name, "archive": target.relative_to(ROOT).as_posix(), "sha256": sources[name]})
    names = [native_name, ui_name, journey_name]
    for prefix, ids in (("local-codex-native", range(17, int(args.native) + 1)), ("desktop-local-ui", range(10, int(args.ui) + 1))):
        for number in ids:
            name = f"{prefix}-{number:02}.json"
            if name not in names:
                names.append(name)
    for name in names:
        copies.append((ROOT / "docs/quality" / name, (DELIVERY / "evidence" / name).read_bytes()))
    for item in journey["screenshots"] + journey["media"]["files"]:
        source = DEV / item["path"]
        target = ROOT / "docs/design/implementation/workmate" / ("desktop-native-" + args.ui + "-" + source.name.split("workmate-local-" + args.ui + "-", 1)[1])
        copies.append((target, source.read_bytes()))
        documentation_media.append({"source": "dev/" + item["path"], "path": target.relative_to(ROOT).as_posix(), "sha256": item["sha256"]})
    attempts = [{"path": "dev/copypaste-delivery/evidence/" + name, "sha256": digest(DELIVERY / "evidence" / name), "status": read(DELIVERY / "evidence" / name)["status"]} for name in names]
    result = {
        "at": datetime.now(timezone.utc).isoformat(), "stage": 74, "status": "verified_native_input_subset",
        "selected": {"native": args.native, "ui": args.ui, "unchanged_backend_control": control_id},
        "previous_checkpoint": {"path": parent_path.relative_to(ROOT).as_posix(), "sha256": digest(parent_path)},
        "source_files_verified": len(sources), "source_archives": archives,
        "native_tests": native["counts"], "desktop_unit_tests": 47, "native_ui_checks": journey["checks"],
        "unchanged_backend": {"report": control_path.relative_to(ROOT).as_posix(), "sha256": digest(control_path), "counts": control["counts"], "source_files_verified": len(unchanged_backend), "coverage": coverage,
                              "scope": "Stage 73 complete Platform regression retained for exactly unchanged backend source; not a rerun or new Desktop qualification."},
        "screenshots": journey["screenshots"], "media": journey["media"], "documentation_media": documentation_media,
        "full_media_decode": "passed", "packaged": ui["packaged"], "attempts": attempts,
        "visual_review": {"ui": args.ui, "scope": "Question starts at its heading; current full permission is synchronized after reload; minimum-size waiting view collapses the disabled composer and retains at least 160px of message space."},
        "historical_attempt_interpretation": {
            "native17": "Failed: fixture omitted required non-empty options on one question. The real native tool rejected it before a client question; immutable failed report and sources retained.",
            "native18": "Two cancellation tests passed; answer test failed because its assertion inspected an escaped JSON string instead of parsing the function_call_output. Corrected to compare exact parsed answers, including explicit free text, in the final full run.",
            "ui10": "All twelve business journeys passed. Screenshot review found initial bottom-of-card scrolling and a permission selector reset on renderer reload; final UI fixes the initial question position, synchronizes the selector and increases waiting message space.",
            "ui11": "Incomplete and failed after eleven observed business assertions: the post-recording/locale stage did not finish. Only its identified candidate and journey/browser process tree were ended after a graceful-close attempt; the parent reclaimed its fixtures and gracefully shut down its owned database. No complete qualification. Its screenshot also exposed a missing actual-resize wait, so final minimum-window checks require exact dimensions and at least 160px of question space. See desktop-native-input-interruption-11.json."},
        "limits": [
            "Provider model/image responses and native dialog choices are explicit fixtures; Electron, pinned Codex, auth, local files, company control/fees and sandbox actually run.",
            "Plain-text-only and secret question presentation have parser/controller checks; the pinned default native model tool actually emits option questions with explicit free-text Other support.",
            "Answer fields are not directly written to the CopyPaste journal/events/billing. Native Codex history, company model context and possible answer-containing outputs are not a promise of secret-free persistence.",
            "Native video/workflow roles, complete browser/application automation, live providers, signing/installers and complete professional/production acceptance remain open.",
            "All 18 roles/29 Skills, 102 REQ/102 TC/NFR/G01-G10 remain; baseline 81 partial, 21 unproven, zero fully accepted."],
        "baseline": {"requirements": 102, "acceptance_cases": 102, "partial": 81, "unproven": 21, "fully_accepted": 0},
        "verifier_sha256": digest(Path(__file__)),
    }
    copies.append((ROOT / "docs/quality/desktop-native-input-checkpoint.json", (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode()))
    assert len({str(file) for file, _ in copies}) == len(copies)
    assert all(not file.exists() for file, _ in copies)
    for file, data in copies:
        exclusive(file, data)
    print(json.dumps({"status": result["status"], "sources": len(sources), "native_tests": 17, "client_tests": 47, "ui_checks": 12, "unchanged_backend_tests": 818}))


if __name__ == "__main__":
    main()
