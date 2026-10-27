import { test } from "node:test";
import assert from "node:assert/strict";
import { rendererApiOperation } from "../src/config.js";
test("local Desktop renderer can fetch scoped presentation but cannot mutate its release API", () => {
  assert.equal(rendererApiOperation("/v1/client-content?client=desktop", "GET"), true);
  assert.equal(rendererApiOperation("/v1/client-content?client=desktop&project_id=4f548c24-e41c-4a68-a202-6c060c87c3ab", "GET"), true);
  for (const method of ["POST", "PATCH", "DELETE"]) assert.equal(rendererApiOperation("/v1/client-content", method), false);
  assert.equal(rendererApiOperation("/v1/admin/client-content", "GET"), false);
});
