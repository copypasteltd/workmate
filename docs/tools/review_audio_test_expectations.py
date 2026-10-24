"""Check the exact retained legacy-test changes for additive SQL101/role1.3."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def main():
    output = ROOT / "docs/quality/audio-production-legacy-test-review.json"
    assert not output.exists()
    baseline = json.loads((ROOT / "docs/quality/history/stage84-before-audio/receipt.json").read_text(encoding="utf-8"))
    originals = {row["source"]: row for row in baseline["files"]}
    rows = []
    for name in ["migrations", "generated-video-jobs"]:
        source = "dev/copypaste-platform/tests/" + name + ".test.ts"
        record = originals[source]
        before = (ROOT / record["archive"]).read_bytes()
        after = (ROOT / source).read_bytes()
        assert sha256(before).hexdigest() == record["sha256"]
        normalized = before.replace(b"\r\n", b"\n")
        if name == "migrations":
            old, new, count = b"\n      100,", b"\n      101,", 2
            assert normalized.count(old) == count
            expected = normalized.replace(old, new)
        else:
            old = b'  assert.equal(s.catalog.role("video-motion").version, "1.2.0");'
            new = b'''  assert.equal(s.catalog.role("video-motion").version, "1.3.0");
  const retainedVideo = s.catalog.historicalRoles.find(role => role.role_key === "video-motion" && role.version === "1.2.0");
  assert.ok(retainedVideo, "The published video-generation role remains addressable after audio is added");
  assert.ok(retainedVideo.tool_ids.includes("video.generate.internal"));
  assert.ok(!retainedVideo.tool_ids.includes("speech.generate.internal"));'''
            count = 1
            assert normalized.count(old) == count
            expected = normalized.replace(old, new)
        assert expected == after.replace(b"\r\n", b"\n"), source
        rows.append({"path": source, "before": {"archive": record["archive"], "sha256": record["sha256"]},
            "after_sha256": sha256(after).hexdigest(), "expected_version_literals_changed": count,
            "new_historical_role_assertions": 3 if name == "generated-video-jobs" else 0})
    result = {"at": datetime.now(timezone.utc).isoformat(), "status": "verified_additive_audio_test_expectations",
        "expected_version_literals_changed": 3, "old_functional_assertions_removed": 0, "new_historical_role_assertions": 3,
        "files": rows, "scope": "Only two latest-schema expectations move from 100 to 101; current video role moves to 1.3 with three additional assertions preserving published 1.2 tools. Every current test runs in fresh complete qualification; no stale batch substitution.",
        "verifier_sha256": sha256(Path(__file__).read_bytes()).hexdigest()}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": result["status"], "changed_version_literals": 3, "old_assertions_removed": 0, "new_historical_assertions": 3}))


if __name__ == "__main__":
    main()
