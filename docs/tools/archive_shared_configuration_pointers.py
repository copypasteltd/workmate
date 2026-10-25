"""Retain committed navigation/development notes before refreshing pointers."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import subprocess

from sync_audio_project_docs import ACTIVE

ROOT = Path(__file__).resolve().parents[2]


def main():
    archive = ROOT / "docs/quality/history/stage86-current-pointers"
    receipt = archive / "receipt.json"
    assert not archive.exists()
    names = [*ACTIVE, "docs/governance/04-git-branches-and-publication.md",
             "docs/product/06-role-templates-and-skill-presets.md", "docs/technical/19-project-skill-lifecycle.md",
             "docs/technical/25-role-template-registry-and-runtime-binding.md", "docs/modules/00-catalog.md"]
    rows = []
    for name in names:
        file = ROOT / name
        raw = file.read_bytes()
        committed = subprocess.check_output(["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "show", "HEAD:" + name], cwd=ROOT)
        assert raw == committed, "Archive only the exact published document: " + name
        target = archive / (name + ".snapshot")
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(raw)
        rows.append({"source": name, "archive": target.relative_to(ROOT).as_posix(), "sha256": sha256(raw).hexdigest(),
                     "relative_links_base": name, "committed_bytes_equal_disk": True})
    result = {"at": datetime.now(timezone.utc).isoformat(), "scope": "Exact committed primary navigation, requirements amendments and development pointers before stage-86 refresh; original links resolve from each source path.",
              "files": rows, "verifier_sha256": sha256(Path(__file__).read_bytes()).hexdigest()}
    with receipt.open("x", encoding="utf-8", newline="\n") as stream:
        stream.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps({"archived_exact_committed_documents": len(rows)}))


if __name__ == "__main__":
    main()
