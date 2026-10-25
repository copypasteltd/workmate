"""Correct README EOF whitespace while preserving the first refresh/audit bytes."""
from datetime import datetime, timezone
import json
from pathlib import Path
from record_folder_work import ROOT, read, digest, ref


def main():
    output = ROOT / "docs/quality/local-programs-readme-format-01.json"
    archive = ROOT / "docs/quality/history/stage88-readme-format"
    assert not output.exists() and not archive.exists()
    refresh_file = ROOT / "docs/quality/local-programs-documentation-refresh.json"
    refresh = read(refresh_file)
    rows = []
    for row in refresh["files"]:
        if not row["path"].endswith(("README.md", "README.en.md")): continue
        file = ROOT / row["path"]
        assert digest(file) == row["after_sha256"]
        before = file.read_bytes()
        after = before.rstrip(b"\r\n") + b"\n"
        if before == after: continue
        saved = archive / "files" / (row["path"].replace("/", "__") + ".snapshot")
        saved.parent.mkdir(parents=True, exist_ok=True)
        saved.write_bytes(before)
        file.write_bytes(after)
        rows.append({"path": row["path"], "archive": saved.relative_to(ROOT).as_posix(), "before_sha256": row["after_sha256"], "after_sha256": digest(file),
                     "transformation": "Only replace terminal CR/LF sequence with one LF; content bytes are otherwise identical"})
    assert len(rows) == 6
    result = {"at": datetime.now(timezone.utc).isoformat(), "scope": "README EOF-only correction after staged whitespace review; initial refresh and audit remain unchanged",
              "initial_refresh": ref(refresh_file), "initial_audit": ref(ROOT / "docs/quality/local-programs-docs-audit-01.json"),
              "files": rows, "verifier_sha256": digest(Path(__file__))}
    archive.mkdir(parents=True, exist_ok=True)
    (archive / "receipt.json").write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": "formatted", "readmes": len(rows), "initial_reports_unchanged": True}))


if __name__ == "__main__": main()
