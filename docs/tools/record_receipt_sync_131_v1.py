"""Preserve original Stage131 outcomes and bind the qualified current sources.

Failed reports and executed QA sources are retained verbatim. A bounded receipt
journey is not promoted to whole-product, crash or professional-role acceptance.
"""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import importlib.util
import json

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
QUALITY = ROOT / "docs/quality"
OUT = QUALITY / "receipt-sync-evidence-131"
CP = QUALITY / "receipt-sync-checkpoint-131.json"
DESKTOP = DEV / "copypaste-desktop-publication-125"
DELIVERY = DEV / "copypaste-delivery"
COUNTS = {"controller_related": 124, "actual_local_codex": 43,
          "actual_native_parent_child_journeys": 3, "actual_packaged_desktop": 8,
          "current_compiler_checks": 2, "old_and_current_receipt_regression": 2}


def digest(body):
    return sha256(body).hexdigest()


def load(file):
    return json.loads(file.read_bytes())


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def binding(file):
    return {"path": file.relative_to(ROOT).as_posix(), "sha256": digest(file.read_bytes())}


def scanner():
    spec = importlib.util.spec_from_file_location("source_build_recorder", ROOT / "docs/tools/record_source_build_reproduction_v1.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def verify():
    index, cp = load(OUT / "index.json"), load(CP)
    assert index["recorder_sha256"] == digest(Path(__file__).read_bytes())
    assert index["status"] == "passed_bounded_durable_local_receipts"
    assert cp["evidence_index"] == binding(OUT / "index.json") and cp["counts"] == COUNTS
    assert cp["fully_accepted"] == 0 and cp["required_open"] == 89 and cp["original_full_acceptance_open"] == 102
    module, checked = scanner(), set()
    needles = module.credentials()
    for row in index["originals"]:
        body = (OUT / row["archive"]).read_bytes()
        assert digest(body) == row["sha256"] and len(body) == row["bytes"]
        if row["sha256"] not in checked:
            module.scan(row["source"], body, needles)
            checked.add(row["sha256"])
    for name, identity in cp["source_files"].items():
        assert digest((ROOT / name).read_bytes()) == identity, name
    for row in cp["media_files"]:
        assert digest((DEV / row["path"]).read_bytes()) == row["sha256"]
    return {"status": "passed", "original_entries": len(index["originals"]), "unique_original_blobs": len(checked),
            "qualified_sources": len(cp["source_files"]), "actual_media_files": len(cp["media_files"])}


def record(attempt):
    assert not CP.exists() and not (OUT / "index.json").exists() and not (OUT / "blobs").exists()
    desktop_raw, delivery_raw = DESKTOP / ".data/receipt-sync-131", DELIVERY / "evidence/receipt-sync-131"
    probes = [load(desktop_raw / f"probe-{n:02}.json") for n in range(1, 6)]
    assert [row["status"] for row in probes] == ["failed", "failed", "passed", "passed", "passed"]
    assert probes[0]["counts"]["fail"] == 1  # New pending-receipt view field absent in the old code.
    assert probes[1]["counts"]["pass"] == 121 and probes[1]["counts"]["fail"] == 3
    assert probes[2]["counts"]["pass"] == probes[2]["counts"]["tests"] == 124
    assert probes[3]["counts"]["pass"] == probes[3]["counts"]["tests"] == 43
    assert len(probes[4]["commands"]) == 2 and all(row["code"] == 0 for row in probes[4]["commands"])
    assert all(row["source_unchanged"] and row["fixtures_restored"] for row in probes)
    baseline = load(delivery_raw / "baseline-01.json")
    assert baseline["status"] == "passed_reproduced_original_receipt_loss" and baseline["fixtures_restored"]
    assert baseline["commands"][0]["counts"]["fail"] == baseline["commands"][1]["counts"]["pass"] == 1
    failed, native = load(delivery_raw / "native-01.json"), load(delivery_raw / "native-02.json")
    assert failed["status"] == "failed" and failed["counts"]["fail"] == 3 and failed["source_unchanged"]
    assert native["status"] == "passed" and native["counts"] == {"tests": 3, "pass": 3, "fail": 0, "cancelled": 0, "skipped": 0, "todo": 0}
    assert native["source_unchanged"] and native["owned_database_shutdown"] and native["owned_database_port_closed"]
    observations = load(delivery_raw / "native-02-observations.json")
    assert len(observations["observations"]) == 3 and observations["provider_closed"]
    for row in observations["observations"]:
        assert row["no_provider_calls_during_sync"] and all(p["closed"] for p in row["native_processes"])
        assert len(row["tasks"]) == 2 and sum(int(task["charged_micros"]) for task in row["tasks"]) == 60
        assert sorted(r["status"] for r in row["reservations"]) == ["reconciling", "settled"]
    ui = load(delivery_raw / f"desktop-{attempt}.json")
    journey = load(delivery_raw / f"desktop-{attempt}-journey.json")
    assert ui["status"] == journey["status"] == "passed"
    assert ui["source_unchanged"] and ui["package_unchanged"] and ui["owned_database_shutdown"] and ui["owned_database_port_closed"]
    assert ui["commands"] and all(row["exit_code"] == 0 for row in ui["commands"])
    assert len(journey["checks"]) == 8 and len(journey["screenshots"]) == 4 and len(journey["recordings"]) == 2 and len(journey["layouts"]) == 3
    assert not journey["errors"] and all(journey[k] for k in ["browser_closed", "desktop_closed", "api_closed", "fixture_closed", "provider_closed"])
    assert journey["observations"]["full_application_restart"] and journey["observations"]["original_process_closed"]
    assert journey["observations"]["no_model_calls_during_sync"] and journey["observations"]["unexpected"] == {"native": 0, "consent": 0}
    for n, row in enumerate(probes, 1):
        assert digest((desktop_raw / f"probe-{n:02}.tap").read_bytes()) == row["raw_sha256"]
        assert digest((desktop_raw / f"probe-{n:02}-verifier.mjs").read_bytes()) == row["verifier_sha256"]
    for n, row in [(1, failed), (2, native)]:
        assert digest((delivery_raw / f"native-{n:02}.tap").read_bytes()) == row["raw_sha256"]
        assert digest((delivery_raw / f"native-{n:02}-verifier.mjs").read_bytes()) == row["verifier_sha256"]
    assert digest((delivery_raw / "baseline-01.tap").read_bytes()) == baseline["raw_sha256"]
    assert digest((delivery_raw / "baseline-01-verifier.mjs").read_bytes()) == baseline["verifier_sha256"]
    for suffix, field in [(".tap", "raw_report_sha256"), ("-verifier.mjs", "verifier_sha256"), ("-journey-verifier.mjs", "journey_verifier_sha256")]:
        assert digest((delivery_raw / (f"desktop-{attempt}" + suffix)).read_bytes()) == ui[field]
    previous_receipt = DELIVERY / ".data/workflow-recovery-130/publication-e5ed1c33-3681-4f99-bda7-c1838fedeb1a/receipt.json"
    assert load(previous_receipt)["status"] == "pushed_and_verified"
    module, originals, bodies = scanner(), [], {}
    needles = module.credentials()
    paths = sorted(p for p in desktop_raw.glob("probe-*") if p.is_file())
    paths += sorted(p for p in desktop_raw.glob("probe-*-sources/**/*") if p.is_file())
    paths += sorted(p for p in delivery_raw.rglob("*") if p.is_file())
    paths += [previous_receipt]
    for file in paths:
        body = file.read_bytes()
        identity = digest(body)
        if identity not in bodies:
            module.scan(file.name, body, needles)
            bodies[identity] = body
        originals.append({"source": file.relative_to(ROOT).as_posix(), "archive": "blobs/" + identity + ".blob", "sha256": identity, "bytes": len(body)})
    sources = {}
    for report in [native, ui]:
        for name, identity in report["source_files"].items():
            target = "dev/" + name
            assert target not in sources or sources[target] == identity, target
            sources[target] = identity
    for name, identity in probes[2]["source_files"].items():
        target = "dev/copypaste-desktop/" + name
        assert target not in sources or sources[target] == identity, target
        sources[target] = identity
    baseline_tool = DELIVERY / "scripts/qualify-receipt-baseline-v1.mjs"
    sources[baseline_tool.relative_to(ROOT).as_posix()] = digest(baseline_tool.read_bytes())
    for name, identity in sources.items():
        assert digest((ROOT / name).read_bytes()) == identity, name
    media = [dict(item, path=item["path"].replace("copypaste-desktop-publication-125/", "copypaste-desktop/", 1))
             for item in journey["screenshots"] + [item for recording in journey["recordings"] for item in recording["files"]]]
    assert len(media) == 8
    for item in media:
        assert digest((DEV / item["path"]).read_bytes()) == item["sha256"]
    index = {"at": datetime.now(timezone.utc).isoformat(), "status": "passed_bounded_durable_local_receipts",
             "recorder_sha256": digest(Path(__file__).read_bytes()), "originals": originals, "unique_blobs": len(bodies),
             "original_outcomes": {"desktop_01": "failed: new pending-receipt flag absent; does not by itself exercise receipt loss",
             "desktop_02": "failed: three pre-existing synthetic child finish replies omitted the actual terminal receipt contract",
             "desktop_03": "passed: 124 controller checks", "desktop_04": "passed: 43 actual pinned native checks", "desktop_05": "passed: two current compiler checks",
             "native_01": "failed: three assertions incorrectly required an uncertain parent to have a charge; original reports and sources retained",
             "native_02": "passed: three actual native/SQL receipt-loss journeys; child settled once and unknown parent held for reconciliation",
             "baseline_01": "passed qualification: exact Stage130 code loses the saved child finish request; current code sends child then parent",
             "packaged": f"passed desktop-{attempt}: eight actual packaged checks; full application restart, four screenshots and two real-time GIF/MP4 recordings"},
             "full_acceptance_closures": 0, "required_open": 89, "unconfirmed_suggestions": 12, "optional_open": 1}
    cp = {"at": index["at"], "status": "verified_bounded_desktop_durable_receipt_sync",
          "scope": "Known completed child result survives receipt loss, local permission withdrawal and restoration. Original child settles before unknown parent; no native or model replay. Synthetic model/dialog choices and injected transport faults; actual native processes, files, SQL and packaged restart.",
          "verifier_sha256": index["recorder_sha256"], "evidence_index": {"path": (OUT / "index.json").relative_to(ROOT).as_posix(), "sha256": digest(encoded(index))},
          "previous_checkpoint": binding(QUALITY / "workflow-recovery-checkpoint-130.json"), "source_files": sources, "media_files": media, "counts": COUNTS,
          "current_full_platform_regression_rerun": False, "new_actual_ui_qualified": True,
          "professional_roles_fully_qualified": 0, "fully_accepted": 0, "original_full_acceptance_open": 102, "required_open": 89, "unconfirmed_suggestions": 12, "optional_open": 1,
          "unsigned_package": {"directory": ui["package_directory"], "files": ui["package_files"]},
          "limits": ["Unsigned package; synthetic provider and native dialog choices", "Native processes completed and closed before qualified application restart; arbitrary crash/process reclamation remains open", "Unknown parent remains held for accounting reconciliation; sync does not resume QA", "New login family, multi-node, all roles, production providers and full platform acceptance remain open"]}
    OUT.mkdir(parents=True, exist_ok=True)
    for identity, body in bodies.items():
        target = OUT / "blobs" / (identity + ".blob")
        target.parent.mkdir(exist_ok=True)
        with target.open("xb") as stream:
            stream.write(body)
    for target, value in [(OUT / "index.json", index), (CP, cp)]:
        module.scan(target.name, encoded(value), needles)
        with target.open("xb") as stream:
            stream.write(encoded(value))
    print(json.dumps(verify()))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--record", action="store_true")
    parser.add_argument("--verify", action="store_true")
    parser.add_argument("--desktop-attempt", default="01")
    args = parser.parse_args()
    assert args.record != args.verify
    if args.record:
        record(args.desktop_attempt)
    else:
        print(json.dumps(verify()))
