import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import assert from "node:assert/strict";

// Existing source-bound checks run sequentially against this exact API build.
// Each browser script owns and closes its contexts, processes and credentials.
const checks = [];
for (const [name, file] of [
  ["admin-vip-credit", "qa-admin-vip-credit.ts"],
  ["resources", "qa-resource-ui.ts"],
  ["admin-vip", "qa-admin-vip.ts"],
  ["admin-plans", "qa-admin-plans.ts"],
  ["admin-fees", "qa-admin-fees.ts"],
  ["membership", "qa-membership.ts"],
  ["admin-membership", "qa-admin-membership-ui.ts"],
  ["native-surfaces", "qa-native-surfaces.ts"],
  ["native-vip", "qa-native-vip.ts"],
  ["sessions", "qa-sessions.ts"],
]) {
  const log = `evidence/vip-credit-recheck-${name}.log`;
  const stream = createWriteStream(log), started = new Date().toISOString();
  console.log(`${started} starting ${name}`);
  const child = spawn(process.execPath, ["--import", "tsx", `scripts/${file}`], {
    cwd: process.cwd(), windowsHide: true, env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.on("data", (b) => stream.write(b));
  child.stderr.on("data", (b) => stream.write(b));
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject); child.once("close", resolve);
  });
  await new Promise((resolve) => stream.end(resolve));
  checks.push({ name, code, log, started, ended: new Date().toISOString() });
  await writeFile("evidence/vip-credit-context.json", JSON.stringify({
    at: new Date().toISOString(), status: code === 0 ? "running" : "failed", checks,
    scope: "Execution index only. Actual check, source, screenshot and closure facts remain in each existing report.",
  }, null, 2) + "\n");
  assert.equal(code, 0, `${name} failed; inspect ${log}`);
  console.log(`${name} passed`);
}
await writeFile("evidence/vip-credit-context.json", JSON.stringify({
  at: new Date().toISOString(), status: "passed", checks,
  scope: "Execution index only. Actual check, source, screenshot and closure facts remain in each existing report.",
}, null, 2) + "\n");
