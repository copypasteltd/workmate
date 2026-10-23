"""Retain exact failed-journey source before serializing capture and resize."""
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
DELIVERY = DEV / "copypaste-delivery"
archive = ROOT / "docs/quality/history/stage75-before-capture-serialization"
assert not archive.exists()
reports = [json.loads((DELIVERY / f"evidence/desktop-local-ui-{n}.json").read_text(encoding="utf-8")) for n in ("15", "16")]
assert all(report["status"] == "failed" and report["source_unchanged"] and report["owned_database_shutdown"] for report in reports)
assert reports[0]["source_files"] == reports[1]["source_files"]
copies, records = [], []
for name in ("copypaste-delivery/scripts/qa-desktop-local.ts", "copypaste-delivery/scripts/qa-desktop-video.ts"):
    data = (DEV / name).read_bytes()
    digest = sha256(data).hexdigest()
    assert reports[1]["source_files"][name] == digest
    target = archive / (name.replace("/", "__") + ".txt")
    copies.append((target, data))
    records.append({"source": "dev/" + name, "archive": target.relative_to(ROOT).as_posix(), "sha256": digest})
diagnostics = []
for run, name in (("65d0e582-c18c-432d-8af5-facb52213457", "concurrent"), ("ea46f0c7-734e-4708-8e58-889ab4fa9e22", "serialized")):
    data = (DELIVERY / ".data/desktop-window-diagnosis" / run / "result.json").read_bytes()
    target = archive / (name + "-window-diagnostic.json")
    copies.append((target, data))
    diagnostics.append({"path": target.relative_to(ROOT).as_posix(), "sha256": sha256(data).hexdigest()})
result = {"reason": "Two failed actual UI attempts timed out on different native resizes while continuous Playwright screenshots were active. Diagnostic native bounds were correct while a renderer viewport could remain at the previous size; serializing capture and native resize produced sixteen exact transitions. Serialize these operations in the QA driver, keep strict 800x600 checks, and retain failures. This does not change product code or establish full product acceptance.",
    "sources": records, "diagnostics": diagnostics, "failed_attempts": ["15", "16"], "verifier_sha256": sha256(Path(__file__).read_bytes()).hexdigest()}
archive.mkdir(parents=True)
for target, data in copies:
    with target.open("xb") as stream:
        stream.write(data)
with (archive / "manifest.json").open("x", encoding="utf-8", newline="\n") as stream:
    stream.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"archived_sources": len(records), "window_diagnostics": len(diagnostics)}))
