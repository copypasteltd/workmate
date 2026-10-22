"""Preserve the published stage 73 files before native input changes."""
import hashlib
import json
from pathlib import Path

root = Path(r"D:\dev\copypasted\自有agent")
target = root / "docs/quality/history/stage74-before-native-input"
target.mkdir(parents=True, exist_ok=False)
names = [
    "dev/copypaste-desktop/src/local-codex.ts",
    "dev/copypaste-desktop/src/local-agent.ts",
    "dev/copypaste-desktop/src/main.ts",
    "dev/copypaste-desktop/renderer/src/local-agent.tsx",
    "dev/copypaste-desktop/renderer/src/local-agent.css",
    "dev/copypaste-desktop/tests/local-agent.test.ts",
    "dev/copypaste-desktop/tests/integration/local-codex.native.test.ts",
    "dev/copypaste-delivery/scripts/run-local-codex-checks.mjs",
    "dev/copypaste-delivery/scripts/qa-desktop-local.ts",
    "dev/copypaste-delivery/scripts/run-desktop-local-ui.mjs",
]
manifest = {}
for name in names:
    data = (root / name).read_bytes()
    archived = name.replace("/", "__") + ".txt"
    (target / archived).write_bytes(data)
    manifest[name] = {"file": archived, "sha256": hashlib.sha256(data).hexdigest()}
(target / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"archived": len(manifest), "directory": str(target)}))
