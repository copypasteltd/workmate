import { spawn } from "node:child_process";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
const root = path.resolve(
  process.env.COPYPASTE_DEV_ROOT ?? path.join(import.meta.dirname, "../.."),
);
const checks = [];
const run = async (repo, script) => {
  const cwd = path.join(root, repo);
  console.log(repo + " · " + script);
  const result = await new Promise((resolve) => {
    const child = spawn(
      process.platform === "win32" ? "npm.cmd" : "npm",
      ["run", script],
      {
        cwd,
        shell: process.platform === "win32",
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
    let output = "";
    child.stdout.on("data", (b) => (output += b));
    child.stderr.on("data", (b) => (output += b));
    child.once("error", (e) => resolve({ code: 1, output: e.message }));
    child.once("close", (code) => resolve({ code, output }));
  });
  checks.push({
    repo,
    command: "npm run " + script,
    exit_code: result.code,
    output: result.output,
  });
  if (result.code !== 0)
    throw new Error(repo + " " + script + " failed:\n" + result.output);
};
let failure;
try {
  for (const repo of [
    "copypaste-platform",
    "copypaste-web",
    "copypaste-admin",
    "copypaste-extension",
    "copypaste-desktop",
    "copypaste-delivery",
  ]) {
    await run(repo, "typecheck");
    await run(repo, "build");
  }
  await run("copypaste-platform", "test");
  await run("copypaste-desktop", "test");
  await run("copypaste-platform", "contracts:export");
} catch (e) {
  failure = e;
}
await mkdir("evidence", { recursive: true });
await writeFile(
  "evidence/verification.json",
  JSON.stringify(
    {
      at: new Date().toISOString(),
      status: failure ? "failed" : "passed",
      checks,
    },
    null,
    2,
  ),
);
if (failure) throw failure;
console.log(
  "All native builds and logic checks passed. UI journeys are recorded separately.",
);
