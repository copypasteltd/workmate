"""Review CLIENT01 boundaries while preserving old Extension evidence scope."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DEV = ROOT / "dev"
old_path = DEV / "copypaste-delivery/evidence/extension-chat-05.json"
old = json.loads(old_path.read_text(encoding="utf-8"))
assert old["status"] == "passed" and old["source_unchanged"]
sources = {name: expected for name, expected in old["source_files"].items() if name.startswith("copypaste-extension/")}
assert len(sources) == 31
assert all(sha256((DEV / name).read_bytes()).hexdigest() == expected for name, expected in sources.items())
verifiers = {name: old["source_files"][name] for name in ("copypaste-delivery/scripts/qa-extension-chat.ts", "copypaste-delivery/scripts/qa-extension.ts", "copypaste-delivery/scripts/run-extension-chat.mjs")}
assert all(sha256((DEV / name).read_bytes()).hexdigest() == expected for name, expected in verifiers.items())
extension = DEV / "copypaste-extension"
args = ["git", "-c", "core.fsmonitor=false", "-c", "core.untrackedCache=false", "ls-files", "--cached", "--others", "--exclude-standard", "-z", "--", "src", "scripts", "tests", "public", "package.json", "package-lock.json", "tsconfig.json"]
actual = {"copypaste-extension/" + name for name in subprocess.check_output(args, cwd=extension).decode().split("\0") if name}
assert actual == set(sources)
checkpoint_path = ROOT / "docs/quality/desktop-video-checkpoint.json"
checkpoint = json.loads(checkpoint_path.read_text(encoding="utf-8"))
assert checkpoint["status"] == "verified_native_private_video_subset"
result = {"at": datetime.now(timezone.utc).isoformat(), "status": "reviewed_direction_with_scoped_runtime_evidence",
    "requirement": "CLIENT01", "desktop": {"agent_location": "customer_device", "kernel": "pinned_native_Codex", "full_permission": "explicit_revocable_OS_user_access",
        "checkpoint": checkpoint_path.relative_to(ROOT).as_posix(), "checkpoint_sha256": sha256(checkpoint_path.read_bytes()).hexdigest(),
        "actual_ui_checks": 18, "native_tests": 17, "full_browser_application_parity": "pending"},
    "extension": {"agent_location": "company_cloud", "ui": "native_right_Side_Panel_conversation_and_attachments", "file_scope": "explicitly_selected_or_dropped_files_read_and_uploaded_to_company",
        "desktop_required_for_cloud_chat_and_file_upload": False, "unchanged_product_sources": sources, "unchanged_journey_verifier_sources": verifiers,
        "historical_actual_ui_report": old_path.relative_to(ROOT).as_posix(), "historical_report_sha256": sha256(old_path.read_bytes()).hexdigest(),
        "scope": "31 Extension product/build/test files and three delivery journey-verifier sources still match its existing successful native Side Panel fixture. This is a read-only source-currentness review, not a rerun against today's backend. Other old report source hashes retain historical scope."},
    "original_acceptance": checkpoint["baseline"], "verifier_sha256": sha256(Path(__file__).read_bytes()).hexdigest()}
with (ROOT / "docs/quality/client-direction-source-review-75.json").open("x", encoding="utf-8", newline="\n") as stream:
    stream.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"status": result["status"], "extension_sources_unchanged": 31, "extension_verifiers_unchanged": 3, "new_extension_UI_run": False, "full_professional_acceptance": False}))
