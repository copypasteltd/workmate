"""Publish the reviewed Stage133 increment through an ordinary atomic push.

Retain every old proof and raw failure. Audit newly reachable objects against
the actual previous publication; do not replay an old full-runtime claim.
"""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import argparse
import json
import os
import subprocess
import sys
import uuid

from prepare_support_publication_133_v1 import ROOT, REPOS, MANIFEST, BASE_DOCS, verify
from audit_support_publication_133_v1 import baseline

REMOTE = "git@github.com:copypasteltd/workmate.git"


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(body):
    return sha256(body).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--push", action="store_true", required=True)
    parser.parse_args()
    output = ROOT / "dev/copypaste-delivery/.data/support-access-133" / ("publication-" + str(uuid.uuid4()))
    output.mkdir(parents=True)
    raw = (output / "commands.log").open("xb")
    receipt = {"started_at": now(), "status": "running", "remote": REMOTE, "failure": None,
               "scope": "Stage133 exact current Git/source/evidence binding, new-history credential/path/size audit and current README links. Stage131 complete-history scan remains historical. Ordinary atomic eight-ref push with SHA readback, no full-product acceptance closure.",
               "publisher_sha256": digest(Path(__file__).read_bytes()), "commands": []}
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_SSH_COMMAND": "ssh -o BatchMode=yes"}

    def run(command, repo=ROOT):
        row = {"started_at": now(), "directory": str(repo), "arguments": command}
        raw.write((json.dumps(row) + "\n").encode())
        raw.flush()
        print(json.dumps({"at": row["started_at"], "operation": command[7] if command[0] == "git" and len(command) > 7 else command[0]}), flush=True)
        result = subprocess.run(command, cwd=repo, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        raw.write(result.stdout + result.stderr + b"\n")
        raw.flush()
        receipt["commands"].append({**row, "finished_at": now(), "exit_code": result.returncode})
        assert result.returncode == 0, "Publication command failed; original local log retained without exposing configured secrets"
        return result.stdout

    def git(repo, *args):
        return run(["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", str(repo), *args], repo)

    def text(repo, *args):
        return git(repo, *args).decode().strip()

    def refs():
        lines = text(ROOT, "ls-remote", "--heads", "origin", *["refs/heads/" + b for b in [*REPOS, "main"]]).splitlines()
        return {r.split()[1].removeprefix("refs/heads/"): r.split()[0] for r in lines}

    def untracked():
        return {name: digest((ROOT / name).read_bytes()) for name in git(ROOT, "ls-files", "--others", "--exclude-standard", "-z").decode().split("\0") if name}

    try:
        manifest = json.loads(MANIFEST.read_bytes())
        previous = baseline()
        expected_before = {**manifest["baseline_component_commits"], "docs": BASE_DOCS, "main": BASE_DOCS}
        assert previous["remote_after"] == expected_before and refs() == expected_before, "Remote advanced; reconcile without force"
        receipt["remote_before"] = expected_before
        receipt["baseline_complete_history_scan"] = previous["complete_history_and_links"]
        preserved = untracked()
        expected_user_files = {
            *["docs/quality/disk-cleanup-copypaste-history-20261030/" + name for name in [
                "cleanup-result.json", "deletion-errors-batched.txt", "deletion-journal-batched.tsv", "directories.plan.txt",
                "execution-start.json", "files.plan.tsv", "plan-summary.json", "protected-git.txt", "protected-links.txt", "verification-errors.txt"]],
            "docs/tools/WindowsHistoryArtifactCleaner.cs", "docs/tools/clean-history-packages-20261030.ps1"}
        assert set(preserved) == expected_user_files, "Review untracked paths without altering user files"
        receipt["preserved_untracked_user_files"] = preserved
        assert text(ROOT, "branch", "--show-current") == "codex/docs"
        assert text(ROOT, "remote", "get-url", "origin") == REMOTE
        assert text(ROOT, "status", "--porcelain", "--untracked-files=no") == ""
        docs = text(ROOT, "rev-parse", "HEAD")
        git(ROOT, "merge-base", "--is-ancestor", BASE_DOCS, docs)
        receipt["git_proof_verification"] = verify()
        receipt["manifest_sha256"] = digest(MANIFEST.read_bytes())
        assert digest((REPOS["desktop"] / ".gitattributes").read_bytes()) == "82eabadd2ae6562e1a246a3458eedde1ba913ee9837ee40f464d60e5d8f9185e"
        audit_file = output / "new-history-audit.json"
        run([sys.executable, "-X", "utf8", "docs/tools/audit_support_publication_133_v1.py", "--report", str(audit_file)])
        checked = json.loads(audit_file.read_bytes())
        assert checked["status"] == "passed" and checked["problems"] == 0
        receipt["incremental_history_and_links"] = {"path": audit_file.relative_to(ROOT).as_posix(), "sha256": digest(audit_file.read_bytes()),
                                                   "new_blobs": checked["unique_new_blobs_scanned"], "links": checked["readme_links"],
                                                   "complete_history_rescanned": checked["complete_history_rescanned"]}
        expected_after = {c["branch"]: c["commit"] for c in manifest["components"]}
        expected_after.update(docs=docs, main=docs)
        for component in manifest["components"]:
            branch, commit = component["branch"], component["commit"]
            repo = REPOS[branch]
            assert Path(text(repo, "rev-parse", "--show-toplevel")).resolve() == repo.resolve()
            assert text(repo, "remote", "get-url", "origin") == REMOTE
            assert text(repo, "branch", "--show-current") == "codex/" + branch
            assert text(repo, "rev-parse", "HEAD") == commit and text(repo, "status", "--porcelain") == ""
            if commit != expected_before[branch]:
                staging = "refs/workmate-staging/" + branch + "-" + commit
                git(ROOT, "fetch", "--no-tags", "--no-write-fetch-head", str(repo), "HEAD:" + staging)
                assert text(ROOT, "rev-parse", staging) == commit
            git(ROOT, "merge-base", "--is-ancestor", expected_before[branch], commit)
        assert refs() == expected_before, "Remote advanced during verification; no force push"
        assert text(ROOT, "rev-parse", "HEAD") == docs and untracked() == preserved
        receipt["push_porcelain"] = git(ROOT, "push", "--atomic", "--porcelain", "origin",
                                        *[commit + ":refs/heads/" + branch for branch, commit in expected_after.items()]).decode()
        receipt["remote_after"] = refs()
        assert receipt["remote_after"] == expected_after and untracked() == preserved
        receipt["status"] = "pushed_and_verified"
    except BaseException as error:
        receipt["status"] = "failed"
        receipt["failure"] = {"type": type(error).__name__, "message": str(error)}
    finally:
        raw.close()
        receipt["finished_at"] = now()
        receipt["raw_log_sha256"] = digest((output / "commands.log").read_bytes())
        with (output / "receipt.json").open("x", encoding="utf-8", newline="\n") as stream:
            json.dump(receipt, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        print(json.dumps({"status": receipt["status"], "receipt": str(output / "receipt.json"),
                          "remote_after": receipt.get("remote_after"), "failure": receipt["failure"]}, ensure_ascii=False), flush=True)
    assert receipt["status"] == "pushed_and_verified", "Preserve the original publication receipt; do not force or rewrite"


if __name__ == "__main__":
    main()
