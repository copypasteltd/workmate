import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
if (
  !process.env.COPYPASTE_UPDATE_TRUST_FILE ||
  !(
    process.env.CSC_LINK ||
    process.env.WIN_CSC_LINK ||
    process.env.CSC_NAME ||
    process.env.WIN_CSC_SUBJECT_NAME
  )
)
  throw new Error(
    "Signed release packaging requires explicit update trust and Windows signing credentials",
  );
const packageJSON = JSON.parse(await readFile("package.json", "utf8"));
const build = {
  ...packageJSON.build,
  forceCodeSigning: true,
  win: { ...packageJSON.build.win, signExecutable: true },
};
const { writeFile, mkdir } = await import("node:fs/promises");
await mkdir(".data/release", { recursive: true });
await writeFile(
  ".data/release/electron-builder.json",
  JSON.stringify(build, null, 2) + "\n",
);
const env = { ...process.env, COPYPASTE_RELEASE_BUILD: "true" };
async function run(args) {
  const child = spawn(process.execPath, args, {
    env,
    stdio: "inherit",
    windowsHide: true,
  });
  const code = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  if (code !== 0) throw new Error("Signed release build failed");
}
await run(["scripts/prepare-local-codex.mjs"]);
await run(["scripts/configure-deployment.mjs"]);
await run(["scripts/configure-update-trust.mjs"]);
await run(["scripts/build-program-host.mjs"]);
await run(["scripts/build-update-host.mjs"]);
await run(["node_modules/typescript/bin/tsc"]);
await run(["scripts/build-native-host.mjs"]);
await run([
  "node_modules/vite/bin/vite.js",
  "build",
  "--config",
  "vite.config.ts",
]);
await run([
  "node_modules/electron-builder/out/cli/cli.js",
  "--win",
  "nsis",
  "--config",
  ".data/release/electron-builder.json",
]);
