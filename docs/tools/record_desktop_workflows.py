"""Bind current native workflow evidence without changing original acceptance."""
import argparse
from collections import Counter
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"


def read(path):
    return json.loads(path.read_text(encoding="utf-8"))


def digest(path):
    return sha256(path.read_bytes()).hexdigest()


def bound(item):
    path = (DELIVERY / item["path"]).resolve()
    assert path.is_relative_to(DELIVERY) and digest(path) == item["sha256"], item
    return path


def names(raw):
    result = []
    for line in raw.splitlines():
        match = re.match(r"^[ \t]*ok \d+ - (.+)$", line)
        if match:
            result.append(match[1].replace("all seventeen connected native roles", "all eighteen connected native roles"))
    return Counter(result)


def main():
    parser = argparse.ArgumentParser()
    for key in ("control", "focused", "native", "supervisor", "ui"):
        parser.add_argument("--" + key, required=True)
    args = parser.parse_args()
    selected = vars(args)
    files = {
        "platform": f"evidence/desktop-execution-control-{args.control}.json",
        "focused": f"evidence/desktop-workflows-{args.focused}.json",
        "native_children": f"evidence/desktop-workflows-native-{args.native}.json",
        "native_supervisor": f"evidence/local-codex-native-{args.supervisor}.json",
        "ui": f"evidence/desktop-local-ui-{args.ui}.json",
    }
    reports = {key: read(DELIVERY / name) for key, name in files.items()}
    for key, report in reports.items():
        assert report["status"] == "passed" and report["source_unchanged"], key
        if "counts" in report and "tests" in report["counts"]:
            counts = report["counts"]
            assert counts["pass"] == counts["tests"] > 0 and all(counts[x] == 0 for x in ("fail", "cancelled", "skipped", "todo"))
        if "owned_database_shutdown" in report:
            assert report["owned_database_shutdown"], key
        if isinstance(report.get("raw_report"), dict):
            bound(report["raw_report"])
        elif isinstance(report.get("raw_report"), str):
            assert digest(DELIVERY / report["raw_report"]) == report["raw_sha256"]
        if isinstance(report.get("verifier"), dict):
            bound(report["verifier"])
    platform = reports["platform"]
    index_item = platform["raw_report"]
    index = read(bound(index_item))
    plan = read(bound(index["plan"]))
    current_cases = Counter()
    for item in index["batches"]:
        batch = read(bound(item))
        current_cases += names(bound(batch["raw_report"]).read_text(encoding="utf-8"))
        assert batch["source_unchanged"] and batch["owned_database_shutdown"]
        cleanup = read(bound(batch["fixture_cleanup"]))
        assert cleanup["status"] == "passed" and all(row["reclaimed"] for row in cleanup["results"])
    old_index = read(DELIVERY / "evidence/desktop-execution-control-15-index.json")
    previous_cases = Counter()
    for item in old_index["batches"]:
        previous_cases += names(bound(read(bound(item))["raw_report"]).read_text(encoding="utf-8"))
    assert sum(previous_cases.values()) == 830 and not previous_cases - current_cases
    assert sum(current_cases.values()) == platform["counts"]["tests"]
    sources = dict(platform["source_files"])
    allowed_ui = {"copypaste-delivery/scripts/qa-desktop-workflows.ts", "copypaste-delivery/scripts/qa-desktop-local.ts", "copypaste-delivery/scripts/run-desktop-local-ui.mjs",
        "copypaste-desktop/renderer/src/local-agent.tsx", "copypaste-desktop/renderer/src/local-agent.css", "copypaste-desktop/renderer-source.json"}
    migration_test = "copypaste-platform/tests/migrations.test.ts"
    migration_before = ROOT / "docs/quality/history/before-desktop-workflow-sources" / migration_test
    original = migration_before.read_bytes().replace(b"\r\n", b"\n")
    assert original.count(b"      93,\n") == 2
    assert (DEV / migration_test).read_bytes().replace(b"\r\n", b"\n") == original.replace(b"      93,\n", b"      94,\n")
    scopes, archives = [], []
    for key, report in reports.items():
        source = report["source_files"]
        if key == "native_supervisor":
            source = {"copypaste-desktop/" + name: value for name, value in source.items()}
        differences = []
        for name, expected in source.items():
            actual = digest(DEV / name)
            if actual != expected:
                assert name in allowed_ui or name == migration_test, (key, name)
                if name == migration_test:
                    assert expected == digest(migration_before)
                differences.append({"path": name, "tested_sha256": expected, "current_sha256": actual,
                    "qualification": "current_complete_platform_regression; two schema-tip expectations 93 to 94 only, original data-preservation assertions unchanged" if name == migration_test else "current_packaged_ui"})
            if key == "ui" or name not in sources:
                sources[name] = actual
        scopes.append({"scope": key, "report": files[key], "sha256": digest(DELIVERY / files[key]), "source_files": len(source), "later_source_differences": differences})
        for name, item in report.get("preserved_changes", {}).items():
            assert digest(bound(item)) == item["sha256"]
            archives.append({"source": name, "archive": (DELIVERY / item["path"]).relative_to(ROOT).as_posix(), "sha256": item["sha256"]})
    for name, value in sources.items():
        assert digest(DEV / name) == value, name
    ui = reports["ui"]
    journey_file = bound(ui["journey"])
    journey = read(journey_file)
    assert journey["status"] == "passed" and all(journey[key] for key in ("electron_closed", "browser_closed", "api_closed", "fixture_closed"))
    assert len(journey["checks"]) == 19
    assert 56 in [int(value) for value in re.findall(r"^# tests (\d+)\r?$", bound(ui["raw_report"]).read_text(encoding="utf-8"), re.M)]
    assert journey["media"]["skipped_capture_errors"] == 0 and journey["media"]["distinct_frames"] > 100
    for item in journey["screenshots"] + journey["media"]["files"]:
        assert digest(DEV / item["path"]) == item["sha256"]
    assert any("two real local Codex children" in check for check in journey["checks"])
    assert reports["native_children"]["counts"]["tests"] == 3 and reports["native_supervisor"]["counts"]["tests"] == 17
    progress = read(ROOT / "docs/quality/requirements-alignment-progress.json")
    assert len(progress["requirements"]) == 102 and progress["fully_accepted_requirements"] == 0
    assert progress["summary"] == {"partial_verified": 81, "completion_not_proven": 21}
    migration_archive = ROOT / "docs/quality/history/before-desktop-workflow-sources/copypaste-platform/migrations"
    old_migrations = sorted(migration_archive.glob("*.sql"))
    assert len(old_migrations) == 93
    for file in old_migrations:
        assert digest(file) == digest(DEV / "copypaste-platform/migrations" / file.name), file.name
    result = {
        "at": datetime.now(timezone.utc).isoformat(), "status": "verified_bounded_native_workflow_subset", "stage": 76, "selected": selected,
        "scope": "Actual customer-device Codex parent/child roles, immutable private workflows, separate explicit child-fee consent and human step approval, real local files and scoped company receipts, stop/revoke process exits, governed downstream publication and packaged Electron interaction. Explicit synthetic model and customer-dialog decisions.",
        "platform_tests": platform["counts"], "focused_overlapping_tests": reports["focused"]["counts"], "native_child_tests": reports["native_children"]["counts"],
        "native_supervisor_tests": reports["native_supervisor"]["counts"], "native_ui_checks": len(journey["checks"]), "client_unit_tests": 56,
        "inventory": {"test_files": len(plan["files"]), "batches": len(plan["batches"]), "plan": index["plan"], "index": index_item, "all_raw_tap_and_cleanup_hashes_verified": True},
        "original_regression": {"previous_tests_preserved": 830, "new_tests": sum(current_cases.values()) - 830, "tap_case_parser": "Includes top-level and indented nested successful TAP cases; all 21 prior nested cases are retained", "role_title_normalization": "seventeen to eighteen admissions only; prior unready-role denial still tested using an unknown role"},
        "migration_integrity": {"published_sql_001_through_093": "93 exact original byte copies compared with current files", "new_sql": "094-desktop-workflow-origin.sql", "later_test_change": "Only two expected latest-version integers changed from 93 to 94; financial/data-preservation assertions byte-equivalent after declared line endings"},
        "source_files": sources, "qualification_scopes": scopes, "source_archives": archives, "packaged": ui["packaged"],
        "screenshots": journey["screenshots"], "media": journey["media"], "documentation_media": [],
        "native_role_admissions": 18, "required_roles": 18, "required_skills": 29,
        "failed_attempts_retained": ["desktop-workflows-01", "desktop-workflows-02", "desktop-workflows-native-01", "desktop-workflows-native-02", "desktop-execution-control-16-batch-10-attempt-01"],
        "superseded_partial_regression": {"receipt": "history/stage76-control17-superseded.json", "sha256": digest(ROOT / "docs/quality/history/stage76-control17-superseded.json"), "qualified_as_current_full_suite": False},
        "external_source_provenance": "Immutable database-computed version snapshots preserve original external inputs across new native sessions and derived versions; withdrawal fences cached reads, child admission and private/shared deliveries without retaining the creator task lifetime",
        "original_acceptance": {"requirements": 102, "test_cases": 102, "partial_verified": 81, "completion_not_proven": 21, "fully_accepted": 0, "NFR_and_G01_G10": "retained"},
        "limits": ["Role admission is not professional output acceptance", "Eight bounded sequential steps only: native Codex, human approval, analytics summary", "Actual workflow-child cancellation cases cover Stop and revoke on Windows; child-specific offline/account-switch journeys are not claimed by these three tests", "Complete browser/third-party application and Codex Desktop operation parity remains pending", "Live internal provider, payment and connector acceptance remains pending", "No fresh Extension UI claim; unchanged product/verifier bytes are compared separately", "Full production deployment and commercial acceptance remain pending"],
        "verifier_sha256": digest(Path(__file__)),
    }
    output = ROOT / "docs/quality/desktop-workflow-checkpoint.json"
    assert not output.exists(), "Preserve an existing checkpoint before revising it"
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": result["status"], "platform_tests": platform["counts"]["tests"], "focused": reports["focused"]["counts"]["tests"], "source_files": len(sources)}))


if __name__ == "__main__":
    main()
