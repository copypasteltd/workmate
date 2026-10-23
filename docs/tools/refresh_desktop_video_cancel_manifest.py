"""Refresh two renderer hashes after the explicit company-cancel correction."""
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
desktop = ROOT / "dev/copypaste-desktop"
file = desktop / "renderer-source.json"
data = json.loads(file.read_text(encoding="utf-8"))
files = {path.relative_to(desktop / "renderer").as_posix(): sha256(path.read_bytes()).hexdigest()
         for path in sorted((desktop / "renderer").rglob("*")) if path.is_file()}
assert [name for name in sorted(set(files) | set(data["files"])) if files.get(name) != data["files"].get(name)] == ["src/local-agent.tsx", "src/local-video.tsx"]
data["files"] = files
file.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"files": len(files), "updated": ["src/local-agent.tsx", "src/local-video.tsx"]}))
