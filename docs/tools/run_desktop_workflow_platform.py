"""Run every current Platform test file once; preserve and stop on failure."""
import argparse
import json
import os
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
DELIVERY = ROOT / "dev/copypaste-delivery"
parser = argparse.ArgumentParser()
parser.add_argument("attempt")
args = parser.parse_args()
assert len(args.attempt) == 2 and args.attempt.isdigit()
prefix = DELIVERY / ("evidence/desktop-execution-control-" + args.attempt)
assert not prefix.with_suffix(".json").exists() and not Path(str(prefix) + "-plan.json").exists()
env = os.environ.copy()
env["COPYPASTE_LOCAL_CODEX_TEST_BIN"] = r"C:\Users\carzy\AppData\Local\OpenAI\Codex\bin\6257d9e8f63c0f2b\codex.exe"
command = ["node", "scripts/run-desktop-platform-resumable.mjs", args.attempt]


def run(action):
    subprocess.run(command + [action], cwd=DELIVERY, env=env, check=True,
                   creationflags=subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0)


run("--init")
plan = json.loads(Path(str(prefix) + "-plan.json").read_text(encoding="utf-8"))
assert len(plan["files"]) == 65 and len(plan["batches"]) == 17
assert "tests/desktop-workflows.test.ts" in plan["files"]
for batch in plan["batches"]:
    print("VERIFY BATCH " + batch["id"] + ": " + ", ".join(batch["files"]), flush=True)
    run("--next")
run("--finish")
report = json.loads(prefix.with_suffix(".json").read_text(encoding="utf-8"))
assert report["status"] == "passed" and report["counts"]["tests"] == 848
print(json.dumps({"status": report["status"], "counts": report["counts"], "inventory": 65, "batches": 17}), flush=True)
