"""Review only additive package-version counts, retaining old Skill assertions."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TEST = "dev/copypaste-platform/tests/skill-lifecycle.test.ts"


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    output = ROOT / "docs/quality/audio-production-skill-expectation-review.json"
    assert not output.exists()
    baseline = json.loads((ROOT / "docs/quality/history/stage84-before-audio/receipt.json").read_text(encoding="utf-8"))
    record = next(row for row in baseline["files"] if row["source"] == TEST)
    before = (ROOT / record["archive"]).read_bytes()
    after = (ROOT / TEST).read_bytes()
    assert sha256(before).hexdigest() == record["sha256"]
    expected = before.replace(b"\r\n", b"\n")
    for old, new in [
        (b"assert.equal(f.versions.length, 30);", b"assert.equal(f.versions.length, 31);"),
        (b"assert.equal(new Set(f.versions.map((v: any) => v.id)).size, 30);", b"assert.equal(new Set(f.versions.map((v: any) => v.id)).size, 31);")]:
        assert expected.count(old) == 1
        expected = expected.replace(old, new)
    anchor = b'  assert.deepEqual(f.versions.filter((v: any) => v.skill_key === "video-generation").map((v: any) => v.package_version).sort(), ["1.0.0", "1.1.0"]);'
    extra = b'  assert.deepEqual(f.versions.filter((v: any) => v.skill_key === "speech-production").map((v: any) => v.package_version).sort(), ["1.0.0", "1.1.0"]);'
    assert expected.count(anchor) == 1 and extra not in expected
    expected = expected.replace(anchor, anchor + b"\n" + extra)
    assert expected == after.replace(b"\r\n", b"\n")
    catalog = json.loads((ROOT / "dev/copypaste-platform/catalog/skill-packages.json").read_text(encoding="utf-8"))
    assert len(catalog) == 31 and len({row["key"] for row in catalog}) == 29
    assert sorted(row["version"] for row in catalog if row["key"] == "speech-production") == ["1.0.0", "1.1.0"]
    result = {"at": datetime.now(timezone.utc).isoformat(), "status": "verified_additive_skill_revision_counts",
        "test_file": TEST, "before": {"archive": record["archive"], "sha256": record["sha256"]}, "after_sha256": digest(ROOT / TEST),
        "literal_changes": 2, "new_retained_revision_assertions": 1, "removed_or_weakened_functional_assertions": 0,
        "product_source_changes": 0, "unique_skill_kinds": 29, "package_versions": 31,
        "scope": "Only total/unique version counts move from 30 to 31. The 29 unique Skill kinds and all old functional assertions remain, with an additional assertion retaining both speech revisions. The entire affected four-file batch must execute afresh.",
        "verifier_sha256": digest(Path(__file__))}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": result["status"], "literal_changes": 2, "old_functional_assertions_removed": 0}))


if __name__ == "__main__":
    main()
