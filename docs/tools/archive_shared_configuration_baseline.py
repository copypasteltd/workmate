"""Retain exact pre-publication documentation and published invariant hashes."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
TARGET = ROOT / "docs/quality/history/stage86-before-shared-configuration"


def git(repo, *args):
    return subprocess.check_output(["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", *args], cwd=repo)


def main():
    assert not TARGET.exists(), "Keep the original preimages; do not overwrite an archive"
    sources = [(ROOT, path) for path in ["docs/README.md", "docs/README.en.md", "docs/quality/workmate-publication.json",
        "docs/quality/audio-authorizations-checkpoint.json", "docs/quality/requirements-alignment-progress.json",
        "docs/quality/02-requirements-traceability.md", "docs/quality/04-implementation-acceptance.md",
        "docs/quality/09-implementation-alignment-audit.md", "docs/quality/2026-10-25-goal-gap-assessment.md",
        "docs/contracts/implemented-routes.json"] if (ROOT / path).is_file()]
    repositories, files = [], []
    for component in ["platform", "web", "admin", "desktop", "extension", "delivery"]:
        repo = ROOT / "dev" / ("copypaste-" + component)
        repositories.append({"component": component, "head": git(repo, "rev-parse", "HEAD").decode().strip()})
        sources.extend((repo, name) for name in ["README.md", "README.en.md"])
    sources.append((ROOT / "dev/copypaste-platform", "contracts/implemented-routes.json"))
    # Validate every preimage before creating any archive files.
    for repo, name in sources:
        disk = (repo / name).read_bytes(); blob = git(repo, "show", "HEAD:" + name)
        assert disk == blob or (b"\0" not in disk and disk.replace(b"\r\n", b"\n") == blob), name
    TARGET.mkdir(parents=True)
    for repo, name in sources:
        source = repo / name; relative = source.relative_to(ROOT).as_posix(); raw = source.read_bytes()
        target = TARGET / (relative.replace("/", "__") + (".snapshot" if name.endswith(".md") else ""))
        with target.open("xb") as output:
            output.write(raw)
        files.append({"source": relative, "archive": target.relative_to(ROOT).as_posix(), "sha256": sha256(raw).hexdigest(),
                      "relative_links_base": source.parent.relative_to(ROOT).as_posix(), "repository_head": git(repo, "rev-parse", "HEAD").decode().strip(),
                      "git_blob_sha256": sha256(git(repo, "show", "HEAD:" + name)).hexdigest()})
    platform = ROOT / "dev/copypaste-platform"
    migrations = {p.name: sha256(p.read_bytes()).hexdigest() for p in sorted((platform / "migrations").glob("*.sql")) if int(p.name[:3]) <= 102}
    assert len(migrations) == 102
    old = json.loads((ROOT / "docs/quality/history/stage85-before-audio-controls/receipt.json").read_text(encoding="utf-8"))
    for name, digest in old["published_migrations"].items():
        assert migrations[name] == digest, name
    contracts = dict(old["published_contracts"])
    for name, digest in contracts.items():
        assert sha256((ROOT / name).read_bytes()).hexdigest() == digest, name
    receipt = {"at": datetime.now(timezone.utc).isoformat(), "status": "exact_prepublication_documentation_preserved",
               "scope": "Documentation before stage 86 publication; component source worktrees may contain uncommitted candidate development. Archive bodies are immutable and links retain their explicit original-source base.",
               "root_input_head": git(ROOT, "rev-parse", "HEAD").decode().strip(), "repositories": repositories,
               "files": files, "published_migrations": migrations, "published_contracts": contracts,
               "verifier_sha256": sha256(Path(__file__).read_bytes()).hexdigest()}
    (TARGET / "receipt.json").write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"archived_files": len(files), "migrations_preserved": len(migrations), "original_contracts_preserved": len(contracts)}))


if __name__ == "__main__":
    main()
