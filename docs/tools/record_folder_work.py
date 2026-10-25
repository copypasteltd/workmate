"""Bind current native folder-work evidence without claiming full acceptance."""
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import argparse
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"


def read(file):
    return json.loads(file.read_text(encoding="utf-8-sig"))


def digest(file):
    result = sha256()
    with file.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            result.update(chunk)
    return result.hexdigest()


def ref(file):
    return {"path": file.relative_to(ROOT).as_posix(), "sha256": digest(file)}


def source(name):
    parts = Path(name.replace("\\", "/")).parts
    assert not Path(name).is_absolute() and ".." not in parts
    if parts[0] in ("dev", "docs"):
        return ROOT.joinpath(*parts)
    if parts[0].startswith("copypaste-"):
        return DEV.joinpath(*parts)
    assert parts[0] in ("platform", "web", "admin", "desktop", "extension", "delivery")
    return DEV.joinpath("copypaste-" + parts[0], *parts[1:])


def linked(item):
    file = ROOT / item["path"] if item["path"].startswith(("dev/", "docs/")) else DELIVERY / item["path"]
    assert digest(file) == item["sha256"], item["path"]
    return file


def counts(text):
    return {key: int(re.search(r"^# " + key + r" (\d+)\s*$", text, re.M)[1])
            for key in ("tests", "pass", "fail", "cancelled", "skipped", "todo")}


def passing(value):
    assert value["tests"] == value["pass"] > 0 and all(value[key] == 0 for key in ("fail", "cancelled", "skipped", "todo"))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--desktop", required=True)
    parser.add_argument("--clients", required=True)
    args = parser.parse_args()
    assert all(re.fullmatch(r"\d{2}", value) for value in vars(args).values())
    output = ROOT / "docs/quality/folder-work-checkpoint.json"
    assert not output.exists(), "Preserve original checkpoints."
    selected = {"desktop_ui": f"evidence/desktop-local-ui-{args.desktop}.json",
                "clients": f"evidence/history-source-clients-{args.clients}.json"}
    reports = {scope: read(DELIVERY / name) for scope, name in selected.items()}
    sources, scopes = {}, []
    for scope, report in reports.items():
        assert report["status"] == "passed" and report["source_unchanged"], scope
        for name, expected in report["source_files"].items():
            file = source(name)
            assert digest(file) == expected, (scope, name)
            key = file.relative_to(ROOT).as_posix()
            assert key not in sources or sources[key] == expected
            sources[key] = expected
        for field in ("raw_report", "verifier", "journey_verifier", "journey", "fixture_cleanup"):
            if isinstance(report.get(field), dict) and "path" in report[field]:
                linked(report[field])
        scopes.append({"scope": scope, "report": selected[scope], "sha256": digest(DELIVERY / selected[scope]),
                       "source_files": len(report["source_files"]), "all_recorded_sources_exact": True})
    native_report = reports["desktop_ui"]
    assert native_report["packaged_unchanged"] and native_report["owned_database_shutdown"] and native_report["owned_preview_closed"]
    assert native_report["fixture_cleanup"]["status"] == "passed" and all(v["reclaimed"] for v in native_report["fixture_cleanup"]["results"])
    native = read(linked(native_report["journey"]))
    assert native["status"] == "passed" and not native["errors"] and len(native["checks"]) == 57
    assert all(native[key] for key in ("electron_closed", "browser_closed", "api_closed", "fixture_closed", "native_browser_fixture_closed"))
    folder = native["native_folder_work"]
    assert folder["charged_micros"] == ["90", "60"] and folder["additional_cloud_tasks"] == 0
    assert folder["allocated_budget_micros"] == 2000000 and folder["original_bytes_preserved"] and folder["same_native_thread"]
    assert len(folder["actual_tool_outputs"]) == 2 and all(v["actual_output"] for v in folder["actual_tool_outputs"])
    assert len(folder["answered_questions"]) == 1 and folder["answered_questions"][0]["original_preserved"]
    assert folder["application_restart"]["old_owned_process_exited"]
    assert folder["application_restart"]["old_pid"] != folder["application_restart"]["new_pid"]
    old_native = read(DELIVERY / "evidence/desktop-local-ui-64-journey.json")
    assert len(old_native["checks"]) == 50 and not Counter(old_native["checks"]) - Counter(native["checks"])
    raw = linked(native_report["raw_report"]).read_text(encoding="utf-8-sig")
    native_unit = counts(raw)
    passing(native_unit)
    assert native_unit["tests"] == 91
    old_raw = (DELIVERY / "evidence/desktop-local-ui-64.tap").read_text(encoding="utf-8-sig")
    old_cases = Counter(re.findall(r"^# Subtest: (.+)$", old_raw, re.M))
    current_cases = Counter(re.findall(r"^# Subtest: (.+)$", raw, re.M))
    assert sum(old_cases.values()) == 69 and not old_cases - current_cases
    client_tests = 0
    for item in reports["clients"]["checks"]:
        assert item["exit_code"] == 0 and digest(DELIVERY / item["raw_report"]) == item["raw_sha256"]
        if item["counts"]:
            passing(item["counts"])
            client_tests += item["counts"]["tests"]
    assert client_tests == 161
    guidance = native["native_project_configuration"]
    assert guidance["versions"] == [3, 3, 4] and guidance["charged_micros"] == ["90", "90", "90"]
    assert guidance["execution_locations"] == ["desktop"] * 3 and guidance["cloud_replacement_created"] is False
    baseline_file = ROOT / "docs/quality/history/stage87-before-folder-work/receipt.json"
    baseline = read(baseline_file)
    for item in baseline["files"]:
        file = ROOT / item["archive"]
        assert digest(file) == item["sha256"] and file.stat().st_size == item["bytes"]
    assert len(baseline["published_migrations"]) == 103 and len(baseline["published_contracts"]) == 532
    for name, expected in {**baseline["published_migrations"], **baseline["published_contracts"]}.items():
        assert digest(ROOT / name) == expected, name
    progress = read(ROOT / "docs/quality/requirements-alignment-progress.json")
    keys = ("requirement_id", "priority", "requirement", "acceptance_case", "acceptance_conditions")
    assert [{key: row[key] for key in keys} for row in progress["requirements"]] == baseline["original_requirements"]
    assert progress["fully_accepted_requirements"] == progress["qualified_live_roles"] == 0
    assert all(gate["full_acceptance"] == "not_proven" for gate in progress["gates"])
    historical_file = ROOT / "docs/quality/shared-project-checkpoint.json"
    historical = read(historical_file)
    unchanged_components = ("platform", "web", "admin", "extension")
    retained_sources = {name: value for name, value in historical["source_files"].items()
                        if name.split("/")[1] in ["copypaste-" + c for c in unchanged_components]}
    assert retained_sources and all(digest(ROOT / name) == value for name, value in retained_sources.items())
    retained = []
    for item in historical["qualification_scopes"]:
        file = DELIVERY / item["report"]
        assert digest(file) == item["sha256"] and read(file)["status"] == "passed"
        for field in ("raw_report", "raw_log", "verifier", "journey_verifier", "journey"):
            value = read(file).get(field)
            if isinstance(value, dict) and "path" in value:
                linked(value)
        retained.append({"scope": item["scope"], "report": item["report"], "sha256": item["sha256"],
                         "scope_note": "Historical stage 86; the whole selected source set is not claimed current."})
    screenshots = native["screenshots"]
    for item in screenshots:
        assert digest(DEV / item["path"]) == item["sha256"]
    recordings = []
    def visit(value):
        if isinstance(value, dict):
            if "observed_frames" in value and "files" in value:
                assert value["skipped_capture_errors"] == 0 and value["distinct_frames"] > 1
                for item in value["files"]:
                    assert digest(DEV / item["path"]) == item["sha256"]
                recordings.append(value)
            else:
                for child in value.values():
                    visit(child)
        elif isinstance(value, list):
            for child in value:
                visit(child)
    visit(native)
    assert len(folder["recordings"]) == 2
    packaged = native_report["packaged"]
    assert packaged["repository_media_excluded"] and packaged["runtime_assets_match_source"]
    assert len(packaged["runtime_asset_files"]) == 14
    old_packaged = read(DELIVERY / "evidence/desktop-local-ui-66.json")["packaged"]
    old_archive = (DELIVERY / old_packaged["executable"]).parent / "resources/app.asar"
    assert digest(old_archive) == old_packaged["app_asar_sha256"]
    new_archive = (DELIVERY / packaged["executable"]).parent / "resources/app.asar"
    assert digest(new_archive) == packaged["app_asar_sha256"] and new_archive.stat().st_size == packaged["app_asar_bytes"]
    result = {"at": datetime.now(timezone.utc).isoformat(), "stage": 87,
        "status": "verified_local_folder_work_and_native_navigation",
        "scope": "Customer-local watched-file queue, explicit questions, snapshots, same-thread continuation, actual app restart, budget caps, revocation, native keyboard access and runtime packaging. Synthetic providers/dialog decisions remain explicit; full product acceptance stays open.",
        "selected": selected, "source_files": dict(sorted(sources.items())), "qualification_scopes": scopes,
        "desktop_ui_checks": 57, "desktop_unit_tests": native_unit, "client_unit_tests": client_tests,
        "original_desktop_50_checks_preserved": True, "original_desktop_69_unit_cases_preserved": True,
        "native_folder_work": folder, "screenshots": screenshots, "recordings": recordings,
        "retained_stage86": {"checkpoint": ref(historical_file), "qualification_scopes": retained,
            "unchanged_product_components": list(unchanged_components), "exact_unchanged_product_sources": len(retained_sources),
            "platform_cases": 1023, "focused_cases": 25, "compatibility_cases": 36, "web_admin_sidepanel_checks": 14,
            "rerun_this_stage": False},
        "packaging": {"current": packaged, "old_attempt": "66", "old_app_asar_bytes": old_archive.stat().st_size,
            "new_app_asar_bytes": new_archive.stat().st_size, "all_runtime_assets_and_licenses_byte_matched": True,
            "repository_media_still_preserved_outside_runtime": True},
        "preserved_baseline": {"receipt": ref(baseline_file), "exact_archives": len(baseline["files"]),
            "migrations": 103, "contracts": 532, "original_requirements": 102},
        "acceptance": {"fully_accepted": 0, "qualified_roles": 0, "G01_G10": "not_proven", "complete_Desktop_parity": "not_qualified"},
        "limitations": ["structured-argv approved-program registry remains incomplete", "complete crash/offline/sleep matrix",
            "all professional roles and live media quality", "complete Admin breadth, teams and solution packages",
            "signed installation/upgrade/uninstall, performance and disaster recovery", "all original 102 cases and release gates"],
        "verifier_sha256": digest(Path(__file__))}
    with output.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": result["status"], "sources": len(sources), "desktop_checks": 57,
                      "client_tests": client_tests, "recordings": len(recordings)}))


if __name__ == "__main__":
    main()
