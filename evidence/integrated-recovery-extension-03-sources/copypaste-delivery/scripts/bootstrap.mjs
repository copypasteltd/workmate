import { spawn } from "node:child_process";
import path from "node:path";
const root = path.resolve(
  process.env.COPYPASTE_DEV_ROOT ?? path.join(import.meta.dirname, "../.."),
);
async function run(repo, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(
      process.platform === "win32" ? "npm.cmd" : "npm",
      args,
      {
        cwd: path.join(root, repo),
        shell: process.platform === "win32",
        windowsHide: true,
        stdio: "inherit",
      },
    );
    child.once("error", reject);
    child.once("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(repo + " failed")),
    );
  });
}
for (const repo of [
  "copypaste-platform",
  "copypaste-web",
  "copypaste-admin",
  "copypaste-extension",
  "copypaste-desktop",
  "copypaste-delivery",
])
  await run(repo, ["ci"]);
await run("copypaste-platform", ["run", "setup:local"]);
for (const repo of [
  "copypaste-platform",
  "copypaste-web",
  "copypaste-admin",
  "copypaste-extension",
  "copypaste-desktop",
])
  await run(repo, ["run", "build"]);
console.log(
  "Dependencies and source builds ready. Run npm run start, then platform npm run db:migrate and your admin enrollment command.",
);
