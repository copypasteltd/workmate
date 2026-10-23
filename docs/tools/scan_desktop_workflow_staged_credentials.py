"""Before committing, check staged bytes for exact local configured secrets."""
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path

from audit_workmate_publication import MAP, ROOT, configured_credentials, git

needles = configured_credentials()
checked = 0
for branch, repo in MAP.items():
    names = git(repo, "diff", "--cached", "--name-only", "--diff-filter=ACM", "-z").split(b"\0")
    for raw in names:
        if not raw:
            continue
        name = raw.decode("utf-8")
        content = git(repo, "show", ":" + name)
        # Do not include matched bytes or configuration in any output.
        assert not any(secret in content for secret in needles), (branch, name, "configured credential in staged content")
        checked += 1
assert checked > 0
receipt = {
    "at": datetime.now(timezone.utc).isoformat(), "status": "passed",
    "staged_files_checked": checked, "repositories": len(MAP),
    "scope": "Exact configured credential literals in staged added/copied/modified blobs before commit; canonical history, signature, path and media audit runs separately before push.",
    "configured_values_or_matches_printed": False,
    "verifier_sha256": sha256(Path(__file__).read_bytes()).hexdigest(),
}
with (ROOT / "docs/quality/desktop-workflow-staged-credentials-01.json").open("x", encoding="utf-8") as stream:
    stream.write(json.dumps(receipt, indent=2) + "\n")
print(json.dumps({"status": "passed", "staged_files_checked": checked, "configured_values_printed": False}))
