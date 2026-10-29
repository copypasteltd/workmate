"""Preserve all native-publication attempts and qualify portable source-bound receipts."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import json
import re

ROOT = Path(__file__).resolve().parents[2]
CANDIDATE = ROOT / "dev/copypaste-platform-publication-125"
RUNS = CANDIDATE / ".data/publication-native-126"
PROBES = CANDIDATE / ".data/pre-turn-startup-126"
OUT = ROOT / "docs/quality/native-publication-evidence-126"
INDEX = OUT / "index.json"
PRIOR = ROOT / "docs/quality/controlled-publications-evidence-125/index.json"
PREVIOUS = ROOT / "docs/quality/history/stage126-previous-publication.json"
REQUIRED = {"tests/publication-native-tools-v3.test.ts", "tests/publications.test.ts", "tests/publication-admin-upgrade.test.ts",
    "tests/publication-protocol.test.ts", "tests/external-budget.test.ts", "tests/storage-orphans.test.ts",
    "tests/schema-compatibility.test.ts", "tests/resource-quotas.test.ts", "tests/native-recovery.test.ts",
    "tests/analysis-role-tools.test.ts", "tests/agent-templates.test.ts", "tests/demo.test.ts",
    "tests/runtime-pre-turn.test.ts", "tests/runtime-startup.test.ts", "tests/runtime-startup-billing.test.ts", "tests/runtime.test.ts"}

def digest(body): return sha256(body).hexdigest()
def read(file): return json.loads(file.read_text(encoding="utf-8-sig"))
def ref(file): return {"path": file.relative_to(ROOT).as_posix(), "sha256": digest(file.read_bytes())}
def safe_file(name):
    path = ROOT / name
    assert path.resolve().is_relative_to(ROOT.resolve()) and not path.is_symlink(), name
    return path

def archive(selected, targeted, startup):
    assert re.fullmatch(r"[0-9]{2}", selected) and int(selected) >= 10
    assert re.fullmatch(r"[0-9]{2}", targeted) and 9 <= int(targeted) < int(selected)
    assert re.fullmatch(r"[0-9]{2}", startup) and int(startup) >= 3
    assert not INDEX.exists(), "Never overwrite an executed archive"
    prior = read(PRIOR)
    reusable = {entry["sha256"]: entry for entry in prior["entries"]}
    receipts = {file.stem.removeprefix("backend-"): read(file) for file in sorted(RUNS.glob("backend-*.json")) if re.fullmatch(r"backend-[0-9]{2}\.json", file.name)}
    assert "06" not in receipts and selected in receipts
    interrupted = read(RUNS / "backend-06-interruption-observation.json")
    assert interrupted["status"] == "interrupted_without_terminal_receipt" and interrupted["claims_full_regression_passed"] is False
    assert all(row["source_unchanged"] and row["owned_database_shutdown"] and row["owned_database_port_closed"] for row in receipts.values())
    for number in [targeted, selected]:
        row = receipts[number]
        assert row["status"] == "passed" and row["counts"]["tests"] == row["counts"]["pass"]
        assert all(row["counts"][key] == 0 for key in ["fail", "cancelled", "skipped", "todo"])
    assert receipts[targeted]["counts"]["pass"] == 5
    assert set(receipts[selected]["test_files"]) == REQUIRED and receipts[selected]["counts"]["pass"] > 133
    for number in ["01", "02", "03", "04", "08"]: assert receipts[number]["status"] == "failed"
    files = []
    for item in sorted(RUNS.iterdir()):
        if re.fullmatch(r"backend-[0-9]{2}(?:\.json|\.tap|-cleanup\.json|-verifier\.mjs|-interruption-observation\.json)", item.name): files.append(item)
        elif re.fullmatch(r"backend-[0-9]{2}-sources", item.name): files.extend(sorted(p for p in item.rglob("*") if p.is_file()))
    probes = {file.stem.removeprefix("probe-"): read(file) for file in sorted(PROBES.glob("probe-*.json")) if re.fullmatch(r"probe-[0-9]{2}\.json", file.name)}
    assert probes["01"]["known_pre_turn_failure_reproduced"] and probes[startup]["status"] == "passed"
    for item in sorted(PROBES.iterdir()):
        if re.fullmatch(r"probe-[0-9]{2}(?:\.json|\.tap|-verifier\.mjs)", item.name): files.append(item)
        elif re.fullmatch(r"probe-[0-9]{2}-sources", item.name): files.extend(sorted(p for p in item.rglob("*") if p.is_file()))
    assert files
    entries = []
    checked = set()
    for file in files:
        assert not file.is_symlink() and (file.resolve().is_relative_to(RUNS.resolve()) or file.resolve().is_relative_to(PROBES.resolve()))
        body = file.read_bytes(); key = digest(body)
        assert len(body) < 100 * 1024 * 1024
        if key in reusable:
            old = reusable[key]; blob = safe_file(old["blob"])
            if key not in checked: assert digest(blob.read_bytes()) == key and blob.stat().st_size == len(body)
        else:
            blob = OUT / "blobs" / key[:2] / (key + ".blob")
            blob.parent.mkdir(parents=True, exist_ok=True)
            if blob.exists(): assert blob.read_bytes() == body
            else:
                with blob.open("xb") as stream: stream.write(body)
        checked.add(key)
        entries.append({"original": file.relative_to(ROOT).as_posix(), "blob": blob.relative_to(ROOT).as_posix(), "sha256": key, "bytes": len(body)})
    assert not PREVIOUS.exists()
    with PREVIOUS.open("xb") as stream: stream.write((ROOT / "docs/quality/workmate-publication.json").read_bytes())
    current = {"dev/copypaste-platform/" + key.removeprefix("copypaste-platform/"): value for key, value in receipts[selected]["source_files"].items()}
    value = {"schema_version": 1, "at": datetime.now(timezone.utc).isoformat(), "archive_tool": ref(Path(__file__)),
        "prior_archive": ref(PRIOR), "previous_publication": ref(PREVIOUS), "scope": "actual_pinned_native_codex_with_simulated_model_and_accounts",
        "selected_full_attempt": selected, "targeted_native_attempt": targeted, "startup_green_attempt": startup,
        "attempts": [{"number": number, "status": row["status"], "counts": row["counts"]} for number, row in receipts.items()],
        "startup_probes": [{"number": number, "status": row["status"], "counts": row["counts"], "mode": row["mode"]} for number, row in probes.items()],
        "interrupted_attempts": [{"number": "06", "status": interrupted["status"]}],
        "current_sources": current, "entries": entries, "entry_count": len(entries), "unique_blobs": len(checked),
        "reused_prior_blobs": len(checked.intersection(reusable)), "new_media": False,
        "limits": ["No live model or advertising provider qualification", "No new UI or installer qualification", "No complete professional role or full product acceptance"]}
    INDEX.parent.mkdir(parents=True, exist_ok=True)
    with INDEX.open("x", encoding="utf-8", newline="\n") as stream: json.dump(value, stream, ensure_ascii=False, indent=2); stream.write("\n")
    print(json.dumps(verify(False), ensure_ascii=False))

def verify(current=True):
    index = read(INDEX)
    assert index["archive_tool"] == ref(Path(__file__)) and index["prior_archive"] == ref(PRIOR) and index["previous_publication"] == ref(PREVIOUS)
    entries = index["entries"]; assert index["entry_count"] == len(entries)
    aliases = {}; bodies = {}; content = {}
    for entry in entries:
        name = entry["original"]
        assert name not in aliases and name.startswith(("dev/copypaste-platform-publication-125/.data/publication-native-126/", "dev/copypaste-platform-publication-125/.data/pre-turn-startup-126/"))
        file = safe_file(entry["blob"])
        assert file.is_relative_to(OUT) or file.is_relative_to(PRIOR.parent)
        assert file.name == entry["sha256"] + ".blob"
        if entry["sha256"] not in content:
            raw = file.read_bytes(); assert digest(raw) == entry["sha256"]; content[entry["sha256"]] = raw
        raw = content[entry["sha256"]]; assert len(raw) == entry["bytes"]
        aliases[name] = entry; bodies[name] = raw
    assert len(content) == index["unique_blobs"]
    prefix = "dev/copypaste-platform-publication-125/.data/publication-native-126/backend-"
    selected_number = index["selected_full_attempt"]
    assert re.fullmatch(r"[0-9]{2}", selected_number) and int(selected_number) >= 10
    targeted_number = index["targeted_native_attempt"]
    assert re.fullmatch(r"[0-9]{2}", targeted_number) and 9 <= int(targeted_number) < int(selected_number)
    selected = None
    for attempt in index["attempts"]:
        base = prefix + attempt["number"]; raw = json.loads(bodies[base + ".json"])
        assert raw["status"] == attempt["status"] and raw["counts"] == attempt["counts"]
        assert raw["source_unchanged"] and raw["owned_database_shutdown"] and raw["owned_database_port_closed"]
        assert digest(bodies[base + "-verifier.mjs"]) == raw["verifier_sha256"]
        assert digest(bodies[base + ".tap"]) == raw["raw_report"]["sha256"]
        assert digest(bodies[base + "-cleanup.json"]) == raw["fixture_cleanup"]["sha256"]
        cleanup = json.loads(bodies[base + "-cleanup.json"])
        assert cleanup["status"] == "passed" and cleanup["workers_exited"] and cleanup["actual_filesystem_checked"] and all(row["reclaimed"] for row in cleanup["results"])
        for name, expected in raw["source_files"].items(): assert digest(bodies[base + "-sources/" + name]) == expected
        if attempt["number"] in [targeted_number, selected_number]:
            counts = raw["counts"]; assert raw["status"] == "passed" and counts["tests"] == counts["pass"] and all(counts[k] == 0 for k in ["fail", "cancelled", "skipped", "todo"])
        if attempt["number"] == selected_number: selected = raw
    interrupted = json.loads(bodies[prefix + "06-interruption-observation.json"])
    assert index["interrupted_attempts"] == [{"number": "06", "status": "interrupted_without_terminal_receipt"}]
    assert prefix + "06.json" not in bodies and prefix + "06-cleanup.json" not in bodies
    assert interrupted["claims_full_regression_passed"] is False and interrupted["terminal_counts_unknown"] and interrupted["original_fixture_cleanup_unknown"]
    assert interrupted["original_tap_sha256"] == digest(bodies[prefix + "06.tap"])
    assert interrupted["original_verifier_sha256"] == digest(bodies[prefix + "06-verifier.mjs"])
    assert interrupted["original_source_files_preserved"] == sum(name.startswith(prefix + "06-sources/") for name in bodies)
    assert selected and set(selected["test_files"]) == REQUIRED and selected["counts"]["pass"] > 133
    targeted = json.loads(bodies[prefix + targeted_number + ".json"])
    assert targeted["counts"]["pass"] == 5
    production_prefixes = tuple("copypaste-platform/" + name for name in ["src/", "catalog/", "migrations/", "skills/", "contracts/"])
    assert {name: value for name, value in targeted["source_files"].items() if name.startswith(production_prefixes)} == {
        name: value for name, value in selected["source_files"].items() if name.startswith(production_prefixes)}
    analysis = json.loads(bodies[prefix + "07.json"])
    assert analysis["status"] == "passed" and analysis["counts"]["tests"] == analysis["counts"]["pass"] == 12
    assert all(analysis["counts"][key] == 0 for key in ["fail", "cancelled", "skipped", "todo"])
    probe_prefix = "dev/copypaste-platform-publication-125/.data/pre-turn-startup-126/probe-"
    green = None
    for probe in index["startup_probes"]:
        base = probe_prefix + probe["number"]; raw = json.loads(bodies[base + ".json"])
        assert raw["status"] == probe["status"] and raw["counts"] == probe["counts"] and raw["mode"] == probe["mode"]
        assert raw["source_unchanged"] and raw["original_fixture_set_restored"] and raw["typecheck_exit"] == 0
        assert digest(bodies[base + "-verifier.mjs"]) == raw["verifier_sha256"]
        assert digest(bodies[base + ".tap"]) == raw["raw_report_sha256"]
        for name, expected in raw["source_files"].items(): assert digest(bodies[base + "-sources/" + name]) == expected
        if probe["number"] == "01":
            assert raw["status"] == "failed" and raw["mode"] == "red" and raw["known_pre_turn_failure_reproduced"]
            assert raw["counts"]["fail"] == 1 and raw["counts"]["pass"] == 0 and raw["test_exit"] == 1
        if probe["number"] == index["startup_green_attempt"]: green = raw
    assert green and green["status"] == "passed" and green["mode"] == "green" and green["test_exit"] == 0
    assert green["counts"]["tests"] == green["counts"]["pass"] == 9
    assert all(green["counts"][key] == 0 for key in ["fail", "cancelled", "skipped", "todo"])
    for name, expected in green["source_files"].items(): assert selected["source_files"]["copypaste-platform/" + name] == expected, name
    assert index["current_sources"] == {"dev/copypaste-platform/" + key.removeprefix("copypaste-platform/"): value for key, value in selected["source_files"].items()}
    if current:
        for name, expected in index["current_sources"].items(): assert digest(safe_file(name).read_bytes()) == expected, name
    return {"status": "passed", "scope": index["scope"], "index": ref(INDEX), "entries": len(entries), "unique_blobs": len(content),
        "qualified_source_files": len(index["current_sources"]), "current_primary_sources_checked": current,
        "full_related_counts": selected["counts"], "pre_turn_counts": green["counts"],
        "attempts_preserved": len(index["attempts"]) + len(index["interrupted_attempts"]) + len(index["startup_probes"]), "verifier_sha256": digest(Path(__file__).read_bytes())}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(); parser.add_argument("mode", choices=["archive", "verify"])
    parser.add_argument("--selected"); parser.add_argument("--targeted"); parser.add_argument("--startup"); args = parser.parse_args()
    archive(args.selected, args.targeted, args.startup) if args.mode == "archive" else print(json.dumps(verify(), ensure_ascii=False))
