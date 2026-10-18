import { mkdtemp, symlink, readlink, rmdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
// Windows PostgreSQL's bootstrap SQL cannot encode a non-ASCII installation path.
// This is a temporary filesystem alias, not a VM or a second copy of project files.
// All data, binaries and source still reside in this repository under dev/.
const real = process.cwd();
let temp,
  alias = real;
if (process.platform === "win32" && /[^\x00-\x7f]/.test(real)) {
  temp = await mkdtemp(path.join(tmpdir(), "copypaste-pg-"));
  alias = path.join(temp, "runtime");
  await symlink(real, alias, "junction");
}
const child = spawn(
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
process.on("SIGINT", () => child.send({ action: "shutdown" }));
process.on("SIGTERM", () => child.send({ action: "shutdown" }));
process.on("message", (message) => {
  if (message?.action === "shutdown") child.send(message);
});
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
