"""Atomically publish the bounded rc.5 source freeze and seven annotated tags."""
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
    report_path = ROOT / "docs/quality/release-freeze-checkpoint-165.json"
    report = json.loads(report_path.read_bytes())
    baseline = report["baseline"]
    out = DELIVERY / ".data/release-freeze-165" / ("publication-" + str(uuid.uuid4()))
    out.mkdir(parents=True)
    log = (out / "commands.log").open("xb")
    result = {"started_at": datetime.now(timezone.utc).isoformat(), "status": "running", "remote": REMOTE, "release": "v0.1.0-rc.5", "report_sha256": digest(report_path), "components": {}, "failure": None}
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
        patterns = ["refs/heads/" + b for b in [*COMPONENTS, "docs", "main"]] + ["refs/tags/v0.1.0-rc.*"]
        return {s.split()[1]: s.split()[0] for s in text(ROOT, "ls-remote", "origin", *patterns).splitlines()}

    def preserve():
        for name, h in {**baseline["preserved_user_files"], **baseline["frozen_files"]}.items():
            assert digest(ROOT / name) == h, name
        assert digest(DEV / "copypaste-desktop/.gitattributes") == baseline["desktop_attributes_sha256"]
        assert digest(DELIVERY / ".data/release-freeze-158/frozen-receipt.json") == baseline["frozen_receipt_sha256"]
        frozen = json.loads((DELIVERY / ".data/release-freeze-158/frozen-receipt.json").read_bytes())
        assert digest(Path(frozen["complete_archive"]["path"])) == frozen["complete_archive"]["sha256"]
        directory = DELIVERY / "release/workmate-v0.1.0-rc.2"
        assert digest(directory / "release-manifest.json") == frozen["manifest_sha256"]
        assert digest(directory / "SHA256SUMS") == frozen["sums_sha256"]
        for v in baseline['frozen_releases'].values():
            assert digest(Path(v['complete_archive']['path'])) == v['complete_archive']['sha256']
            assert digest(Path(v['directory']) / 'release-manifest.json') == v['manifest_sha256']
            assert digest(Path(v['directory']) / 'SHA256SUMS') == v['sums_sha256']
        for name, expected in (("dev/" + p, h) for p, h in report["qualified_sources"].items()):
            assert digest(ROOT / name) == expected, name

    def allowed(branch, name):
        if branch == "docs":
            return name in ["docs/README.md", "docs/README.en.md", "docs/releases/v0.1.0-rc.5.md", "docs/requirements/26-workspace-recovery-and-admin-target.md", "docs/quality/functional-closure-165.json"] or name.startswith(("docs/development/165-", "docs/changes/165-", "docs/quality/release-freeze-checkpoint-165.", "docs/quality/remaining-work-stage165.", "docs/quality/spec-review-165/", "docs/history/readme-before-rc5/", "docs/assets/functional-closure-165/")) or name in ["docs/tools/prepare-release-freeze-165-v1.py", "docs/tools/publish-release-freeze-165-v1.py", "docs/tools/finalize-release-handoff-165-v1.py"]
        if name in ["README.md", "README.en.md"] or name.startswith("assets/screenshots/workmate-functional-closure-165-"):
            return True
        product = {
            "backend": {"src/workspaces.ts", "tests/workspace-creation-165-v1.test.ts", "tests/workspace-creation-165-v2.test.ts", "scripts/serve-functional-closure-165-v1.ts"},
            "web": {"src/api.ts", "src/context.tsx", "src/main.tsx", "src/workspace-creation.ts", "src/workspace-creation-form.tsx", "tests/workspace-creation-165.test.ts"},
            "desktop": {"src/config.ts", "renderer/src/api.ts", "renderer/src/context.tsx", "renderer/src/main.tsx", "renderer/src/workspace-creation.ts", "renderer/src/workspace-creation-form.tsx"},
            "admin": {"src/main.tsx", "src/directory.tsx"}, "extension": set(),
        }
        if name in product.get(branch, set()): return True
        return branch == "delivery" and (name.startswith(("evidence/release-freeze-165/", "evidence/functional-closure-165/")) or name in ["scripts/package-frozen-release-165-v1.py", "scripts/publish-github-release-165-v1.py", "scripts/qualify-functional-closure-165-v1.mjs", "scripts/qualify-functional-closure-165-v2.mjs", "scripts/qa-workspace-recovery-165-v1.ts", "scripts/qa-admin-target-165-v1.ts"])

    try:
        assert report["status"] == "qualified" and report["release"] == "v0.1.0-rc.5" and len(report["build_commands"]) == 7 and all(c["exit_code"] == 0 for c in report["build_commands"])
        assert report["focused_qualification"]["database_cases"] == 7 and report["focused_qualification"]["helper_cases"] == 4
        assert report["focused_qualification"]["actual_ui_checks"] >= 6
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
            git(repo, "commit", "-m", "Freeze Workmate rc.5 with creation recovery, Admin targets and organized handbooks (stage165)")
            heads[branch] = text(repo, "rev-parse", "HEAD")
            result["components"][branch] = {"commit": heads[branch], "files": len(changed)}
        for branch, repo in repos.items():
            if branch != "docs":
                git(ROOT, "fetch", "--no-tags", str(repo), heads[branch])
        preserve()
        assert refs() == baseline["remote_refs"], "Remote advanced before push"
        tags = {}
        for branch in [*COMPONENTS, "docs"]:
            tag = "v0.1.0-rc.5" + ("" if branch == "docs" else "-" + branch)
            assert not text(ROOT, "tag", "--list", tag), "Existing local tag preserved"
            git(ROOT, "tag", "-a", tag, heads[branch], "-m", "Workmate rc.5 frozen synthetic candidate; " + branch)
            tags[tag] = {"object": text(ROOT, "rev-parse", "refs/tags/" + tag), "commit": heads[branch]}
        result["tags"] = tags
        git(ROOT, "push", "--atomic", "origin", *[heads[b] + ":refs/heads/" + b for b in COMPONENTS], heads["docs"] + ":refs/heads/docs", heads["docs"] + ":refs/heads/main", *["refs/tags/" + t + ":refs/tags/" + t for t in tags])
        observed = refs()
        expected = {**baseline["remote_refs"], **{"refs/heads/" + b: heads["docs" if b == "main" else b] for b in [*COMPONENTS, "docs", "main"]}}
        for tag, value in tags.items():
            expected["refs/tags/" + tag] = value["object"]
            expected["refs/tags/" + tag + "^{}"] = value["commit"]
        assert observed == expected, "Exact remote refs did not match"
        preserve()
        result.update(status="published", release_scope="Complete bounded synthetic candidate v0.1.0-rc.5", verified_refs=observed, previous_frozen_tags_unchanged=True, frozen_bytes_unchanged=True, preserved_user_files=12)
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
