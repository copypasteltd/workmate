"""Capture exact TAP bytes; retain full evidence on a failing regression."""
import hashlib
import json
from pathlib import Path
import re
import subprocess
from datetime import datetime, timezone

delivery = Path(__file__).resolve().parent.parent
platform = delivery.parent / "copypaste-platform"
result = subprocess.run(["npm.cmd", "test"], cwd=platform, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
raw = result.stdout
folder = delivery / "evidence"
folder.mkdir(exist_ok=True)
(folder / "alignment-platform.tap").write_bytes(raw)
counts = {key: int(value) for key, value in re.findall(rb"^# (tests|pass|fail|cancelled|skipped|todo) (\d+)\r?$", raw, re.M)}
counts = {key.decode(): value for key, value in counts.items()}
passed = result.returncode == 0 and counts.get("tests", 0) > 0 and counts.get("pass") == counts.get("tests")
report = {
    "at": datetime.now(timezone.utc).isoformat(), "command": "npm test", "repository": "copypaste-platform",
    "status": "passed" if passed else "failed", "counts": counts, "raw_report": "alignment-platform.tap",
    "sha256": hashlib.sha256(raw).hexdigest(),
    "scope": "Current source regression, including controlled adapters and real Codex with synthetic model dependencies; not all 102 acceptance cases or live role qualification",
}
(folder / "alignment-platform.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
print(json.dumps(report, ensure_ascii=False))
if not passed:
    print(raw.decode("utf-8", errors="replace")[-16000:])
raise SystemExit(0 if passed else 1)
