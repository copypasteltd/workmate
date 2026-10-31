"""Publish the qualified session-boundary source correction; keep frozen release bytes."""
from pathlib import Path
from hashlib import sha256, sha1
from datetime import datetime, timezone
import json
import os
import subprocess
import uuid

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"
REMOTE = "git@github.com:copypasteltd/workmate.git"
COMPONENTS = {"backend": "platform", "web": "web", "admin": "admin", "desktop": "desktop", "extension": "extension", "delivery": "delivery"}


def digest(p):
    h = sha256()
    with p.open("rb") as f:
        for b in iter(lambda: f.read(4 * 1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()


def main():
    report_path = ROOT / "docs/quality/session-boundary-checkpoint-163.json"
    report = json.loads(report_path.read_bytes())
    baseline = report["baseline"]
    out = DELIVERY / ".data/session-fence-163" / ("git-sync-" + str(uuid.uuid4()))
    out.mkdir(parents=True)
    log = (out / "commands.log").open("xb")
    result = {"started_at": datetime.now(timezone.utc).isoformat(), "status": "running", "remote": REMOTE, "release": "v0.1.0-rc.3", "report_sha256": digest(report_path), "components": {}, "failure": None}
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_SSH_COMMAND": "ssh -o BatchMode=yes"}

    def git(repo, *args):
        argv = ["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-c", "gc.auto=0", "-c", "gc.autoPackLimit=0", "-C", str(repo), *args]
        log.write((json.dumps({"cwd": str(repo), "args": args}) + "\n").encode())
        log.flush()
        p = subprocess.run(argv, cwd=repo, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
        log.write(p.stdout + p.stderr + b"\n")
        log.flush()
        assert p.returncode == 0, "Git operation failed; exact commands.log retained"
        return p.stdout

    def text(repo, *args):
        return git(repo, *args).decode().strip()

    def refs():
        patterns = ["refs/heads/" + b for b in [*COMPONENTS, "docs", "main"]] + ["refs/tags/v0.1.0-rc.1*", "refs/tags/v0.1.0-rc.2*", "refs/tags/v0.1.0-rc.3*"]
        return {s.split()[1]: s.split()[0] for s in text(ROOT, "ls-remote", "origin", *patterns).splitlines()}

    def preserve():
        for name, h in {**baseline["preserved_user_files"], **baseline["frozen_files"]}.items():
            assert digest(ROOT / name) == h, name
        assert digest(DEV / "copypaste-desktop/.gitattributes") == baseline["desktop_attributes_sha256"]
        assert digest(DELIVERY / ".data/release-freeze-161/frozen-receipt.json") == baseline["rc3_frozen_receipt_sha256"]
        frozen = json.loads((DELIVERY / ".data/release-freeze-161/frozen-receipt.json").read_bytes())
        assert digest(Path(frozen["complete_archive"]["path"])) == frozen["complete_archive"]["sha256"]
        directory = DELIVERY / "release/workmate-v0.1.0-rc.3"
        assert digest(directory / "release-manifest.json") == frozen["manifest_sha256"]
        assert digest(directory / "SHA256SUMS") == frozen["sums_sha256"]
        assert digest(DEV / "copypaste-platform/.env") == baseline["platform_environment_sha256"]
        for name, expected in report["qualified_sources"].items():
            assert digest(ROOT / name) == expected, name

    def allowed(branch, name):
        if branch == "docs":
            return name in ["docs/README.md", "docs/README.en.md"] or name.startswith(("docs/development/163-", "docs/changes/163-", "docs/quality/session-boundary-checkpoint-163.", "docs/quality/remaining-work-stage163.", "docs/assets/session-boundary-163/")) or name.startswith("docs/tools/") and "session-boundary-163-v1.py" in name
        if name in ["README.md", "README.en.md"] or name.startswith("assets/screenshots/workmate-session-boundary-163-"):
            return True
        if branch == "web":
            return name in ["src/api.ts", "src/session-request.ts", "src/task-events.ts"]
        if branch == "admin":
            return name == "src/api.ts"
        if branch == "desktop":
            return name in ["renderer/src/api.ts", "renderer/src/session-request.ts", "renderer/src/task-events.ts"]
        if branch == "backend":
            return name in ["scripts/serve-session-boundary-163-v1.ts", "scripts/serve-session-boundary-163-v2.ts"]
        return branch == "delivery" and (name.startswith("evidence/session-boundary-163/") or name.startswith("scripts/qualify-session-ui-163-v") or name.startswith("scripts/qa-session-boundary-163-v") or name == "scripts/qualify-session-boundary-163-v1.mjs" or name == "tests/session-boundary-163-v1.test.mjs")

    try:
        assert report["status"] == "qualified" and report["qualification"]["status"] == "passed" and report["http_test_results"] == 28
        assert report["browser"]["status"] == "passed" and report["browser"]["browser_closed"] and len(report["browser"]["checks"]) == 3
        assert report["browser_qualification"]["owned_services_closed"]
        preserve()
        assert refs() == baseline["remote_refs"], "Remote advanced; preserve other work"
        repos = {b: DEV / ("copypaste-" + c) for b, c in COMPONENTS.items()}
        repos["docs"] = ROOT
        changes = {}
        protected = {p.replace("\\", "/") for p in baseline["preserved_user_files"]}
        for branch, repo in repos.items():
            assert text(repo, "remote", "get-url", "origin") == REMOTE
            assert text(repo, "branch", "--show-current") == "codex/" + branch
            assert text(repo, "rev-parse", "HEAD") == baseline["heads"]["docs" if branch == "docs" else COMPONENTS[branch]]
            assert text(repo, "diff", "--cached", "--name-only") == "", "Preserve pre-existing staged work"
            tracked = set(git(repo, "diff", "--name-only", "-z", "HEAD").decode().split("\0")) - {""}
            untracked = set(git(repo, "ls-files", "--others", "--exclude-standard", "-z").decode().split("\0")) - {""}
            if branch == "docs":
                assert not tracked.intersection(protected)
                untracked -= protected
            changed = tracked | untracked
            assert changed and all(allowed(branch, p) for p in changed), "Unexpected changes in " + branch
            changes[branch] = sorted(changed)
        heads = {}
        for branch, repo in repos.items():
            changed = changes[branch]
            for i in range(0, len(changed), 60):
                git(repo, "add", "--", *changed[i:i + 60])
            staged = set(git(repo, "diff", "--cached", "--name-only", "-z").decode().split("\0")) - {""}
            assert staged == set(changed)
            for name in changed:
                raw = (repo / name).read_bytes()
                expected = sha1(("blob " + str(len(raw)) + "\0").encode() + raw).hexdigest()
                assert text(repo, "ls-files", "-s", "--", name).split()[1] == expected, "Git normalization changed bound bytes: " + name
            git(repo, "commit", "-m", "Fix current-session business responses, stale sign-in results and progress withdrawal (stage163)")
            heads[branch] = text(repo, "rev-parse", "HEAD")
            result["components"][branch] = {"commit": heads[branch], "files": len(changed)}
        for branch, repo in repos.items():
            if branch != "docs":
                git(ROOT, "fetch", "--no-tags", str(repo), heads[branch])
        preserve()
        assert refs() == baseline["remote_refs"], "Remote advanced before push"
        git(ROOT, "push", "--atomic", "origin", *[heads[b] + ":refs/heads/" + b for b in COMPONENTS], heads["docs"] + ":refs/heads/docs", heads["docs"] + ":refs/heads/main")
        observed = refs()
        expected = {**baseline["remote_refs"], **{"refs/heads/" + b: heads["docs" if b == "main" else b] for b in [*COMPONENTS, "docs", "main"]}}
        assert observed == expected, "Exact remote refs did not match"
        preserve()
        result.update(status="published", release_scope="Unfrozen session-boundary source correction after rc.3; original installers unchanged", verified_refs=observed, all_frozen_tags_unchanged=True, frozen_bytes_unchanged=True, preserved_user_files=12)
    except Exception as e:
        result.update(status="failed", failure=type(e).__name__ + ": " + str(e))
    finally:
        result["finished_at"] = datetime.now(timezone.utc).isoformat()
        result["publisher_sha256"] = digest(Path(__file__))
        (out / "receipt.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
        log.close()
        print(json.dumps({"status": result["status"], "receipt": str(out / "receipt.json"), "failure": result["failure"]}, ensure_ascii=False))
    assert result["status"] == "published"


if __name__ == "__main__":
    main()
