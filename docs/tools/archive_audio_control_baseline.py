"""Retain the published baseline before customer audio authorization changes."""
import argparse
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
ARCHIVE = ROOT / "docs/quality/history/stage85-before-audio-controls"
COMPONENTS = ["platform", "web", "admin", "desktop", "extension", "delivery"]


def git(repo, *args):
    return subprocess.check_output(["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", *args], cwd=repo)


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--add", nargs="*", default=[])
    args = p.parse_args()
    receipt = ARCHIVE / "receipt.json"
    if receipt.exists():
        result = json.loads(receipt.read_text(encoding="utf-8"))
    else:
        repos = []
        for component in ["docs", *COMPONENTS]:
            repo = ROOT if component == "docs" else ROOT / "dev" / ("copypaste-" + component)
            # The new archive tool itself is an untracked primary-doc artifact.
            if component != "docs":
                assert not git(repo, "status", "--porcelain"), component
            repos.append({"component": component, "head": git(repo, "rev-parse", "HEAD").decode().strip(),
                "branch": git(repo, "branch", "--show-current").decode().strip()})
        migrations = {f.name: digest(f) for f in (ROOT / "dev/copypaste-platform/migrations").glob("*.sql")}
        assert len(migrations) == 101
        result = {"at": datetime.now(timezone.utc).isoformat(), "status": "published_audio_control_preimages_preserved",
            "repositories": repos, "published_migrations": migrations,
            "published_contracts": {f: digest(ROOT / f) for f in ["docs/contracts/openapi.json", "dev/copypaste-platform/catalog/openapi.json",
                "docs/contracts/audio-production-openapi.json", "dev/copypaste-platform/contracts/audio-production-openapi.json"]},
            "files": [], "scope": "Published baseline bytes. Flat .snapshot files are inert, including any captured Git attributes. Old evidence is never rewritten."}
    original_heads = {r["component"]: r["head"] for r in result["repositories"]}
    existing = {r["source"] for r in result["files"]}
    for name in args.add:
        rel = Path(name)
        assert not rel.is_absolute() and ".." not in rel.parts
        if name in existing:
            continue
        component, repo, source = "docs", ROOT, rel.as_posix()
        if source.startswith("dev/copypaste-"):
            directory, source = source[len("dev/"):].split("/", 1)
            component = directory.removeprefix("copypaste-")
            assert component in COMPONENTS
            repo = ROOT / "dev" / directory
        data = (ROOT / rel).read_bytes()
        baseline = git(repo, "show", original_heads[component] + ":" + source)
        assert baseline == data or baseline == data.replace(b"\r\n", b"\n"), name
        target = ARCHIVE / "files" / (component + "__" + source.replace("/", "__") + ".snapshot")
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("xb") as stream:
            stream.write(data)
        result["files"].append({"source": rel.as_posix(), "archive": target.relative_to(ROOT).as_posix(),
            "sha256": digest(target), "baseline_git_blob_sha256": sha256(baseline).hexdigest(), "declared_crlf_normalization_only": baseline != data})
    assert all(digest(ROOT / r["archive"]) == r["sha256"] for r in result["files"])
    result["verifier_sha256"] = digest(Path(__file__))
    receipt.parent.mkdir(parents=True, exist_ok=True)
    receipt.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": result["status"], "published_migrations": 101, "archived_files": len(result["files"])}))


if __name__ == "__main__":
    main()
