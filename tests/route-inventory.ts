import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";

/** Preserve the published baseline and explicitly declare every added route.
 * Callers still require exact equality with actual registered operations. */
export async function currentRouteInventory() {
  const source = await readFile("contracts/implemented-routes.json", "utf8"), baseline = JSON.parse(source);
  const additions = JSON.parse(await readFile("contracts/preset-specialist-route-additions.json", "utf8"));
  assert.equal(createHash("sha256").update(source.replaceAll("\r\n", "\n")).digest("hex"), additions.baseline_lf_sha256);
  const routes = [...baseline.routes, ...additions.routes], conditional_routes = [...baseline.conditional_routes, ...additions.conditional_routes];
  const labels = [...routes, ...conditional_routes].map(row => row.method + " " + row.path);
  assert.equal(new Set(labels).size, labels.length, "Route declarations must not overlap");
  return { ...baseline, routes, conditional_routes };
}
