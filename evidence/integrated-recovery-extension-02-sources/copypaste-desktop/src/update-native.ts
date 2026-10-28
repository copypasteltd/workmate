import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { UpdateError } from "./desktop-update-contract.js";
export async function inspectInstaller(
  helper: string,
  file: string,
  sha256: string,
  signer: string,
) {
  try {
    const result = await promisify(execFile)(
      helper,
      ["inspect", file, sha256, signer],
      { windowsHide: true, timeout: 45000, maxBuffer: 4000 },
    );
    if (result.stdout.trim() !== "VERIFIED")
      throw new UpdateError("UPDATE_AUTHENTICODE_INVALID");
  } catch (error: any) {
    const code =
      typeof error.stderr === "string" &&
      /^UPDATE_[A-Z_]+\s*$/.test(error.stderr)
        ? error.stderr.trim()
        : "UPDATE_INSTALLER_VERIFICATION_FAILED";
    throw new UpdateError(code);
  }
}
export function prepareInstaller(
  helper: string,
  file: string,
  sha256: string,
  signer: string,
) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(
      helper,
      ["install", file, sha256, signer, String(process.pid)],
      { windowsHide: true, detached: true, stdio: ["pipe", "pipe", "ignore"] },
    );
    let output = "",
      ready = false;
    const timer = setTimeout(() => {
      child.kill();
      reject(new UpdateError("UPDATE_INSTALLER_VERIFICATION_FAILED"));
    }, 45000);
    child.on("error", () => {
      clearTimeout(timer);
      reject(new UpdateError("UPDATE_INSTALLER_START_FAILED"));
    });
    child.on("exit", () => {
      clearTimeout(timer);
      if (!ready)
        reject(new UpdateError("UPDATE_INSTALLER_VERIFICATION_FAILED"));
    });
    child.stdout.on("data", (value) => {
      output += value.toString();
      if (output.length > 1000) {
        child.kill();
        return;
      }
      if (!ready && output.trim() === "READY") {
        ready = true;
        clearTimeout(timer);
        child.stdin.end("COMMIT\n");
        child.stdout.destroy();
        child.unref();
        resolve();
      }
    });
    child.stdin.on("error", () => {
      if (!ready) reject(new UpdateError("UPDATE_INSTALLER_START_FAILED"));
    });
  });
}
