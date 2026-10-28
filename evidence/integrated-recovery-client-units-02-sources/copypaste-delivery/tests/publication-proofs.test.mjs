import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
test("lossless sharded publication rejects tampering, truncation, duplicate identities and unsafe paths", () => {
  const root = path.resolve(import.meta.dirname, "../../..");
  const result = spawnSync("python", ["docs/tools/test_publication_proofs.py"], { cwd: root, windowsHide: true, encoding: "utf8", timeout: 60000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.match(result.stderr, /Ran 7 tests/); assert.match(result.stderr, /\bOK\b/);
});
