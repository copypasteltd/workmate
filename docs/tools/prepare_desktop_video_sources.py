"""Preserve published sources and refresh provenance before qualification."""
from hashlib import sha256
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
archive = ROOT / "docs/quality/history/stage75-published-source-supplement"
archive.mkdir(exist_ok=False)
sources = [
    ("dev/copypaste-platform", "src/video-render.ts"),
    ("dev/copypaste-platform", "src/video-project-model.ts"),
    ("dev/copypaste-platform", "contracts/template-video-openapi.json"),
    ("dev/copypaste-desktop", "renderer-source.json"),
    ("dev/copypaste-delivery", "scripts/export-template-video-contract.ts"),
    (".", "docs/contracts/template-video-openapi.json"),
]
manifest = []
for repo, name in sources:
    args = ["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false"]
    commit = subprocess.check_output(args + ["rev-parse", "HEAD"], cwd=ROOT / repo).decode().strip()
    data = subprocess.check_output(args + ["show", "HEAD:" + name], cwd=ROOT / repo)
    dest = archive / ((repo.strip("./") + "/" + name).strip("/").replace("/", "__") + ".txt")
    dest.write_bytes(data)
    manifest.append({"repository": repo, "source": name, "commit": commit, "archive": dest.relative_to(ROOT).as_posix(), "sha256": sha256(data).hexdigest(), "basis": "published_git_HEAD_bytes"})
(archive / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
desktop = ROOT / "dev/copypaste-desktop"
target = desktop / "renderer-source.json"
prior = json.loads(target.read_text(encoding="utf-8"))
files = {file.relative_to(desktop / "renderer").as_posix(): sha256(file.read_bytes()).hexdigest()
         for file in sorted((desktop / "renderer").rglob("*")) if file.is_file()}
changed = sorted(name for name in set(files) | set(prior["files"]) if files.get(name) != prior["files"].get(name))
assert changed == ["src/local-agent.css", "src/local-agent.tsx", "src/local-video.tsx", "src/video-projects.tsx"], changed
prior["files"] = files
target.write_text(json.dumps(prior, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"published_sources_preserved": len(manifest), "renderer_changes": changed}))
