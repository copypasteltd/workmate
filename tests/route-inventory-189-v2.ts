import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { currentRouteInventory as previousInventory } from "./route-inventory.js";

export async function currentRouteInventory() {
  const previous = await previousInventory();
  const addition = JSON.parse(await readFile("contracts/current-route-additions-189-v2.json", "utf8"));
  const baseline = await readFile("contracts/implemented-routes.json", "utf8");
  assert.equal(createHash("sha256").update(baseline.replaceAll("\r\n", "\n")).digest("hex"), addition.baseline_lf_sha256);
  const routes = [...previous.routes, ...addition.routes];
  const conditional_routes = [...previous.conditional_routes, ...addition.conditional_routes];
  const keys = [...routes, ...conditional_routes].map(row => row.method + " " + row.path);
  assert.equal(new Set(keys).size, keys.length, "Explicit route declarations overlap");
  assert.equal(routes.length, addition.expected_current_routes);
  assert.equal(conditional_routes.length, addition.expected_current_conditional_routes);
  return {...previous, routes, conditional_routes};
}
