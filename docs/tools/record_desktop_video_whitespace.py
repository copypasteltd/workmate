"""Audit staged source and preserve exact qualified raw diagnostics/archives."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
repositories = {"docs": ROOT, **{name: ROOT / "dev" / ("copypaste-" + name) for name in ("platform", "web", "admin", "desktop", "extension", "delivery")}}


def git(repo, *args):
    return subprocess.run(["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", *args], cwd=repo, capture_output=True)


exceptions, files, checked = [], {}, []
for component, repo in repositories.items():
    source = git(repo, "diff", "--cached", "--check", "--", ".", ":(exclude)evidence/**", ":(exclude)docs/quality/history/**")
    assert source.returncode == 0 and not source.stdout and not source.stderr, component
    raw = git(repo, "diff", "--cached", "--check")
    assert raw.returncode in (0, 2) and not raw.stderr
    last = None
    for line in raw.stdout.decode("utf-8").splitlines():
        match = re.fullmatch(r"(.+):(\d+): (trailing whitespace|new blank line at EOF)\.", line)
        if not match:
            assert last and line.startswith("+"), component
            continue
        name, number, kind = match.groups()
        allowed = component == "delivery" and (re.fullmatch(r"evidence/[a-z0-9._-]+\.tap", name) or re.fullmatch(r"evidence/local-codex-native-20-sources/.+", name))
        allowed = allowed or component == "docs" and re.fullmatch(r"docs/quality/history/.+\.txt", name)
        assert allowed, (component, name, "Do not exempt editable source")
        data = (repo / name).read_bytes()
        lines = data.splitlines()
        if kind == "trailing whitespace":
            assert lines[int(number) - 1].endswith((b" ", b"\t"))
        else:
            assert all(not item.strip() for item in lines[int(number) - 1:])
        staged = git(repo, "show", ":" + name)
        assert staged.returncode == 0 and staged.stdout == data, (component, name)
        identity = component + "/" + name
        files[identity] = {"repository": component, "path": name, "sha256": sha256(data).hexdigest(), "staged_bytes_equal_disk": True}
        last = {"repository": component, "path": name, "line": int(number), "kind": kind}
        exceptions.append(last)
    checked.append(component)
result = {"at": datetime.now(timezone.utc).isoformat(), "status": "passed", "repositories": checked,
    "source_and_readme_whitespace_issues": 0, "raw_log_exceptions": exceptions, "raw_files": list(files.values()), "raw_bytes_changed": False,
    "scope": "Staged editable source and README in seven repositories. Only exact TAP and retained immutable source-archive diagnostics are exempted; no raw bytes are trimmed.",
    "verifier_sha256": sha256(Path(__file__).read_bytes()).hexdigest()}
with (ROOT / "docs/quality/desktop-video-whitespace-01.json").open("x", encoding="utf-8", newline="\n") as stream:
    stream.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"status": result["status"], "repositories": 7, "source_issues": 0, "preserved_diagnostics": len(exceptions), "raw_files": len(files)}))
