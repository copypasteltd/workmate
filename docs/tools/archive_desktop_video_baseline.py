"""Preserve published stage 74 sources before native video integration."""
from hashlib import sha256
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
target = root / "docs/quality/history/stage75-before-desktop-video"
target.mkdir(parents=True, exist_ok=False)
names = [
    "docs/quality/workmate-publication.json",
    "docs/quality/desktop-native-input-checkpoint.json",
    "dev/copypaste-platform/src/task-business-tools.ts",
    "dev/copypaste-platform/src/task-tool-reuse.ts",
    "dev/copypaste-platform/src/video-projects.ts",
    "dev/copypaste-platform/src/desktop-executions.ts",
    "dev/copypaste-desktop/src/local-codex.ts",
    "dev/copypaste-desktop/renderer/src/local-agent.tsx",
    "dev/copypaste-desktop/renderer/src/local-agent.css",
    "dev/copypaste-delivery/scripts/qa-desktop-local.ts",
    "dev/copypaste-delivery/scripts/run-desktop-local-ui.mjs",
    "dev/copypaste-delivery/scripts/run-desktop-platform-resumable.mjs",
]
manifest = {}
for name in names:
    data = (root / name).read_bytes()
    archived = name.replace("/", "__") + ".txt"
    (target / archived).write_bytes(data)
    manifest[name] = {"file": archived, "sha256": sha256(data).hexdigest()}
(target / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"archived": len(manifest), "directory": str(target)}))
