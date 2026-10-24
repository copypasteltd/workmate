"""Archive exact attempt sources before editing, reusing published bytes."""
import hashlib
import json
import sys
from pathlib import Path

root = Path(__file__).resolve().parents[2]
attempt = sys.argv[1]
assert len(attempt) == 2 and attempt.isdigit()
kind = sys.argv[2] if len(sys.argv) > 2 else "checks"
assert kind in ("checks", "ui", "desktop")
stem = "desktop-local-ui" if kind == "desktop" else "geo-observation-" + kind
report_path = root / f"dev/copypaste-delivery/evidence/{stem}-{attempt}.json"
report = json.loads(report_path.read_text(encoding="utf-8"))
assert report["status"] in ("failed", "passed") and report["source_unchanged"]
baseline = json.loads((root / "docs/quality/history/stage83-before-geo-observations/receipt.json").read_text(encoding="utf-8"))
known = {f["sha256"]: f["archive"] for f in baseline["files"]}
target = root / f"docs/quality/history/stage83-geo-{kind + '-' if kind != 'checks' else ''}attempt-{attempt}"
target.mkdir(exist_ok=False)
files = []
for key, digest in report["source_files"].items():
    relative = key if key.startswith("docs/") else "dev/" + key
    data = (root / relative).read_bytes()
    assert hashlib.sha256(data).hexdigest() == digest, key
    archive = known.get(digest)
    if archive is None:
        saved = target / relative
        saved.parent.mkdir(parents=True, exist_ok=True)
        saved.write_bytes(data)
        archive = saved.relative_to(root).as_posix()
        known[digest] = archive
    files.append({"source": key, "sha256": digest, "archive": archive})
(target / "receipt.json").write_text(json.dumps({"attempt": attempt, "status": "archived_" + report["status"] + "_sources", "report": report_path.relative_to(root).as_posix(), "files": files}, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"attempt": attempt, "files": len(files), "archive": str(target)}))
