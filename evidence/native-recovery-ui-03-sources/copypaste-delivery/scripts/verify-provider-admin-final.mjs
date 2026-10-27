// One sequential native verification chain. Each child retains its own evidence.
// Do not edit source while this chain is running. No Docker/WSL or deployment.
import { spawn } from "node:child_process";
import { readFile, access } from "node:fs/promises";
import path from "node:path";
import assert from "node:assert/strict";

const delivery = process.cwd(), root = path.resolve("../.."),
  candidate = "03", full = "01", staticId = "03", ui = "08", scan = "02";
assert.equal(JSON.parse(await readFile("evidence/provider-admin-candidate-02.json", "utf8")).status,"passed");
for (const file of [
  `evidence/provider-admin-candidate-${candidate}.json`,
  `evidence/provider-admin-regression-${full}.json`,
  `evidence/provider-admin-static-${staticId}.json`,
  `evidence/provider-admin-ui-${ui}.json`,
  "evidence/provider-admin-upgrade.json",
]) await assert.rejects(access(file), e => e.code === "ENOENT");

async function phase(name, executable, args, cwd = delivery) {
  console.log(JSON.stringify({phase:name,status:"started",at:new Date().toISOString()}));
  const child = spawn(executable,args,{
    cwd, windowsHide:true, env:{...process.env}, stdio:["ignore","pipe","pipe"],
  });
  // Child commands publish structured receipts and raw logs themselves. Avoid
  // echoing arbitrary child diagnostics or configuration into the conversation.
  child.stdout.resume(); child.stderr.resume();
  const code = await new Promise((resolve,reject) => {child.once("error",reject);child.once("close",resolve);});
  console.log(JSON.stringify({phase:name,status:code===0?"passed":"failed",exit_code:code,at:new Date().toISOString()}));
  assert.equal(code,0,"Inspect the retained receipt for phase: "+name);
}
await phase("built Admin browser",process.execPath,["scripts/run-provider-admin-ui.mjs",ui]);
await phase("Platform types and build",process.execPath,["scripts/run-provider-admin-static-checks.mjs",staticId]);
await phase("focused native suite",process.execPath,["scripts/run-provider-admin-checks.mjs",candidate]);
await phase("full native regression",process.execPath,["scripts/run-provider-admin-checks.mjs",full,"--full"]);
await phase("067 to 068 original-row preservation",process.execPath,["scripts/upgrade-provider-admin-local.mjs",candidate,full,staticId,ui]);
await phase("configured credential evidence scan",process.execPath,["docs/tools/scan_provider_admin_credentials.mjs",scan],root);
await phase("exact requirements evidence binding","python",[
  "docs/tools/refresh_stage58_provider_admin.py","--focused",candidate,"--full",full,"--static",staticId,"--ui",ui,"--credential-scan",scan,"--write",
],root);
await phase("bilingual repository instructions","python",[
  "docs/tools/update_stage58_readmes.py","--focused",candidate,"--full",full,"--static",staticId,"--ui",ui,
],root);
console.log(JSON.stringify({status:"passed",candidate,full,static:staticId,ui,credential_scan:scan,scope:"Native local verification only; review and commits remain separate"}));
