"""Check staged source and preserve exact native/UI TAP diagnostics."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DELIVERY = ROOT / "dev/copypaste-delivery"


def git(*args):
    return subprocess.run(["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", *args], cwd=DELIVERY, capture_output=True, check=False)


source = git("diff", "--cached", "--check", "--", ".", ":(exclude)evidence/**")
assert source.returncode == 0 and not source.stdout and not source.stderr
raw = git("diff", "--cached", "--check")
assert raw.returncode in (0, 2) and not raw.stderr
exceptions, files = [], {}
for line in raw.stdout.decode("utf-8").splitlines():
    match = re.fullmatch(r"(evidence/(?:local-codex-native|desktop-local-ui)-\d{2}\.tap):(\d+): (trailing whitespace|new blank line at EOF)\.", line)
    if not match:
        assert line.startswith("+") and (not line[1:].strip() or line[1:].strip() == "[plugin builtin:vite-reporter]"), "Unexpected diagnostic"
        continue
    name, number, kind = match.groups()
    data = (DELIVERY / name).read_bytes()
    lines = data.splitlines()
    if kind == "trailing whitespace":
        assert lines[int(number) - 1].endswith((b" ", b"\t"))
    else:
        assert all(not item.strip() for item in lines[int(number) - 1:])
    staged = git("show", ":" + name)
    assert staged.returncode == 0 and staged.stdout == data
    files[name] = {"path": name, "sha256": sha256(data).hexdigest(), "staged_bytes_equal_disk": True}
    exceptions.append({"path": name, "line": int(number), "kind": kind})
assert bool(raw.stdout) == bool(exceptions)
result = {"at": datetime.now(timezone.utc).isoformat(), "status": "passed", "source_and_readme_whitespace_issues": 0,
    "scope": "Staged Delivery source/readmes checked separately; exact native and UI raw TAP whitespace is retained as explicit exceptions.",
    "raw_log_exceptions": exceptions, "raw_files": list(files.values()), "raw_bytes_changed": False,
    "verifier_sha256": sha256(Path(__file__).read_bytes()).hexdigest()}
with (ROOT / "docs/quality/desktop-native-input-whitespace-01.json").open("x", encoding="utf-8", newline="\n") as stream:
    stream.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"status": result["status"], "source_issues": 0, "raw_diagnostics": len(exceptions), "raw_files": len(files)}))
