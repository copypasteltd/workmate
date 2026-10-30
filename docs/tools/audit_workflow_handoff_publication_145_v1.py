"""Read-only incremental audit against the actual published Stage144 baseline.

Old history is not presented as rescanned. New reachable blobs, every current
path, new commit paths and current bilingual README destinations are checked.
Credential matches are never printed.
"""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import json
import re
import subprocess

from audit_workmate_publication import configured_credentials, readme_target_file
from record_source_build_reproduction_v1 import scan
from prepare_workflow_handoff_publication_145_v1 import ROOT, REPOS, BASE_DOCS, MANIFEST, git, read


def digest(body):
    return sha256(body).hexdigest()


def baseline():
    cp = read(ROOT / "docs/quality/workflow-handoff-checkpoint-145.json")
    archive = ROOT / "docs/quality/workflow-handoff-evidence-145"
    index = read(archive / "index.json")
    entry = cp["previous_publication_receipt"]
    file = archive / entry["archive"]
    assert digest(file.read_bytes()) == entry["sha256"]
    receipt = read(file)
    assert receipt["status"] == "pushed_and_verified" and receipt["remote_after"]["docs"] == BASE_DOCS
    raw = next(r for r in index["originals"] if r["source"] == entry["source"].rsplit("/",1)[0] + "/commands.log")
    assert digest((archive / raw["archive"]).read_bytes()) == raw["sha256"] == receipt["raw_log_sha256"]
    historical = receipt.get("complete_history_and_links", receipt.get("baseline_complete_history_scan"))
    assert historical["status"] == "passed" and historical["problems"] == 0
    incremental = receipt["incremental_history_and_links"]
    row = next(r for r in index["originals"] if r["source"] == incremental["path"])
    assert digest((archive / row["archive"]).read_bytes()) == row["sha256"] == incremental["sha256"]
    checked = read(archive / row["archive"])
    assert checked["status"] == "passed" and checked["problems"] == 0
    receipt["complete_history_and_links"] = historical
    return receipt


def audit():
    manifest, previous, needles = read(MANIFEST), baseline(), configured_credentials()
    bases = {**manifest["baseline_component_commits"], "docs": BASE_DOCS, "main": BASE_DOCS}
    assert previous["remote_after"] == bases
    forbidden = re.compile(r"(^|/)(?:node_modules|\.data|\.git|dist|release|test-results)(?:/|$)|(^|/)\.env(?:$|\.(?!example$))|(?:^|/)(?:id_rsa|id_ed25519)$", re.I)
    scanned, repositories, links = set(), [], []
    for branch, repo in REPOS.items():
        assert Path(git(repo, "rev-parse", "--show-toplevel").decode().strip()).resolve() == repo.resolve()
        assert git(repo, "remote", "get-url", "origin").decode().strip() == manifest["remote"]
        git(repo, "merge-base", "--is-ancestor", bases[branch], "HEAD")
        tree = git(repo, "ls-tree", "-rz", "--name-only", "HEAD").decode().split("\0")
        current_paths = [name for name in tree if name]
        for name in current_paths:
            assert not forbidden.search(name), "Forbidden current path: " + branch + "/" + name
        changed = [name.strip("\n") for name in git(repo, "log", "--format=", "--name-only", "-z", bases[branch] + "..HEAD").decode().split("\0") if name.strip("\n")]
        for name in changed:
            assert not forbidden.search(name), "Forbidden new commit path: " + branch + "/" + name
            assert not any(ord(c) < 32 or ord(c) == 127 for c in name), "Control character in Git path"
        objects = {}
        for line in git(repo, "rev-list", "--objects", "HEAD", "^" + bases[branch]).decode().splitlines():
            oid, _, name = line.partition(" ")
            objects.setdefault(oid, name)
        ids = list(objects)
        metadata = b""
        if ids:
            metadata = subprocess.check_output(["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", str(repo),
                                                "cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)"],
                                               input=("\n".join(ids) + "\n").encode(), stderr=subprocess.PIPE)
        blobs = []
        for line in metadata.decode().splitlines():
            oid, kind, size = line.split()
            if kind == "blob":
                assert int(size) < 100 * 1024 * 1024, "New blob reaches GitHub size limit"
                assert not forbidden.search(objects[oid]), "Forbidden new historical path"
                blobs.append((oid, objects[oid], int(size)))
        byte_count = 0
        process = subprocess.Popen(["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", str(repo), "cat-file", "--batch"],
                                   stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        try:
            for oid, name, size in blobs:
                if oid in scanned:
                    continue
                process.stdin.write((oid + "\n").encode())
                process.stdin.flush()
                header = process.stdout.readline().decode().split()
                assert header == [oid, "blob", str(size)]
                body = process.stdout.read(size)
                assert len(body) == size and process.stdout.read(1) == b"\n"
                scan(branch + "/" + name, body, needles)
                scanned.add(oid)
                byte_count += size
            process.stdin.close()
            assert process.wait(timeout=30) == 0
        finally:
            if process.poll() is None:
                process.kill()
                process.wait()
        readmes = [repo / "README.md", repo / "README.en.md"] if branch != "docs" else [repo / "docs/README.md", repo / "docs/README.en.md"]
        for file in readmes:
            body = file.read_bytes()
            assert git(repo, "show", "HEAD:" + file.relative_to(repo).as_posix()) == body
            text = body.decode()
            assert len(text) > 2500 and "\ufffd" not in text
            stripped = re.sub(r"\x60{3}.*?\x60{3}", "", text, flags=re.S)
            for target in re.findall(r"!?\[[^\]]*\]\(([^)\n]+)\)", stripped):
                destination = readme_target_file(repo, file, target.strip("<>"))
                if destination is not None:
                    assert destination.is_file(), "Missing README destination: " + target
                    links.append({"from": file.relative_to(ROOT).as_posix(), "target": target})
        repositories.append({"branch": branch, "head": git(repo, "rev-parse", "HEAD").decode().strip(),
                             "baseline": bases[branch], "all_current_paths_checked": len(current_paths),
                             "new_commit_paths_checked": len(changed), "new_reachable_blobs": len(blobs),
                             "unique_new_blob_bytes_scanned": byte_count})
    return {"at": datetime.now(timezone.utc).isoformat(), "status": "passed", "problems": 0,
            "scope": "New HEAD-reachable Git objects since the actual published Stage144 heads, all current/new commit paths, configured credentials and recognizable signatures, 100MiB limit and current bilingual README targets. No rescan of immutable old history and no full security audit claim.",
            "verifier_sha256": digest(Path(__file__).read_bytes()), "configured_credential_patterns": len(needles),
            "unique_new_blobs_scanned": len(scanned), "readme_links": len(links), "repositories": repositories,
            "historical_complete_scan": previous["complete_history_and_links"], "complete_history_rescanned": False}


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True)
    args = parser.parse_args()
    output = Path(args.report).resolve()
    assert output.is_relative_to(ROOT / "dev/copypaste-delivery/.data/workflow-handoff-145") and output.parent.is_dir()
    assert not output.exists(), "Never replace original audit output"
    value = audit()
    with output.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print(json.dumps({k: value[k] for k in ["status", "problems", "unique_new_blobs_scanned", "readme_links", "complete_history_rescanned"]}))
