import { test } from "node:test";
import assert from "node:assert/strict";
import { rendererApiOperation } from "../src/config.js";

const id = "bb286561-7d8b-45cd-9e6c-11741910b475";
const query = new URLSearchParams({ profile: "search_performance", account_id: "https://example.hk/",
  date_from: "2026-10-01", date_to: "2026-10-07", group_by: "query,page" }).toString();

test("Website report bridge supports encoded URL properties and keeps both report routes read-only", () => {
  for (const route of ["/v1/connector-snapshots/" + id + "/web-analysis",
    "/v1/tenants/" + id + "/projects/" + id + "/connector-snapshots/" + id + "/web-analysis"]) {
    assert.equal(rendererApiOperation(route + "?" + query, "GET"), true);
    for (const method of ["POST", "PATCH", "PUT", "DELETE"])
      assert.equal(rendererApiOperation(route + "?" + query, method), false);
  }
});

test("Accepting encoded query URLs never permits path escapes, arbitrary origins or privileged endpoints", () => {
  for (const route of [
    "/v1/connector-snapshots/" + id + "%2f..%2fweb-analysis",
    "/v1/connector-snapshots/" + id + "%5c..%5cweb-analysis",
    "/v1/connector-snapshots/" + id + "%252fweb-analysis",
    "/v1/connector-snapshots/" + id + "\\web-analysis",
    "/v1/admin/users", "/v1/desktop-inference/credentials", "/v1/auth/token",
    "https://evil.invalid/v1/session/context", "/v1/session/context#untrusted",
  ]) assert.equal(rendererApiOperation(route + (route.includes("#") ? "" : "?" + query), "GET"), false, route);
});
