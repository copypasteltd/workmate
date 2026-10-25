"""Bind actual native program/browser evidence to current source, retaining full acceptance gates."""
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import argparse
import json
from pathlib import Path
import re
import subprocess

from record_folder_work import ROOT, DEV, DELIVERY, read, digest, ref, source, linked, passing


def totals(text):
    fields = ("tests", "pass", "fail", "cancelled", "skipped", "todo")
    values = {key: [int(v) for v in re.findall(r"^# " + key + r" (\d+)\s*$", text, re.M)] for key in fields}
    assert len({len(v) for v in values.values()}) == 1
    result = [{key: values[key][index] for key in fields} for index in range(len(values["tests"]))]
    for item in result:
        passing(item)
    return result


def text(file):
    value = file.read_bytes()
    return value.decode("utf-16") if value.startswith((b"\xff\xfe", b"\xfe\xff")) else value.decode("utf-8-sig")


def main():
    parser = argparse.ArgumentParser()
    for name in ("desktop", "clients", "server"):
        parser.add_argument("--" + name, required=True)
    args = parser.parse_args()
    assert all(re.fullmatch(r"\d{2}", value) for value in vars(args).values())
    output = ROOT / "docs/quality/local-programs-checkpoint.json"
    assert not output.exists(), "Retain all previous qualification receipts"
    selected = {"desktop_ui": f"evidence/desktop-local-ui-{args.desktop}.json", "clients": f"evidence/history-source-clients-{args.clients}.json",
                "server": f"evidence/desktop-execution-control-{args.server}.json"}
    reports = {key: read(DELIVERY / value) for key, value in selected.items()}
    sources, scopes = {}, []
    for key, value in reports.items():
        assert value["status"] == "passed" and value["source_unchanged"], key
        for name, expected in value["source_files"].items():
            file = source(name); assert digest(file) == expected, (key, name)
            relative = file.relative_to(ROOT).as_posix()
            assert relative not in sources or sources[relative] == expected
            sources[relative] = expected
        for field in ("raw_report", "verifier", "journey_verifier", "journey", "fixture_cleanup"):
            if isinstance(value.get(field), dict) and "path" in value[field]:
                linked(value[field])
        scopes.append({"scope": key, "report": selected[key], "sha256": digest(DELIVERY / selected[key]), "source_files": len(value["source_files"]), "all_recorded_sources_exact": True})
    report = reports["desktop_ui"]
    assert report["packaged_unchanged"] and report["owned_database_shutdown"] and report["owned_preview_closed"]
    assert report["fixture_cleanup"]["status"] == "passed" and all(row["reclaimed"] for row in report["fixture_cleanup"]["results"])
    native = read(linked(report["journey"]))
    assert native["status"] == "passed" and len(native["checks"]) == 68 and not native["errors"]
    assert all(native[name] for name in ("electron_closed", "browser_closed", "api_closed", "fixture_closed", "native_browser_fixture_closed"))
    old = read(DELIVERY / "evidence/desktop-local-ui-69-journey.json")
    assert len(old["checks"]) == 57 and not Counter(old["checks"]) - Counter(native["checks"])
    raw = text(linked(report["raw_report"]))
    desktop, kernel = totals(raw)
    assert desktop["tests"] == 114 and kernel["tests"] == 18
    old_cases = Counter(re.findall(r"^# Subtest: (.+)$", text(DELIVERY / "evidence/desktop-local-ui-69.tap"), re.M))
    current_cases = Counter(re.findall(r"^# Subtest: (.+)$", raw, re.M))
    assert sum(old_cases.values()) == 91 and not old_cases - current_cases
    before_native = read(ROOT / "docs/quality/history/stage88-before-local-programs/receipt.json")["input_commits"]["dev/copypaste-desktop"]
    original_kernel = subprocess.check_output(["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "show", before_native + ":tests/integration/local-codex.native.test.ts"], cwd=DEV / "copypaste-desktop").decode("utf-8")
    old_kernel_names = re.findall(r'^test\("([^\"]+)"', original_kernel, re.M)
    loops = re.findall(r'for \(const (\w+) of (\[[^\]]+\]) as const\) test\(`([^`]+)`', original_kernel)
    assert len(loops) == original_kernel.count("test(`") == 1
    for variable, values, template in loops:
        assert "${" + variable + "}" in template
        old_kernel_names.extend(template.replace("${" + variable + "}", value) for value in json.loads(values))
    assert len(old_kernel_names) == 17 and all(name in current_cases for name in old_kernel_names)
    client_total = 0
    for row in reports["clients"]["checks"]:
        assert row["exit_code"] == 0 and digest(DELIVERY / row["raw_report"]) == row["raw_sha256"]
        if row["counts"]:
            passing(row["counts"]); client_total += row["counts"]["tests"]
    assert client_total == 184
    passing(reports["server"]["counts"])
    assert reports["server"]["owned_database_shutdown"] and reports["server"]["native_binary_exercised"]
    policy_file = DELIVERY / "evidence/desktop-program-policy-01.tap"
    policy_counts, = totals(text(policy_file)); assert policy_counts["tests"] >= 6
    programs, browser = native["native_programs"], native["native_browser_resources"]
    assert programs["no_cloud_replacement_tasks"] and programs["owned_programs_closed"] and not programs["human_native_dialog_clicks"]
    assert [row["state"] for row in programs["receipts"]] == ["succeeded", "failed", "cancelled", "cancelled"]
    assert len({row["taskId"] for row in programs["receipts"]}) == 4
    good = programs["receipts"][0]
    actual_file = Path(good["argv"][1])
    actual_bytes = actual_file.read_bytes()
    actual = json.loads(actual_bytes.decode("utf-8"))
    assert actual == {"args": good["argv"][3:], "token": False} and good["exitCode"] == 0
    assert "ACTUAL_APPROVED_PROGRAM_COMPLETE" in good["stdout"] and programs["receipts"][1]["exitCode"] == 7
    assert all(row["actual_output"] for row in programs["actual_outputs"])
    assert {row["tool"] for row in programs["actual_outputs"]} >= {"list", "run", "status", "denied"}
    assert browser["actual_contexts_at_limit"] == 2 and browser["all_owned_pages_closed"] and len(browser["receipts"]) == 4
    assert all(row["actual_output"] for row in browser["actual_outputs"])
    assert {row["action"] for row in browser["actual_outputs"]} >= {"overflow", "check_denied", "check_allowed", "read_storage", "tabs"}
    folder = native["native_folder_work"]
    assert folder["charged_micros"] == ["90", "60"] and folder["additional_cloud_tasks"] == 0 and folder["same_native_thread"]
    assert folder["application_restart"]["old_owned_process_exited"] and folder["application_restart"]["old_pid"] != folder["application_restart"]["new_pid"]
    packaged = report["packaged"]
    assert packaged["runtime_assets_match_source"] and packaged["repository_media_excluded"] and len(packaged["runtime_asset_files"]) == 14
    resources = (DELIVERY / packaged["executable"]).parent / "resources"
    assert digest(resources / "app.asar") == packaged["app_asar_sha256"]
    guardian = packaged["program_guardian"]
    assert digest(resources / "local-program-host/local-program-host.exe") == guardian["sha256"]
    assert digest(resources / "local-program-host/manifest.json") == guardian["manifest_sha256"]
    assert digest(DEV / "copypaste-desktop/src/local-program-host.cs") == guardian["source_sha256"]
    preserved = ROOT / "docs/quality/history/stage88-before-local-programs/receipt.json"
    baseline = read(preserved)
    for row in baseline["files"]:
        assert digest(ROOT / row["archive"]) == row["sha256"] and (ROOT / row["archive"]).stat().st_size == row["bytes"]
    published = read(ROOT / "docs/quality/history/stage87-before-folder-work/receipt.json")
    for group, count in (("published_migrations", 103), ("published_contracts", 532)):
        assert len(published[group]) == count
        for name, expected in published[group].items(): assert digest(ROOT / name) == expected, name
    progress = read(ROOT / "docs/quality/requirements-alignment-progress.json")
    fields = ("requirement_id", "priority", "requirement", "acceptance_case", "acceptance_conditions")
    assert [{name: row[name] for name in fields} for row in progress["requirements"]] == published["original_requirements"]
    assert progress["summary"] == {"partial_verified": 86, "completion_not_proven": 16}
    assert progress["fully_accepted_requirements"] == progress["qualified_live_roles"] == 0
    assert len(progress["gates"]) == 10 and all(row["full_acceptance"] == "not_proven" for row in progress["gates"])
    recordings = []
    def visit(value):
        if isinstance(value, dict):
            if "observed_frames" in value and "files" in value:
                assert value["distinct_frames"] > 1 and value["skipped_capture_errors"] == 0
                for row in value["files"]: assert digest(DEV / row["path"]) == row["sha256"]
                recordings.append(value)
            else:
                for child in value.values(): visit(child)
        elif isinstance(value, list):
            for child in value: visit(child)
    visit(native)
    for row in native["screenshots"]: assert digest(DEV / row["path"]) == row["sha256"]
    retained = read(ROOT / "docs/quality/folder-work-checkpoint.json")
    unchanged = {name: expected for name, expected in retained["source_files"].items() if name.split("/")[1] in ("copypaste-web", "copypaste-admin", "copypaste-extension")}
    assert all(digest(ROOT / name) == expected for name, expected in unchanged.items())
    result = {"at": datetime.now(timezone.utc).isoformat(), "stage": 88, "status": "verified_native_programs_and_browser_resources",
              "scope": "Customer-approved pinned native programs, structured argv, real process ownership/stop/revocation/parent loss, original billing, exact browser page/context quotas and reset; synthetic model/dialog choices remain explicit.",
              "selected": selected, "source_files": dict(sorted(sources.items())), "qualification_scopes": scopes,
              "desktop_ui_checks": 68, "desktop_unit_tests": desktop, "native_codex_tests": kernel, "client_unit_tests": client_total,
              "server_checks": reports["server"]["counts"], "policy_checks": {"raw_report": ref(policy_file), "counts": policy_counts},
              "original_desktop_57_checks_preserved": True, "original_desktop_91_unit_cases_preserved": True, "original_native_17_cases_preserved": True,
              "native_programs": programs, "native_browser_resources": browser, "native_folder_work": folder,
              "screenshots": native["screenshots"], "recordings": recordings, "packaging": packaged,
              "preserved_baseline": {"receipt": ref(preserved), "archives": len(baseline["files"]), "migrations": 103, "contracts": 532, "original_requirements": 102},
              "retained_historical": {"checkpoint": ref(ROOT / "docs/quality/folder-work-checkpoint.json"), "stage86_platform_cases": 1023,
                  "current_full_platform_regression_rerun": False, "web_admin_sidepanel_checks": 14, "unchanged_product_components": ["web", "admin", "extension"], "exact_unchanged_product_sources": len(unchanged)},
              "acceptance": {"fully_accepted": 0, "qualified_roles": 0, "G01_G10": "not_proven", "complete_Desktop_parity": "not_qualified"},
              "limitations": ["Windows x64 and native .NET Framework guardian; other operating systems unqualified", "full crash/offline/sleep/application-operation matrix", "all professional roles and actual model/media/customer quality", "complete Admin breadth, teams and solutions", "signed installation/update/uninstall, performance and actual disaster recovery", "all 102 original complete cases and G01-G10"],
              "verifier_sha256": digest(Path(__file__))}
    actual_archive = ROOT / "docs/quality/history/stage88-native-program-output/output.json.snapshot"
    actual_receipt = actual_archive.parent / "receipt.json"
    assert actual_file.is_relative_to(ROOT) and not actual_archive.exists() and not actual_receipt.exists()
    actual_archive.parent.mkdir(parents=True, exist_ok=True)
    actual_archive.write_bytes(actual_bytes)
    provenance = {"at": result["at"], "scope": "Exact real native-program output bytes from the selected packaged journey; synthetic test input only",
                  "files": [{"path": actual_file.relative_to(ROOT).as_posix(), "archive": actual_archive.relative_to(ROOT).as_posix(),
                             "sha256": sha256(actual_bytes).hexdigest(), "bytes": len(actual_bytes)}]}
    actual_receipt.write_text(json.dumps(provenance, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    result["native_program_output_file"] = {"archive": ref(actual_archive), "provenance": ref(actual_receipt), "value": actual}
    with output.open("x", encoding="utf-8", newline="\n") as stream: stream.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": result["status"], "source_files": len(sources), "desktop": 68, "unit": 114, "native": 18, "clients": client_total, "server": reports["server"]["counts"]["tests"]}))


if __name__ == "__main__": main()
