import { mkdir, mkdtemp, symlink, readlink, rmdir } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
// Windows PostgreSQL's bootstrap SQL cannot encode a non-ASCII installation path.
// This is a filesystem alias, not a VM or a second copy of project files.
// All data, binaries and source still reside in this repository under dev/.
const real = process.cwd();
let child;
let shutdownRequested = false;
let controlReady = false;
function requestShutdown() {
  shutdownRequested = true;
  if (controlReady && child?.connected && child.exitCode === null)
    child.send({ action: "shutdown" });
}
process.on("SIGINT", requestShutdown);
process.on("SIGTERM", requestShutdown);
process.on("message", (message) => {
  if (message?.action === "shutdown") requestShutdown();
});
let temp,
  alias = real;
if (process.platform === "win32" && /[^\x00-\x7f]/.test(real)) {
  // PostgreSQL starts new backends using this executable path throughout its
  // lifetime. An OS temporary-directory cleanup can break an otherwise live
  // cluster. Keep the owned junction in the stable per-user application cache.
  const base = path.resolve(
    process.env.COPYPASTE_NATIVE_ALIAS_ROOT ??
      path.join(
        process.env.LOCALAPPDATA ?? path.join(homedir(), "AppData", "Local"),
        "CopyPaste",
        "native-runtime-aliases",
      ),
  );
  if (/[^\x00-\x7f]/.test(base))
    throw new Error(
      "COPYPASTE_NATIVE_ALIAS_ROOT must name a stable ASCII path",
    );
  await mkdir(base, { recursive: true });
  temp = await mkdtemp(path.join(base, "postgres-"));
  alias = path.join(temp, "runtime");
  await symlink(real, alias, "junction");
}
child = spawn(
  process.execPath,
  [
    "--preserve-symlinks",
    "--preserve-symlinks-main",
    "--env-file=" + path.join(real, ".env"),
    path.join(alias, "dist/scripts/db-local.js"),
  ],
  {
    cwd: alias,
    windowsHide: true,
    stdio: ["ignore", "inherit", "inherit", "ipc"],
  },
);
child.on("message", (message) => {
  if (message?.control === "ready") {
    controlReady = true;
    if (shutdownRequested) requestShutdown();
  }
});
let stopped = false;
async function cleanup() {
  if (stopped) return;
  stopped = true;
  if (temp) {
    const target = await readlink(alias).catch(() => null);
    if (target && path.resolve(target) === path.resolve(real))
      await rmdir(alias);
    await rmdir(temp).catch(() => {});
  }
}
child.on("exit", async (code) => {
  await cleanup();
  process.exitCode = code ?? 1;
  if (process.connected) process.disconnect();
});
child.on("error", async () => {
  await cleanup();
  process.exitCode = 1;
  if (process.connected) process.disconnect();
});
