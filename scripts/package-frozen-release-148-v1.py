"""Package existing qualified builds; no recompilation or functional test replay."""
from pathlib import Path
from hashlib import sha256
from datetime import datetime, timezone
import json
import subprocess
import zipfile

ROOT = Path(__file__).resolve().parents[3]
DEV = ROOT / "dev"
VERSION = "v0.1.0-rc.1"
OUTPUT = DEV / "copypaste-delivery/release" / ("workmate-" + VERSION)
COMPONENTS = {"backend": "platform", "web": "web", "admin": "admin", "desktop": "desktop", "extension": "extension", "delivery": "delivery"}


def digest(path):
    with path.open("rb") as stream:
        return sha256_file(stream)


def sha256_file(stream):
    value = sha256()
    for block in iter(lambda: stream.read(4 * 1024 * 1024), b""):
        value.update(block)
    return value.hexdigest()


def git(repo, *args):
    return subprocess.check_output(["git", "-c", "core.fsmonitor=false", "-C", str(repo), *args]).decode().strip()


def main():
    assert not OUTPUT.exists(), "Frozen output already exists; preserve it and choose a new version"
    checkpoint = json.loads((ROOT / "docs/quality/release-freeze-checkpoint-148.json").read_bytes())
    for path, expected in checkpoint["qualified_sources"].items():
        assert digest(DEV / path) == expected, path
    package = DEV / "copypaste-desktop/release/marketing-import-148-01/win-unpacked"
    for path, expected in checkpoint["package_files"].items():
        assert digest(package / path) == expected, path
    OUTPUT.mkdir(parents=True)
    guide = OUTPUT / "README.md"
    document = (ROOT / "docs/releases/v0.1.0-rc.1.md").read_text(encoding="utf-8")
    document = document.replace("](../quality/", "](https://github.com/copypasteltd/workmate/blob/" + VERSION + "/docs/quality/")
    guide.write_text(document, encoding="utf-8", newline="\n")
    artifacts = []

    def archive(name, entries, kind):
        target = OUTPUT / name
        count = 0
        with zipfile.ZipFile(target, "x", compression=zipfile.ZIP_DEFLATED, compresslevel=1, allowZip64=True) as z:
            for original, archive_path in entries:
                z.write(original, archive_path)
                count += 1
        # Cheap archive-directory check, not an added end-to-end regression.
        with zipfile.ZipFile(target) as z:
            assert len(z.infolist()) == count and count > 0
        row = {"file": name, "kind": kind, "bytes": target.stat().st_size, "sha256": digest(target), "entries": count}
        artifacts.append(row)
        print(json.dumps(row), flush=True)

    def folder(path, prefix=""):
        return [(p, prefix + p.relative_to(path).as_posix()) for p in sorted(path.rglob("*")) if p.is_file()]

    archive(f"workmate-{VERSION}-windows-x64-unsigned.zip", folder(package, "CopyPaste/"), "qualified_portable_directory")
    for name in ("web", "admin", "extension"):
        directory = DEV / ("copypaste-" + name) / "dist"
        assert (directory / ("manifest.json" if name == "extension" else "index.html")).is_file()
        archive(f"workmate-{VERSION}-{name}.zip", folder(directory), "static_build" if name != "extension" else "chrome_mv3_unpacked")

    components, sources = [], []
    source_entries = []
    for branch, directory_name in COMPONENTS.items():
        repo = DEV / ("copypaste-" + directory_name)
        components.append({"branch": branch, "directory": repo.name, "commit": git(repo, "rev-parse", "HEAD"), "tree": git(repo, "rev-parse", "HEAD^{tree}"),
                           "version": json.loads((repo / "package.json").read_bytes())["version"], "tag": VERSION + "-" + branch})
        paths = git(repo, "ls-files", "-z").split("\0")
        for path in paths:
            if not path:
                continue
            parts = Path(path).parts
            if any(part in (".git", "node_modules", ".data", "release", "dist", "renderer-dist", "evidence", "test-results") for part in parts):
                continue
            if path.startswith("assets/screenshots/") and "marketing-release-148-04" not in path:
                continue
            if any(part.startswith(".env") and part != ".env.example" for part in parts):
                continue
            original = repo / path
            assert original.is_file(), path
            name = repo.name + "/" + path
            source_entries.append((original, name))
            sources.append({"path": name, "sha256": digest(original), "bytes": original.stat().st_size})
    source_entries += [(guide, "RELEASE.md")]
    archive(f"workmate-{VERSION}-buildable-sources.zip", source_entries, "six_complete_buildable_sources_without_historical_evidence")
    source_index = OUTPUT / "source-files.json"
    source_index.write_text(json.dumps(sources, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    manifest = {"product": "Workmate", "release": VERSION, "frozen_at": datetime.now(timezone.utc).isoformat(), "release_type": "first_frozen_candidate",
                "platform": "windows-x64", "ai_mode": "authorized_synthetic", "schema_version": 145,
                "codex": {"version": "0.163.0-alpha.11", "sha256": "00c0f1e4099246fddcd67ec620ca8ed50827c7d70e113b7224f7a2933cf2d67c", "desktop_execution": "customer_local"},
                "docs_commit": git(ROOT, "rev-parse", "HEAD"), "docs_tag": VERSION, "components": components, "artifacts": artifacts,
                "source_index": {"path": source_index.name, "sha256": digest(source_index), "files": len(sources)},
                "checkpoint": {"path": "docs/quality/release-freeze-checkpoint-148.json", "sha256": digest(ROOT / "docs/quality/release-freeze-checkpoint-148.json")},
                "qualified_package_files": checkpoint["package_files"], "current_qualification": {"backend_cases": 17, "actual_client_journey_groups": 4, "broad_regression": "deliberately_omitted_by_user"},
                "limitations": ["Synthetic AI and external dependencies; production provider/account integration remains open", "Unsigned Windows directory package; signed installers and updater acceptance remain open", "Aggregate project/tenant erasure unimplemented; archived-project restoration access fix pending", "UTF16 CSV uploads require BOM", "Full102-record acceptance remains open except previously accepted REQ095", "Source archive excludes historical evidence/media; full independent Git histories retained through frozen tags"],
                "release_web_assets": checkpoint["release_web_assets"], "packager_sha256": digest(Path(__file__))}
    (OUTPUT / "release-manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    sums = "".join(digest(p) + "  " + p.name + "\n" for p in sorted(OUTPUT.iterdir()) if p.is_file())
    (OUTPUT / "SHA256SUMS").write_text(sums, encoding="utf-8", newline="\n")
    print(json.dumps({"status": "frozen", "directory": str(OUTPUT), "artifact_count": len(artifacts), "source_files": len(sources)}, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
