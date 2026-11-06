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
  const workspace = JSON.parse(await readFile("contracts/workspace-route-additions-196.json", "utf8"));
  assert.equal(workspace.baseline_lf_sha256, addition.baseline_lf_sha256);
  const currentRoutes=[...routes,...workspace.routes],currentConditional=[...conditional_routes,...workspace.conditional_routes];
  assert.equal(new Set([...currentRoutes,...currentConditional].map(row=>row.method+" "+row.path)).size,currentRoutes.length+currentConditional.length);
  assert.equal(currentRoutes.length,workspace.expected_current_routes);
  assert.equal(currentConditional.length,workspace.expected_current_conditional_routes);
  const directory=JSON.parse(await readFile("contracts/task-directory-route-additions-198.json","utf8"));
  assert.equal(directory.baseline_lf_sha256,addition.baseline_lf_sha256);
  const finalRoutes=[...currentRoutes,...directory.routes],finalConditional=[...currentConditional,...directory.conditional_routes];
  assert.equal(new Set([...finalRoutes,...finalConditional].map(row=>row.method+" "+row.path)).size,finalRoutes.length+finalConditional.length);
  assert.equal(finalRoutes.length,directory.expected_current_routes);assert.equal(finalConditional.length,directory.expected_current_conditional_routes);
  const design=JSON.parse(await readFile("contracts/design-draft-route-additions-199.json","utf8"));
  assert.equal(design.baseline_lf_sha256,addition.baseline_lf_sha256);
  const allRoutes=[...finalRoutes,...design.routes],allConditional=[...finalConditional,...design.conditional_routes];
  assert.equal(new Set([...allRoutes,...allConditional].map(row=>row.method+" "+row.path)).size,allRoutes.length+allConditional.length);
  assert.equal(allRoutes.length,design.expected_current_routes);assert.equal(allConditional.length,design.expected_current_conditional_routes);
  return {...previous,routes:allRoutes,conditional_routes:allConditional};
}
