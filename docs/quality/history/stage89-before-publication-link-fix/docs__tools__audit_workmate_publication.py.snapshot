"""Read-only publication audit. Never prints matched credential values."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[2]
MAP = {
    "backend": ROOT / "dev/copypaste-platform",
    "web": ROOT / "dev/copypaste-web",
    "admin": ROOT / "dev/copypaste-admin",
    "desktop": ROOT / "dev/copypaste-desktop",
    "extension": ROOT / "dev/copypaste-extension",
    "delivery": ROOT / "dev/copypaste-delivery",
    "docs": ROOT,
}
REMOTE = "git@github.com:copypasteltd/workmate.git"
BASE = "https://github.com/copypasteltd/workmate/"


def git(repo, *args, data=None):
    return subprocess.check_output(
        ["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", str(repo), *args],
        input=data, stderr=subprocess.PIPE,
    )


def configured_credentials():
    # Literal local configuration is read only to recognize values which must
    # never be published. Neither needles nor matched bytes enter the report.
    needles = set()
    for repo in MAP.values():
        for name in (".env", ".env.local"):
            file = repo / name
            if not file.is_file():
                continue
            for line in file.read_text(encoding="utf-8-sig").splitlines():
                match = re.match(r"^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$", line)
                if not match:
                    continue
                field, value = match.groups()
                if not re.search(r"(?:KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL)$", field):
                    continue
                value = value.strip("'\"")
                candidates = [value]
                if field.endswith("DATABASE_URL") and value:
                    password = urlparse(value).password
                    if password:
                        candidates += [password, unquote(password)]
                for candidate in candidates:
                    if len(candidate) >= 12:
                        needles.add(candidate.encode())
    assert needles, "A meaningful scan must recognize configured credentials"
    return needles


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True)
    parser.add_argument("--media", required=True)
    parser.add_argument("--verify-only", action="store_true", help="Read-only final verification; emit a summary without writing a report")
    args = parser.parse_args()
    assert re.fullmatch(r"workmate-publication-audit-\d{2}\.json", args.report)
    output = ROOT / "docs/quality" / args.report
    assert args.verify_only or not output.exists(), "Never overwrite retained audit evidence"
    credentials = configured_credentials()
    problems, repositories, links = [], [], []
    forbidden = re.compile(r"(^|/)(?:node_modules|\.data|\.git|dist|release|test-results)(?:/|$)|(^|/)\.env(?:$|\.(?!example$))|(?:^|/)(?:id_rsa|id_ed25519)$", re.I)
    signatures = {
        "private_key": re.compile(rb"-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----"),
        "github_personal_token": re.compile(rb"(?:gh[pousr]_[A-Za-z0-9]{32,}|github_pat_[A-Za-z0-9_]{40,})"),
        "openai_secret": re.compile(rb"\bsk-(?:proj-|svcacct-)?[A-Za-z0-9_-]{32,}\b"),
        "aws_access_id": re.compile(rb"\b(?:AKIA|ASIA)[A-Z0-9]{16}\b"),
    }
    # Recognizable fixtures are not real credentials. Do not exempt local
    # configured secrets, private keys or arbitrary high-entropy tokens.
    fixture = re.compile(rb"(?:example|fixture|synthetic|dummy|placeholder|fake|test[-_]|not[-_]?real)", re.I)
    scanned_objects = set()
    for branch, repo in MAP.items():
        top = Path(git(repo, "rev-parse", "--show-toplevel").decode().strip()).resolve()
        assert top == repo.resolve(), "Expected an independent repository"
        assert git(repo, "remote", "get-url", "origin").decode().strip() == REMOTE
        head = git(repo, "rev-parse", "HEAD").decode().strip()
        tree = git(repo, "ls-tree", "-rz", "--name-only", "HEAD").decode().split("\0")
        historical = git(repo, "rev-list", "--objects", "HEAD").decode().splitlines()
        object_paths = {}
        for line in historical:
            parts = line.split(" ", 1)
            object_paths.setdefault(parts[0], parts[1] if len(parts) == 2 else "")
        ids = list(object_paths)
        metadata = git(repo, "cat-file", "--batch-check=%(objectname) %(objecttype) %(objectsize)", data=("\n".join(ids) + "\n").encode()).decode().splitlines()
        blobs = []
        for row in metadata:
            oid, kind, size = row.split()
            if kind != "blob":
                continue
            size = int(size)
            name = object_paths[oid]
            if size >= 100 * 1024 * 1024:
                problems.append({"branch": branch, "path": name, "oid": oid, "kind": "GitHub_blob_at_least_100MiB", "bytes": size})
            if forbidden.search(name):
                problems.append({"branch": branch, "path": name, "oid": oid, "kind": "forbidden_historical_path"})
            blobs.append((oid, name, size))
        # One persistent batch reader per repository avoids per-blob subprocesses.
        proc = subprocess.Popen(
            ["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", str(repo), "cat-file", "--batch"],
            stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        )
        bytes_checked = 0
        try:
            for oid, name, size in blobs:
                if oid in scanned_objects:
                    continue
                proc.stdin.write((oid + "\n").encode())
                proc.stdin.flush()
                header = proc.stdout.readline().decode().split()
                assert header[0] == oid and header[1] == "blob" and int(header[2]) == size
                content = proc.stdout.read(size)
                assert len(content) == size and proc.stdout.read(1) == b"\n"
                bytes_checked += size
                scanned_objects.add(oid)
                if any(secret in content for secret in credentials):
                    problems.append({"branch": branch, "path": name, "oid": oid, "kind": "configured_credential_literal"})
                if b"\0" not in content[:8192]:
                    for kind, pattern in signatures.items():
                        for hit in pattern.finditer(content):
                            if kind != "private_key" and fixture.search(hit.group()):
                                continue
                            problems.append({"branch": branch, "path": name, "oid": oid, "kind": kind})
                            break
            proc.stdin.close()
            assert proc.wait(timeout=30) == 0
        finally:
            if proc.poll() is None:
                proc.kill()
                proc.wait()
        for name in tree:
            if name and forbidden.search(name):
                problems.append({"branch": branch, "path": name, "kind": "forbidden_current_path"})
        readmes = [repo / "README.md", repo / "README.en.md"] if branch != "docs" else [repo / "docs/README.md", repo / "docs/README.en.md"]
        for readme in readmes:
            content = readme.read_text(encoding="utf-8")
            assert len(content) > 2500 and "\ufffd" not in content
            stripped = re.sub(r"\x60{3}.*?\x60{3}", "", content, flags=re.S)
            for target in re.findall(r"!?\[[^\]]*\]\(([^)\n]+)\)", stripped):
                target = target.strip("<>")
                if target.startswith(BASE):
                    part = target[len(BASE):]
                    if part.startswith("tree/"):
                        assert part[5:] in {*MAP, "main"}
                        continue
                    assert part.startswith("blob/"), target
                    target_branch, destination = part[5:].split("/", 1)
                    assert target_branch in {*MAP, "main"}
                    directory = MAP.get(target_branch, ROOT)
                    local = directory / unquote(destination.split("#")[0])
                elif re.match(r"^[a-zA-Z][a-zA-Z0-9+.-]*:", target):
                    continue
                else:
                    local = (readme.parent / unquote(target.split("#")[0])).resolve()
                    assert local.is_relative_to(repo), "Standalone README link escapes its repository"
                links.append({"from": str(readme.relative_to(ROOT)), "target": target})
                if not local.is_file():
                    problems.append({"branch": branch, "readme": readme.name, "target": target, "kind": "missing_readme_target"})
        repositories.append({
            "branch": branch, "local_branch": git(repo, "branch", "--show-current").decode().strip(),
            "head": head, "commits": int(git(repo, "rev-list", "--count", "HEAD")),
            "current_files": len([v for v in tree if v]), "historical_blobs": len(blobs),
            "unique_blob_bytes_checked": bytes_checked,
            "largest_blob": max((size for _, _, size in blobs), default=0),
        })
    media = json.loads((ROOT / "docs/quality" / ("workmate-media-" + args.media + ".json")).read_text(encoding="utf-8"))
    assert media["status"] == "passed" and len(media["recordings"]) == 4
    for item in media["screenshots"]:
        assert sha256((ROOT / "dev" / item["path"]).read_bytes()).hexdigest() == item["sha256"]
    for recording in media["recordings"]:
        assert recording["distinct_frames"] >= 2 and recording["observed_frames"] >= 5
        for item in recording["files"]:
            assert sha256((ROOT / "dev" / item["path"]).read_bytes()).hexdigest() == item["sha256"]
    result = {
        "at": datetime.now(timezone.utc).isoformat(),
        "status": "failed" if problems else "passed",
        "scope": "All HEAD-reachable Git blobs in seven independent repositories, exact configured credential values and listed token signatures, forbidden paths and 100MiB limit; current bilingual README links and actual media bytes. Not a complete security/secret audit.",
        "verifier_sha256": sha256(Path(__file__).read_bytes()).hexdigest(),
        "configured_patterns": len(credentials), "unique_historical_blobs_checked": len(scanned_objects),
        "repositories": repositories, "readme_links": len(links), "problems": problems,
    }
    if not args.verify_only:
        output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"status": result["status"], "historical_blobs": len(scanned_objects), "links": len(links), "problems": len(problems)}))
    return 1 if problems else 0


if __name__ == "__main__":
    raise SystemExit(main())
