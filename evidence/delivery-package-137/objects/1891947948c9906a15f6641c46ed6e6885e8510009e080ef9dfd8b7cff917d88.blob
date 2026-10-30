import { test } from "node:test";
import assert from "node:assert/strict";
import { rendererApiOperation } from "../src/config.js";
test("native support receipt recovery allows customer GET only and never administrator impersonation", () => {
  const key = "714359ec-9538-4ab0-8683-3fe5741432fa";
  assert.equal(rendererApiOperation(`/v1/support-grants/attempts/${key}`, "GET"), true);
  for (const method of ["POST", "PATCH", "DELETE"])
    assert.equal(rendererApiOperation(`/v1/support-grants/attempts/${key}`, method), false);
  assert.equal(rendererApiOperation(`/v1/admin/support/sessions/${key}/view`, "GET"), false);
});
