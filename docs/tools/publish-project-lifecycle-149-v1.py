"""Ordinary atomic branch publication; retain the first frozen release exactly."""
from pathlib import Path
from hashlib import sha1, sha256
from datetime import datetime, timezone
import json
import os
import re
import subprocess
import uuid

ROOT = Path(r"D:\dev\copypasted\自有agent")
DEV = ROOT / "dev"
REMOTE = "git@github.com:copypasteltd/workmate.git"
COMPONENTS = {"backend": "platform", "web": "web", "admin": "admin", "desktop": "desktop", "extension": "extension", "delivery": "delivery"}
REPOS = {b: DEV / ("copypaste-" + c) for b, c in COMPONENTS.items()}
CHECKPOINT = ROOT / "docs/quality/project-lifecycle-checkpoint-149.json"

def now():
    return datetime.now(timezone.utc).isoformat()

def digest(path):
    h = sha256()
    with path.open("rb") as f:
        for b in iter(lambda: f.read(4 * 1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()

def blob_sha(path):
    b = path.read_bytes()
    return sha1(("blob " + str(len(b)) + "\0").encode() + b).hexdigest()

def main():
    cp = json.loads(CHECKPOINT.read_bytes())
    baseline = cp["baseline"]
    output = DEV / "copypaste-delivery/.data/project-lifecycle-149" / ("publication-" + str(uuid.uuid4()))
    output.mkdir(parents=True)
    log = (output / "commands.log").open("xb")
    receipt = {"started_at": now(), "status": "running", "remote": REMOTE, "failure": None,
               "publisher_sha256": digest(Path(__file__)), "checkpoint_sha256": digest(CHECKPOINT), "commands": [], "components": [],
               "scope": "Unreleased post-freeze project-management fix. Publish eight ordinary branch heads, not a new release/tag. Focused source/runtime evidence only; no full historical or whole-product acceptance claim."}
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_SSH_COMMAND": "ssh -o BatchMode=yes"}

    def run(args, cwd=ROOT):
        row = {"at": now(), "cwd": str(cwd), "args": args}
        log.write((json.dumps(row) + "\n").encode()); log.flush()
        r = subprocess.run(args, cwd=cwd, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        log.write(r.stdout + r.stderr + b"\n"); log.flush()
        receipt["commands"].append({**row, "finished_at": now(), "exit_code": r.returncode})
        assert r.returncode == 0, "Command failed; original local commands.log retained"
        return r.stdout

    def git(repo, *args):
        return run(["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", str(repo), *args], repo)

    def text(repo, *args):
        return git(repo, *args).decode().strip()

    def refs():
        return {s.split()[1].removeprefix("refs/heads/"): s.split()[0] for s in text(ROOT, "ls-remote", "--heads", "origin", *["refs/heads/" + n for n in [*REPOS, "docs", "main"]]).splitlines()}

    tags = ["v0.1.0-rc.1"] + ["v0.1.0-rc.1-" + b for b in REPOS]
    def tagrefs():
        return {s.split()[1]: s.split()[0] for s in text(ROOT, "ls-remote", "--tags", "origin", *["refs/tags/" + t + tail for t in tags for tail in ["", "^{}"]]).splitlines()}

    def preserved():
        for path, expected in {**baseline["preserved_user_files"], **baseline["frozen_files"]}.items():
            assert digest(ROOT / path) == expected, path
        assert digest(REPOS["desktop"] / ".gitattributes") == baseline["desktop_attributes_sha256"]

    def check_sources():
        for path, expected in cp["source_files"].items():
            assert digest(DEV / path) == expected, path

    def commit(repo, branch):
        base = baseline["heads"]["docs" if branch == "docs" else COMPONENTS[branch]]
        assert text(repo, "rev-parse", "HEAD") == base
        assert text(repo, "branch", "--show-current") == "codex/" + branch
        assert text(repo, "remote", "get-url", "origin") == REMOTE
        assert text(repo, "diff", "--cached", "--name-only") == "", "Keep any pre-existing staged work untouched"
        specs = ["docs/README.md", "docs/README.en.md", "docs/tools/*149*", "docs/development/149-project-management.md", "docs/changes/149-project-management.md",
                 "docs/quality/*149*", "docs/assets/project-lifecycle-149", "docs/contracts/project-management-openapi.json"] if branch == "docs" else [
                 "README.md", "README.en.md", ".gitattributes", "src", "renderer/src", "tests", "scripts", "contracts", "assets/screenshots/*149*", "evidence/project-lifecycle-149"]
        changed = set(git(repo, "diff", "--name-only", "-z", "HEAD", "--", *specs).decode().split("\0")) - {""}
        changed.update(set(git(repo, "ls-files", "--others", "--exclude-standard", "-z", "--", *specs).decode().split("\0")) - {""})
        common = {"README.md", "README.en.md"}
        exact = {
            "backend": {"src/workspaces.ts", "src/project-management.ts", "contracts/project-management-openapi.json", "tests/project-management-149-v1.test.ts", "tests/project-management-149-v2.test.ts"},
            "web": {"src/" + f for f in ["main.tsx", "context.tsx", "api.ts", "project-management.tsx", "project-management.css"]},
            "desktop": {"renderer/src/" + f for f in ["main.tsx", "context.tsx", "api.ts", "project-management.tsx", "project-management.css"]},
            "delivery": {".gitattributes"}, "admin": set(), "extension": set(),
        }
        for f in changed:
            if branch == "docs":
                assert f in {"docs/README.md", "docs/README.en.md", "docs/contracts/project-management-openapi.json"} or "149" in f, f
                assert f not in baseline["preserved_user_files"]
            else:
                assert f in common | exact[branch] or (f.startswith(("scripts/", "evidence/project-lifecycle-149/", "assets/screenshots/")) and "149" in f), f
                assert branch != "desktop" or f != ".gitattributes"
        assert changed
        paths = sorted(changed)
        for start in range(0, len(paths), 35):
            git(repo, "add", "--", *paths[start:start + 35])
        records = git(repo, "diff", "--cached", "--raw", "--no-abbrev", "-z").decode().split("\0")
        for i in range(0, len(records) - 1, 2):
            meta, file = records[i].split(), records[i + 1]
            assert meta[4] in ("A", "M"), file
            if repo.name + "/" + file in cp["source_files"] or file.startswith("evidence/") or "149" in file:
                assert meta[3] == blob_sha(repo / file), "Git conversion changed bound bytes: " + file
        # An existing terminal blank line in an immutable verifier is not rewritten.
        git(repo, "-c", "core.whitespace=-blank-at-eof", "diff", "--cached", "--check")
        git(repo, "commit", "-m", "fix: restore archived project management and fence stale selection" if branch not in ["admin", "extension", "docs"] else "docs: document post-freeze project management and actual client flows")
        head = text(repo, "rev-parse", "HEAD")
        git(repo, "merge-base", "--is-ancestor", base, head)
        assert text(repo, "diff", "--cached", "--name-only") == ""
        receipt["components"].append({"branch": branch, "baseline": base, "commit": head, "new_or_changed_paths": len(paths)})
        print(json.dumps({"component": branch, "commit": head, "paths": len(paths)}), flush=True)
        return head

    try:
        assert cp["status"] == "verified_project_management_increment" and cp["backend_cases"] == 10 and cp["actual_journey_groups"] == 5
        assert cp["new_full_acceptance_closures"] == 0 and cp["frozen_release_unchanged"]
        preserved(); check_sources()
        before = {branch: baseline["heads"][name] for branch, name in COMPONENTS.items()}
        before.update(docs=baseline["heads"]["docs"], main=baseline["heads"]["docs"])
        assert refs() == before, "Remote advanced; reconcile without force"
        receipt["remote_before"] = before
        oldtags = tagrefs()
        assert len(oldtags) == 14
        for tag, commit_sha in {"v0.1.0-rc.1": before["docs"], **{"v0.1.0-rc.1-" + b: before[b] for b in REPOS}}.items():
            assert oldtags["refs/tags/" + tag + "^{}"] == commit_sha
        receipt["frozen_remote_tags_before"] = oldtags
        # Verify only new documentation links; inherited histories were qualified earlier.
        new_links = 0
        docs = [ROOT / "docs/development/149-project-management.md", ROOT / "docs/changes/149-project-management.md"]
        docs += [repo / name for repo in REPOS.values() for name in ["README.md", "README.en.md"]]
        for file in docs:
            content = file.read_text(encoding="utf-8")
            if file.name.startswith("README"):
                content = content.split("\n---\n", 1)[0]
            for target in re.findall(r"\]\(([^)]+)\)", content):
                if re.match(r"[a-z]+://|#", target):
                    continue
                assert (file.parent / target.split("#", 1)[0]).is_file(), str(file) + " -> " + target
                new_links += 1
        receipt["new_documentation_links_checked"] = new_links
        heads = {branch: commit(repo, branch) for branch, repo in REPOS.items()}
        docs_head = commit(ROOT, "docs")
        heads.update(docs=docs_head, main=docs_head)
        for branch, repo in REPOS.items():
            target = "refs/workmate-staging/project-lifecycle-149-" + branch
            git(ROOT, "fetch", "--no-tags", "--no-write-fetch-head", str(repo), "HEAD:" + target)
            assert text(ROOT, "rev-parse", target) == heads[branch]
        preserved(); check_sources()
        assert refs() == before and tagrefs() == oldtags, "Remote advanced; no force push"
        print("Publishing eight branch heads; retaining all seven frozen tags.", flush=True)
        receipt["push_porcelain"] = git(ROOT, "push", "--atomic", "--porcelain", "origin", *[head + ":refs/heads/" + b for b, head in heads.items()]).decode()
        receipt["remote_after"] = refs()
        assert receipt["remote_after"] == heads
        receipt["frozen_remote_tags_after"] = tagrefs()
        assert receipt["frozen_remote_tags_after"] == oldtags
        preserved()
        receipt["status"] = "pushed_verified_frozen_release_preserved"
    except BaseException as e:
        receipt["status"] = "failed"
        receipt["failure"] = {"type": type(e).__name__, "message": str(e)}
    finally:
        log.close()
        receipt["finished_at"] = now()
        receipt["raw_log_sha256"] = digest(output / "commands.log")
        with (output / "receipt.json").open("x", encoding="utf-8", newline="\n") as f:
            json.dump(receipt, f, ensure_ascii=False, indent=2); f.write("\n")
        print(json.dumps({"status": receipt["status"], "receipt": str(output / "receipt.json"), "failure": receipt["failure"]}, ensure_ascii=False), flush=True)
    assert receipt["status"] == "pushed_verified_frozen_release_preserved", "Keep original receipt; do not force or overwrite"

if __name__ == "__main__":
    main()
