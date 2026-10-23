"""Qualify the private native video subset without changing acceptance scope."""
import argparse
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess

from record_desktop_company_tools import tap_counts

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"


def read(file):
    return json.loads(file.read_text(encoding="utf-8"))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def bound(item):
    file = (DELIVERY / item["path"]).resolve()
    assert file.is_relative_to(DELIVERY) and digest(file) == item["sha256"], item["path"]
    return file


def save(file, raw):
    file.parent.mkdir(parents=True, exist_ok=True)
    with file.open("xb") as stream:
        stream.write(raw)


def complete(control):
    index = read(bound(control["raw_report"]))
    assert index == control["coverage"]
    plan = read(bound(index["plan"]))
    actual = sorted("tests/" + p.name for p in (DEV / "copypaste-platform/tests").glob("*.test.ts"))
    assert len(actual) == 64 and plan["files"] == actual
    batches = [{"id": f"{n // 4 + 1:02}", "files": actual[n:n + 4]} for n in range(0, len(actual), 4)]
    assert plan["batches"] == batches and plan["source_files"] == control["source_files"]
    assert plan["source_fingerprint"] == control["source_fingerprint"] == sha256(json.dumps(plan["source_files"], ensure_ascii=False, separators=(",", ":")).encode()).hexdigest()
    bound(plan["verifier"])
    setup = read(bound(index["setup"]))
    assert setup["status"] == "passed" and setup["source_unchanged"]
    assert setup["plan_sha256"] == index["plan"]["sha256"] and setup["source_fingerprint"] == control["source_fingerprint"]
    assert setup["counts"] == tap_counts(bound(setup["raw_report"]).read_text(encoding="utf-8")) == control["qualification_state_test_counts"]
    assert setup["counts"]["tests"] == 6 and len(setup["checks"]) == 2 and all(c["exit_code"] == 0 for c in setup["checks"])
    assert setup["checks"] == control["checks"] and len(index["batches"]) == 16
    texts, totals, selected = [], Counter(), set()
    for expected, item in zip(batches, index["batches"], strict=True):
        assert item["batch"] == expected["id"] and item["files"] == expected["files"]
        receipt = read(bound(item))
        assert receipt["status"] == "passed" and receipt["source_unchanged"] and receipt["owned_database_shutdown"]
        assert receipt["files"] == expected["files"] and receipt["plan_sha256"] == index["plan"]["sha256"] and receipt["source_fingerprint"] == control["source_fingerprint"]
        assert len(receipt["checks"]) == 1 and receipt["checks"][0]["exit_code"] == 0
        raw = bound(receipt["raw_report"]).read_text(encoding="utf-8")
        assert tap_counts(raw) == receipt["counts"] == item["counts"]
        cleanup = read(bound(receipt["fixture_cleanup"]))
        assert cleanup["status"] == "passed" and cleanup["workers_exited"] and all(r["reclaimed"] for r in cleanup["results"])
        texts.append(raw); totals.update(receipt["counts"]); selected.add(item["path"])
    assert dict(totals) == control["counts"] and totals["tests"] == 830
    attempt = re.search(r"control-(\d{2})-index", control["raw_report"]["path"])[1]
    for file in (DELIVERY / "evidence").glob(f"desktop-execution-control-{attempt}-batch-??-attempt-??.json"):
        row = read(file)
        assert row["status"] in ("passed", "interrupted")
        if row["status"] == "passed":
            assert file.relative_to(DELIVERY).as_posix() in selected
    passed = re.findall(r"^[ \t]*ok \d+ - (.*)\r?$", "\n".join(texts), re.M)
    assert len(passed) == 830
    assert control["required_scenarios"][0] == "all seventeen connected native roles"
    assert all(any(name in title for title in passed) for name in control["required_scenarios"])
    return passed, {"test_files": 64, "batches": 16, "plan": index["plan"], "index": control["raw_report"], "all_batch_tap_and_cleanup_hashes_verified": True}


def main():
    parser = argparse.ArgumentParser()
    for key in ("control", "native", "ui", "focused", "prior-ui", "visually-reviewed-ui"):
        parser.add_argument("--" + key, required=True)
    args = parser.parse_args()
    assert args.ui == args.visually_reviewed_ui
    assert all(re.fullmatch(r"\d{2}", value) for value in vars(args).values())
    names = [f"desktop-execution-control-{args.control}.json", f"local-codex-native-{args.native}.json", f"desktop-local-ui-{args.ui}.json", f"desktop-video-{args.focused}.json"]
    control, native, ui, focused = reports = [read(DELIVERY / "evidence" / name) for name in names]
    assert all(r["status"] == "passed" and r["source_unchanged"] for r in reports)
    interrupted_ui_path = DELIVERY / "evidence/desktop-local-ui-15.json"
    interrupted_ui = read(interrupted_ui_path)
    interrupted_journey = read(bound(interrupted_ui["journey"]))
    assert interrupted_ui["status"] == "failed" and interrupted_ui["source_unchanged"]
    assert interrupted_ui["owned_database_shutdown"] and interrupted_ui["owned_preview_closed"]
    assert interrupted_journey["errors"] == ["Error: Timed out: actual question minimum-window resize"]
    assert all(interrupted_journey[key] for key in ("electron_closed", "browser_closed", "api_closed", "fixture_closed"))
    later_failed = read(DELIVERY / "evidence/desktop-local-ui-16.json")
    later_journey = read(bound(later_failed["journey"]))
    assert later_failed["status"] == "failed" and later_failed["source_unchanged"] and later_failed["owned_database_shutdown"] and later_failed["owned_preview_closed"]
    assert later_failed["source_files"] == interrupted_ui["source_files"]
    assert later_journey["errors"] == ["Error: Timed out: actual video minimum window"]
    assert all(later_journey[key] for key in ("electron_closed", "browser_closed", "api_closed", "fixture_closed"))
    bound(later_failed["raw_report"])
    qa_correction = {"copypaste-delivery/scripts/qa-desktop-local.ts", "copypaste-delivery/scripts/qa-desktop-video.ts"}
    assert {name for name, value in ui["source_files"].items() if interrupted_ui["source_files"][name] != value} == qa_correction
    compile_failure = read(DELIVERY / "evidence/desktop-local-ui-17.json")
    assert compile_failure["status"] == "failed" and compile_failure["source_unchanged"] and compile_failure["checks"] == [{"name": "delivery typecheck", "exit_code": 1}]
    assert "TS7006" in bound(compile_failure["raw_report"]).read_text(encoding="utf-8")
    assert {name for name, value in ui["source_files"].items() if compile_failure["source_files"][name] != value} == qa_correction
    serialized_failed = read(DELIVERY / "evidence/desktop-local-ui-18.json")
    serialized_journey = read(bound(serialized_failed["journey"]))
    assert serialized_failed["status"] == "failed" and serialized_failed["source_unchanged"] and serialized_failed["owned_database_shutdown"] and serialized_failed["owned_preview_closed"]
    assert serialized_journey["errors"] == ["Error: Timed out: actual question minimum-window resize"]
    assert all(serialized_journey[key] for key in ("electron_closed", "browser_closed", "api_closed", "fixture_closed"))
    serialized_tap = bound(serialized_failed["raw_report"]).read_text(encoding="utf-8")
    assert '"requested":[800,600]' in serialized_tap and '"renderer":{"width":1440,"height":980,"outer":[800,600]' in serialized_tap
    assert {name for name, value in ui["source_files"].items() if serialized_failed["source_files"][name] != value} == qa_correction
    bound(interrupted_ui["raw_report"])
    passed, inventory = complete(control)
    parent_path = ROOT / "docs/quality/desktop-company-tools-checkpoint.json"
    parent = read(parent_path)
    old = read(DELIVERY / f"evidence/desktop-execution-control-{parent['selected']['control']}.json")
    assert old["counts"]["tests"] == 818
    old_index = read(bound(old["raw_report"]))
    previous = []
    for item in old_index["batches"]:
        receipt = read(bound(item))
        raw = bound(receipt["raw_report"]).read_text(encoding="utf-8")
        assert tap_counts(raw) == receipt["counts"]
        previous += re.findall(r"^[ \t]*ok \d+ - (.*)\r?$", raw, re.M)
    assert len(previous) == 818
    normalized = [title.replace("all sixteen connected native roles", "all seventeen connected native roles") for title in previous]
    assert not (Counter(normalized) - Counter(passed))
    migrations = {name: expected for name, expected in old["source_files"].items() if re.fullmatch(r"copypaste-platform/migrations/0(?:0[1-9]|[1-8]\d|9[0-2])-[^/]+\.sql", name)}
    assert len(migrations) == 92
    assert all(digest(DEV / name) == expected for name, expected in migrations.items())
    assert native["counts"] == tap_counts((DELIVERY / native["raw_report"]).read_text(encoding="utf-8")) and native["counts"]["tests"] == 17
    assert digest(DELIVERY / native["raw_report"]) == native["raw_sha256"]
    assert digest(DELIVERY / f"evidence/local-codex-native-{args.native}-verifier.mjs") == native["verifier_sha256"]
    assert tap_counts(bound(ui["raw_report"]).read_text(encoding="utf-8"))["tests"] == 47
    assert focused["counts"] == tap_counts(bound(focused["raw_report"]).read_text(encoding="utf-8")) and focused["counts"]["tests"] == 58
    assert all(any(name in title for title in passed) for name in focused["required_scenarios"])
    assert any("minimum landscape video fits its real CTA" in title for title in passed)
    for item in (ui["verifier"], ui["journey_verifier"], ui["journey"], ui["fixture_cleanup"], focused["verifier"]):
        bound(item)
    cleanup = read(bound(ui["fixture_cleanup"]))
    assert cleanup["status"] == "passed" and cleanup["workers_exited"] and all(r["reclaimed"] for r in cleanup["results"])
    assert ui["owned_database_shutdown"] and ui["owned_preview_closed"] and focused["owned_database_shutdown"]
    assert len(ui["checks"]) == 11 and all(c["exit_code"] == 0 for c in ui["checks"])
    journey_name = f"desktop-local-ui-{args.ui}-journey.json"
    journey = read(DELIVERY / "evidence" / journey_name)
    assert journey["status"] == "passed" and len(journey["checks"]) == 18 and not journey["errors"]
    assert journey["company_image_calls"] == 2 and journey["native_input_completions"] == 1
    assert all(journey[key] for key in ("electron_closed", "browser_closed", "api_closed", "fixture_closed"))
    observed = journey["native_video_tool_results"]
    assert len({o["tool"] for o in observed}) == 7 and all(o["output_format"] == "json_string" for o in observed)
    assert len(journey["screenshots"]) == 17 and journey["media"]["distinct_frames"] > 30 and journey["media"]["skipped_capture_errors"] == 0
    sources, qualification_scopes = {}, []
    prior_ui = read(DELIVERY / f"evidence/desktop-local-ui-{args.prior_ui}.json")
    assert prior_ui["status"] == "passed" and prior_ui["source_unchanged"]
    # Platform tests exercise backend and native main-process code. Five later
    # UI-only changes decouple explicit company cancellation from OS grants;
    # the new actual packaged UI run qualifies those exact current bytes.
    ui_only = {"copypaste-desktop/renderer/src/local-agent.tsx", "copypaste-desktop/renderer/src/local-video.tsx",
               "copypaste-desktop/renderer-source.json", "copypaste-delivery/scripts/qa-desktop-video.ts", "copypaste-delivery/scripts/qa-desktop-local.ts"}
    for report in reports:
        differences = []
        for name, expected in report["source_files"].items():
            source = "copypaste-desktop/" + name if report is native else name
            current = digest(DEV / source)
            if current != expected:
                assert report is control or report is focused, source
                assert source in ui_only and prior_ui["source_files"][source] == expected
                assert ui["source_files"][source] == current
                differences.append({"path": source, "qualified_before_sha256": expected, "current_packaged_ui_sha256": current})
            assert source not in sources or sources[source] == current, source
            sources[source] = current
        assert {item["path"] for item in differences} == (ui_only if report is control or report is focused else set())
        qualification_scopes.append({"report": names[reports.index(report)], "source_files": len(report["source_files"]), "later_ui_only_differences": differences,
            "note": "Backend and native main-process sources unchanged; exact later renderer/QA changes qualified by the selected current packaged UI." if differences else "All source bindings still match current bytes."})
    for name, expected in native["source_files"].items():
        assert digest(DELIVERY / f"evidence/local-codex-native-{args.native}-sources" / name) == expected
    for item in journey["screenshots"] + journey["media"]["files"]:
        assert digest(DEV / item["path"]) == item["sha256"]
    for item in journey["media"]["files"]:
        subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-xerror", "-err_detect", "explode", "-i", str(DEV / item["path"]), "-f", "null", "-"], capture_output=True, check=True)
    candidate = (DELIVERY / ui["packaged"]["executable"]).resolve()
    resources = candidate.parent / "resources"
    assert candidate.is_relative_to(DEV) and candidate.is_file()
    assert digest(resources / "app.asar") == ui["packaged"]["app_asar_sha256"]
    assert digest(resources / "local-codex/codex.exe") == ui["packaged"]["native_binary_sha256"] == native["native_binary_sha256"] == control["native_binary"]["sha256"]
    contract = ROOT / "docs/contracts/template-video-openapi.json"
    api = read(contract)
    assert digest(contract) == digest(DEV / "copypaste-platform/contracts/template-video-openapi.json")
    assert api["x-model-source-sha256"] == digest(DEV / "copypaste-platform/src/video-project-model.ts")
    assert api["x-route-source-sha256"] == digest(DEV / "copypaste-platform/src/video-projects.ts")
    assert sum(len(v) for v in api["paths"].values()) == 8
    copies, archives, media = [], [], []
    dirty_names = set()
    args_git = ["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false"]
    for repo in sorted({name.split("/", 1)[0] for name in sources}):
        folder = DEV / repo
        raw = subprocess.check_output(args_git + ["diff", "HEAD", "--name-only", "-z"], cwd=folder)
        raw += subprocess.check_output(args_git + ["ls-files", "--others", "--exclude-standard", "-z"], cwd=folder)
        dirty_names.update(repo + "/" + name.decode() for name in raw.split(b"\0") if name)
    for source in sorted(sources):
        if source in dirty_names:
            target = ROOT / "docs/quality/history/desktop-video-qualified-sources" / (source.replace("/", "__") + ".txt")
            copies.append((target, (DEV / source).read_bytes()))
            archives.append({"source": "dev/" + source, "archive": target.relative_to(ROOT).as_posix(), "sha256": sources[source]})
    for name in names + [journey_name, "desktop-video-01.json", "desktop-video-02.json", "desktop-local-ui-13.json", "desktop-local-ui-13-journey.json", "desktop-local-ui-15.json", "desktop-local-ui-15-journey.json", "desktop-local-ui-16.json", "desktop-local-ui-16-journey.json", "desktop-local-ui-17.json", "desktop-local-ui-18.json", "desktop-local-ui-18-journey.json", f"desktop-local-ui-{args.prior_ui}.json"]:
        copies.append((ROOT / "docs/quality" / name, (DELIVERY / "evidence" / name).read_bytes()))
    for item in journey["screenshots"] + journey["media"]["files"]:
        source = DEV / item["path"]
        target = ROOT / "docs/design/implementation" / source.name
        copies.append((target, source.read_bytes()))
        media.append({"source": source.relative_to(ROOT).as_posix(), "path": target.relative_to(ROOT).as_posix(), "sha256": item["sha256"]})
    result = {"at": datetime.now(timezone.utc).isoformat(), "status": "verified_native_private_video_subset", "stage": 75,
        "selected": {"control": args.control, "native": args.native, "ui": args.ui, "focused": args.focused},
        "scope": "Local Codex video-motion role, seven scoped company tools, private projects/sources/deliveries, real native composition and playback, explicit queued completion, version edit/retry/cancel, owner fencing, native permission revocation and authenticated download. Synthetic model/image/dialog decisions; no cloud Agent execution for Desktop.",
        "platform_tests": control["counts"], "focused_tests": focused["counts"], "native_tests": native["counts"], "client_unit_tests": 47, "native_ui_checks": 18,
        "inventory": inventory, "original_regression": {"tests_preserved": 818, "additional_tests": 12, "admission_title_renamed_sixteen_to_seventeen": True, "unchanged_published_migrations": 92},
        "current_native_role_admissions": 17, "roles_required": 18, "skills_required": 29,
        "source_files": sources, "qualification_scopes": qualification_scopes, "source_archives": archives, "packaged": ui["packaged"], "screenshots": journey["screenshots"], "media": journey["media"], "documentation_media": media,
        "contract": {"path": contract.relative_to(ROOT).as_posix(), "sha256": digest(contract), "operations": 8},
        "baseline": {"requirements": 102, "test_cases": 102, "partial": 81, "unproven": 21, "fully_accepted": 0},
        "earlier_attempts": {"focused01": {"status": "failed", "note": "42/49 passed; real 480x270 encoding exposed a CTA text-height defect. Renderer profile 2 fixes geometry; profile 1 remains readable and cannot silently rerender with changed geometry."},
            "focused02": {"status": "passed_historical_scope", "note": "49/49 passed before adding minimum-landscape/profile-boundary test, non-vacuous privacy assertion, strict status schema and final UI sources. Historical scope only."},
            "ui13": {"status": "failed", "note": "Failed after 12 observed assertions: revoked answers correctly hit LOCAL_PERMISSION_REQUIRED before input lookup. Test expectation corrected. Visual review also led to bounded preview sizing and a full-frame 800x600 assertion; original failure and three source files retained."},
            "ui15": {"status": "failed", "note": "Timed out during the second actual minimum-window resize after six successful journey checks. All owned resources closed. Attempt 16 used identical source bytes and is also retained.", "report_sha256": digest(interrupted_ui_path), "raw_report": interrupted_ui["raw_report"]},
            "ui16": {"status": "failed", "note": "Timed out during the video minimum-window resize after eight successful journey checks. Continuous capture and real native resize are now serialized in the QA driver; exact target dimensions and full-frame assertions remain enforced. Exact pre-correction sources and separate diagnostic observations are retained in history/stage75-before-capture-serialization.", "raw_report": later_failed["raw_report"]},
            "ui17": {"status": "failed", "note": "TypeScript rejected an implicit-any diagnostic callback before launching owned services. Its exact journey verifier is retained; no test or service coverage is claimed for this attempt.", "raw_report": compile_failure["raw_report"]},
            "ui18": {"status": "failed", "note": "Serializing capture and resize alone did not resolve the viewport mismatch: native content was 800x600 while the renderer reported 1440x980. The current QA driver uses native Electron surface capture, serializes navigation as well, focuses the actual window and still requires exact native renderer sizes. No product-runtime sources were changed for this QA correction.", "raw_report": serialized_failed["raw_report"]}},
        "prior_ui_qualification": {"attempt": args.prior_ui, "status": "passed", "checks": 18, "note": "Before explicit company-service cancellation was separated from idle local OS revocation. It retains original source bindings and is not the current packaged UI."},
        "limits": ["workflow-consultant native tools remain unavailable", "17 native role admissions do not prove all professional outcomes", "complete browser and OS application automation remains pending", "live model/image/video providers and human native-dialog clicks remain pending", "signed production installers, store distribution and full production matrix remain pending", "existing Extension/native Side Panel evidence retains its own source scope", "all original REQ/TC/NFR/G01-G10 acceptance remains open"],
        "verifier_sha256": digest(Path(__file__))}
    copies.append((ROOT / "docs/quality/desktop-video-checkpoint.json", (json.dumps(result, ensure_ascii=False, indent=2) + "\n").encode()))
    assert all(not target.exists() for target, _ in copies)
    for target, raw in copies:
        save(target, raw)
    print(json.dumps({"status": result["status"], "platform": 830, "focused": 58, "native": 17, "client": 47, "ui": 18, "archives": len(archives), "media": len(media)}))


if __name__ == "__main__":
    main()
