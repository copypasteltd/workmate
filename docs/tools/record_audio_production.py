"""Bind actual audio, client, native and complete regression evidence."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re

from record_desktop_browser import batch_cases, bound

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"


def read(file):
    return json.loads(file.read_text(encoding="utf-8"))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    for name in ["core", "compatibility", "ui", "desktop", "clients", "control"]:
        parser.add_argument("--" + name, required=True)
    args = vars(parser.parse_args())
    assert all(re.fullmatch(r"\d{2}", value) for value in args.values())
    output = ROOT / "docs/quality/audio-production-checkpoint.json"
    assert not output.exists()
    selected = {
        "core": f"evidence/audio-production-checks-{args['core']}.json",
        "compatibility": f"evidence/audio-production-checks-{args['compatibility']}.json",
        "web_admin_sidepanel": f"evidence/audio-production-ui-{args['ui']}.json",
        "desktop_ui": f"evidence/desktop-local-ui-{args['desktop']}.json",
        "clients": f"evidence/history-source-clients-{args['clients']}.json",
        "platform": f"evidence/desktop-execution-control-{args['control']}.json",
    }
    reports = {key: read(DELIVERY / file) for key, file in selected.items()}
    skill_review_file = ROOT / "docs/quality/audio-production-skill-expectation-review.json"
    skill_review = read(skill_review_file)
    assert skill_review["status"] == "verified_additive_skill_revision_counts" and skill_review["literal_changes"] == 2
    assert skill_review["product_source_changes"] == skill_review["removed_or_weakened_functional_assertions"] == 0
    assert skill_review["verifier_sha256"] == digest(ROOT / "docs/tools/review_audio_skill_expectation.py")
    assert digest(ROOT / skill_review["before"]["archive"]) == skill_review["before"]["sha256"]
    assert digest(ROOT / skill_review["test_file"]) == skill_review["after_sha256"]
    sources, scopes = {}, []
    for key, report in reports.items():
        assert report["status"] == "passed" and report["source_unchanged"], key
        if "owned_database_shutdown" in report:
            assert report["owned_database_shutdown"], key
        if "counts" in report and "tests" in report["counts"]:
            c = report["counts"]
            assert c["tests"] == c["pass"] > 0
            assert all(c[item] == 0 for item in ["fail", "cancelled", "skipped", "todo"])
        unexecuted_test_differences = []
        for name, value in report["source_files"].items():
            if key == "clients":
                component, relative = name.split("/", 1)
                file = DEV / ("copypaste-" + component) / relative
            else:
                file = ROOT / name if name.startswith(("docs/", "dev/")) else DEV / name
            relative = file.relative_to(ROOT).as_posix()
            current_value = digest(file)
            if current_value != value:
                assert key != "platform" and relative == skill_review["test_file"], (key, name)
                assert value == skill_review["before"]["sha256"] and current_value == skill_review["after_sha256"]
                assert "tests/skill-lifecycle.test.ts" not in report.get("files", [])
                assert not any(row.get("repository") == "platform" and row.get("check") == "test" for row in report.get("checks", []))
                unexecuted_test_differences.append(relative)
                value = current_value
            assert relative not in sources or sources[relative] == value
            sources[relative] = value
        for field in ["raw_report", "raw_log", "verifier", "journey_verifier", "journey"]:
            if isinstance(report.get(field), dict) and "path" in report[field]:
                bound(report[field])
        scopes.append({"scope": key, "report": selected[key], "sha256": digest(DELIVERY / selected[key]),
                       "source_files": len(report["source_files"]), "current_runtime_and_executed_test_sources_exact": True,
                       "unexecuted_reviewed_test_differences": unexecuted_test_differences})
    assert reports["core"]["phase"] == "core" and reports["core"]["counts"]["tests"] == 43
    assert reports["compatibility"]["phase"] == "compatibility" and reports["compatibility"]["counts"]["tests"] == 80
    full = reports["platform"]
    assert full["execution_strategy"] == "complete_file_inventory_with_reviewed_skill_expectation_update"
    assert full["composition_verifier"]["path"] == "docs/tools/compose_audio_requalification.py"
    assert full["test_expectation_review"]["path"] == skill_review_file.relative_to(ROOT).as_posix()
    for row in [full["composition_verifier"], full["test_expectation_review"], *full["composition_dependencies"]]:
        file = (ROOT / row["path"]).resolve()
        assert file.is_relative_to(ROOT) and digest(file) == row["sha256"]
    index = read(bound(full["raw_report"]))
    plan = read(bound(index["plan"]))
    actual = batch_cases(index)
    previous = batch_cases(read(bound(read(DELIVERY / "evidence/desktop-execution-control-34.json")["raw_report"])))
    assert sum(previous.values()) == 968 and not previous - actual
    assert sum(actual.values()) == full["counts"]["tests"]
    assert "tests/audio-production.test.ts" in plan["files"]
    assert len(plan["files"]) == 77 and len(plan["batches"]) == 20
    assert len(index["qualification_scopes"]) == 20
    for batch, scope in zip(index["batches"], index["qualification_scopes"], strict=True):
        assert batch["batch"] == scope["batch"] and scope["current_runtime_and_executed_test_sources_exact"]
        assert scope["unexecuted_test_fixture_differences"] == (["copypaste-platform/tests/skill-lifecycle.test.ts"] if int(scope["batch"]) <= 16 else [])
    native = read(bound(reports["desktop_ui"]["journey"]))
    web = reports["web_admin_sidepanel"]["journey"]
    assert len(native["checks"]) == 40 and len(web["checks"]) == 10
    assert not native["errors"] and not web["errors"]
    assert all(native[key] for key in ["electron_closed", "browser_closed", "api_closed", "fixture_closed", "native_browser_fixture_closed"])
    assert all(web[key] for key in ["browser_closed", "api_closed", "fixture_closed", "provider_closed"])
    assert web["side_panel"]["side"] == "right" and web["side_panel"]["context_type"] == "SIDE_PANEL"
    assert web["side_panel"]["owned_context_closed"]
    assert len(native["native_audio_tool_results"]) == len(web["native_tool_results"]) == 2
    for key, field in [("desktop_ui", "owned_preview_closed"), ("web_admin_sidepanel", "owned_previews_closed")]:
        report = reports[key]
        assert report[field]
        assert report["fixture_cleanup"]["status"] == "passed"
        assert all(row["reclaimed"] for row in report["fixture_cleanup"]["results"])
    client_cases = 0
    for item in reports["clients"]["checks"]:
        assert item["exit_code"] == 0 and digest(DELIVERY / item["raw_report"]) == item["raw_sha256"]
        if item["counts"]:
            c = item["counts"]
            assert c["tests"] == c["pass"] > 0
            assert all(c[key] == 0 for key in ["fail", "cancelled", "skipped", "todo"])
            client_cases += c["tests"]
    baseline_file = ROOT / "docs/quality/history/stage84-before-audio/receipt.json"
    baseline = read(baseline_file)
    assert len(baseline["published_migrations"]) == 100
    for name, value in baseline["published_migrations"].items():
        assert digest(DEV / "copypaste-platform/migrations" / name) == value
    for name, value in baseline["original_openapi"].items():
        assert digest(ROOT / name) == value
    for item in baseline["files"]:
        assert digest(ROOT / item["archive"]) == item["sha256"]
    contract_file = ROOT / f"docs/quality/audio-production-contract-{args['ui']}.json"
    contract = read(contract_file)
    assert contract["status"] == "passed_real_audio_http_samples"
    assert (ROOT / "docs/contracts/audio-production-openapi.json").read_bytes() == (DEV / "copypaste-platform/contracts/audio-production-openapi.json").read_bytes()
    inventory_file = ROOT / "docs/contracts/implemented-routes.json"
    assert inventory_file.read_bytes() == (DEV / "copypaste-platform/contracts/implemented-routes.json").read_bytes()
    inventory = read(inventory_file)
    configured = {(v["method"], v["path"]) for v in inventory["routes"]}
    conditional = {(v["method"], v["path"]) for v in inventory["conditional_routes"]}
    routes = {(v["method"], v["path"]) for v in web["route_inventory"]["routes"]}
    assert routes == configured and len(routes) == 472 and len(conditional) == 1
    assert len([row for row in configured if "/audio-jobs" in row[1]]) == 7
    recordings = [*web["media"], native["audio_media"]]
    screenshots = web["screenshots"]
    layout = [row for row in native["screenshots"] if "-audio-" in row["path"] or "-layout-" in row["path"] or "-generated-progress-" in row["path"]]
    assert len(recordings) == 4 and len([row for row in layout if "-audio-" in row["path"]]) == 4
    copies = []
    for item in screenshots + layout + [file for media in recordings for file in media["files"]]:
        source = DEV / item["path"]
        assert digest(source) == item["sha256"]
        target = ROOT / "docs/design/implementation" / (Path(item["path"]).parts[0] + "__" + source.name)
        if target.exists():
            assert digest(target) == item["sha256"]
        else:
            target.write_bytes(source.read_bytes())
        copies.append({"source": item["path"], "path": target.relative_to(ROOT).as_posix(), "sha256": item["sha256"]})
    for media in recordings:
        assert media["skipped_capture_errors"] == 0 and media["distinct_frames"] > 1
    visual = ROOT / "docs/quality/audio-production-visual-review.md"
    assert visual.exists()
    media_file = ROOT / "docs/quality/audio-production-media-review.json"
    media_review = read(media_file)
    assert media_review["status"] == "passed" and not media_review["raw_media_modified"]
    assert len(media_review["recordings"]) == 4
    assert {row["sha256"] for row in media_review["sources"]} == {digest(DELIVERY / selected[key]) for key in ["web_admin_sidepanel", "desktop_ui"]}
    capture_file = ROOT / "docs/quality/audio-capture-verifier-review.json"
    capture_review = read(capture_file)
    assert capture_review["status"] == "verified_actual_theme_capture_correction"
    assert digest(ROOT / capture_review["after"]["path"]) == capture_review["after"]["sha256"]
    legacy_file = ROOT / "docs/quality/audio-production-legacy-test-review.json"
    legacy_review = read(legacy_file)
    assert legacy_review["status"] == "verified_additive_audio_test_expectations" and legacy_review["old_functional_assertions_removed"] == 0
    for row in legacy_review["files"]:
        assert digest(ROOT / row["path"]) == row["after_sha256"]
        assert digest(ROOT / row["before"]["archive"]) == row["before"]["sha256"]
    result = {"at": datetime.now(timezone.utc).isoformat(), "stage": 84,
        "status": "verified_internal_audio_subflow",
        "scope": "Internal speech/file transcription, actual local/cloud Codex tool loops, retained original WAV/transcripts and manual revisions, current source/privacy/budget gates, independent audited Admin body/cost permissions, real native right Side Panel, frameless local Desktop reflow and focus preservation with no visible scrollbar rails. Synthetic tone/ASR/reasoning; full original acceptance remains open.",
        "selected": selected, "source_files": dict(sorted(sources.items())), "qualification_scopes": scopes,
        "platform_tests": full["counts"], "previous_platform_cases_preserved": 968,
        "platform_files": len(plan["files"]), "platform_batches": len(plan["batches"]),
        "platform_qualification_strategy": full["execution_strategy"], "platform_batch_source_scopes": index["qualification_scopes"],
        "core_tests": reports["core"]["counts"], "compatibility_tests": reports["compatibility"]["counts"],
        "client_counts": client_cases, "web_admin_sidepanel_checks": len(web["checks"]), "desktop_ui_checks": len(native["checks"]),
        "packaged": reports["desktop_ui"]["packaged"],
        "screenshots": screenshots, "layout_screenshots": layout, "recordings": recordings, "documentation_media": copies,
        "published_migrations_preserved": 100, "baseline": {"path": baseline_file.relative_to(ROOT).as_posix(), "sha256": digest(baseline_file)},
        "contract_validation": {"path": contract_file.relative_to(ROOT).as_posix(), "sha256": digest(contract_file)},
        "complete_route_inventory": {"path": inventory_file.relative_to(ROOT).as_posix(), "sha256": digest(inventory_file), "configured": 472, "conditional": 1},
        "visual_review": {"path": visual.relative_to(ROOT).as_posix(), "sha256": digest(visual)},
        "media_review": {"path": media_file.relative_to(ROOT).as_posix(), "sha256": digest(media_file)},
        "capture_review": {"path": capture_file.relative_to(ROOT).as_posix(), "sha256": digest(capture_file)},
        "legacy_test_review": {"path": legacy_file.relative_to(ROOT).as_posix(), "sha256": digest(legacy_file)},
        "skill_test_review": {"path": skill_review_file.relative_to(ROOT).as_posix(), "sha256": digest(skill_review_file)},
        "original_acceptance": {"requirements": 102, "cases": 102, "partially_verified": 83, "not_proven": 19, "fully_accepted": 0, "gates_G01_G10": "not_proven"},
        "not_validated": ["live_voice_and_Cantonese_quality", "independent_human_rights_confirmation", "managed_audio_validation_publication_rollback", "unknown_POST_external_bill_review_and_recovery_delivery", "all_professional_roles", "signed_installer", "complete_Codex_Desktop_parity", "performance_capacity_and_original_acceptance"],
        "verifier_sha256": digest(Path(__file__))}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": result["status"], "sources": len(sources), "platform_tests": full["counts"]["tests"], "client_tests": client_cases, "screenshots": len(screenshots), "layout": len(layout)}))


if __name__ == "__main__":
    main()
