"""Record an incomplete owned UI attempt without promoting partial passes."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
delivery = root / "dev/copypaste-delivery"
report_path = delivery / "evidence/desktop-local-ui-11.json"
report = json.loads(report_path.read_text(encoding="utf-8"))
assert report["status"] == "failed" and report["source_unchanged"] and report["owned_database_shutdown"]
cleanup = report["fixture_cleanup"]
assert cleanup["status"] == "passed" and all(item["reclaimed"] for item in cleanup["results"])
raw_path = delivery / report["raw_report"]["path"]
raw = raw_path.read_bytes()
assert sha256(raw).hexdigest() == report["raw_report"]["sha256"] and raw.count(b"PASS: ") == 11
note_path = delivery / ".data/desktop-local/92955fa1-e123-43fb-bc55-70fd94b5e63e/external-shutdown.json"
result = {
    "at": datetime.now(timezone.utc).isoformat(), "status": "incomplete_attempt_reclaimed", "attempt": "11",
    "complete_qualification": False, "observed_business_passes": 11, "qualification_contribution": 0,
    "reason": "Post-recording/locale completion did not return; exact unresolved await was not established. Partial assertions and media are not final qualification.",
    "owned_candidate": "dev/copypaste-desktop/.data/local-candidates/ee7d3640-6ba6-4c40-9451-cab4a7082180/win-unpacked/CopyPaste.exe",
    "graceful_close_attempt": "Browser.close on this candidate's own loopback DevTools endpoint, then a bounded wait.",
    "forced_cleanup": {"candidate_pid": 29360, "journey_pid": 43528, "browser_pid": 42612,
        "identity_check": "Candidate executable path and journey command/attempt were checked before terminating their owned process trees. Parent runner remained alive for fixture reclamation and graceful owned DB shutdown."},
    "owned_database_shutdown": True, "fixture_cleanup": cleanup, "source_unchanged": True,
    "minimum_window_limit": "No completed resize wait; the question screenshot was still 1440x980. It cannot establish minimum-window behavior.",
    "report": {"path": report_path.relative_to(root).as_posix(), "sha256": sha256(report_path.read_bytes()).hexdigest()},
    "raw": {"path": raw_path.relative_to(root).as_posix(), "sha256": sha256(raw).hexdigest()},
    "shutdown_note": json.loads(note_path.read_text(encoding="utf-8")),
    "verifier_sha256": sha256(Path(__file__).read_bytes()).hexdigest(),
}
output = root / "docs/quality/desktop-native-input-interruption-11.json"
with output.open("x", encoding="utf-8", newline="\n") as stream:
    stream.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"status": result["status"], "observed_passes": 11, "qualification_contribution": 0, "database_shutdown": True}))
