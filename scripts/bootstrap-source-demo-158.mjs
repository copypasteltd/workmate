import assert from "node:assert/strict";
import {sourceRoot,sourceDatabasePort,assertLocalSourceDemo,prepareSourceDemoRuntime} from "./source-demo-runtime-158.mjs";
assert.equal(process.argv.length,2,"Use npm run bootstrap:demo");
const root=sourceRoot();sourceDatabasePort();await assertLocalSourceDemo(root,{requireEnvironment:false});
const runtime=await prepareSourceDemoRuntime(root);
console.log("Pinned demo runtime verified: Codex "+runtime.version+". Installing locked dependencies and building the six source repositories.");
// setup-local writes a selected port only on its original exclusive first
// creation path. No post-install rewrite of an existing configuration occurs.
await import("./bootstrap.mjs");
await assertLocalSourceDemo(root);
console.log("Source demo ready. Run npm run demo (synthetic services), then npm run stop when finished. Production configuration is separate.");
