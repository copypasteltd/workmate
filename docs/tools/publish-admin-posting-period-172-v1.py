"""Publish only the qualified source increment; preserve every frozen release."""
from datetime import datetime, timezone
from hashlib import sha1, sha256
import json
import os
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote
import uuid

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"
REPOS = {"docs": ROOT, "backend": DEV / "copypaste-platform", **{key: DEV / ("copypaste-" + key) for key in ["web", "admin", "desktop", "extension", "delivery"]}}
BRANCHES = ["backend", "web", "admin", "desktop", "extension", "delivery", "docs", "main"]
OUT = DELIVERY / ".data/admin-posting-period-172" / ("publication-" + str(uuid.uuid4()))
OUT.mkdir()
log = (OUT / "commands.log").open("xb")
result = {"at": datetime.now(timezone.utc).isoformat(), "stage": 172, "status": "running", "failure": None}
env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_SSH_COMMAND": "ssh -o BatchMode=yes"}


def digest(path):
    value = sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            value.update(chunk)
    return value.hexdigest()


def create(path, value):
    with path.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def git(repo, *args):
    log.write((json.dumps({"repository": str(repo), "args": args}) + "\n").encode())
    log.flush()
    process = subprocess.run(["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-c", "gc.auto=0", "-c", "gc.autoPackLimit=0", *args], cwd=repo, env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)
    log.write(process.stdout + process.stderr + b"\n")
    log.flush()
    assert process.returncode == 0, "Git failed; exact command/output retained in the private publication log"
    return process.stdout.decode("utf-8").strip()


def refs():
    return {line.split()[1]: line.split()[0] for line in git(ROOT, "ls-remote", "origin", "refs/heads/*", "refs/tags/v0.1.*").splitlines()}


def preserve(baseline):
    for name, expected in baseline["preserved_user_files"].items():
        assert digest(ROOT / name) == expected, name
    assert digest(DEV / "copypaste-desktop/.gitattributes") == baseline["desktop_attributes_sha256"]
    for version, frozen in baseline["frozen_releases"].items():
        directory = Path(frozen["directory"])
        assert digest(directory / "release-manifest.json") == frozen["manifest_sha256"], version
        assert digest(directory / "SHA256SUMS") == frozen["sums_sha256"], version
        assert Path(frozen["complete_archive"]["path"]).stat().st_size == frozen["complete_archive"]["bytes"]


def stage(repo, names):
    assert not git(repo, "diff", "--cached", "--name-only"), "Existing staged work must be preserved"
    changed = set(git(repo, "diff", "--name-only", "-z").split("\0")) - {""}
    assert changed <= set(names), "Unrelated tracked work must be preserved: " + str(changed - set(names))
    git(repo, "add", "--", *names)
    assert set(git(repo, "diff", "--cached", "--name-only", "-z").split("\0")) - {""} == set(names)
    git(repo, "diff", "--cached", "--check")
    for name in names:
        raw = (repo / name).read_bytes()
        blob = sha1(("blob " + str(len(raw)) + "\0").encode() + raw).hexdigest()
        assert git(repo, "ls-files", "-s", "--", name).split()[1] == blob, "Staging changed qualified bytes: " + name


try:
    baseline = json.loads((DELIVERY / ".data/admin-posting-period-172/baseline.json").read_bytes())
    report = json.loads((ROOT / "docs/quality/admin-posting-period-172.json").read_bytes())
    assert report["status"] == "qualified" and report["owned_browser_and_services_closed"]
    for name, expected in report["sources"].items():
        assert digest(DEV / name) == expected, name
    for entry in [report["qualification"], report["actual_ui"], *report["retained_attempts"]]:
        assert digest(ROOT / entry["path"]) == entry["sha256"], entry["path"]
    for entry in report["media"]["copies"]:
        assert digest(ROOT / entry["path"]) == entry["sha256"], entry["path"]
    assert (ROOT / "docs/contracts/admin-posting-period-172.json").read_bytes() == (REPOS["backend"] / "contracts/admin-posting-period-172.json").read_bytes()
    prior_ledger = json.loads((ROOT / "docs/quality/remaining-work-stage169.json").read_bytes())
    ledger = json.loads((ROOT / "docs/quality/remaining-work-stage172.json").read_bytes())
    identity = lambda document: [(row["id"], row["priority"], row["full_acceptance"], row["optional"], row.get("requirement_origin")) for row in document["requirements"]]
    assert identity(ledger) == identity(prior_ledger) and len(ledger["requirements"]) == 102
    assert ledger["summary"] == prior_ledger["summary"] and ledger["current_increment"]["new_full_acceptance_closures"] == 0
    preserve(baseline)
    frozen_checks = {}
    for version, frozen in baseline["frozen_releases"].items():
        archive = Path(frozen["complete_archive"]["path"])
        assert digest(archive) == frozen["complete_archive"]["sha256"], version
        frozen_checks[version] = {"sha256": frozen["complete_archive"]["sha256"], "bytes": archive.stat().st_size, "mtime_ns": archive.stat().st_mtime_ns}
    before = refs()
    assert before == baseline["remote_refs"] and len(before) == 106
    for key, repo in REPOS.items():
        assert git(repo, "rev-parse", "HEAD") == baseline["heads"][key], key
        if key not in ["backend", "admin", "delivery", "docs"]:
            assert not git(repo, "status", "--porcelain", "--untracked-files=no"), key
    handbooks = ["README.md", "README.en.md"]

    def media(key):
        repo = REPOS[key]
        prefix = repo.relative_to(ROOT).as_posix() + "/" if key != "docs" else ""
        return sorted(entry["path"][len(prefix):] for entry in report["media"]["copies"] if (entry["path"].startswith(prefix + "assets/screenshots/") if key != "docs" else entry["path"].startswith("docs/assets/admin-posting-period-172/")))

    names = {
        "backend": handbooks + ["src/admin-usage-report-model.ts", "src/admin-usage-report-query.ts", "src/admin-usage-reports.ts", "contracts/admin-posting-period-172.json"] + [f"tests/admin-posting-period-fixture-172-v{version}.ts" for version in [1, 2]] + [f"tests/admin-posting-period-172-v{version}.test.ts" for version in [1, 2]] + [f"scripts/serve-admin-posting-period-172-v{version}.ts" for version in [1, 2]] + media("backend"),
        "admin": handbooks + ["src/usage-reports.tsx", "src/usage-reports.css"] + media("admin"),
        "delivery": handbooks + ["scripts/qa-admin-posting-period-172-v1.ts"] + [f"scripts/qualify-admin-posting-period-172-v{version}.mjs" for version in [1, 2]] + sorted(path.relative_to(DELIVERY).as_posix() for path in (DELIVERY / "evidence/admin-posting-period-172").glob("*.json")) + media("delivery"),
        "docs": ["docs/README.md", "docs/README.en.md", "docs/product/08-admin-dashboard.md", "docs/requirements/29-admin-usage-reports.md", "docs/requirements/30-admin-posting-period.md", "docs/contracts/admin-posting-period-172.json", "docs/development/172-admin-posting-period.md", "docs/changes/172-admin-posting-period.md", "docs/quality/admin-posting-period-172.json", "docs/quality/remaining-work-stage172.json", "docs/quality/remaining-work-stage172.md", "docs/tools/prepare-admin-posting-period-172-v1.py", "docs/tools/publish-admin-posting-period-172-v1.py"] + media("docs"),
    }
    for key in ["backend", "admin", "delivery"]:
        for name in handbooks:
            path = REPOS[key] / name
            for target in re.findall(r"!?\[[^\]]*\]\(([^\s)]+)\)", path.read_text(encoding="utf-8")):
                if not target.startswith(("https://", "http://", "#")):
                    assert (path.parent / unquote(target.split("#")[0])).is_file(), (key, name, target)
    # Validate every repository's staged blobs before committing any repository.
    for key in ["backend", "admin", "delivery", "docs"]:
        stage(REPOS[key], names[key])
    commits = {}
    for key in ["backend", "admin", "delivery", "docs"]:
        git(REPOS[key], "commit", "-m", "Implement exact Admin posting-period consumption and source handoff (stage172)")
        commits[key] = git(REPOS[key], "rev-parse", "HEAD")
        git(REPOS[key], "merge-base", "--is-ancestor", baseline["heads"][key], commits[key])
        print(json.dumps({"phase": "committed", "component": key, "files": len(names[key]), "commit": commits[key]}), flush=True)
    for key in ["backend", "admin", "delivery"]:
        git(ROOT, "fetch", "--no-tags", "--no-write-fetch-head", str(REPOS[key]), commits[key])
    assert refs() == before, "Concurrent remote change must be preserved"
    targets = {branch: commits.get(branch, baseline["heads"].get(branch, commits["docs"])) for branch in BRANCHES}
    targets["main"] = commits["docs"]
    git(ROOT, "push", "--atomic", "origin", *[targets[branch] + ":refs/heads/" + branch for branch in BRANCHES])
    expected = {**before, **{"refs/heads/" + branch: targets[branch] for branch in BRANCHES}}
    assert refs() == expected
    public = {"stage": 172, "at": datetime.now(timezone.utc).isoformat(), "status": "published", "commits": commits, "verified_source_publication_refs": expected, "frozen_tags_unchanged": True, "frozen_releases_unchanged": frozen_checks, "preserved_user_files": 12, "qualification": report["qualification"], "actual_ui": report["actual_ui"], "scope": "Source increment after v0.1.1; no frozen archive/tag replacement, no new release upload, no whole-acceptance closure. Docs/main subsequently receive this publication receipt.", "publisher_sha256": digest(Path(__file__))}
    public_path = ROOT / "docs/quality/admin-posting-period-publication-172.json"
    create(public_path, public)
    for name in ["README.md", "README.en.md"]:
        path = ROOT / "docs" / name
        content = path.read_text(encoding="utf-8")
        content = content.replace("[更新 / Changes](changes/172-admin-posting-period.md)", "[Git发布回执 / Publication](quality/admin-posting-period-publication-172.json) · [更新 / Changes](changes/172-admin-posting-period.md)", 1)
        path.write_text(content, encoding="utf-8", newline="\n")
    followup = ["docs/README.md", "docs/README.en.md", public_path.relative_to(ROOT).as_posix()]
    stage(ROOT, followup)
    git(ROOT, "commit", "-m", "Record verified stage172 source publication and unchanged release archives")
    final_docs = git(ROOT, "rev-parse", "HEAD")
    assert refs() == expected
    git(ROOT, "push", "--atomic", "origin", final_docs + ":refs/heads/docs", final_docs + ":refs/heads/main")
    expected.update({"refs/heads/docs": final_docs, "refs/heads/main": final_docs})
    assert refs() == expected
    preserve(baseline)
    for version, frozen in baseline["frozen_releases"].items():
        assert Path(frozen["complete_archive"]["path"]).stat().st_mtime_ns == frozen_checks[version]["mtime_ns"]
    for key, repo in REPOS.items():
        assert not git(repo, "status", "--porcelain", "--untracked-files=no"), key
    result.update(status="published", commits=commits, final_docs_commit=final_docs, verified_refs=expected, frozen_tags_unchanged=True, frozen_releases_unchanged=frozen_checks, preserved_user_files=12)
except Exception as error:
    result["failure"] = str(error)
finally:
    result["finished_at"] = datetime.now(timezone.utc).isoformat()
    result["publisher_sha256"] = digest(Path(__file__))
    log.close()
    result["private_log_sha256"] = digest(OUT / "commands.log")
    create(OUT / "receipt.json", result)
    print(json.dumps({"status": result["status"], "failure": result["failure"], "receipt": str(OUT / "receipt.json")}, ensure_ascii=False), flush=True)
assert result["status"] == "published", result["failure"]
