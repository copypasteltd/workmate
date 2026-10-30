import test from "node:test";
import assert from "node:assert/strict";
import { rendererApiOperation } from "../src/config.js";

test("the Desktop renderer cannot allocate, operate or acknowledge a cloud computer through its authenticated bridge", () => {
  const id = "f3c6a5d1-f5e5-41fb-a339-9557d89aa68d";
  const root = `/v1/tenants/${id}/projects/${id}/cloud-computers`;
  for (const route of [root + "/plans", root + "/quotes", root + "/sessions", root + `/sessions/${id}/tasks`, root + `/sessions/${id}/commands`, root + `/sessions/${id}/stop`, `/v1/cloud-runtime-nodes/${id}/acknowledgements`]) {
    for (const method of ["GET", "POST", "PATCH", "DELETE"]) assert.equal(rendererApiOperation(route, method), false, method + " " + route);
  }
  assert.equal(rendererApiOperation(`/v1/tenants/${id}/projects/${id}/assets`, "GET"), true);
  assert.equal(rendererApiOperation("/v1/session/context", "GET"), true);
  assert.equal(rendererApiOperation("/v1/client-content?client=desktop", "GET"), true);
});
