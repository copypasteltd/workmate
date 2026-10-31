"""Package seven current v0.1.0 distributions, full source and pinned runtime."""
from pathlib import Path, PurePosixPath
from hashlib import sha256
from datetime import datetime, timezone
import json
import re
import shutil
import subprocess
import uuid
import zipfile

ROOT = Path(__file__).resolve().parents[3]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"
VERSION = "v0.1.0"
SOURCE_ROOT = "workmate-" + VERSION + "-source"
OUTPUT = DELIVERY / "release" / ("workmate-" + VERSION)
COMPONENTS = {"backend": "platform", "web": "web", "admin": "admin", "desktop": "desktop", "extension": "extension", "delivery": "delivery"}


def digest(p):
    h = sha256()
    with p.open("rb") as f:
        for b in iter(lambda: f.read(4 * 1024 * 1024), b""):
            h.update(b)
    return h.hexdigest()


def git(repo, *args):
    return subprocess.check_output(["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "-C", str(repo), *args], cwd=repo).decode().strip()


def write(p, value):
    with p.open("x", encoding="utf-8", newline="\n") as f:
        f.write(json.dumps(value, ensure_ascii=False, indent=2) + "\n")


def folder(directory, prefix=""):
    return [(p, prefix + p.relative_to(directory).as_posix()) for p in sorted(directory.rglob("*")) if p.is_file()]


def linked_media(repo):
    out = {}
    for name in ["README.md", "README.en.md"]:
        for value in re.findall(r"!?\[[^\]]*\]\(([^)]+)\)", (repo / name).read_text(encoding="utf-8")):
            value = value.split("#")[0]
            if value.startswith("assets/screenshots/") and ".." not in PurePosixPath(value).parts and (repo / value).is_file():
                out[value] = repo / value
    return out


def main():
    assert not OUTPUT.exists(), "Never replace an existing frozen release"
    checkpoint = ROOT / "docs/quality/release-freeze-checkpoint-167.json"
    cp = json.loads(checkpoint.read_bytes())
    assert cp["status"] == "qualified" and cp["release"] == VERSION
    receipts = []
    for p in (DELIVERY / ".data/release-freeze-167").glob("publication-*/receipt.json"):
        v = json.loads(p.read_bytes())
        if v["status"] == "published":
            receipts.append((p, v))
    assert len(receipts) == 1
    publication, published = receipts[0]
    for b, c in COMPONENTS.items():
        assert git(DEV / ("copypaste-" + c), "rev-parse", "HEAD") == published["components"][b]["commit"]
    assert git(ROOT, "rev-parse", "HEAD") == published["components"]["docs"]["commit"]
    for p, h in cp["qualified_sources"].items():
        assert digest(DEV / p) == h, p
    for c, files in cp["builds"].items():
        actual = {p.relative_to(DEV / ("copypaste-" + c) / "dist").as_posix(): digest(p) for p in sorted((DEV / ("copypaste-" + c) / "dist").rglob("*")) if p.is_file()}
        assert actual == files, c + " build changed"
    for name, directory in [('desktop_main', 'dist'), ('desktop_renderer', 'renderer-dist')]:
        actual = {p.relative_to(DEV / 'copypaste-desktop' / directory).as_posix(): digest(p) for p in sorted((DEV / 'copypaste-desktop' / directory).rglob('*')) if p.is_file()}
        assert actual == cp[name], name + ' output changed'
    stage = DELIVERY / ".data/release-freeze-167" / ("prepared-" + str(uuid.uuid4()))
    stage.mkdir(parents=True)
    artifacts, contents = [], {}

    def archive(suffix, entries, kind):
        name = "workmate-" + VERSION + "-" + suffix + ".zip"
        target, listing = stage / name, {}
        with zipfile.ZipFile(target, "x", zipfile.ZIP_DEFLATED, compresslevel=1) as z:
            for p, n in entries:
                assert n not in listing
                z.write(p, n)
                listing[n] = {"sha256": digest(p), "bytes": p.stat().st_size}
        with zipfile.ZipFile(target) as z:
            assert len(z.infolist()) == len(listing) > 0
            assert z.testzip() is None, name + " CRC failed"
        row = {"file": name, "kind": kind, "bytes": target.stat().st_size, "sha256": digest(target), "entries": len(listing)}
        artifacts.append(row)
        contents[name] = listing
        print(json.dumps(row), flush=True)
        return target

    package = Path(cp['package_root'])
    for n, h in cp['package_files'].items():
        assert digest(package / n) == h, n
    installer_entries = []
    for n, value in cp['installers'].items():
        assert digest(Path(value['path'])) == value['sha256']
        installer_entries.append((Path(value['path']), 'installers/' + n))
    archive('windows-x64-unsigned', folder(package, 'CopyPaste/') + installer_entries, 'verified_reused_unsigned_unpacked_portable_nsis_windows_distribution')
    archive('web', folder(DEV / 'copypaste-web/dist'), 'rebuilt_current_web')
    archive('extension', folder(DEV / 'copypaste-extension/dist'), 'rebuilt_native_chrome_side_panel')
    archive("admin", folder(DEV / "copypaste-admin/dist"), "rebuilt_current_admin")
    platform = DEV / "copypaste-platform"
    selected = git(platform, "ls-files", "-z", "--", "src", "scripts", "catalog", "contracts", "skills", "migrations", "assets/fonts", "public", "package.json", "package-lock.json", "tsconfig.json", ".env.example", "README.md", "README.en.md").split("\0")
    backend = {"copypaste-platform/" + p: platform / p for p in selected if p}
    backend.update({"copypaste-platform/" + n: p for n, p in linked_media(platform).items()})
    backend.update({n: p for p, n in folder(platform / "dist", "copypaste-platform/dist/")})
    archive("backend", [(p, n) for n, p in sorted(backend.items())], "rebuilt_backend_source_runtime_assets_lockfiles")
    files, heads = {}, {}
    for c in COMPONENTS.values():
        repo = DEV / ("copypaste-" + c)
        heads[c] = git(repo, "rev-parse", "HEAD")
        tracked = git(repo, "ls-files", "-z", "--", ".", ":(exclude)evidence/**", ":(exclude)release/**", ":(exclude)node_modules/**", ":(exclude).data/**", ":(exclude)dist/**", ":(exclude)assets/screenshots/**").split("\0")
        for p in tracked:
            if not p:
                continue
            parts = PurePosixPath(p).parts
            if any(s in parts for s in [".git", "node_modules", ".data", "dist", "release", "test-results", "playwright-report"]):
                continue
            if any(s == ".env" or s.startswith(".env.") and s != ".env.example" for s in parts):
                continue
            files["dev/" + repo.name + "/" + p] = repo / p
        files.update({"dev/" + repo.name + "/" + n: p for n, p in linked_media(repo).items()})
    # Only committed authoritative text is eligible. User-owned untracked
    # cleanup scripts/reports and historical raw blob stores are not packaged.
    for p in git(ROOT, "ls-files", "-z", "--", "docs").split("\0"):
        if not p:
            continue
        parts = PurePosixPath(p).parts
        if parts[:2] == ("docs", "assets") or parts[:2] == ("docs", "quality") and len(parts) != 3:
            continue
        if Path(p).suffix.lower() not in [".md", ".json", ".yaml", ".yml", ".mmd", ".py", ".ps1", ".cs"]:
            continue
        files[p] = ROOT / p
    for directory in ["docs/assets/release-freeze-158", "docs/assets/admin-overview-160", "docs/assets/session-boundary-163", "docs/assets/functional-closure-165", "docs/assets/admin-user-resources-166"]:
        for p, name in folder(ROOT / directory, directory + "/"):
            files[name] = p
    for p in git(DELIVERY, "ls-files", "-z", "--", "evidence/onboarding-162", "evidence/session-boundary-163", "evidence/release-freeze-167", "evidence/functional-closure-165", "evidence/admin-user-resources-166").split("\0"):
        if p:
            files["dev/copypaste-delivery/" + p] = DELIVERY / p
    root_guide = (ROOT / 'docs/releases' / (VERSION + '.md')).read_text(encoding='utf-8')
    for target in ['quality', 'assets']:
        root_guide = root_guide.replace('](../' + target + '/', '](docs/' + target + '/')
    root_guide_path = stage.parent / ('root-guide-' + str(uuid.uuid4()) + '.md')
    root_guide_path.write_text(root_guide, encoding='utf-8', newline='\n')
    files['START-HERE.md'] = root_guide_path
    # Fail before freezing if any root-guide local link is absent from the source.
    for link in re.findall(r'!?\[[^\]]*\]\(([^)]+)\)', root_guide):
        if not link.startswith(('https://', 'http://', '#')):
            assert link.split('#')[0] in files, 'Missing root guide target: ' + link

    source_facts = {n: {"sha256": digest(p), "bytes": p.stat().st_size} for n, p in sorted(files.items())}
    source_manifest = {"release": VERSION, "source_root": SOURCE_ROOT, "schema_version": 155, "component_commits": heads, "docs_commit": git(ROOT, "rev-parse", "HEAD"), "source_files": source_facts, "exclusions": "Git metadata/history, dependencies, local secrets/configuration/databases, build outputs and historical raw evidence/unreferenced media. Independent Git repositories and full history remain on their component branches/tags."}
    write(stage / "source-files.json", source_manifest)
    archive("buildable-sources", [(p, SOURCE_ROOT + "/" + n) for n, p in sorted(files.items())] + [(stage / "source-files.json", SOURCE_ROOT + "/SOURCE-MANIFEST.json")], "six_current_buildable_source_trees_and_authoritative_docs")
    runtime = DEV / "copypaste-desktop/.data/runtime/windows-x64"
    rm = json.loads((runtime / "runtime-manifest.json").read_bytes())
    assert rm["runtime"] == "0.163.0-alpha.11" and len(rm["files"]) == 4
    runtime_entries = []
    for n, expected in rm["files"].items():
        assert (runtime / n).stat().st_size == expected["bytes"] and digest(runtime / n) == expected["sha256"]
        runtime_entries.append((runtime / n, SOURCE_ROOT + "/dev/copypaste-desktop/.data/runtime/windows-x64/" + n))
    runtime_entries.append((runtime / "runtime-manifest.json", SOURCE_ROOT + "/dev/copypaste-desktop/.data/runtime/windows-x64/runtime-manifest.json"))
    archive("source-runtime-windows-x64", runtime_entries, "pinned_four_file_codex_companion_with_matching_source_root")
    assert len(artifacts) == 7
    guide = (ROOT / "docs/releases" / (VERSION + ".md")).read_text(encoding="utf-8")
    for name in ["quality", "development"]:
        guide = guide.replace("](../" + name + "/", "](https://github.com/copypasteltd/workmate/blob/" + VERSION + "/docs/" + name + "/")
    guide = guide.replace("](../assets/", "](assets/")
    with (stage / "README.md").open("x", encoding="utf-8", newline="\n") as f:
        f.write(guide)
    for directory in ["release-freeze-158", "admin-overview-160", "session-boundary-163", "functional-closure-165", "admin-user-resources-166"]:
        for p, name in folder(ROOT / "docs/assets" / directory, "assets/" + directory + "/"):
            target = stage / name
            target.parent.mkdir(parents=True, exist_ok=True)
            with p.open("rb") as a, target.open("xb") as b:
                shutil.copyfileobj(a, b)
    write(stage / "artifact-contents.json", contents)
    with (stage / "publication-receipt.json").open("xb") as f:
        f.write(publication.read_bytes())
    manifest = {"product": "Workmate", "release": VERSION, "frozen_at": datetime.now(timezone.utc).isoformat(), "release_type": "complete_frozen_synthetic_initial_release", "schema_version": 155, "ai_mode": "authorized_synthetic", "docs_commit": git(ROOT, "rev-parse", "HEAD"), "docs_tag": VERSION, "components": [{"branch": b, "directory": "copypaste-" + c, "commit": heads[c], "tree": git(DEV / ("copypaste-" + c), "rev-parse", "HEAD^{tree}"), "tag": VERSION + "-" + b, "component_version": json.loads((DEV / ("copypaste-" + c) / "package.json").read_bytes())["version"]} for b, c in COMPONENTS.items()], "codex": {"version": rm["runtime"], "sha256": rm["files"]["codex.exe"]["sha256"], "desktop_execution": "customer_local"}, "artifacts": artifacts, "source_manifest": {"file": "source-files.json", "sha256": digest(stage / "source-files.json")}, "artifact_contents": {"file": "artifact-contents.json", "sha256": digest(stage / "artifact-contents.json")}, "qualification_checkpoint": {"path": "docs/quality/release-freeze-checkpoint-167.json", "sha256": digest(checkpoint)}, "qualification_scope": cp["scope"], "limits": ["Authorized synthetic external dependencies; no production provider claim", "Unsigned Windows candidate; signing/install/update acceptance remains open", "No new broad historical or cross-OS acceptance", "All previous frozen packages/tags remain unchanged"], "packager_sha256": digest(Path(__file__))}
    write(stage / "release-manifest.json", manifest)
    with (stage / "SHA256SUMS").open("x", encoding="utf-8", newline="\n") as f:
        f.write("".join(digest(p) + "  " + p.relative_to(stage).as_posix() + "\n" for p in sorted(stage.rglob("*")) if p.is_file()))
    for p, h in cp["qualified_sources"].items():
        assert digest(DEV / p) == h, p
    for n, facts in source_facts.items():
        assert digest(files[n]) == facts["sha256"], n
    assert not OUTPUT.exists()
    stage.replace(OUTPUT)
    complete = DELIVERY / "release" / ("workmate-" + VERSION + "-complete.zip")
    with zipfile.ZipFile(complete, "x", zipfile.ZIP_STORED) as z:
        for p, n in folder(OUTPUT, OUTPUT.name + "/"):
            z.write(p, n)
    complete_sha = digest(complete)
    with (complete.parent / (complete.name + ".sha256")).open("x", encoding="utf-8", newline="\n") as f:
        f.write(complete_sha + "  " + complete.name + "\n")
    receipt = {"at": datetime.now(timezone.utc).isoformat(), "status": "frozen", "release": VERSION, "directory": str(OUTPUT), "artifact_count": len(artifacts), "complete_archive": {"path": str(complete), "bytes": complete.stat().st_size, "sha256": complete_sha}, "manifest_sha256": digest(OUTPUT / "release-manifest.json"), "sums_sha256": digest(OUTPUT / "SHA256SUMS"), "git_publication": str(publication), "packager_sha256": digest(Path(__file__))}
    write(DELIVERY / ".data/release-freeze-167/frozen-receipt.json", receipt)
    print(json.dumps(receipt, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
