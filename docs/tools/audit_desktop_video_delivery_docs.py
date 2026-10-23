"""Check current README images and preserve the entire original acceptance map."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
checkpoint = json.loads((ROOT / "docs/quality/desktop-video-checkpoint.json").read_text(encoding="utf-8"))
assert checkpoint["status"] == "verified_native_private_video_subset"
readmes = [ROOT / "docs" / name for name in ("README.md", "README.en.md")]
for component in ("platform", "web", "admin", "desktop", "extension", "delivery"):
    readmes += [ROOT / "dev" / ("copypaste-" + component) / name for name in ("README.md", "README.en.md")]
images = []
for file in readmes:
    text = file.read_text(encoding="utf-8")
    assert "desktop-video-checkpoint.json" in text and "830" in text and "58" in text
    for link in re.findall(r"!\[[^\]]*\]\(([^)]+)\)", text):
        if link.startswith(("https://", "http://")):
            continue
        target = (file.parent / link).resolve()
        assert target.is_relative_to(ROOT) and target.is_file(), (file.relative_to(ROOT), link)
        images.append({"readme": file.relative_to(ROOT).as_posix(), "image": target.relative_to(ROOT).as_posix(), "sha256": sha256(target.read_bytes()).hexdigest()})
before = json.loads((ROOT / "docs/quality/history/before-desktop-video-docs/docs__quality__requirements-alignment-progress.json.txt").read_text(encoding="utf-8"))
after = json.loads((ROOT / "docs/quality/requirements-alignment-progress.json").read_text(encoding="utf-8"))
assert before["requirements"] == after["requirements"] and len(after["requirements"]) == 102
assert before["summary"] == after["summary"] == {"partial_verified": 81, "completion_not_proven": 21}
assert before["fully_accepted_requirements"] == after["fully_accepted_requirements"] == 0
for key in ("gates", "nfr_full_acceptance", "requirements_amendments"):
    assert before[key] == after[key]
result = {"at": datetime.now(timezone.utc).isoformat(), "status": "passed", "bilingual_readmes": 14, "local_readme_images_checked": images,
    "original_requirement_records_unchanged": 102, "gates_and_nfr_unchanged": True, "baseline": checkpoint["baseline"],
    "verifier_sha256": sha256(Path(__file__).read_bytes()).hexdigest()}
with (ROOT / "docs/quality/desktop-video-docs-audit-01.json").open("x", encoding="utf-8", newline="\n") as stream:
    stream.write(json.dumps(result, ensure_ascii=False, indent=2) + "\n")
print(json.dumps({"status": "passed", "readmes": 14, "images": len(images), "original_requirements_unchanged": 102}))
