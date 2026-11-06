import { test } from "node:test";
import assert from "node:assert/strict";
import { withUnadmittedToolRetry } from "./task-tool-protocol-199.js";
test("only the explicit unadmitted transient is retried with the exact same arguments and key", async () => {
  let calls = 0; const body = { value: "original" }, key = "original-operation-key";
  const t = withUnadmittedToolRetry({ run: async (b: unknown, k: string) => { assert.equal(b, body); assert.equal(k, key); if (++calls < 3) throw { code: "TASK_CONTROL_CHANGING", status: 409 }; return "done"; } });
  assert.equal(await t.run(body, key), "done"); assert.equal(calls, 3);
  for (const code of ["TASK_PAUSE_REQUESTED", "UNKNOWN_RESULT", "PROVIDER_ERROR"]) { let count = 0; const t = withUnadmittedToolRetry({ run: async () => { count++; throw { code, status: 409 }; } }); await assert.rejects(t.run(), (e: any) => e.code === code); assert.equal(count, 1); }
});
