import assert from "node:assert/strict";
import {sourceRoot,assertLocalSourceDemo,prepareSourceDemoRuntime} from "./source-demo-runtime-158.mjs";
const args=process.argv.slice(2);assert.ok(args.length===0||args.length===1&&args[0]==="--check","Use npm run demo, or npm run demo:check");
const root=sourceRoot();await assertLocalSourceDemo(root);const runtime=await prepareSourceDemoRuntime(root);
process.env.CODEX_BIN=runtime.executable;process.env.CODEX_VERSION=runtime.version;
console.log(JSON.stringify({status:"source_demo_runtime_verified",runtime:runtime.version,platform:runtime.platform,sha256:runtime.files["codex.exe"].sha256,mode:"synthetic_loopback_only",native_desktop:"customer_local_unchanged"}));
if(!args.includes("--check")){process.argv.push("--demo");await import("./source-demo-controller-158.mjs");}
