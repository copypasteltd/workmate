"""Preserve the runtime qualification and bind its exact bytes to current Git."""
from pathlib import Path
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import argparse
import json
import subprocess

from record_native_teams_139_v1 import (
    ROOT, DEV, RAW, CP as RUNTIME_CP, OUT as RUNTIME_OUT,
    sha, read, ref, encoded, report, credentials, scan,
)
from prepare_receipt_publication_131_v1 import blobs

CP = ROOT / "docs/quality/native-teams-release-checkpoint-139.json"
OUT = ROOT / "docs/quality/native-teams-release-evidence-139"
EXPECTED_RUNTIME = "a1c264393faf83d43bf6887192144b99ab0062c052d50b307148af656c862b7d"
MAPPING = {"platform": "backend", "web": "web", "admin": "admin", "desktop": "desktop", "extension": "extension", "delivery": "delivery"}


def git(repo, *args):
    return subprocess.check_output(["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", str(repo), *args], stderr=subprocess.PIPE)


def runtime():
    assert sha(RUNTIME_CP.read_bytes()) == EXPECTED_RUNTIME
    value = read(RUNTIME_CP)
    assert value["status"] == "verified_native_specialist_teams"
    assert value["evidence_index"] == ref(RUNTIME_OUT / "index.json")
    index = read(RUNTIME_OUT / "index.json")
    assert index["recorder_sha256"] == sha((ROOT / "docs/tools/record_native_teams_139_v1.py").read_bytes())
    needles = credentials()
    for item in index["originals"]:
        body = (RUNTIME_OUT / item["archive"]).read_bytes()
        assert len(body) == item["bytes"] and sha(body) == item["sha256"]
        scan(item["source"], body, needles)
    for stem in value["selected_attempts"].values():
        row, _ = report(stem)
        assert row["status"] == "passed" and row["sources_unchanged"] and row["database_shutdown"] == 0
    for item in value["media_files"]:
        assert sha((DEV / item["path"]).read_bytes()) == item["sha256"]
    for item in value["downloaded_archives"]:
        assert ref(ROOT / item["path"])["sha256"] == item["sha256"]
    return value


def check_sources(sources, qualification):
    expected = {**sources, **qualification}

    def working(item):
        name, digest = item
        assert sha((ROOT / name).read_bytes()) == digest, name

    with ThreadPoolExecutor(max_workers=16) as pool:
        list(pool.map(working, expected.items()))
    results = []
    for component, branch in MAPPING.items():
        repo = DEV / ("copypaste-" + component)
        prefix = "dev/copypaste-" + component + "/"
        subset = {name.removeprefix(prefix): digest for name, digest in expected.items() if name.startswith(prefix)}
        tree = {}
        for row in git(repo, "ls-tree", "-rz", "HEAD").split(b"\0"):
            if row:
                metadata, name = row.split(b"\t", 1)
                tree[name.decode()] = metadata.decode().split()[2]
        for name, _, body in blobs(repo, [(name, tree[name]) for name in subset]):
            assert sha(body) == subset[name], "Git bytes differ from qualified source: " + branch + "/" + name
        assert not git(repo, "diff", "--cached", "--name-only", "HEAD", "--")
        results.append({"branch": branch, "commit": git(repo, "rev-parse", "HEAD").decode().strip(), "exact_paths": len(subset)})
    assert sum(r["exact_paths"] for r in results) == len(expected)
    return results


def verify():
    value, base = read(CP), runtime()
    assert value["status"] == "verified_exact_native_team_release_bytes"
    assert value["runtime_checkpoint"] == ref(RUNTIME_CP)
    assert value["recorder_sha256"] == sha(Path(__file__).read_bytes())
    assert value["source_files"].keys() == base["source_files"].keys()
    changed = [n for n, digest in base["source_files"].items() if value["source_files"][n] != digest]
    assert changed == ["dev/copypaste-platform/.gitattributes"]
    assert value["qualification_sources"] == {
        **base["qualification_sources"],
        "dev/copypaste-delivery/.gitattributes": sha((DEV / "copypaste-delivery/.gitattributes").read_bytes()),
    }
    for item in value["metadata_archives"]:
        assert ref(ROOT / item["path"])["sha256"] == item["sha256"]
    assert value["counts"] == base["counts"] and value["new_full_acceptance_closures"] == 0
    assert check_sources(value["source_files"], value["qualification_sources"]) == value["git_source_proofs"]
    assert sha((DEV / "copypaste-desktop/.gitattributes").read_bytes()) == "82eabadd2ae6562e1a246a3458eedde1ba913ee9837ee40f464d60e5d8f9185e"
    return {"status": "verified", "checkpoint_sha256": sha(CP.read_bytes()), "source_files": len(value["source_files"]),
            "runtime_checkpoint_unchanged": True, "runtime_source_changes": 0, "version_control_source_changes": 1,
            "exact_git_paths": sum(r["exact_paths"] for r in value["git_source_proofs"])}


def record():
    assert not CP.exists() and not OUT.exists()
    base = runtime()
    sources = dict(base["source_files"])
    sources["dev/copypaste-platform/.gitattributes"] = sha((DEV / "copypaste-platform/.gitattributes").read_bytes())
    qualification = {**base["qualification_sources"],
                     "dev/copypaste-delivery/.gitattributes": sha((DEV / "copypaste-delivery/.gitattributes").read_bytes())}
    assert sources["dev/copypaste-platform/.gitattributes"] != base["source_files"]["dev/copypaste-platform/.gitattributes"]
    proofs = check_sources(sources, qualification)
    OUT.mkdir(parents=True)
    archives = []

    def retain(name, body):
        file = OUT / (sha(body) + ".blob")
        if not file.exists():
            with file.open("xb") as stream:
                stream.write(body)
        else:
            assert file.read_bytes() == body
        archives.append({"source": name, **ref(file)})

    _, original_sources = report(base["selected_attempts"]["backend"])
    old_attribute = original_sources["copypaste-platform/.gitattributes"]
    retain("Original runtime-qualified backend Git attributes", (DEV / "copypaste-delivery" / old_attribute["path"]).read_bytes())
    for component in ["platform", "delivery"]:
        retain("Exact release " + component + " Git attributes", (DEV / ("copypaste-" + component) / ".gitattributes").read_bytes())
    value = {"at": datetime.now(timezone.utc).isoformat(), "status": "verified_exact_native_team_release_bytes",
             "runtime_checkpoint": ref(RUNTIME_CP), "original_evidence_index": base["evidence_index"],
             "recorder_sha256": sha(Path(__file__).read_bytes()), "source_files": sources,
             "qualification_sources": qualification, "metadata_archives": archives, "git_source_proofs": proofs,
             "counts": base["counts"], "selected_attempts": base["selected_attempts"],
             "media_files": base["media_files"], "downloaded_archives": base["downloaded_archives"],
             "runtime_source_changes": 0, "new_full_acceptance_closures": 0,
             "scope": "Retain the exact original 177 related checks, six actual packaged Windows journey checks and all raw failures. No runtime/model test is rerun or relabelled. Only backend Git attributes change after runtime qualification; delivery Git attributes also preserve original verifier bytes. Every current source and qualification entry matches both working bytes and its actual Git blob. Strict byte equality is retained; no newline-equivalence exception is used.",
             "unchanged_requirements": {"accepted": ["REQ-095"], "required_open": 88, "unconfirmed_suggestions": 12, "optional_open": 1}}
    CP.write_bytes(encoded(value))
    print(json.dumps(verify()))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--record", action="store_true")
    group.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    if args.record:
        record()
    else:
        print(json.dumps(verify()))
