"""Review exact additive migration, role and packaged-skill test expectations."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
PLATFORM = ROOT / "dev/copypaste-platform"


def read(file):
    return json.loads(file.read_text(encoding="utf-8"))


def digest(file):
    return sha256(file.read_bytes()).hexdigest()


def main():
    output = ROOT / "docs/quality/audio-authorizations-expectation-review.json"
    assert not output.exists()
    archive = read(ROOT / "docs/quality/history/stage85-before-audio-controls/receipt.json")
    originals = {row["source"]: row for row in archive["files"]}
    reviewed = []
    for name in ["skill-lifecycle", "generated-video-jobs", "migrations"]:
        relative = "dev/copypaste-platform/tests/" + name + ".test.ts"
        record = originals[relative]
        before = (ROOT / record["archive"]).read_text(encoding="utf-8")
        assert digest(ROOT / record["archive"]) == record["sha256"]
        after = (ROOT / relative).read_text(encoding="utf-8")
        expected = before
        if name == "skill-lifecycle":
            for old, new in [
                ("assert.equal(f.versions.length, 31);", "assert.equal(f.versions.length, 32);"),
                ("assert.equal(new Set(f.versions.map((v: any) => v.id)).size, 31);", "assert.equal(new Set(f.versions.map((v: any) => v.id)).size, 32);"),
                ('v.skill_key === "speech-production").map((v: any) => v.package_version).sort(), ["1.0.0", "1.1.0"]);',
                 'v.skill_key === "speech-production").map((v: any) => v.package_version).sort(), ["1.0.0", "1.1.0", "1.2.0"]);'),
            ]:
                assert expected.count(old) == 1
                expected = expected.replace(old, new)
        elif name == "generated-video-jobs":
            old = '  assert.equal(s.catalog.role("video-motion").version, "1.3.0");'
            new = '\n'.join([
                '  assert.equal(s.catalog.role("video-motion").version, "1.4.0");',
                '  const retainedAudio = s.catalog.historicalRoles.find(role => role.role_key === "video-motion" && role.version === "1.3.0");',
                '  assert.ok(retainedAudio, "Published pre-consent role stays addressable with its original immutable speech Skill");',
                '  assert.ok(retainedAudio.skill_bindings.some((skill: any) => skill.skill_key === "speech-production" && skill.version === "1.1.0"));',
            ])
            assert expected.count(old) == 1
            expected = expected.replace(old, new)
        else:
            assert expected.count("      101,\n") == 2
            expected = expected.replace("      101,\n", "      102,\n")
        assert expected == after, relative
        old_names = re.findall(r'test\("([^"\n]+)"', before)
        assert old_names == re.findall(r'test\("([^"\n]+)"', after)
        reviewed.append({"path": relative, "before": record, "after_sha256": digest(ROOT / relative), "old_test_names_preserved": len(old_names)})
    packages = read(PLATFORM / "catalog/skill-packages.json")
    old_packages = read(ROOT / originals["dev/copypaste-platform/catalog/skill-packages.json"]["archive"])
    assert len(packages) == 32 and len({row["key"] for row in packages}) == 29
    assert packages[:len(old_packages)] == old_packages and len(old_packages) == 31
    for row in packages:
        assert digest(PLATFORM / row["path"]) == row["sha256"]
    catalog = read(PLATFORM / "catalog/role-preset-catalog.json")
    old_catalog = read(ROOT / originals["dev/copypaste-platform/catalog/role-preset-catalog.json"]["archive"])
    history = read(PLATFORM / "catalog/role-preset-history.json")
    old_history = read(ROOT / originals["dev/copypaste-platform/catalog/role-preset-history.json"]["archive"])
    old_role = next(row for row in old_catalog["roles"] if row["role_key"] == "video-motion")
    assert old_role["version"] == "1.3.0" and history == [*old_history, old_role]
    assert catalog["skill_catalog"][:-1] == old_catalog["skill_catalog"]
    for old in old_catalog["roles"]:
        if old["role_key"] != "video-motion":
            assert old in catalog["roles"]
    assert next(row for row in catalog["roles"] if row["role_key"] == "video-motion")["version"] == "1.4.0"
    result = {"at": datetime.now(timezone.utc).isoformat(), "status": "verified_additive_audio_authorization_expectations",
        "files": reviewed, "published_skill_packages_preserved": 31, "unique_skills": 29, "current_package_versions": 32,
        "published_role_1_3_exactly_retained": True, "current_role": "1.4.0", "removed_or_weakened_functional_assertions": 0,
        "scope": "Exact reviewed version/count literals and additional retained-role assertions only. This review itself is not test execution; all three files must pass in current complete regression.",
        "verifier_sha256": digest(Path(__file__))}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": result["status"], "reviewed_test_files": 3, "prior_packages_preserved": 31}))


if __name__ == "__main__":
    main()
