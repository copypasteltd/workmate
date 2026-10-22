"""Bind committed component bytes to the retained tests and publication plan."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"
BRANCHES = {"platform": "backend", "web": "web", "admin": "admin", "desktop": "desktop", "extension": "extension", "delivery": "delivery"}


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def git(repo, *args, check=True):
    return subprocess.run(["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", str(repo), *args], capture_output=True, check=check)


def read(file):
    return json.loads(file.read_text(encoding="utf-8"))


def main():
    output = ROOT / "docs/quality/workmate-publication.json"
    assert not output.exists(), "Keep the original delivery plan; future updates must explicitly revise its reviewed component versions"
    evidence = DELIVERY / "evidence"
    full = read(evidence / "paid-input-regression-02.json")
    focused = read(evidence / "paid-input-integration-10.json")
    clients = read(evidence / "paid-input-clients-08.json")
    native = read(evidence / "paid-input-native-06.json")
    media = read(evidence / "workmate-media-06.json")
    for report in (full, focused, clients, native, media):
        assert report["status"] == "passed"
    assert full["counts"]["pass"] == full["counts"]["tests"] == 782
    assert focused["counts"]["pass"] == focused["counts"]["tests"] == 34
    assert len(clients["checks"]) == 13 and all(c["exit_code"] == 0 for c in clients["checks"])
    assert native["counts"] == {"checks": 32, "errors": 0}
    assert native["owned_database_shutdown"] and native["owned_web_preview_closed"] and native["owned_admin_preview_closed"]
    checked = {}
    for name, report, resolve in (
        ("full_platform", full, lambda p: DEV / "copypaste-platform" / p),
        ("client_checks", clients, lambda p: DEV / ("copypaste-" + p.split("/", 1)[0]) / p.split("/", 1)[1]),
        ("native_journey", native, lambda p: ROOT / p if p.startswith("docs/") else DEV / p),
    ):
        assert report["source_unchanged"]
        for file, expected in report["source_files"].items():
            assert digest(resolve(file)) == expected, "Recorded source changed: " + file
        checked[name] = len(report["source_files"])
    components = []
    whitespace_exceptions = []
    bytes_checked = 0
    for component, branch in BRANCHES.items():
        repo = DEV / ("copypaste-" + component)
        assert git(repo, "status", "--porcelain").stdout == b""
        commit = git(repo, "rev-parse", "HEAD").stdout.decode().strip()
        assert git(repo, "branch", "--show-current").stdout.decode().strip() == "codex/" + branch
        changes = [p.decode() for p in git(repo, "diff-tree", "--no-commit-id", "--name-only", "-r", "-z", "HEAD").stdout.split(b"\0") if p]
        for file in changes:
            assert git(repo, "show", "HEAD:" + file).stdout == (repo / file).read_bytes(), "Committed bytes changed: " + component + "/" + file
            bytes_checked += 1
        whitespace = git(repo, "show", "--format=", "--check", "HEAD", check=False)
        assert not whitespace.stderr
        excluded = set()
        if whitespace.returncode:
            assert component == "delivery"
            for line in whitespace.stdout.decode().splitlines():
                match = re.fullmatch(r"(evidence/paid-input-native-(0[456])\.log):(\d+): (trailing whitespace\.|new blank line at EOF\.)", line)
                if match:
                    file, attempt, number, message = match.groups()
                    original = read(evidence / ("paid-input-native-" + attempt + ".json"))["raw_report"]
                    assert original["path"] == file and original["sha256"] == digest(repo / file)
                    whitespace_exceptions.append({"path": "dev/copypaste-delivery/" + file, "line": int(number), "message": message, "sha256": original["sha256"]})
                    excluded.add(file)
                else:
                    assert line.startswith("+") and excluded, "Unexpected source whitespace diagnostic"
            assert len(excluded) == 3
            remaining = git(repo, "show", "--format=", "--check", "HEAD", "--", ".", *(":(exclude)" + f for f in sorted(excluded)))
            assert not remaining.stdout and not remaining.stderr
        else:
            assert not whitespace.stdout
        components.append({
            "component": component, "branch": branch, "local_branch": "codex/" + branch,
            "directory": repo.relative_to(ROOT).as_posix(), "commit": commit,
            "tree": git(repo, "rev-parse", "HEAD^{tree}").stdout.decode().strip(),
            "readmes": [{"path": name, "sha256": digest(repo / name)} for name in ("README.md", "README.en.md")],
            "branch_url": "https://github.com/copypasteltd/workmate/tree/" + branch,
        })
    syntax = subprocess.run(["node", "--check", "scripts/publish-workmate.mjs"], cwd=DELIVERY, capture_output=True, check=True)
    assert not syntax.stdout and not syntax.stderr
    archive_file = ROOT / "docs/quality/history/stage66-before-workmate-readmes/manifest.json"
    for entry in read(archive_file)["files"]:
        assert digest(ROOT / entry["archive"]) == entry["sha256"]
    proofs = []
    for file in (
        "paid-input-regression-02.json", "paid-input-integration-10.json", "paid-input-clients-08.json",
        "paid-input-native-06.json", "paid-input-native-06-journey.json", "workmate-media-06.json",
        "paid-input-native-04.json", "paid-input-native-05.json", "workmate-media-04.json", "workmate-media-05.json",
    ):
        proofs.append({
            "repository": "delivery", "path": "evidence/" + file, "sha256": digest(evidence / file),
            "url": "https://github.com/copypasteltd/workmate/blob/delivery/evidence/" + file,
        })
    result = {
        "at": datetime.now(timezone.utc).isoformat(), "status": "ready_for_remote_verification",
        "scope": "Final committed components and actual retained source/media evidence. Only a successful publisher receipt plus remote SHA verification establishes publication.",
        "remote": "git@github.com:copypasteltd/workmate.git",
        "documentation_branches": ["docs", "main"],
        "documentation_commit_rule": "Both branches publish the final committed docs checkout; no self-referential commit ID is stored in this file.",
        "components": components, "media_attempt": "06", "client_attempt": "08",
        "source_bindings_checked": checked, "latest_component_committed_files_equal_disk": bytes_checked,
        "recording_scope": media["scope"], "proofs": proofs,
        "separately_verified_source_addition": {
            "path": "dev/copypaste-delivery/scripts/publish-workmate.mjs",
            "sha256": digest(DELIVERY / "scripts/publish-workmate.mjs"), "node_syntax_exit_code": 0,
            "note": "Added after client/native qualification; verify its actual preflight separately before pushing.",
        },
        "preserved_raw_whitespace_exceptions": whitespace_exceptions,
        "source_and_markdown_whitespace_issues": 0,
        "acceptance_baseline": {"requirements": 102, "acceptance_cases": 102, "partial": 81, "unproven": 21, "fully_accepted": 0, "all_NFR_and_G01_G10_preserved": True},
        "verifier_sha256": digest(Path(__file__)),
    }
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": result["status"], "components": len(components), "source_bindings": checked, "committed_files_checked": bytes_checked, "raw_log_whitespace_exceptions": len(whitespace_exceptions)}))


if __name__ == "__main__":
    main()
