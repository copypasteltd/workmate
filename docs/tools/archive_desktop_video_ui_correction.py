"""Retain the failed UI13 sources before correcting its assertion and preview."""
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
report = DEV / "copypaste-delivery/evidence/desktop-local-ui-13.json"
data = json.loads(report.read_text(encoding="utf-8"))
assert data["status"] == "failed" and data["source_unchanged"] and data["owned_database_shutdown"]
dest = ROOT / "docs/quality/history/stage75-ui13-correction"
dest.mkdir(exist_ok=False)
manifest = []
for name in ["copypaste-delivery/scripts/qa-desktop-video.ts", "copypaste-desktop/renderer/src/local-agent.css", "copypaste-desktop/renderer-source.json"]:
    raw = (DEV / name).read_bytes()
    digest = sha256(raw).hexdigest()
    assert digest == data["source_files"][name]
    target = dest / (name.replace("/", "__") + ".txt")
    target.write_bytes(raw)
    manifest.append({"source": "dev/" + name, "archive": target.relative_to(ROOT).as_posix(), "sha256": digest})
(dest / "manifest.json").write_text(json.dumps({"report_sha256": sha256(report.read_bytes()).hexdigest(), "sources": manifest,
    "reason": "UI13 retained as failed. Revoked-answer guard correctly returns LOCAL_PERMISSION_REQUIRED before looking up a stale input; its test expected LOCAL_INPUT_NOT_FOUND. Visual review also found that preview frames need explicit scroll and sizing within the conversation. No runtime permission bypass is introduced."}, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"preserved": len(manifest)}))
