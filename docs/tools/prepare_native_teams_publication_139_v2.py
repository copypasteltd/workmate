"""Bind the reviewed increment without replacing any historical proof layer."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import json
import subprocess

from publication_proofs import load_proofs, write_shards
from prepare_receipt_publication_131_v1 import changes, blobs
from record_native_team_release_139_v2 import verify as qualify

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "docs/quality/workmate-publication-139.json"
OLD = ROOT / "docs/quality/workmate-publication-138.json"
CP = ROOT / "docs/quality/native-teams-release-checkpoint-139.json"
BASE_DOCS = "c7a5524ee0e8987d662e817849e82986f31a5f76"
MAPPING = {"backend": "platform", "web": "web", "admin": "admin", "desktop": "desktop", "extension": "extension", "delivery": "delivery"}
REPOS = {branch: ROOT / ("dev/copypaste-" + component) for branch, component in MAPPING.items()}
REPOS["docs"] = ROOT


def sha(body):
    return sha256(body).hexdigest()


def read(file):
    return json.loads(file.read_bytes())


def git(repo, *args):
    return subprocess.check_output(["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", str(repo), *args], stderr=subprocess.PIPE)


def ref(file):
    return {"path": file.relative_to(ROOT).as_posix(), "sha256": sha(file.read_bytes())}


def layers():
    old = read(OLD)
    result = list(old["historical_layers"])
    result.append({"stage": 138, "manifest": ref(OLD), "proofs": old["incremental_proofs"],
                   "proof_count": 1934, "scope": "Historical original identities; not relabelled as current runtime qualification"})
    for row in result:
        assert row["manifest"] == ref(ROOT / row["manifest"]["path"])
        assert len(load_proofs(row["proofs"], ROOT)) == row["proof_count"] == {128: 357840, 130: 7754, 131: 7862, 132: 2755, 133: 3352, 134: 3571, 135: 4183, 136: 2444, 137: 1789, 138: 1934}[row["stage"]]
    return result


def prepare():
    assert not MANIFEST.exists()
    git(ROOT, "merge-base", "--is-ancestor", BASE_DOCS, "HEAD")
    qualification, historical = qualify(), layers()
    old = read(OLD)
    previous = ROOT / "docs/quality/history/stage139-previous-publication.json"
    if previous.exists():
        assert previous.read_bytes() == OLD.read_bytes(), "Keep the original failed preparer archive"
    else:
        with previous.open("xb") as stream:
            stream.write(OLD.read_bytes())
    git(ROOT, "add", "--", previous.relative_to(ROOT).as_posix())
    baselines = {c["branch"]: c["commit"] for c in old["components"]}
    baselines["docs"] = BASE_DOCS
    rows, components = [], []
    for branch, repo in REPOS.items():
        if branch != "docs":
            git(repo, "merge-base", "--is-ancestor", baselines[branch], "HEAD")
            # Exact frozen source and every incremental working byte are checked below.
            # Untouched historical evidence is already bound to the retained commit.
            assert not git(repo, "diff", "--cached", "--name-only", "HEAD", "--"), branch
            assert git(repo, "remote", "get-url", "origin").decode().strip() == old["remote"]
            components.append({"branch": branch, "component": MAPPING[branch], "directory": repo.relative_to(ROOT).as_posix(),
                               "commit": git(repo, "rev-parse", "HEAD").decode().strip(),
                               "tree": git(repo, "rev-parse", "HEAD^{tree}").decode().strip()})
        entries = changes(repo, baselines[branch]) if branch != "docs" else list({**dict(changes(repo, BASE_DOCS)), **dict(changes(repo, None))}.items())
        for name, oid, body in blobs(repo, entries):
            assert (repo / name).read_bytes() == body, "Proof bytes differ from working file: " + name
            rows.append({"repository": branch, "path": name, "sha256": sha(body), "git_blob_oid": oid,
                         "url": "https://github.com/copypasteltd/workmate/blob/" + branch + "/" + name})
    assert rows
    added = write_shards(rows, ROOT, 139)
    value = {"at": datetime.now(timezone.utc).isoformat(), "status": "ready_for_incremental_remote_verification",
             "scope": "Stage139 native specialist teams with independently frozen roles, parallel/dependent actual local Codex execution, durable receipts, immutable customer permissions and complete team ZIP with synthetic business content. Original historical layers retain their identities and scopes.",
             "remote": old["remote"], "baseline_manifest": ref(previous), "baseline_manifest_current_file": ref(OLD),
             "baseline_documentation_commit": BASE_DOCS,
             "baseline_component_commits": {k: v for k, v in baselines.items() if k != "docs"},
             "historical_layers": historical, "total_historical_proof_entries_retained": sum(r["proof_count"] for r in historical),
             "historical_identities_removed": 0, "historical_proofs_relabelled_as_current": False,
             "components": components, "checkpoint": ref(CP), "runtime_checkpoint": ref(ROOT / "docs/quality/native-teams-checkpoint-139.json"), "qualification": qualification,
             "incremental_proofs": added, "incremental_paths": len(rows),
             "documentation_self_binding": "The manifest and new proof shards bind to the final docs/main commit without recursively hashing themselves.",
             "current_full_platform_regression_rerun": False, "new_full_acceptance_closures": 0,
             "preparer": ref(Path(__file__)), "publisher": ref(ROOT / "docs/tools/publish_native_teams_publication_139_v1.py"),
             "publication_auditor": ref(ROOT / "docs/tools/audit_native_teams_publication_139_v1.py")}
    with MANIFEST.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    git(ROOT, "add", "--", MANIFEST.relative_to(ROOT).as_posix(), *[r["path"] for r in added["proof_shards"]])
    print(json.dumps({"status": "prepared", "historical_proofs_retained": value["total_historical_proof_entries_retained"],
                      "new_paths": len(rows), "new_shards": len(added["proof_shards"])}))


def verify():
    value = read(MANIFEST)
    assert value["status"] == "ready_for_incremental_remote_verification"
    assert value["preparer"] == ref(Path(__file__)) and value["publisher"] == ref(ROOT / value["publisher"]["path"])
    assert value["publication_auditor"] == ref(ROOT / value["publication_auditor"]["path"])
    assert value["checkpoint"] == ref(CP) and value["qualification"] == qualify()
    assert value["historical_layers"] == layers()
    assert value["total_historical_proof_entries_retained"] == 393484 and value["historical_identities_removed"] == 0
    previous = ROOT / value["baseline_manifest"]["path"]
    assert value["baseline_manifest"] == ref(previous) and previous.read_bytes() == OLD.read_bytes()
    assert value["baseline_manifest_current_file"] == ref(OLD)
    rows, groups = load_proofs(value["incremental_proofs"], ROOT), {}
    for row in rows:
        groups.setdefault(row["repository"], []).append(row)
    checked = 0
    for branch, repo in REPOS.items():
        group = groups.get(branch, [])
        identities = {r["path"]: r for r in group}
        tree = {}
        for raw in git(repo, "ls-tree", "-rz", "HEAD").split(b"\0"):
            if raw:
                metadata, name = raw.split(b"\t", 1)
                tree[name.decode()] = metadata.decode().split()[2]
        for row in group:
            assert tree[row["path"]] == row["git_blob_oid"]
        for name, oid, body in blobs(repo, [(r["path"], r["git_blob_oid"]) for r in group]):
            assert sha(body) == identities[name]["sha256"] and (repo / name).read_bytes() == body, name
            checked += 1
        base = BASE_DOCS if branch == "docs" else value["baseline_component_commits"][branch]
        actual = {name for name, _ in changes(repo, base)}
        expected = set(identities)
        if branch == "docs":
            expected |= {MANIFEST.relative_to(ROOT).as_posix(), *[r["path"] for r in value["incremental_proofs"]["proof_shards"]]}
        assert actual == expected, "Committed path coverage mismatch: " + branch
    assert checked == value["incremental_paths"]
    for component in value["components"]:
        repo = REPOS[component["branch"]]
        assert git(repo, "rev-parse", "HEAD").decode().strip() == component["commit"]
        git(repo, "merge-base", "--is-ancestor", value["baseline_component_commits"][component["branch"]], "HEAD")
    for file in [MANIFEST, *[ROOT / r["path"] for r in value["incremental_proofs"]["proof_shards"]]]:
        assert git(ROOT, "show", "HEAD:" + file.relative_to(ROOT).as_posix()) == file.read_bytes()
    return {"status": "passed", "historical_proofs_retained": 393484, "new_current_git_paths": checked,
            "historical_git_blobs_rechecked_by_this_verifier": False,
            "security_scan": "Publisher separately audits newly reachable objects and every current path, retaining the published full-history baseline"}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument("--prepare", action="store_true")
    group.add_argument("--verify", action="store_true")
    args = parser.parse_args()
    if args.prepare:
        prepare()
    else:
        print(json.dumps(verify()))
