"""Preserve UI14 before decoupling human cloud cancellation from OS grants."""
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
report = ROOT / "dev/copypaste-delivery/evidence/desktop-local-ui-14.json"
data = json.loads(report.read_text(encoding="utf-8"))
assert data["status"] == "passed" and data["source_unchanged"]
target = ROOT / "docs/quality/history/stage75-before-idle-video-cancel"
target.mkdir(exist_ok=False)
files = []
for source in ["copypaste-desktop/renderer/src/local-agent.tsx", "copypaste-desktop/renderer/src/local-video.tsx", "copypaste-desktop/renderer-source.json", "copypaste-delivery/scripts/qa-desktop-video.ts"]:
    raw = (ROOT / "dev" / source).read_bytes()
    digest = sha256(raw).hexdigest()
    assert digest == data["source_files"][source]
    archive = target / (source.replace("/", "__") + ".txt")
    archive.write_bytes(raw)
    files.append({"source": "dev/" + source, "archive": archive.relative_to(ROOT).as_posix(), "sha256": digest})
(target / "manifest.json").write_text(json.dumps({"prior_qualification": report.relative_to(ROOT).as_posix(), "prior_report_sha256": sha256(report.read_bytes()).hexdigest(),
    "reason": "Explicit cancellation of an accepted company video must use current company project permission. Revoking idle local OS permission must not disable the user's service cancellation button.", "sources": files}, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"preserved": len(files)}))
