"""Archive stage 76 without changing any published source or SQL bytes."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
archive = ROOT / "docs/quality/history/before-desktop-browser-sources"
assert not archive.exists(), "Never replace a prior checkpoint"
rows = {}
for repo in [ROOT, *(ROOT / "dev" / f"copypaste-{name}" for name in
                    ["platform", "web", "admin", "desktop", "extension", "delivery"])]:
    def git(*args):
        return subprocess.check_output(["git", "-c", "core.fsmonitor=false", "-c",
                                        "core.untrackedCache=false", *args], cwd=repo)
    assert not git("status", "--porcelain", "-uno").strip(), repo
    sources = {}
    for raw in git("ls-files", "-z", "--", "src", "renderer", "scripts", "tests", "migrations",
                   "catalog", "skills", "contracts", "renderer-source.json", "package.json",
                   "package-lock.json", "tsconfig.json", "vite.config.ts", "README.md", "README.en.md").split(b"\0"):
        if not raw:
            continue
        file = raw.decode("utf-8")
        data = (repo / file).read_bytes()
        sources[file] = hashlib.sha256(data).hexdigest()
        target = archive / repo.name / file
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    rows[repo.name] = {"head": git("rev-parse", "HEAD").decode().strip(), "files": sources}
archive.mkdir(parents=True, exist_ok=True)
(archive / "manifest.json").write_text(json.dumps(rows, indent=2, ensure_ascii=True) + "\n", encoding="utf-8")
print(json.dumps({"repositories": len(rows), "files": sum(len(row["files"]) for row in rows.values())}))
