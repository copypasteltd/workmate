"""Record the exact native audio theme-verifier correction."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BEFORE = ROOT / "docs/quality/history/stage84-before-audio/audio-theme-helper-before.snapshot"
AFTER = ROOT / "dev/copypaste-delivery/scripts/qa-audio-native.ts"


def main():
    output = ROOT / "docs/quality/audio-capture-verifier-review.json"
    assert not output.exists()
    before, after = BEFORE.read_bytes(), AFTER.read_bytes()
    normalized = before.replace(b"\r\n", b"\n")
    old = b'    await page.getByTitle("Theme: light / dark / system", { exact: true }).click();'
    new = b'''    for (let i = 0; i < 3 && await page.evaluate(() => document.documentElement.dataset.theme) !== "dark"; i++)
      await page.getByTitle("Theme: light / dark / system", { exact: true }).click();
    assert.equal(await page.evaluate(() => document.documentElement.dataset.theme), "dark");'''
    assert normalized.count(old) == 1
    normalized = normalized.replace(old, new)
    old_timing = 'await localized.getByText("時間由客戶手動修訂。", { exact: true }).waitFor();'.encode("utf-8")
    new_timing = old_timing.replace(b".waitFor();", b".scrollIntoViewIfNeeded();")
    assert normalized.count(old_timing) == 1
    assert normalized.replace(old_timing, new_timing) == after.replace(b"\r\n", b"\n")
    result = {"at": datetime.now(timezone.utc).isoformat(), "status": "verified_actual_theme_capture_correction",
        "before": {"path": BEFORE.relative_to(ROOT).as_posix(), "sha256": sha256(before).hexdigest()},
        "after": {"path": AFTER.relative_to(ROOT).as_posix(), "sha256": sha256(after).hexdigest()},
        "changes": ["Use actual theme controls until the rendered dark state and assert it", "Reveal the actual manually revised subtitle text before capturing"],
        "product_source_changes": 0, "functional_assertions_removed": 0,
        "previous_native_attempt": "51", "previous_audio_dark_screenshot": "actually_light_not_accepted_as_dark_evidence",
        "scope": "Verifier-only correction; all old functional steps and original receipts retained. Fresh native capture and source qualification required.",
        "verifier_sha256": sha256(Path(__file__).read_bytes()).hexdigest()}
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8", newline="\n")
    print(json.dumps({"status": result["status"], "product_source_changes": 0, "functional_assertions_removed": 0}))


if __name__ == "__main__":
    main()
