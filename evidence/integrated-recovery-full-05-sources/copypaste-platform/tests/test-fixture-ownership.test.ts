import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { processIsGone, validateFixtureOwner } from "../scripts/test-fixture-ownership.js";
const token = "91c4ab40-8537-457b-948b-8bf862c87d34", id = "a".repeat(32), base = path.resolve(".data/test-runs");
const item = { id, token, directory: path.join(base, id), worker_pid: 123 };
test("interrupted fixture reclamation requires the exact durable owner and child path", () => {
  assert.equal(validateFixtureOwner(item, { token }, base, id + ".json"), item);
  for (const changed of [{ token: "wrong" }, { directory: path.dirname(base) }, { worker_pid: 0 }, { id: "../escape" }])
    assert.throws(() => validateFixtureOwner({ ...item, ...changed }, { token }, base, id + ".json"));
});
test("only a confirmed missing process permits reclamation; live and inaccessible owners remain protected", () => {
  assert.equal(processIsGone(123, (() => true) as any), false);
  assert.equal(processIsGone(123, (() => { throw Object.assign(new Error(), { code: "ESRCH" }); }) as any), true);
  assert.throws(() => processIsGone(123, (() => { throw Object.assign(new Error(), { code: "EPERM" }); }) as any));
  assert.throws(() => processIsGone(-1));
});
