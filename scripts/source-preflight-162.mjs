import assert from "node:assert/strict";
import {sourceRoot, assertLocalSourceDemo} from "./source-demo-runtime-158.mjs";
import {assertSourceDemoPortsAvailable} from "./source-demo-port-preflight-162.mjs";

assert.equal(process.argv.length, 2, "Use npm run demo:preflight");
await assertLocalSourceDemo(sourceRoot(), {requireEnvironment: false});
const ports = await assertSourceDemoPortsAvailable();
console.log(JSON.stringify({status: "source_layout_and_ports_ready", ...ports}));
console.log("Source layout and startup ports are ready. Run npm run bootstrap:demo to prepare the matching Codex runtime and locked dependencies.");
