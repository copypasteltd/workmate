"""Bind actual shared-guidance, private-upload and responsive-panel evidence."""
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


def passing(counts):
    assert counts["tests"] == counts["pass"] > 0
    assert all(counts[k] == 0 for k in ["fail", "cancelled", "skipped", "todo"])


def main():
    parser = argparse.ArgumentParser()
    for key in ["core", "compatibility", "ui", "desktop", "clients", "control"]:
        parser.add_argument("--" + key, required=True)
    args = vars(parser.parse_args())
    assert all(re.fullmatch(r"\d{2}", value) for value in args.values())
    output = ROOT / "docs/quality/shared-project-checkpoint.json"
    assert not output.exists(), "Preserve prior receipts"
    selected = {
        "core": f"evidence/project-configuration-checks-{args['core']}.json",
        "compatibility": f"evidence/project-configuration-checks-{args['compatibility']}.json",
        "web_admin_sidepanel": f"evidence/project-configuration-ui-{args['ui']}.json",
        "desktop_ui": f"evidence/desktop-local-ui-{args['desktop']}.json",
        "clients": f"evidence/history-source-clients-{args['clients']}.json",
        "platform": f"evidence/desktop-execution-control-{args['control']}.json",
    }
    reports = {key: read(DELIVERY / value) for key, value in selected.items()}
    sources, scopes = {}, []
    for scope, report in reports.items():
        assert report["status"] == "passed" and report["source_unchanged"], scope
        if "owned_database_shutdown" in report:
            assert report["owned_database_shutdown"], scope
        if "tests" in report.get("counts", {}):
            passing(report["counts"])
        for name, value in report["source_files"].items():
            if scope == "clients":
                component, relative = name.split("/", 1)
                file = DEV / ("copypaste-" + component) / relative
            else:
                file = ROOT / name if name.startswith(("docs/", "dev/")) else DEV / name
            assert file.resolve().is_relative_to(ROOT) and digest(file) == value, (scope, name)
            relative = file.relative_to(ROOT).as_posix()
            assert relative not in sources or sources[relative] == value
            sources[relative] = value
        for field in ["raw_report", "raw_log", "verifier", "journey_verifier", "journey"]:
            if isinstance(report.get(field), dict) and "path" in report[field]:
                bound(report[field])
        scopes.append({"scope": scope, "report": selected[scope], "sha256": digest(DELIVERY / selected[scope]),
                       "source_files": len(report["source_files"]), "all_recorded_sources_exact": True,
                       "later_source_differences": []})
    assert reports["core"]["phase"] == "core" and reports["core"]["counts"]["tests"] == 25
    assert reports["compatibility"]["phase"] == "compatibility" and reports["compatibility"]["counts"]["tests"] == 36
    full = reports["platform"]
    assert full["execution_strategy"] == "resumable_complete_file_inventory"
    index = read(bound(full["raw_report"]))
    plan = read(bound(index["plan"]))
    actual = batch_cases(index)
    previous = read(DELIVERY / "evidence/desktop-execution-control-38.json")
    prior_cases = batch_cases(read(bound(previous["raw_report"])))
    assert sum(prior_cases.values()) == 1001 and not prior_cases - actual
    assert sum(actual.values()) == full["counts"]["tests"] == 1023
    assert len(plan["files"]) == 79 and len(plan["batches"]) == len(index["batches"]) == 20
    assert "tests/project-configuration.test.ts" in plan["files"]
    native = read(bound(reports["desktop_ui"]["journey"]))
    web = reports["web_admin_sidepanel"]["journey"]
    assert native["status"] == web["status"] == "passed"
    assert len(native["checks"]) == 50 and len(web["checks"]) == 14
    assert not native["errors"] and not web["errors"]
    assert all(native[k] for k in ["electron_closed", "browser_closed", "api_closed", "fixture_closed", "native_browser_fixture_closed"])
    assert all(web[k] for k in ["browser_closed", "api_closed", "fixture_closed"])
    assert reports["web_admin_sidepanel"]["compiled_unchanged"]
    for scope, closed in [("desktop_ui", "owned_preview_closed"), ("web_admin_sidepanel", "owned_previews_closed")]:
        assert reports[scope][closed] and reports[scope]["fixture_cleanup"]["status"] == "passed"
        assert all(row["reclaimed"] for row in reports[scope]["fixture_cleanup"]["results"])
    guidance = native["native_project_configuration"]
    assert guidance["versions"] == [3, 3, 4] and [int(value) for value in guidance["charged_micros"]] == [90, 90, 90]
    assert guidance["execution_locations"] == ["desktop"] * 3 and guidance["cloud_replacement_created"] is False
    assert len(guidance["actual_tool_outputs"]) == 6
    assert native["project_configuration"]["new_task_id"] is None
    panel = web["side_panel"]
    assert panel["context_type"] == "SIDE_PANEL" and panel["side"] == "right" and panel["owned_context_closed"]
    assert len(panel["viewport_checks"]) >= 8 and panel["pointer_send"]
    assert panel["advanced_last_control"]
    private = web["private_attachment"]
    assert all(private[k] for k in ["actor_private", "owner_download_exact_bytes", "absent_from_peer_project_list"])
    assert all(private[k] == 404 for k in ["same_project_editor_download", "same_project_editor_versions", "same_project_editor_conversation"])
    client_tests = 0
    for item in reports["clients"]["checks"]:
        assert item["exit_code"] == 0 and digest(DELIVERY / item["raw_report"]) == item["raw_sha256"]
        if item["counts"]:
            passing(item["counts"])
            client_tests += item["counts"]["tests"]
    assert client_tests == 139
    baseline_file = ROOT / "docs/quality/history/stage86-before-shared-configuration/receipt.json"
    baseline = read(baseline_file)
    assert len(baseline["published_migrations"]) == 102 and len(baseline["published_contracts"]) == 4
    for name, value in baseline["published_migrations"].items():
        assert digest(DEV / "copypaste-platform/migrations" / name) == value
    for name, value in baseline["published_contracts"].items():
        assert digest(ROOT / name) == value
    for item in baseline["files"]:
        assert digest(ROOT / item["archive"]) == item["sha256"]
    inventory_file = ROOT / "docs/contracts/implemented-routes.json"
    assert inventory_file.read_bytes() == (DEV / "copypaste-platform/contracts/implemented-routes.json").read_bytes()
    inventory = read(inventory_file)
    assert len(inventory["routes"]) == 487 and len(inventory["conditional_routes"]) == 1
    route_receipt = ROOT / "docs/quality/shared-project-route-inventory.json"
    assert read(route_receipt)["new_sha256"] == digest(inventory_file)
    contract_file = ROOT / "docs/contracts/project-configuration-openapi.json"
    assert contract_file.read_bytes() == (DEV / "copypaste-platform/contracts/project-configuration-openapi.json").read_bytes()
    recordings = [*web["media"], native["project_configuration"]["media"], guidance["media"]]
    assert len(recordings) == 5
    for media in recordings:
        assert media["skipped_capture_errors"] == 0 and media["distinct_frames"] > 1
    native_shots = [row for row in native["screenshots"] if Path(row["path"]).name.startswith("workmate-guidance-" + args["desktop"] + "-")]
    assert len(native_shots) == 9
    screenshots = [*web["screenshots"], *native_shots]
    copies = []
    for row in [*screenshots, *[item for media in recordings for item in media["files"]]]:
        source = DEV / row["path"]
        assert digest(source) == row["sha256"]
        target = ROOT / "docs/design/implementation" / (Path(row["path"]).parts[0] + "__" + source.name)
        if target.exists():
            assert digest(target) == row["sha256"]
        else:
            target.write_bytes(source.read_bytes())
        copies.append({"source": row["path"], "path": target.relative_to(ROOT).as_posix(), "sha256": row["sha256"]})
    result = {
        "at": datetime.now(timezone.utc).isoformat(), "stage": 86,
        "status": "verified_shared_project_guidance_and_private_chat",
        "scope": "Immutable project guidance, exact dependencies, original/absent continuation, real local Codex reads and settlements, actor-private resumable chat attachments, scoped Admin body governance and actual responsive native Side Panel. Synthetic provider content remains explicit; complete product acceptance stays open.",
        "selected": selected, "source_files": dict(sorted(sources.items())), "qualification_scopes": scopes,
        "platform_tests": full["counts"], "previous_platform_cases_preserved": 1001, "platform_files": 79, "platform_batches": 20,
        "core_tests": reports["core"]["counts"], "compatibility_tests": reports["compatibility"]["counts"],
        "client_counts": client_tests, "web_admin_sidepanel_checks": 14, "desktop_ui_checks": 50,
        "packaged": reports["desktop_ui"]["packaged"], "native_project_configuration": guidance,
        "private_attachment": private, "side_panel": panel, "screenshots": screenshots, "recordings": recordings,
        "documentation_media": copies, "baseline": ref(baseline_file), "published_migrations_preserved": 102,
        "published_contracts_preserved": 4, "additive_contract": ref(contract_file),
        "route_inventory": {**ref(inventory_file), "configured": 487, "conditional": 1, "receipt": ref(route_receipt)},
        "not_validated": ["live_model_and_media_quality", "all_18_professional_roles", "full_large_file_sleep_and_site_matrix", "signed_install_upgrade_uninstall", "complete_Desktop_operation_parity", "complete_original_102_requirement_acceptance_and_G01_G10"],
        "verifier_sha256": digest(Path(__file__)),
    }
    with output.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": result["status"], "sources": len(sources), "platform_tests": full["counts"]["tests"], "media_copies": len(copies)}))


if __name__ == "__main__":
    main()
