"""Ordinary additive documentation publication with eight-ref readback.

Reuses the immutable Stage128 full audit only for unchanged baseline objects.
Scans every added byte. Does not rerun product tests or change component heads.
Executed versions, logs and receipts must never be overwritten.
"""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import importlib.util
import json
from pathlib import Path
import re
import subprocess
import uuid


ROOT = Path(__file__).resolve().parents[2]
FOLDER = "docs/quality/source-build-reproduction-129"
BASE = "744fcb4f990002e5a142d8db71c2ff6d420bb2ce"
REMOTE = "git@github.com:copypasteltd/workmate.git"
OWN_FILES = ["docs/tools/record_source_build_reproduction_v1.py",
             "docs/tools/publish_source_build_supplement_v1.py",
             "docs/changes/129-source-build-reproduction.md"]
COMPONENTS = {"backend": "platform", "web": "web", "admin": "admin",
              "desktop": "desktop", "extension": "extension", "delivery": "delivery"}


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(data):
    return sha256(data).hexdigest()


def load(path):
    return json.loads(path.read_bytes())


def import_recorder():
    spec = importlib.util.spec_from_file_location("source_build_recorder", ROOT / OWN_FILES[0])
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--push", action="store_true", required=True)
    parser.parse_args()
    output = ROOT / "dev/copypaste-delivery/.data/source-repro-129" / ("publication-" + str(uuid.uuid4()))
    output.mkdir()
    raw = (output / "commands.log").open("xb")
    receipt = {"started_at": now(), "status": "running", "scope": "Additive source-build documentation; unchanged Stage128 component heads and manifest. All added bytes scanned and committed blobs checked. No full-history audit or runtime tests rerun.",
               "remote": REMOTE, "verifier_sha256": digest(Path(__file__).read_bytes()),
               "baseline_documentation_commit": BASE, "failure": None, "commands": []}

    def run(repo, *args):
        command = ["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", str(repo), *args]
        started = now()
        result = subprocess.run(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        raw.write((json.dumps({"at": started, "repo": str(repo), "arguments": list(args)}) + "\n").encode())
        raw.write(result.stdout + result.stderr + b"\n")
        raw.flush()
        receipt["commands"].append({"arguments": list(args), "started_at": started,
                                     "finished_at": now(), "exit_code": result.returncode})
        assert result.returncode == 0, f"Git operation failed: {args[0]}"
        return result.stdout

    def git(repo, *args):
        return run(repo, *args).decode("utf-8").strip()

    def refs():
        lines = git(ROOT, "ls-remote", "--heads", "origin", *["refs/heads/" + b for b in [*COMPONENTS, "docs", "main"]]).splitlines()
        return {line.split()[1].removeprefix("refs/heads/"): line.split()[0] for line in lines}

    def untracked():
        status = run(ROOT, "status", "--porcelain=v1", "-z", "--untracked-files=all").decode("utf-8")
        entries = [r for r in status.split("\0") if r]
        assert all(r.startswith("?? ") for r in entries), "Unexpected tracked or staged changes"
        return {r[3:]: digest((ROOT / r[3:]).read_bytes()) for r in entries if r[3:] not in own}

    try:
        recorder = import_recorder()
        recorder.verify_archive()
        index = load(ROOT / FOLDER / "index.json")
        cp = load(ROOT / "docs/quality/startup-recovery-checkpoint-128.json")
        own = sorted(OWN_FILES + [p.relative_to(ROOT).as_posix() for p in (ROOT / FOLDER).rglob("*") if p.is_file()])
        assert git(ROOT, "rev-parse", "HEAD") == BASE
        assert git(ROOT, "branch", "--show-current") == "codex/docs"
        assert git(ROOT, "remote", "get-url", "origin") == REMOTE
        expected_before = {**cp["component_commits"], "main": BASE, "docs": BASE}
        before = refs()
        assert before == expected_before, "Remote advanced; preserve it and reconcile without force"
        receipt["remote_before"] = before
        preserved = untracked()
        receipt["preserved_untracked_user_files"] = preserved
        for branch, component in COMPONENTS.items():
            repo = ROOT / f"dev/copypaste-{component}"
            assert git(repo, "rev-parse", "HEAD") == cp["component_commits"][branch]
            # The recorder already checked complete primary and fresh trees.
            # This additive docs push never stages a component. Recheck its
            # source while retaining the immutable committed evidence baseline.
            guard = ["--", ".", ":(exclude)evidence/"] if branch == "delivery" else []
            assert git(repo, "status", "--porcelain", "--untracked-files=no", *guard) == ""
            assert git(ROOT, "cat-file", "-t", cp["component_commits"][branch]) == "commit"
        needles, additions = recorder.credentials(), []
        for name in own:
            body = (ROOT / name).read_bytes()
            recorder.scan(name, body, needles)
            assert git(ROOT, "ls-tree", "--name-only", BASE, "--", name) == "", "Supplement must be additive"
            if name.endswith(".md"):
                for target in re.findall(r"\[[^\]]*\]\(([^)]+)\)", body.decode("utf-8")):
                    if re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", target):
                        continue
                    local = ((ROOT / name).parent / target.split("#", 1)[0]).resolve()
                    assert local.is_relative_to(ROOT.resolve()) and local.is_file(), f"Broken documentation link: {name}"
            additions.append({"path": name, "sha256": digest(body), "bytes": len(body)})
        run(ROOT, "add", "--", *own)
        staged = git(ROOT, "diff", "--cached", "--name-status").splitlines()
        assert sorted(staged) == sorted("A\t" + name for name in own)
        run(ROOT, "diff", "--cached", "--check", "--", "docs/tools", "docs/changes")
        run(ROOT, "commit", "-m", "docs: preserve six clean Stage128 installation and build results")
        head = git(ROOT, "rev-parse", "HEAD")
        assert git(ROOT, "rev-parse", "HEAD^") == BASE
        assert sorted(git(ROOT, "diff", "--name-status", BASE, head).splitlines()) == sorted("A\t" + name for name in own)
        for row in additions:
            assert digest(run(ROOT, "cat-file", "blob", head + ":" + row["path"])) == row["sha256"]
        receipt["added_files"] = additions
        receipt["documentation_commit"] = head
        receipt["source_build_index_sha256"] = digest((ROOT / FOLDER / "index.json").read_bytes())
        receipt["delivery_repeat_working_tree_guard"] = "source paths; historical evidence excluded after the recorder's complete clean-tree check; component commit unchanged"
        assert refs() == before, "Remote changed during preflight; no force publication"
        expected_after = {**cp["component_commits"], "main": head, "docs": head}
        pushed = run(ROOT, "push", "--atomic", "--porcelain", "origin",
                     *[commit + ":refs/heads/" + branch for branch, commit in expected_after.items()])
        receipt["push_porcelain"] = pushed.decode("utf-8")
        receipt["remote_after"] = refs()
        assert receipt["remote_after"] == expected_after
        assert untracked() == preserved, "Unrelated user files changed during publication"
        assert index["full_acceptance_closures"] == 0
        receipt["status"] = "pushed_and_verified"
    except BaseException as error:
        receipt["status"] = "failed"
        receipt["failure"] = {"type": type(error).__name__, "message": str(error)}
    finally:
        raw.close()
        receipt["raw_log_sha256"] = digest((output / "commands.log").read_bytes())
        receipt["finished_at"] = now()
        with (output / "receipt.json").open("x", encoding="utf-8", newline="\n") as stream:
            json.dump(receipt, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        print(json.dumps({"status": receipt["status"], "documentation_commit": receipt.get("documentation_commit"),
                          "receipt": str(output / "receipt.json"), "failure": receipt["failure"]}, ensure_ascii=False))
    assert receipt["status"] == "pushed_and_verified", "Retain failed receipt; resolve without rewriting evidence or force pushing"


if __name__ == "__main__":
    main()
