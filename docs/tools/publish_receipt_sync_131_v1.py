"""Publish reviewed Stage131 source and docs with real history audit and atomic eight-ref readback.

No force push, previous proof replacement, raw evidence rewrite or implicit
acceptance closure. Receipts are exclusive local records under dev/.
"""
from datetime import datetime, timezone
from hashlib import sha256
from pathlib import Path
import argparse
import json
import os
import subprocess
import sys
import uuid

from prepare_receipt_publication_131_v1 import ROOT, REPOS, MANIFEST, BASE_DOCS, verify

REMOTE = "git@github.com:copypasteltd/workmate.git"


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(body):
    return sha256(body).hexdigest()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--push", action="store_true", required=True)
    parser.parse_args()
    output = ROOT / "dev/copypaste-delivery/.data/receipt-sync-131" / ("publication-" + str(uuid.uuid4()))
    output.mkdir(parents=True)
    raw = (output / "commands.log").open("xb")
    receipt = {"started_at": now(), "status": "running", "remote": REMOTE, "failure": None,
               "scope": "Stage131 current incremental Git proofs plus complete HEAD-reachable history credential/path/size and current README-link scan. All historical proof shards retained under their original scope. Bounded native and unsigned packaged UI only; no whole-platform runtime rerun.",
               "publisher_sha256": digest(Path(__file__).read_bytes()), "commands": []}
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_SSH_COMMAND": "ssh -o BatchMode=yes"}

    def run(command, repo=ROOT):
        started = now()
        row = {"started_at": started, "directory": str(repo), "arguments": command}
        raw.write((json.dumps(row) + "\n").encode())
        raw.flush()
        print(json.dumps({"at": started, "phase": command[0] if command[0] != "git" else command[7] if len(command) > 7 else "git"}), flush=True)
        result = subprocess.run(command, cwd=repo, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        raw.write(result.stdout + result.stderr + b"\n")
        raw.flush()
        receipt["commands"].append({**row, "finished_at": now(), "exit_code": result.returncode})
        assert result.returncode == 0, "Publication command failed; preserve the original local log without printing credentials"
        return result.stdout

    def git(repo, *args):
        return run(["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", str(repo), *args], repo)

    def text(repo, *args):
        return git(repo, *args).decode("utf-8").strip()

    def refs():
        lines = text(ROOT, "ls-remote", "--heads", "origin", *["refs/heads/" + branch for branch in [*REPOS, "main"]]).splitlines()
        return {row.split()[1].removeprefix("refs/heads/"): row.split()[0] for row in lines}

    def untracked():
        names = git(ROOT, "ls-files", "--others", "--exclude-standard", "-z").decode("utf-8").split("\0")
        return {name: digest((ROOT / name).read_bytes()) for name in names if name}

    try:
        manifest = json.loads(MANIFEST.read_bytes())
        previous_receipt = ROOT / "dev/copypaste-delivery/.data/workflow-recovery-130/publication-e5ed1c33-3681-4f99-bda7-c1838fedeb1a/receipt.json"
        baseline = json.loads(previous_receipt.read_bytes())
        assert baseline["status"] == "pushed_and_verified" and baseline["remote_after"]["docs"] == BASE_DOCS
        expected_before = {**manifest["baseline_component_commits"], "docs": BASE_DOCS, "main": BASE_DOCS}
        assert baseline["remote_after"] == expected_before
        assert refs() == expected_before, "Remote advanced; reconcile normally without force"
        receipt["baseline_push_receipt_sha256"] = digest(previous_receipt.read_bytes())
        receipt["remote_before"] = expected_before
        preserved = untracked()
        receipt["preserved_untracked_user_files"] = preserved
        assert text(ROOT, "branch", "--show-current") == "codex/docs"
        assert text(ROOT, "remote", "get-url", "origin") == REMOTE
        assert text(ROOT, "status", "--porcelain", "--untracked-files=no") == ""
        docs = text(ROOT, "rev-parse", "HEAD")
        git(ROOT, "merge-base", "--is-ancestor", BASE_DOCS, docs)
        receipt["git_proof_verification"] = verify()
        receipt["manifest_sha256"] = digest(MANIFEST.read_bytes())
        receipt["full_history_verifier_sha256"] = digest((ROOT / "docs/tools/audit_workmate_publication.py").read_bytes())
        print("Checking all current reachable Git history and bilingual README targets", flush=True)
        audit = run([sys.executable, "-X", "utf8", "docs/tools/audit_workmate_publication.py", "--report", "workmate-publication-audit-12.json", "--media", "10", "--verify-only"])
        checked = json.loads(audit)
        assert checked["status"] == "passed" and checked["problems"] == 0
        receipt["complete_history_and_links"] = checked
        expected_after = {item["branch"]: item["commit"] for item in manifest["components"]}
        expected_after.update(docs=docs, main=docs)
        for component in manifest["components"]:
            branch, commit = component["branch"], component["commit"]
            repo = REPOS[branch]
            assert Path(text(repo, "rev-parse", "--show-toplevel")).resolve() == repo.resolve()
            assert text(repo, "remote", "get-url", "origin") == REMOTE
            assert text(repo, "branch", "--show-current") == "codex/" + branch
            assert text(repo, "rev-parse", "HEAD") == commit
            # Only new reviewed commit objects are imported; source checkouts
            # and their histories are not switched or overwritten.
            if commit != expected_before[branch]:
                staging = "refs/workmate-staging/" + branch + "-" + commit
                git(ROOT, "fetch", "--no-tags", "--no-write-fetch-head", str(repo), "HEAD:" + staging)
                assert text(ROOT, "rev-parse", staging) == commit
            git(ROOT, "merge-base", "--is-ancestor", expected_before[branch], commit)
        assert refs() == expected_before, "Remote advanced during verification; no force push"
        assert text(ROOT, "rev-parse", "HEAD") == docs and untracked() == preserved
        pushed = git(ROOT, "push", "--atomic", "--porcelain", "origin", *[commit + ":refs/heads/" + branch for branch, commit in expected_after.items()])
        receipt["push_porcelain"] = pushed.decode("utf-8")
        receipt["remote_after"] = refs()
        assert receipt["remote_after"] == expected_after
        assert untracked() == preserved
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
        print(json.dumps({"status": receipt["status"], "receipt": str(output / "receipt.json"), "remote_after": receipt.get("remote_after"), "failure": receipt["failure"]}, ensure_ascii=False), flush=True)
    assert receipt["status"] == "pushed_and_verified", "Retain the original receipt; continue without rewriting evidence or force pushing"


if __name__ == "__main__":
    main()
