"""Bind current customer-confirmation, native-layout and regression evidence."""
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


def ref(file):
    return {"path": file.relative_to(ROOT).as_posix(), "sha256": digest(file)}


def main():
    parser = argparse.ArgumentParser()
    for name in ["core", "compatibility", "ui", "desktop", "clients", "control"]:
        parser.add_argument("--" + name, required=True)
    args = vars(parser.parse_args())
    assert all(re.fullmatch(r"\d{2}", value) for value in args.values())
    output = ROOT / "docs/quality/audio-authorizations-checkpoint.json"
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
    sources, scopes = {}, []
    for key, report in reports.items():
        assert report["status"] == "passed" and report["source_unchanged"], key
        if "owned_database_shutdown" in report:
            assert report["owned_database_shutdown"], key
        if "tests" in report.get("counts", {}):
            count = report["counts"]
            assert count["tests"] == count["pass"] > 0
            assert all(count[name] == 0 for name in ["fail", "cancelled", "skipped", "todo"])
        for name, value in report["source_files"].items():
            if key == "clients":
                component, relative = name.split("/", 1)
                file = DEV / ("copypaste-" + component) / relative
            else:
                file = ROOT / name if name.startswith(("docs/", "dev/")) else DEV / name
            assert file.resolve().is_relative_to(ROOT) and digest(file) == value, (key, name)
            relative = file.relative_to(ROOT).as_posix()
            assert relative not in sources or sources[relative] == value
            sources[relative] = value
        for field in ["raw_report", "raw_log", "verifier", "journey_verifier", "journey"]:
            if isinstance(report.get(field), dict) and "path" in report[field]:
                bound(report[field])
        scopes.append({"scope": key, "report": selected[key], "sha256": digest(DELIVERY / selected[key]),
            "source_files": len(report["source_files"]), "all_recorded_sources_exact": True, "later_source_differences": []})
    assert reports["core"]["phase"] == "core" and reports["core"]["counts"]["tests"] == 56
    assert reports["compatibility"]["phase"] == "compatibility" and reports["compatibility"]["counts"]["tests"] == 80
    full = reports["platform"]
    assert full["execution_strategy"] == "resumable_complete_file_inventory"
    index = read(bound(full["raw_report"]))
    plan = read(bound(index["plan"]))
    actual = batch_cases(index)
    previous_report = read(DELIVERY / "evidence/desktop-execution-control-36.json")
    previous = batch_cases(read(bound(previous_report["raw_report"])))
    assert sum(previous.values()) == 988 and not previous - actual
    assert sum(actual.values()) == full["counts"]["tests"] == 1001
    assert len(plan["files"]) == 78 and len(plan["batches"]) == len(index["batches"]) == 20
    assert {"tests/audio-production.test.ts", "tests/audio-authorization-upgrade.test.ts"} <= set(plan["files"])
    native = read(bound(reports["desktop_ui"]["journey"]))
    web = reports["web_admin_sidepanel"]["journey"]
    assert len(native["checks"]) == 41 and len(web["checks"]) == 13
    assert not native["errors"] and not web["errors"]
    assert all(native[key] for key in ["electron_closed", "browser_closed", "api_closed", "fixture_closed", "native_browser_fixture_closed"])
    assert all(web[key] for key in ["browser_closed", "api_closed", "fixture_closed", "provider_closed"])
    assert web["side_panel"]["context_type"] == "SIDE_PANEL" and web["side_panel"]["side"] == "right" and web["side_panel"]["owned_context_closed"]
    assert len(native["native_audio_tool_results"]) == 2 and len(web["native_tool_results"]) == 3
    for key, field in [("desktop_ui", "owned_preview_closed"), ("web_admin_sidepanel", "owned_previews_closed")]:
        assert reports[key][field] and reports[key]["fixture_cleanup"]["status"] == "passed"
        assert all(row["reclaimed"] for row in reports[key]["fixture_cleanup"]["results"])
    client_cases = 0
    for item in reports["clients"]["checks"]:
        assert item["exit_code"] == 0 and digest(DELIVERY / item["raw_report"]) == item["raw_sha256"]
        if item["counts"]:
            count = item["counts"]
            assert count["tests"] == count["pass"] > 0 and all(count[key] == 0 for key in ["fail", "cancelled", "skipped", "todo"])
            client_cases += count["tests"]
    assert client_cases == 124
    baseline_file = ROOT / "docs/quality/history/stage85-before-audio-controls/receipt.json"
    baseline = read(baseline_file)
    assert len(baseline["published_migrations"]) == 101 and len(baseline["published_contracts"]) == 4
    for name, value in baseline["published_migrations"].items():
        assert digest(DEV / "copypaste-platform/migrations" / name) == value
    for name, value in baseline["published_contracts"].items():
        assert digest(ROOT / name) == value
    for item in baseline["files"]:
        assert digest(ROOT / item["archive"]) == item["sha256"]
    inventory_file = ROOT / "docs/contracts/implemented-routes.json"
    assert inventory_file.read_bytes() == (DEV / "copypaste-platform/contracts/implemented-routes.json").read_bytes()
    inventory = read(inventory_file)
    assert len(inventory["routes"]) == 479 and len(inventory["conditional_routes"]) == 1
    assert {(row["method"], row["path"]) for row in web["route_inventory"]["routes"]} == {(row["method"], row["path"]) for row in inventory["routes"]}
    contract_file = ROOT / f"docs/quality/audio-authorizations-contract-{args['ui']}.json"
    assert read(contract_file)["status"] == "passed_current_audio_authorization_http"
    expectation_file = ROOT / "docs/quality/audio-authorizations-expectation-review.json"
    assert read(expectation_file)["status"] == "verified_additive_audio_authorization_expectations"
    race_file = ROOT / "docs/quality/audio-authorizations-recovery-race.json"
    assert read(race_file)["status"] == "verified_real_row_lock_renewal_race_fix"
    role_catalog = ROOT / "docs/contracts/role-preset-catalog-current.json"
    assert role_catalog.read_bytes() == (DEV / "copypaste-platform/catalog/role-preset-catalog.json").read_bytes()
    media_file = ROOT / "docs/quality/audio-authorizations-media-review-02.json"
    media_review = read(media_file)
    assert media_review["status"] == "passed" and not media_review["raw_media_modified"] and len(media_review["recordings"]) == 4
    assert {row["sha256"] for row in media_review["sources"]} == {digest(DELIVERY / selected[key]) for key in ["web_admin_sidepanel", "desktop_ui"]}
    recordings = [*web["media"], native["audio_media"]]
    layout = [row for row in native["screenshots"] if any(value in row["path"] for value in ["-audio-", "-layout-", "-generated-progress-"])]
    assert len([row for row in layout if "-audio-consent-" in row["path"]]) == 3
    copies = []
    for row in [*web["screenshots"], *layout, *[item for media in recordings for item in media["files"]]]:
        source = DEV / row["path"]
        assert digest(source) == row["sha256"]
        target = ROOT / "docs/design/implementation" / (Path(row["path"]).parts[0] + "__" + source.name)
        if target.exists():
            assert digest(target) == row["sha256"]
        else:
            target.write_bytes(source.read_bytes())
        copies.append({"source": row["path"], "path": target.relative_to(ROOT).as_posix(), "sha256": row["sha256"]})
    visual_file = ROOT / "docs/quality/audio-authorizations-visual-review-02.md"
    assert visual_file.exists()
    result = {"at": datetime.now(timezone.utc).isoformat(), "stage": 85, "status": "verified_independent_customer_audio_confirmation",
        "scope": "Separate authenticated customer confirmation of exact audio intent and company quote, decline/expiry/Stop/revocation and truthful fee retention; actual cloud Web/native right Side Panel and packaged local-Codex Desktop with frameless, wrapping, rail-free accessible layouts. Explicit synthetic services and native-dialog decisions. Original complete acceptance remains open.",
        "selected": selected, "source_files": dict(sorted(sources.items())), "qualification_scopes": scopes,
        "platform_tests": full["counts"], "previous_platform_cases_preserved": 988, "platform_files": 78, "platform_batches": 20,
        "core_tests": reports["core"]["counts"], "compatibility_tests": reports["compatibility"]["counts"], "client_counts": client_cases,
        "web_admin_sidepanel_checks": 13, "desktop_ui_checks": 41, "packaged": reports["desktop_ui"]["packaged"],
        "screenshots": web["screenshots"], "layout_screenshots": layout, "recordings": recordings, "documentation_media": copies,
        "published_migrations_preserved": 101, "published_contracts_preserved": 4, "baseline": ref(baseline_file),
        "contract_validation": ref(contract_file), "complete_route_inventory": {**ref(inventory_file), "configured": 479, "conditional": 1},
        "visual_review": ref(visual_file), "media_review": ref(media_file), "expectation_review": ref(expectation_file),
        "current_role_catalog": ref(role_catalog),
        "recovery_race_review": ref(race_file),
        "original_acceptance": {"requirements": 102, "cases": 102, "partially_verified": 83, "not_proven": 19, "fully_accepted": 0, "gates_G01_G10": "not_proven"},
        "not_validated": ["live_voice_and_Cantonese_quality", "legal_ownership_verification", "managed_audio_validation_publication_rollback", "unknown_POST_external_bill_review_and_recovery_delivery", "all_professional_roles", "signed_installer", "complete_Codex_Desktop_parity", "performance_capacity_and_original_acceptance"],
        "verifier_sha256": digest(Path(__file__))}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": result["status"], "sources": len(sources), "platform_tests": 1001, "client_tests": client_cases, "actual_media_copies": len(copies)}))


if __name__ == "__main__":
    main()
