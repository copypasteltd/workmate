"""Bind Stage131 Git bytes while retaining the immutable Stage128 and Stage130 layers.

The baseline is historical. New proofs override only their corresponding current
paths; old identities and original source claims are never relabelled or removed.
"""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import json
import subprocess

from publication_proofs import load_proofs, write_shards
from record_receipt_sync_131_v1 import verify as qualify

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "docs/quality/workmate-publication-131.json"
OLD = ROOT / "docs/quality/workmate-publication-130.json"
CP = ROOT / "docs/quality/receipt-sync-checkpoint-131.json"
BASE_DOCS = "558c683f97b72f1297e05f5675fe424d9fc6b6af"
MAPPING = {"backend": "platform", "web": "web", "admin": "admin", "desktop": "desktop", "extension": "extension", "delivery": "delivery"}
REPOS = {branch: ROOT / ("dev/copypaste-" + component) for branch, component in MAPPING.items()}
REPOS["docs"] = ROOT


def sha(body):
    return sha256(body).hexdigest()


def read(file):
    return json.loads(file.read_bytes())


def git(repo, *args, data=None):
    return subprocess.check_output(["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", str(repo), *args], input=data, stderr=subprocess.PIPE)


def ref(file):
    return {"path": file.relative_to(ROOT).as_posix(), "sha256": sha(file.read_bytes())}


def changes(repo, base=None):
    args = ["diff", "--no-renames", "--raw", "--no-abbrev", "-z"]
    args += [base, "HEAD"] if base else ["--cached"]
    fields = git(repo, *args).split(b"\0")
    result = []
    for index in range(0, len(fields) - 1, 2):
        metadata = fields[index].decode().split()
        assert len(metadata) == 5 and metadata[4] in ["A", "M"], "Unexpected deletion, rename or merge; preserve and review"
        name = fields[index + 1].decode("utf-8")
        result.append((name, metadata[3]))
    return result


def blobs(repo, entries):
    process = subprocess.Popen(["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", str(repo), "cat-file", "--batch"], stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    cache = {}
    try:
        for name, oid in entries:
            if oid not in cache:
                process.stdin.write((oid + "\n").encode())
                process.stdin.flush()
                header = process.stdout.readline().decode().split()
                assert header[0] == oid and header[1] == "blob"
                body = process.stdout.read(int(header[2]))
                assert len(body) == int(header[2]) and process.stdout.read(1) == b"\n"
                cache[oid] = body
            yield name, oid, cache[oid]
        process.stdin.close()
        assert process.wait(timeout=30) == 0
    finally:
        if process.poll() is None:
            process.kill()
            process.wait()


def prepare():
    assert not MANIFEST.exists()
    assert git(ROOT, "rev-parse", "HEAD").decode().strip() == BASE_DOCS
    qualification = qualify()
    old = read(OLD)
    original = read(ROOT / old["baseline_manifest_current_file"]["path"])
    prior = load_proofs(original, ROOT)
    overlay = load_proofs(old["incremental_proofs"], ROOT)
    assert len(prior) == 357840
    assert len(overlay) == 7754
    previous = ROOT / "docs/quality/history/stage131-previous-publication.json"
    with previous.open("xb") as stream:
        stream.write(OLD.read_bytes())
    git(ROOT, "add", "--", previous.relative_to(ROOT).as_posix())
    rows, components = [], []
    baselines = {item["branch"]: item["commit"] for item in old["components"]}
    baselines["docs"] = BASE_DOCS
    for branch, repo in REPOS.items():
        if branch != "docs":
            git(repo, "merge-base", "--is-ancestor", baselines[branch], "HEAD")
            assert not git(repo, "status", "--porcelain", "--untracked-files=no"), branch
            assert git(repo, "remote", "get-url", "origin").decode().strip() == old["remote"]
            components.append({"branch": branch, "component": MAPPING[branch], "directory": repo.relative_to(ROOT).as_posix(),
                               "commit": git(repo, "rev-parse", "HEAD").decode().strip(), "tree": git(repo, "rev-parse", "HEAD^{tree}").decode().strip()})
        entries = changes(repo, baselines[branch] if branch != "docs" else None)
        for name, oid, body in blobs(repo, entries):
            assert (repo / name).read_bytes() == body, "New proof bytes must match the committed or staged working file: " + name
            rows.append({"repository": branch, "path": name, "sha256": sha(body), "git_blob_oid": oid,
                         "url": "https://github.com/copypasteltd/workmate/blob/" + branch + "/" + name})
    assert rows
    added = write_shards(rows, ROOT, 131)
    value = {"at": datetime.now(timezone.utc).isoformat(), "status": "ready_for_incremental_remote_verification",
             "scope": "Stage131 customer-local Desktop durable child-before-parent receipt synchronization, local grant withdrawal and application restoration. Historical proof layers retain original commits and scope; new proofs bind this reviewed increment.",
             "remote": old["remote"], "baseline_manifest": ref(previous), "baseline_manifest_current_file": ref(OLD),
             "baseline_documentation_commit": BASE_DOCS, "baseline_component_commits": {k: v for k, v in baselines.items() if k != "docs"},
             "historical_proof_count_retained": len(prior), "historical_proof_shards_retained": original["proof_shards"],
             "previous_incremental_proof_count_retained": len(overlay), "previous_incremental_proofs_retained": old["incremental_proofs"],
             "total_historical_proof_entries_retained": len(prior) + len(overlay),
             "historical_identities_removed": 0, "historical_proofs_relabelled_as_current": False,
             "components": components, "checkpoint": ref(CP), "qualification": qualification,
             "incremental_proofs": added, "incremental_paths": len(rows),
             "documentation_self_binding": "The manifest and its new proof shards are verified as exact blobs of the final docs/main commit by the publisher; their hashes are not recursively embedded in themselves.",
             "current_full_platform_regression_rerun": False, "new_full_acceptance_closures": 0,
             "preparer": ref(Path(__file__)), "publisher": ref(ROOT / "docs/tools/publish_receipt_sync_131_v1.py")}
    with MANIFEST.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    git(ROOT, "add", "--", MANIFEST.relative_to(ROOT).as_posix(), *[row["path"] for row in added["proof_shards"]])
    print(json.dumps({"status": "prepared", "historical_proofs_retained": len(prior), "new_paths": len(rows), "new_shards": len(added["proof_shards"])}))


def verify():
    value = read(MANIFEST)
    assert value["status"] == "ready_for_incremental_remote_verification"
    assert value["preparer"] == ref(Path(__file__))
    assert value["publisher"] == ref(ROOT / value["publisher"]["path"])
    assert value["checkpoint"] == ref(CP)
    assert value["qualification"] == qualify()
    previous = ROOT / value["baseline_manifest"]["path"]
    assert value["baseline_manifest"] == ref(previous) and previous.read_bytes() == OLD.read_bytes()
    assert value["baseline_manifest_current_file"] == ref(OLD)
    old = read(previous)
    original = read(ROOT / old["baseline_manifest_current_file"]["path"])
    prior = load_proofs(original, ROOT)
    overlay = load_proofs(old["incremental_proofs"], ROOT)
    assert len(prior) == value["historical_proof_count_retained"] == 357840
    assert value["historical_proof_shards_retained"] == original["proof_shards"] and value["historical_identities_removed"] == 0
    assert len(overlay) == value["previous_incremental_proof_count_retained"] == 7754
    assert value["previous_incremental_proofs_retained"] == old["incremental_proofs"]
    assert value["total_historical_proof_entries_retained"] == len(prior) + len(overlay)
    rows = load_proofs(value["incremental_proofs"], ROOT)
    groups = {}
    for row in rows:
        groups.setdefault(row["repository"], []).append(row)
    checked = 0
    for branch, group in groups.items():
        repo = REPOS[branch]
        identities = {row["path"]: row for row in group}
        # The tree verifies the filename-to-object binding as well as content.
        tree = {}
        for raw in git(repo, "ls-tree", "-rz", "HEAD").split(b"\0"):
            if not raw:
                continue
            metadata, name = raw.split(b"\t", 1)
            tree[name.decode("utf-8")] = metadata.decode().split()[2]
        for row in group:
            assert tree[row["path"]] == row["git_blob_oid"]
        for name, oid, body in blobs(repo, [(row["path"], row["git_blob_oid"]) for row in group]):
            assert sha(body) == identities[name]["sha256"] and (repo / name).read_bytes() == body, name
            checked += 1
    assert checked == value["incremental_paths"]
    for component in value["components"]:
        repo = REPOS[component["branch"]]
        assert git(repo, "rev-parse", "HEAD").decode().strip() == component["commit"]
        git(repo, "merge-base", "--is-ancestor", value["baseline_component_commits"][component["branch"]], "HEAD")
    assert git(ROOT, "show", "HEAD:docs/quality/workmate-publication-131.json") == MANIFEST.read_bytes()
    for row in value["incremental_proofs"]["proof_shards"]:
        assert git(ROOT, "show", "HEAD:" + row["path"]) == (ROOT / row["path"]).read_bytes()
    return {"status": "passed", "historical_proofs_retained": len(prior), "previous_incremental_proofs_retained": len(overlay), "new_current_git_paths": checked,
            "historical_git_blobs_rechecked_by_this_verifier": False, "full_history_security_scan": "Separate required publisher check"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--prepare", action="store_true")
    parser.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    assert args.prepare != args.verify
    if args.prepare:
        prepare()
    else:
        print(json.dumps(verify()))
