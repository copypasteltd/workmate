"""Audit staged live sources; retain exact immutable TAP and archive bytes."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
repositories = {"docs": ROOT, **{name: DEV / ("copypaste-" + name) for name in ("platform", "web", "admin", "desktop", "extension", "delivery")}}


def git(repo, *args):
    return subprocess.run(["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", *args], cwd=repo, capture_output=True)


archives = {}
for receipt in (DEV / "copypaste-delivery/evidence").glob("desktop-workflows-*.json"):
    data = json.loads(receipt.read_text(encoding="utf-8"))
    for item in data.get("preserved_changes", {}).values():
        archives[item["path"]] = item["sha256"]
native = json.loads((DEV / "copypaste-delivery/evidence/local-codex-native-21.json").read_text(encoding="utf-8"))
archives.update({"evidence/local-codex-native-21-sources/" + name: value for name, value in native["source_files"].items()})
exceptions, files, checked = [], {}, []
for component, repo in repositories.items():
    live = git(repo, "diff", "--cached", "--check", "--", ".", ":(exclude)evidence/**", ":(exclude)docs/quality/history/**")
    assert live.returncode == 0 and not live.stdout and not live.stderr, (component, live.stdout.decode("utf-8"))
    raw = git(repo, "diff", "--cached", "--check")
    assert raw.returncode in (0, 2) and not raw.stderr
    last = None
    for line in raw.stdout.decode("utf-8").splitlines():
        match = re.fullmatch(r"(.+):(\d+): (trailing whitespace|new blank line at EOF)\.", line)
        if not match:
            assert last and line.startswith("+"), component
            continue
        name, number, kind = match.groups()
        allowed = component == "docs" and name.startswith("docs/quality/history/")
        allowed = allowed or component == "delivery" and (re.fullmatch(r"evidence/[a-z0-9._-]+\.tap", name) or name in archives)
        assert allowed, (component, name, "Do not exempt editable source")
        data = (repo / name).read_bytes()
        if name in archives:
            assert sha256(data).hexdigest() == archives[name]
        lines = data.splitlines()
        if kind == "trailing whitespace":
            assert lines[int(number) - 1].endswith((b" ", b"\t"))
        else:
            assert all(not value.strip() for value in lines[int(number) - 1:])
        staged = git(repo, "show", ":" + name)
        assert staged.returncode == 0 and staged.stdout == data
        identity = component + "/" + name
        files[identity] = {"repository": component, "path": name, "sha256": sha256(data).hexdigest(), "staged_bytes_equal_disk": True}
        last = {"repository": component, "path": name, "line": int(number), "kind": kind}
        exceptions.append(last)
    checked.append(component)
result = {"at": datetime.now(timezone.utc).isoformat(), "status": "passed", "repositories": checked,
    "source_and_readme_whitespace_issues": 0, "raw_log_exceptions": exceptions, "raw_files": list(files.values()), "raw_bytes_changed": False,
    "scope": "Staged editable sources and README in all seven repositories. Only exact retained TAP/source/history archives retain their original diagnostics; nothing is trimmed.",
    "verifier_sha256": sha256(Path(__file__).read_bytes()).hexdigest()}
with (ROOT / "docs/quality/desktop-workflow-whitespace-01.json").open("x", encoding="utf-8") as stream:
    stream.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"status": "passed", "repositories": 7, "source_issues": 0, "preserved_diagnostics": len(exceptions), "raw_files": len(files)}))
