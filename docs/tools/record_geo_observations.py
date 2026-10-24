"""Bind current GEO/native/UI/regression receipts; preserve original acceptance."""
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
    for name in ["core", "ui", "desktop", "clients", "control"]:
        parser.add_argument("--" + name, required=True)
    args = vars(parser.parse_args())
    assert all(re.fullmatch(r"\d{2}", v) for v in args.values())
    output = ROOT / "docs/quality/geo-observation-checkpoint.json"
    assert not output.exists()
    selected = {"core": f"evidence/geo-observation-checks-{args['core']}.json", "web_admin_sidepanel": f"evidence/geo-observation-ui-{args['ui']}.json",
        "desktop_ui": f"evidence/desktop-local-ui-{args['desktop']}.json", "clients": f"evidence/history-source-clients-{args['clients']}.json",
        "platform": f"evidence/desktop-execution-control-{args['control']}.json"}
    reports = {key: read(DELIVERY / value) for key, value in selected.items()}
    migration_review_file = ROOT / "docs/quality/geo-observation-migration-expectation-review.json"
    migration_review = read(migration_review_file)
    assert migration_review["status"] == "verified_test_fixture_updates_only"
    assert migration_review["literal_changes"] == 3 and migration_review["product_source_changes"] == migration_review["removed_or_weakened_assertions"] == 0
    test_updates = {item["test_file"]: item for item in migration_review["test_updates"]}
    replacements = {"migrations.test.ts": (b"\n      99,", b"\n      100,", 2),
        "creative-feedback.test.ts": (b'await runMigrations(client, "098 to confirmed creative feedback");', b'await runMigrations(client, "098 to confirmed creative feedback", { throughVersion: 99 });', 1)}
    assert {Path(name).name for name in test_updates} == set(replacements)
    for name, item in test_updates.items():
        before_test = (ROOT / item["before"]["archive"]).read_bytes()
        assert sha256(before_test).hexdigest() == item["before"]["sha256"]
        old_literal, new_literal, count = replacements[Path(name).name]
        assert before_test.count(old_literal) == count and (ROOT / name).read_bytes() == before_test.replace(old_literal, new_literal)
    assert digest(ROOT / "docs/tools/repair_geo_migration_expectations.py") == migration_review["verifier_sha256"]
    sources, scopes = {}, []
    for key, report in reports.items():
        differences = []
        assert report["status"] == "passed" and report["source_unchanged"], key
        if "owned_database_shutdown" in report:
            assert report["owned_database_shutdown"], key
        if "counts" in report and "tests" in report["counts"]:
            c = report["counts"]
            assert c["tests"] == c["pass"] > 0 and all(c[k] == 0 for k in ["fail", "cancelled", "skipped", "todo"])
        for name, value in report["source_files"].items():
            if key == "clients":
                component, _, relative = name.partition("/")
                assert component in ["platform", "web", "admin", "desktop", "extension", "delivery"]
                file = DEV / ("copypaste-" + component) / relative
            else:
                file = ROOT / name if name.startswith(("docs/", "dev/")) else DEV / name
            actual = digest(file)
            name = file.relative_to(ROOT).as_posix()
            if actual != value:
                assert key != "platform" and name in test_updates, (key, name)
                item = test_updates[name]
                assert value == item["before"]["sha256"] and actual == item["after_sha256"]
                differences.append({"path": name, "qualified_sha256": value, "current_sha256": actual, "kind": item["kind"]})
            assert name not in sources or sources[name] == actual
            sources[name] = actual
        for field in ["raw_report", "raw_log", "verifier", "journey_verifier", "journey"]:
            if isinstance(report.get(field), dict) and "path" in report[field]:
                bound(report[field])
        scopes.append({"scope": key, "report": selected[key], "sha256": digest(DELIVERY / selected[key]), "source_files": len(report["source_files"]),
            "current_source_exact": not differences, "current_runtime_source_exact": True, "later_source_differences": differences})
    full = reports["platform"]
    assert full["execution_strategy"] in ["resumable_complete_file_inventory", "complete_file_inventory_with_reviewed_test_expectation_update"]
    assert all(sources[name] == item["after_sha256"] for name, item in test_updates.items())
    index = read(bound(full["raw_report"]))
    plan = read(bound(index["plan"]))
    if full["execution_strategy"] == "complete_file_inventory_with_reviewed_test_expectation_update":
        composer = full["composition_verifier"]
        assert composer["path"] == "docs/tools/compose_geo_test_requalification.py" and digest(ROOT / composer["path"]) == composer["sha256"]
        assert full["test_expectation_review"]["sha256"] == digest(migration_review_file)
        assert full["source_files"] == plan["source_files"]
        assert len(index["qualification_scopes"]) == len(index["batches"])
        for item, scope in zip(index["batches"], index["qualification_scopes"], strict=True):
            receipt = read(bound(item))
            source_plan = read(bound(scope["source_plan"]))
            assert scope["current_runtime_and_executed_test_sources_exact"] and scope["batch"] == item["batch"] == receipt["batch"]
            assert receipt["plan_sha256"] == scope["source_plan"]["sha256"]
            changed = [name for name in source_plan["source_files"] if source_plan["source_files"][name] != plan["source_files"][name]]
            allowed = {name.removeprefix("dev/") for name in test_updates}
            assert not changed or set(changed) == allowed
            assert all("copypaste-platform/" + name not in changed for name in receipt["files"])
            for name in receipt["files"]:
                key = "copypaste-platform/" + name
                assert source_plan["source_files"][key] == plan["source_files"][key] == digest(DEV / key)
    actual = batch_cases(index)
    previous = batch_cases(read(bound(read(DELIVERY / "evidence/desktop-execution-control-31.json")["raw_report"])))
    assert sum(previous.values()) == 946 and not previous - actual
    assert sum(actual.values()) == full["counts"]["tests"]
    assert {"tests/geo-model.test.ts", "tests/geo-observations.test.ts"} <= set(plan["files"])
    assert reports["core"]["phase"] == "core" and reports["core"]["counts"]["tests"] >= 22
    desktop = read(bound(reports["desktop_ui"]["journey"]))
    web = reports["web_admin_sidepanel"]["journey"]
    assert len(desktop["checks"]) == 37 and len(web["checks"]) == 13
    assert all(desktop[k] for k in ["electron_closed", "browser_closed", "api_closed", "fixture_closed", "native_browser_fixture_closed"])
    assert all(web[k] for k in ["browser_closed", "api_closed", "fixture_closed"])
    assert not desktop["errors"] and not web["errors"]
    assert web["side_panel"]["side"] == "right" and web["side_panel"]["context_type"] == "SIDE_PANEL" and web["side_panel"]["owned_context_closed"]
    for key in ["desktop_ui", "web_admin_sidepanel"]:
        report = reports[key]
        assert report["owned_preview_closed"] if key == "desktop_ui" else report["owned_previews_closed"]
        cleanup = report["fixture_cleanup"]
        assert cleanup["status"] == "passed" and all(v["reclaimed"] for v in cleanup["results"])
    client_cases = 0
    for item in reports["clients"]["checks"]:
        assert item["exit_code"] == 0 and digest(DELIVERY / item["raw_report"]) == item["raw_sha256"]
        if item["counts"]:
            c = item["counts"]
            assert c["tests"] == c["pass"] > 0 and all(c[k] == 0 for k in ["fail", "cancelled", "skipped", "todo"])
            client_cases += c["tests"]
    baseline = read(ROOT / "docs/quality/creative-feedback-checkpoint.json")
    migrations = {name: value for name, value in baseline["source_files"].items() if "/migrations/" in name}
    assert len(migrations) == 99
    for name, value in migrations.items():
        assert digest(ROOT / name) == value
    for file, expected in [(ROOT / "docs/contracts/openapi.json", "51dd90f26137798dd23c4e881b7f9f0b20f99ad4b9fee0cce98686e11873aab4"),
        (DEV / "copypaste-platform/catalog/openapi.json", "7ce0b4cb170cdebc07aa4ee8f8810f24dbf996d95128519da184d7b2eb62156b")]:
        assert digest(file) == expected
    assert digest(ROOT / "docs/contracts/geo-observation-openapi.json") == digest(DEV / "copypaste-platform/contracts/geo-observation-openapi.json")
    routes = web["route_inventory"]["routes"]
    unique = {(v["method"], v["path"]) for v in routes}
    assert len(unique) == len(routes)
    geo_routes = sorted([v for v in routes if "/geo/" in v["path"]], key=lambda v: (v["path"], v["method"]))
    assert len(geo_routes) == 11
    inventory_file = ROOT / "docs/contracts/implemented-routes.json"
    assert inventory_file.read_bytes() == (DEV / "copypaste-platform/contracts/implemented-routes.json").read_bytes()
    inventory = read(inventory_file)
    configured = {(v["method"], v["path"]) for v in inventory["routes"]}
    conditional = {(v["method"], v["path"]) for v in inventory["conditional_routes"]}
    assert len(configured) == 465 and len(conditional) == 1 and configured.isdisjoint(conditional)
    assert unique == configured | conditional
    repair_file = ROOT / "docs/quality/geo-observation-inventory-repair.json"
    repair = read(repair_file)
    assert repair["status"] == "refreshed_from_actual_app" and repair["new_sha256"] == digest(inventory_file)
    assert repair["previous_routes_preserved"] == 455 and len(repair["added_geo_operations"]) == 11
    assert repair["verifier_sha256"] == digest(ROOT / "docs/tools/refresh_geo_route_inventory.py")
    route_file = ROOT / "docs/quality/geo-observation-route-inventory.json"
    assert not route_file.exists()
    route_file.write_text(json.dumps({"status": "passed", "kind": "actual_fastify_route_inventory", "data_mode": web["route_inventory"]["data_mode"], "route_count": len(routes),
        "geo_operations": len(geo_routes), "routes": routes, "full_original_openapi_acceptance": "not_proven"}, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    recordings = [*web["media"], desktop["creative_feedback_media"]]
    screenshots = web["screenshots"]
    layout = [v for v in desktop["screenshots"] if "-layout-" in v["path"] or "-geo-browser-entry-" in v["path"] or "-generated-progress-" in v["path"]]
    assert len(recordings) == 4 and len(layout) >= 12
    documentation_media = []
    for item in screenshots + layout + [f for media in recordings for f in media["files"]]:
        file = DEV / item["path"]
        assert digest(file) == item["sha256"]
        target = ROOT / "docs/design/implementation" / (Path(item["path"]).parts[0] + "__" + file.name)
        if target.exists():
            assert digest(target) == item["sha256"]
        else:
            target.write_bytes(file.read_bytes())
        documentation_media.append({"source": item["path"], "path": target.relative_to(ROOT).as_posix(), "sha256": item["sha256"]})
    for media in recordings:
        assert media["skipped_capture_errors"] == 0 and media["distinct_frames"] > 1
    result = {"at": datetime.now(timezone.utc).isoformat(), "stage": 83, "status": "verified_reproducible_geo_observation_subflow",
        "scope": "Immutable question/harness versions, real Codex repeats through a synthetic company gateway, exact retained answers and comparisons, separately attested consumer samples, scoped Admin/source governance, actual native right Side Panel and frameless local Desktop without scrollbar rails. Interactive/runtime sources match exactly; two later historical migration test fixtures are separately reviewed, with both affected whole batches freshly executed. Every current test file is covered. Synthetic model/business data; original complete acceptance remains open.",
        "selected": selected, "source_files": dict(sorted(sources.items())), "qualification_scopes": scopes,
        "platform_tests": full["counts"], "previous_platform_cases_preserved": 946, "platform_files": len(plan["files"]), "platform_batches": len(plan["batches"]),
        "platform_qualification_strategy": full["execution_strategy"], "platform_batch_source_scopes": index.get("qualification_scopes", []),
        "core_tests": reports["core"]["counts"], "client_counts": client_cases, "web_admin_sidepanel_checks": len(web["checks"]), "desktop_ui_checks": len(desktop["checks"]),
        "screenshots": screenshots, "layout_screenshots": layout, "recordings": recordings, "documentation_media": documentation_media,
        "published_migrations_preserved": 99, "route_inventory": {"path": route_file.relative_to(ROOT).as_posix(), "sha256": digest(route_file)},
        "complete_route_inventory": {"path": inventory_file.relative_to(ROOT).as_posix(), "sha256": digest(inventory_file), "configured": 465, "conditional": 1},
        "route_inventory_repair": {"path": repair_file.relative_to(ROOT).as_posix(), "sha256": digest(repair_file)},
        "migration_expectation_review": {"path": migration_review_file.relative_to(ROOT).as_posix(), "sha256": digest(migration_review_file)},
        "media_review": {"path": "docs/quality/geo-observation-media-review.json", "sha256": digest(ROOT / "docs/quality/geo-observation-media-review.json")},
        "visual_review": {"path": "docs/quality/geo-observation-visual-review.md", "sha256": digest(ROOT / "docs/quality/geo-observation-visual-review.md")},
        "native_encoding_review": {"path": "docs/quality/geo-observation-native-encoding-review.json", "sha256": digest(ROOT / "docs/quality/geo-observation-native-encoding-review.json")},
        "original_acceptance": {"requirements": 102, "cases": 102, "partially_verified": 83, "not_proven": 19, "fully_accepted": 0, "gates_G01_G10": "not_proven"},
        "not_validated": ["live_provider_or_consumer_rankings", "automated_consumer_observations", "Desktop_local_GEO_protocol", "provider_resolved_model_identity_or_processing_region", "causal_uplift", "all_professional_roles", "signed_installer", "complete_Codex_Desktop_parity", "performance_and_capacity_acceptance", "complete_original_acceptance", "production_readiness"],
        "verifier_sha256": digest(Path(__file__))}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": result["status"], "sources": len(sources), "platform_tests": full["counts"]["tests"], "screenshots": len(screenshots), "layout": len(layout)}))


if __name__ == "__main__":
    main()
