"""Verify canonical archive reads while actively refusing candidate file access."""
from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
import json
import sys
import traceback

from record_audio_accounting_v2 import ROOT, read, ref
from verify_controlled_publications_archive_v1 import INDEX, canonical, verify_archive


def main():
    attempt = sys.argv[1]
    assert len(sys.argv) == 2 and len(attempt) == 2 and attempt.isdigit()
    output = ROOT / f"docs/quality/controlled-publications-portability-125-{attempt}.json"
    assert not output.exists(), "Never overwrite executed verification"
    index = read(INDEX)
    cp = {"evidence_index": ref(INDEX), "previous_publication": index["previous_publication"],
          "source_files": {canonical(name): value for name, value in index["current_source_files"].items()},
          "actual_media_files": {canonical(name): value for name, value in index["actual_media_files"].items()}}
    reads = []

    def audit(event, args):
        if event not in ("open", "os.listdir", "os.scandir", "os.chdir") or not args:
            return
        target = args[0]
        if not isinstance(target, (str, bytes)):
            return
        name = target.decode(errors="replace") if isinstance(target, bytes) else target
        assert "-publication-125" not in name, "Candidate path access is forbidden"
        if event == "open":
            reads.append(name)

    result = {"at": datetime.now(timezone.utc).isoformat(), "status": "started",
              "verifier": ref(Path(__file__)),
              "archive_reader": ref(ROOT / "docs/tools/verify_controlled_publications_archive_v1.py"),
              "evidence_index": ref(INDEX), "candidate_file_access_refused": True,
              "scope": "Canonical current sources and preserved publishing receipts; not independent installation or full-product acceptance."}
    sys.addaudithook(audit)
    try:
        result["checked"] = verify_archive(cp)
        result["status"] = "passed"
    except Exception:
        result["status"] = "failed"
        result["error"] = traceback.format_exc()
    result["file_opens"] = len(reads)
    result["finished_at"] = datetime.now(timezone.utc).isoformat()
    with output.open("x", encoding="utf-8", newline="\n") as stream:
        json.dump(result, stream, ensure_ascii=False, indent=2)
        stream.write("\n")
    print(json.dumps(result, ensure_ascii=False))
    if result["status"] != "passed":
        raise SystemExit(1)


if __name__ == "__main__":
    main()
