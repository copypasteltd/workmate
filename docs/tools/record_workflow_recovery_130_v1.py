"""Archive exact Stage130 outcomes and bind the current qualified execution sources.

Executed verifiers, failed probes and original observations are immutable.
This recorder does not expand bounded tests into full product acceptance.
"""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import importlib.util
import json

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
OUT = ROOT / "docs/quality/workflow-recovery-evidence-130"
CP = ROOT / "docs/quality/workflow-recovery-checkpoint-130.json"
DESKTOP = DEV / "copypaste-desktop-publication-125"
DELIVERY = DEV / "copypaste-delivery"
QUALITY = ROOT / "docs/quality"


def digest(body):
    return sha256(body).hexdigest()


def load(file):
    return json.loads(file.read_bytes())


def scanner():
    spec = importlib.util.spec_from_file_location("source_build_recorder", ROOT / "docs/tools/record_source_build_reproduction_v1.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def encoded(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode()


def binding(file):
    return {"path": file.relative_to(ROOT).as_posix(), "sha256": digest(file.read_bytes())}


def verify():
    index, cp = load(OUT / "index.json"), load(CP)
    assert index["recorder_sha256"] == digest(Path(__file__).read_bytes())
    assert index["status"] == "passed_bounded_native_parent_child_workflows"
    assert cp["evidence_index"] == binding(OUT / "index.json")
    assert cp["counts"] == {"controller_related": 109, "actual_local_codex": 43, "actual_native_parent_child_journeys": 3,
                            "actual_packaged_desktop": 8, "current_compiler_checks": 2}
    assert cp["fully_accepted"] == 0 and cp["required_open"] == 89 and cp["original_full_acceptance_open"] == 102
    module = scanner()
    needles = module.credentials()
    checked = set()
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
    assert attempt == "01"
    assert not CP.exists() and not (OUT / "index.json").exists() and not (OUT / "blobs").exists()
    desktop_raw = DESKTOP / ".data/workflow-recovery-130"
    delivery_raw = DELIVERY / "evidence/workflow-recovery-130"
    probes = [load(desktop_raw / f"probe-{n:02}.json") for n in range(1, 7)]
    assert [row["status"] for row in probes] == ["failed", "failed", "passed", "failed", "passed", "passed"]
    assert probes[0]["counts"]["fail"] == 1
    assert probes[1]["counts"]["pass"] == 107 and probes[1]["counts"]["fail"] == 2
    assert probes[2]["counts"]["pass"] == probes[2]["counts"]["tests"] == 109
    assert probes[4]["counts"]["pass"] == probes[4]["counts"]["tests"] == 43
    assert probes[3]["fixtures_restored"] is False and all(row["code"] == 0 for row in probes[3]["commands"])
    assert probes[5]["fixtures_restored"] is True and len(probes[5]["commands"]) == 2 and all(row["code"] == 0 for row in probes[5]["commands"])
    assert all(row["source_unchanged"] for row in probes)
    failed = load(delivery_raw / "native-01.json")
    native = load(delivery_raw / "native-02.json")
    ui = load(delivery_raw / f"desktop-{attempt}.json")
    journey = load(delivery_raw / f"desktop-{attempt}-journey.json")
    observations = load(delivery_raw / "native-02-observations.json")
    assert failed["status"] == "failed" and failed["commands"][0]["exit_code"] == 1 and failed["source_unchanged"]
    assert native["status"] == ui["status"] == journey["status"] == "passed"
    assert native["counts"] == {"tests": 3, "pass": 3, "fail": 0, "cancelled": 0, "skipped": 0, "todo": 0}
    assert native["source_unchanged"] and native["owned_database_shutdown"] and native["owned_database_port_closed"]
    assert ui["source_unchanged"] and ui["package_unchanged"] and ui["owned_database_shutdown"] and ui["owned_database_port_closed"]
    assert ui["commands"] and all(row["exit_code"] == 0 for row in ui["commands"])
    assert all(journey[key] for key in ["browser_closed", "desktop_closed", "api_closed", "fixture_closed", "provider_closed"])
    assert len(journey["checks"]) == 8 and len(journey["screenshots"]) == 4 and len(journey["recordings"]) == 1 and len(journey["layouts"]) == 3
    assert not journey["errors"]
    assert len(observations["observations"]) == 3 and observations["provider_closed"]
    for row in observations["observations"]:
        assert all(process["closed"] for process in row["native_processes"])
    for number, row in enumerate(probes, 1):
        assert digest((desktop_raw / f"probe-{number:02}.tap").read_bytes()) == row["raw_sha256"]
        assert digest((desktop_raw / f"probe-{number:02}-verifier.mjs").read_bytes()) == row["verifier_sha256"]
    for number, row in [(1, failed), (2, native)]:
        assert digest((delivery_raw / f"native-{number:02}.tap").read_bytes()) == row["raw_sha256"]
        assert digest((delivery_raw / f"native-{number:02}-verifier.mjs").read_bytes()) == row["verifier_sha256"]
    assert digest((delivery_raw / f"desktop-{attempt}.tap").read_bytes()) == ui["raw_report_sha256"]
    assert digest((delivery_raw / f"desktop-{attempt}-verifier.mjs").read_bytes()) == ui["verifier_sha256"]
    assert digest((delivery_raw / f"desktop-{attempt}-journey-verifier.mjs").read_bytes()) == ui["journey_verifier_sha256"]
    module, originals, bodies = scanner(), [], {}
    needles = module.credentials()
    paths = sorted(p for p in desktop_raw.glob("probe-*") if p.is_file())
    paths += sorted(p for p in desktop_raw.glob("probe-*-sources/**/*") if p.is_file())
    paths += sorted(p for p in delivery_raw.rglob("*") if p.is_file())
    paths += [DELIVERY / ".data/publication/556ea9f8-3b04-419c-85b8-168fdbcf3cc9/receipt.json",
              DELIVERY / ".data/source-repro-129/publication-ead9d580-554c-4b21-aee4-dc62d34cb39e/receipt.json"]
    for file in paths:
        body = file.read_bytes()
        identity = digest(body)
        if identity not in bodies:
            module.scan(file.name, body, needles)
            bodies[identity] = body
        originals.append({"source": file.relative_to(ROOT).as_posix(), "archive": "blobs/" + identity + ".blob",
                          "sha256": identity, "bytes": len(body)})
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
    for name, identity in sources.items():
        assert digest((ROOT / name).read_bytes()) == identity, name
    media = [dict(item, path=item["path"].replace("copypaste-desktop-publication-125/", "copypaste-desktop/", 1))
             for item in journey["screenshots"] + [item for recording in journey["recordings"] for item in recording["files"]]]
    for item in media:
        assert digest((DEV / item["path"]).read_bytes()) == item["sha256"]
    assert len(media) == 6
    index = {"at": datetime.now(timezone.utc).isoformat(), "status": "passed_bounded_native_parent_child_workflows",
             "recorder_sha256": digest(Path(__file__).read_bytes()), "originals": originals,
             "unique_blobs": len(bodies), "original_outcomes": {"desktop_01": "failed: original stalled-heartbeat shutdown reproduction",
             "desktop_02": "failed: two new fixture cases held mandatory checks as well as the background check; original failure retained",
             "desktop_03": "passed: 109 controller checks", "desktop_04": "failed provenance: compilers passed, overlapping native fixture prevented a clean fixture comparison",
             "desktop_05": "passed: 43 actual pinned native checks", "desktop_06": "passed: two compiler checks and fixture restoration",
             "native_01": "failed compilation: two unknown test outcome types; no database or native journey started",
             "native_02": "passed: three actual parent/child journeys with owned database and fixture closure",
             "packaged_01": "passed: eight actual unsigned packaged UI checks; four screenshots, one real-time GIF and MP4"},
             "full_acceptance_closures": 0, "required_open": 89, "unconfirmed_suggestions": 12, "optional_open": 1}
    cp = {"at": index["at"], "status": "verified_bounded_desktop_workflow_recovery", "scope": "Actual pinned customer-local parent/child Codex workflows, cancellation of stalled background authority waits and bounded child pre-turn recovery. Synthetic provider, customer choices and injected transport faults.",
          "verifier_sha256": index["recorder_sha256"], "evidence_index": {"path": (OUT / "index.json").relative_to(ROOT).as_posix(), "sha256": digest(encoded(index))},
          "previous_checkpoint": binding(QUALITY / "startup-recovery-checkpoint-128.json"), "source_files": sources, "media_files": media,
          "counts": {"controller_related": 109, "actual_local_codex": 43, "actual_native_parent_child_journeys": 3, "actual_packaged_desktop": 8, "current_compiler_checks": 2},
          "current_full_platform_regression_rerun": False, "new_actual_ui_qualified": True,
          "professional_roles_fully_qualified": 0, "fully_accepted": 0, "original_full_acceptance_open": 102, "required_open": 89, "unconfirmed_suggestions": 12, "optional_open": 1,
          "unsigned_package": {"directory": ui["package_directory"], "files": ui["package_files"]},
          "limits": ["Unsigned package, synthetic provider and native dialog choices", "No arbitrary crash/multi-node or all-role acceptance", "Durable lost child finish receipt and complete parent/child accounting reconciliation remain open"]}
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
    parser.add_argument("--attempt", default="01")
    args = parser.parse_args()
    assert args.record != args.verify
    if args.record:
        record(args.attempt)
    else:
        print(json.dumps(verify()))
