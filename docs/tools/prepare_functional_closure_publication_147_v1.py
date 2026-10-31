"""Bind the reviewed increment without replacing any historical proof layer."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import json
import subprocess
from concurrent.futures import ThreadPoolExecutor

from publication_proofs import load_proofs, write_shards
from prepare_receipt_publication_131_v1 import changes, blobs
from functional_closure_147_binding_v1 import qualify_backend

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = ROOT / "docs/quality/workmate-publication-147.json"
OLD = ROOT / "docs/quality/workmate-publication-146.json"
CP = ROOT / "docs/quality/functional-closure-checkpoint-147.json"
BASE_DOCS = "8755c105dbc831149cefb9e065b3f6e0cf45097c"
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


def qualify():
    # The completed recorder already validated every original source object at
    # these six immutable commits. Recheck current working sources and the small
    # central archive; the incremental Git proof below covers all new objects.
    cp = read(CP)
    binding=qualify_backend(cp['selected_attempts']['backend'])
    assert cp['backend_qualification']==binding and cp['binding_helper']==ref(ROOT/'docs/tools/functional_closure_147_binding_v1.py')
    archive = ROOT / 'docs/quality/functional-closure-evidence-147'
    assert cp['status'] == 'verified_functional_closure_slice'
    assert cp['recorder_sha256'] == sha((ROOT/'docs/tools/record_functional_closure_147_v1.py').read_bytes())
    assert cp['evidence_index'] == ref(archive/'index.json')
    index = read(archive/'index.json')
    def check_source(item):
        name,digest = item
        assert sha((ROOT/name).read_bytes()) == digest,name
    with ThreadPoolExecutor(max_workers=16) as pool:
        list(pool.map(check_source,{**cp['source_files'],**cp['qualification_sources']}.items()))
    for item in index['originals']:
        body=(archive/item['archive']).read_bytes()
        assert sha(body)==item['sha256'] and len(body)==item['bytes']
    for item in cp['git_source_proofs']:
        assert git(REPOS[item['branch']],'rev-parse','HEAD').decode().strip()==item['commit']
    for kind,stem in cp['selected_attempts'].items():
        report=read(ROOT/'dev/copypaste-delivery/evidence/functional-closure-147'/(stem+'.json'))
        assert report['status']=='passed' and report['source_unchanged']
        if kind in ['native','extension']:assert report['exit_code']==0
        else:
            assert report['result_exit_code']==0 and report['owned_database_shutdown']
            assert report.get('owned_database_port_closed',all(report.get('ports_closed',{}).values()))
        for key in ['source_manifest','raw_report','verifier']:
            item=report[key]
            assert sha((ROOT/'dev/copypaste-delivery'/item['path']).read_bytes())==item['sha256']
    for item in cp['media_files']:
        assert sha((ROOT/'dev'/item['path']).read_bytes())==item['sha256']
    for item in cp['shared_media_copies']:
        assert sha((ROOT/item['path']).read_bytes())==item['sha256']
    assert cp['backend_case_counts']==[3] and binding['verified_case_coverage']==95 and len(cp['ui_checks'])==5
    return {'status':'passed','source_files':len(cp['source_files']),'backend_case_coverage':binding['verified_case_coverage'],'current_backend_cases':sum(cp['backend_case_counts']),'native_cases':sum(cp['native_case_counts']),'ui_checks':5,
            'media_files':len(cp['media_files']),'originals':len(index['originals']),'new_full_acceptance_closures':0,
            'binding':'Completed original recorder at unchanged component commits; current sources/central originals/media rechecked. All incremental Git objects are bound below. No test or historical-runtime replay.'}


def layers():
    old = read(OLD)
    result = list(old["historical_layers"])
    result.append({"stage": 146, "manifest": ref(OLD), "proofs": old["incremental_proofs"],
                   "proof_count": 1938, "scope": "Historical original identities; not relabelled as current runtime qualification"})
    for row in result:
        assert row["manifest"] == ref(ROOT / row["manifest"]["path"])
        assert len(load_proofs(row["proofs"], ROOT)) == row["proof_count"] == {128: 357840, 130: 7754, 131: 7862, 132: 2755, 133: 3352, 134: 3571, 135: 4183, 136: 2444, 137: 1789, 138: 1934, 139: 1934, 140: 1958, 141: 27, 142: 1819, 143: 1937, 144: 1518, 145: 1750, 146: 1938}[row["stage"]]
    return result


def prepare():
    assert not MANIFEST.exists()
    git(ROOT, "merge-base", "--is-ancestor", BASE_DOCS, "HEAD")
    qualification, historical = qualify(), layers()
    old = read(OLD)
    previous = ROOT / "docs/quality/history/stage147-previous-publication.json"
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
    added = write_shards(rows, ROOT, 147)
    value = {"at": datetime.now(timezone.utc).isoformat(), "status": "ready_for_incremental_remote_verification",
             "scope": "Stage147 adds typed named workflow contracts, exact specialist file versions, complete named outputs and fixed recurring input review, plus actual paid cloud Codex to packaged local Codex preparation, explicit private file return and original cloud thread continuation. Current source/authentication, unique admission, fees and private upload scope are enforced. Synthetic internal model data is explicit. Original attempts and all original complete professional, production and OS acceptance scopes are retained.",
             "remote": old["remote"], "baseline_manifest": ref(previous), "baseline_manifest_current_file": ref(OLD),
             "baseline_documentation_commit": BASE_DOCS,
             "baseline_component_commits": {k: v for k, v in baselines.items() if k != "docs"},
             "historical_layers": historical, "total_historical_proof_entries_retained": sum(r["proof_count"] for r in historical),
             "historical_identities_removed": 0, "historical_proofs_relabelled_as_current": False,
             "components": components, "checkpoint": ref(CP), "runtime_checkpoint": ref(ROOT / "docs/quality/functional-closure-checkpoint-147.json"), "qualification": qualification,
             "incremental_proofs": added, "incremental_paths": len(rows),
             "documentation_self_binding": "The manifest and new proof shards bind to the final docs/main commit without recursively hashing themselves.",
             "current_full_platform_regression_rerun": False, "new_full_acceptance_closures": 0,
             "preparer": ref(Path(__file__)), "publisher": ref(ROOT / "docs/tools/publish_functional_closure_publication_147_v1.py"),
             "publication_auditor": ref(ROOT / "docs/tools/audit_functional_closure_publication_147_v1.py")}
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
    assert value["total_historical_proof_entries_retained"] == 406365 and value["historical_identities_removed"] == 0
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
    return {"status": "passed", "historical_proofs_retained": 406365, "new_current_git_paths": checked,
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
