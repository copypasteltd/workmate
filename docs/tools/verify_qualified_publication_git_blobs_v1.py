"""Compare qualified source hashes with actual Git blobs before publication."""
from __future__ import annotations

import argparse
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

from finalize_desktop_browser_manifest import committed_blobs
from record_audio_accounting_v2 import git

ROOT = Path(__file__).resolve().parents[2]
INDEX = ROOT / "docs/quality/controlled-publications-evidence-125/index.json"


def digest(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("attempt")
    args = parser.parse_args()
    assert len(args.attempt) == 2 and args.attempt.isdigit()
    output = ROOT / f"docs/quality/publication-qualified-git-bytes-125-{args.attempt}.json"
    assert not output.exists(), "Never overwrite an audit"
    index = json.loads(INDEX.read_text(encoding="utf-8"))
    groups = {}
    for name, expected in index["current_source_files"].items():
        parts = Path(name).parts
        assert parts[0] == "dev" and len(parts) > 2 and parts[1].startswith("copypaste-")
        groups.setdefault(parts[1], {})[Path(*parts[2:]).as_posix()] = expected
    cache, differences, commits, checked = {}, [], {}, 0
    for directory, files in groups.items():
        repo = ROOT / "dev" / directory
        commits[directory] = git(repo, "rev-parse", "HEAD").decode().strip()
        blobs = committed_blobs(repo, sorted(files), cache)
        for name, expected in files.items():
            body = blobs[name]
            actual = digest(body)
            if actual != expected:
                working = (repo / name).read_bytes()
                differences.append({"repository": directory, "path": name, "qualified_sha256": expected,
                                    "committed_sha256": actual, "working_still_matches_qualified": digest(working) == expected,
                                    "difference_is_only_crlf_to_lf": working.replace(b"\r\n", b"\n") == body})
            checked += 1
    report = {"at": datetime.now(timezone.utc).isoformat(), "status": "passed" if not differences else "failed",
              "qualified_sources_checked": checked, "different_files": differences, "repository_commits": commits,
              "evidence_index": {"path": INDEX.relative_to(ROOT).as_posix(), "sha256": digest(INDEX.read_bytes())},
              "verifier_sha256": digest(Path(__file__).read_bytes()),
              "limits": ["Exact Git bytes only, not a new behavioral test or full-product acceptance.",
                         "Qualified scope is the source list in the preserved evidence index; later metadata and README changes are tracked separately."]}
    with output.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(report, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print(json.dumps({"status": report["status"], "sources_checked": checked, "differences": differences,
                      "report": output.relative_to(ROOT).as_posix()}, ensure_ascii=False))
    if differences:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
