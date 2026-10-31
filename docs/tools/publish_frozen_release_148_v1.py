"""Commit, package and atomically publish the first frozen candidate, without force."""
from pathlib import Path
from hashlib import sha1, sha256
from datetime import datetime, timezone
import json
import os
import subprocess
import sys
import uuid

ROOT = Path(r"D:\dev\copypasted\自有agent")
DEV = ROOT / "dev"
VERSION = "v0.1.0-rc.1"
REMOTE = "git@github.com:copypasteltd/workmate.git"
COMPONENTS = {"backend": "platform", "web": "web", "admin": "admin", "desktop": "desktop", "extension": "extension", "delivery": "delivery"}
REPOS = {branch: DEV / ("copypaste-" + name) for branch, name in COMPONENTS.items()}


def now():
    return datetime.now(timezone.utc).isoformat()


def digest(path):
    h = sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def blob_sha(path):
    h = sha1(("blob " + str(path.stat().st_size) + "\0").encode())
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()


def main():
    checkpoint_path = ROOT / "docs/quality/release-freeze-checkpoint-148.json"
    checkpoint = json.loads(checkpoint_path.read_bytes())
    baseline = checkpoint["baseline_heads"]
    output = DEV / "copypaste-delivery/.data/marketing-import-148" / ("publication-" + str(uuid.uuid4()))
    output.mkdir(parents=True)
    log = (output / "commands.log").open("xb")
    receipt = {"release": VERSION, "started_at": now(), "status": "running", "remote": REMOTE, "failure": None,
               "publisher_sha256": digest(Path(__file__)), "checkpoint_sha256": digest(checkpoint_path),
               "scope": "First frozen candidate with user-directed reduced testing; original evidence/full scopes retained by ancestry, not a new complete-history scan",
               "commands": [], "components": [], "release_web_assets": checkpoint["release_web_assets"]}
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_SSH_COMMAND": "ssh -o BatchMode=yes"}

    def run(args, cwd=ROOT):
        row = {"at": now(), "cwd": str(cwd), "args": args}
        log.write((json.dumps(row) + "\n").encode())
        log.flush()
        process = subprocess.run(args, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        log.write(process.stdout + process.stderr + b"\n")
        log.flush()
        receipt["commands"].append({**row, "finished_at": now(), "exit_code": process.returncode})
        assert process.returncode == 0, "Command failed; see preserved local commands.log"
        return process.stdout

    def git(repo, *args):
        return run(["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", str(repo), *args], repo)

    def text(repo, *args):
        return git(repo, *args).decode().strip()

    def refs():
        return {line.split()[1].removeprefix("refs/heads/"): line.split()[0] for line in text(ROOT, "ls-remote", "--heads", "origin", *["refs/heads/" + name for name in (*REPOS, "docs", "main")]).splitlines()}

    def preserved():
        for path, expected in checkpoint["preserved_user_files"].items():
            assert digest(ROOT / path) == expected, path
        assert digest(REPOS["desktop"] / ".gitattributes") == checkpoint["desktop_attributes_sha256"]

    def commit(repo, branch):
        base = baseline["docs" if branch == "docs" else COMPONENTS[branch]]
        assert text(repo, "rev-parse", "HEAD") == base
        assert text(repo, "branch", "--show-current") == "codex/" + branch
        assert text(repo, "remote", "get-url", "origin") == REMOTE
        assert text(repo, "diff", "--cached", "--name-only") == ""
        paths = set(git(repo, "diff", "--name-only", "-z", "HEAD").decode().split("\0"))
        paths.update(git(repo, "ls-files", "--others", "--exclude-standard", "-z").decode().split("\0"))
        paths.discard("")
        if branch == "docs":
            paths -= set(checkpoint["preserved_user_files"])
            assert all(path.startswith("docs/") and ("148" in path or path in ("docs/releases/v0.1.0-rc.1.md", "docs/README.md", "docs/README.en.md")) for path in paths), "Unexpected documentation change"
        else:
            assert all(path in ("README.md", "README.en.md", ".gitattributes") or path.startswith(("src/", "renderer/src/", "tests/", "scripts/", "assets/screenshots/", "evidence/marketing-import-148/")) for path in paths), "Unexpected component change"
        assert paths and (branch != "desktop" or ".gitattributes" not in paths)
        paths = sorted(paths)
        # Bound each invocation to Windows command-line limits.
        for start in range(0, len(paths), 40):
            git(repo, "add", "--", *paths[start:start + 40])
        raw = git(repo, "diff", "--cached", "--raw", "--no-abbrev", "-z").decode().split("\0")
        checked = 0
        for index in range(0, len(raw) - 1, 2):
            metadata, path = raw[index], raw[index + 1]
            fields = metadata.split()
            assert fields[4] in ("A", "M"), "Review deletion/rename instead of silently publishing"
            qualified = repo.name + "/" + path in checkpoint["qualified_sources"]
            immutable = path.startswith("evidence/") or ("148" in path and path.startswith(("scripts/", "tests/", "docs/tools/")))
            if qualified or immutable:
                assert fields[3] == blob_sha(repo / path), "Git conversion changed immutable bytes: " + path
                checked += 1
        git(repo, "diff", "--cached", "--check")
        git(repo, "commit", "-m", "release: freeze Workmate v0.1.0-rc.1 with reviewed campaign imports")
        head = text(repo, "rev-parse", "HEAD")
        git(repo, "merge-base", "--is-ancestor", base, head)
        assert text(repo, "diff", "--cached", "--name-only") == ""
        print(json.dumps({"component": branch, "commit": head, "new_or_changed_paths": len(paths), "immutable_blobs_checked": checked}), flush=True)
        receipt["components"].append({"branch": branch, "commit": head, "baseline": base, "paths": len(paths), "immutable_blobs_checked": checked})
        return head

    try:
        expected_before = {branch: baseline[name] for branch, name in COMPONENTS.items()}
        expected_before.update(docs=baseline["docs"], main=baseline["docs"])
        assert refs() == expected_before, "Remote advanced; reconcile without force"
        receipt["remote_before"] = expected_before
        tags = [VERSION] + [VERSION + "-" + branch for branch in REPOS]
        assert text(ROOT, "ls-remote", "--tags", "origin", *["refs/tags/" + tag for tag in tags]) == "", "Release tags already exist"
        assert not (DEV / "copypaste-delivery/release" / ("workmate-" + VERSION)).exists()
        preserved()
        heads = {}
        for branch, repo in REPOS.items():
            heads[branch] = commit(repo, branch)
        docs = commit(ROOT, "docs")
        heads.update(docs=docs, main=docs)
        for branch, repo in REPOS.items():
            staging = "refs/workmate-staging/first-frozen-148-" + branch
            git(ROOT, "fetch", "--no-tags", "--no-write-fetch-head", str(repo), "HEAD:" + staging)
            assert text(ROOT, "rev-parse", staging) == heads[branch]
        expected_tags = {VERSION: docs, **{VERSION + "-" + branch: head for branch, head in heads.items() if branch in REPOS}}
        for tag, head in expected_tags.items():
            assert text(ROOT, "tag", "--list", tag) == "", "Never replace a local frozen tag"
            git(ROOT, "tag", "-a", tag, head, "-m", "Workmate first frozen candidate; synthetic AI; focused source-bound checks; full acceptance remains open")
        print("Committed seven independent repositories. Packaging existing qualified builds.", flush=True)
        run([sys.executable, "-X", "utf8", str(DEV / "copypaste-delivery/scripts/package-frozen-release-148-v1.py")])
        package_dir = DEV / "copypaste-delivery/release" / ("workmate-" + VERSION)
        manifest = json.loads((package_dir / "release-manifest.json").read_bytes())
        assert {row["branch"]: row["commit"] for row in manifest["components"]} == {name: head for name, head in heads.items() if name in REPOS}
        assert manifest["docs_commit"] == docs
        receipt["artifacts"] = {"directory": str(package_dir), "manifest_sha256": digest(package_dir / "release-manifest.json"), "checksums_sha256": digest(package_dir / "SHA256SUMS"), "files": manifest["artifacts"]}
        assert refs() == expected_before, "Remote advanced during packaging; no force push"
        preserved()
        print("Publishing eight branches and seven immutable tags through authorized SSH.", flush=True)
        receipt["push_porcelain"] = git(ROOT, "push", "--atomic", "--porcelain", "origin", *[head + ":refs/heads/" + branch for branch, head in heads.items()], *["refs/tags/" + tag + ":refs/tags/" + tag for tag in expected_tags]).decode()
        receipt["remote_after"] = refs()
        assert receipt["remote_after"] == heads
        lines = text(ROOT, "ls-remote", "--tags", "origin", *["refs/tags/" + tag + "^{}" for tag in expected_tags]).splitlines()
        remote_tags = {line.split()[1].removeprefix("refs/tags/").removesuffix("^{}"): line.split()[0] for line in lines}
        assert remote_tags == expected_tags, "Read back peeled tag commits"
        receipt["remote_tag_commits"] = remote_tags
        preserved()
        receipt["status"] = "frozen_packaged_branches_and_tags_verified"
    except BaseException as error:
        receipt["status"] = "failed"
        receipt["failure"] = {"type": type(error).__name__, "message": str(error)}
    finally:
        log.close()
        receipt["finished_at"] = now()
        receipt["raw_log_sha256"] = digest(output / "commands.log")
        with (output / "receipt.json").open("x", encoding="utf-8", newline="\n") as stream:
            json.dump(receipt, stream, ensure_ascii=False, indent=2)
            stream.write("\n")
        print(json.dumps({"status": receipt["status"], "receipt": str(output / "receipt.json"), "failure": receipt["failure"]}, ensure_ascii=False), flush=True)
    assert receipt["status"] == "frozen_packaged_branches_and_tags_verified", "Original failed receipt preserved; do not force, overwrite frozen output or reuse an executed verifier"


if __name__ == "__main__":
    main()
