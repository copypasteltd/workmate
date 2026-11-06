import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { currentRouteInventory as previousInventory } from "./route-inventory-189-v2.js";
export async function currentRouteInventory() {
  const previous = await previousInventory(), additions = JSON.parse(await readFile("contracts/design-production-route-additions-200.json", "utf8"));
  const routes = [...previous.routes, ...additions.routes], conditional_routes = [...previous.conditional_routes, ...additions.conditional_routes];
  assert.equal(new Set([...routes, ...conditional_routes].map(r => r.method + " " + r.path)).size, routes.length + conditional_routes.length);
  assert.equal(routes.length, additions.expected_current_routes); assert.equal(conditional_routes.length, additions.expected_current_conditional_routes);
  return { ...previous, routes, conditional_routes };
}
