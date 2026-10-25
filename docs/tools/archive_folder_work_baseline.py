"""Preserve stage-87 documentation inputs and published contract bytes."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DESTINATION = ROOT / "docs/quality/history/stage87-before-folder-work"
COMPONENTS = ("platform", "web", "admin", "desktop", "extension", "delivery")


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def git(repo, *args):
    return subprocess.check_output(["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", *args], cwd=repo).decode("utf-8").strip()


def main():
    assert not DESTINATION.exists(), "Keep the original baseline; use a new stage for later work."
    pointers = json.loads((ROOT / "docs/quality/history/stage86-current-pointers/receipt.json").read_text(encoding="utf-8"))
    names = [row["source"] for row in pointers["files"]]
    names += ["docs/README.md", "docs/README.en.md", "docs/quality/workmate-publication.json",
              "docs/quality/shared-project-checkpoint.json", "docs/quality/requirements-alignment-progress.json",
              "docs/quality/2026-10-25-goal-gap-assessment.md", "docs/quality/2026-10-25-goal-gap-review-07.json",
              "docs/requirements/01-srs.md", "docs/quality/01-test-and-acceptance-plan.md",
              "docs/technical/87-desktop-folder-work.md"]
    names += [f"dev/copypaste-{component}/{name}" for component in COMPONENTS for name in ("README.md", "README.en.md")]
    names = list(dict.fromkeys(names))
    DESTINATION.mkdir(parents=True)
    files = []
    for name in names:
        source = ROOT / name
        target = DESTINATION / "files" / (name.replace("/", "__") + ".snapshot")
        target.parent.mkdir(exist_ok=True)
        data = source.read_bytes()
        with target.open("xb") as stream:
            stream.write(data)
        files.append({"source": name, "archive": target.relative_to(ROOT).as_posix(), "sha256": sha256(data).hexdigest(), "bytes": len(data)})
    migrations = sorted((ROOT / "dev/copypaste-platform/migrations").glob("[0-9][0-9][0-9]-*.sql"))
    assert len(migrations) == 103
    contract_files = sorted((ROOT / "docs/contracts").rglob("*")) + sorted((ROOT / "dev/copypaste-platform/contracts").rglob("*"))
    contracts = {file.relative_to(ROOT).as_posix(): digest(file) for file in contract_files if file.is_file()}
    contracts["dev/copypaste-platform/catalog/openapi.json"] = digest(ROOT / "dev/copypaste-platform/catalog/openapi.json")
    progress = json.loads((ROOT / "docs/quality/requirements-alignment-progress.json").read_text(encoding="utf-8"))
    keys = ("requirement_id", "priority", "requirement", "acceptance_case", "acceptance_conditions")
    originals = [{key: row[key] for key in keys} for row in progress["requirements"]]
    assert len(originals) == 102
    result = {"at": datetime.now(timezone.utc).isoformat(), "stage": 87,
              "scope": "Exact pre-folder-work documentation and original acceptance conditions; component sources are separately bound to current native/client receipts.",
              "files": files, "published_migrations": {file.relative_to(ROOT).as_posix(): digest(file) for file in migrations},
              "published_contracts": contracts, "original_requirements": originals,
              "input_commits": {component: git(ROOT / "dev" / ("copypaste-" + component), "rev-parse", "HEAD") for component in COMPONENTS},
              "documentation_input_commit": git(ROOT, "rev-parse", "HEAD"),
              "verifier_sha256": digest(Path(__file__))}
    with (DESTINATION / "receipt.json").open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"status": "archived", "files": len(files), "published_migrations": len(migrations),
                      "published_contracts": len(contracts), "original_requirements": len(originals)}))


if __name__ == "__main__":
    main()
