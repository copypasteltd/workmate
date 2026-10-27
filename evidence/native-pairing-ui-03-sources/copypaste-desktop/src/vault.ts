import { spawn } from "node:child_process";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { exclusive } from "./lock.js";

// DPAPI CurrentUser wraps a small profile key without sharing Chromium Local State
// between the desktop process and short-lived Chrome native-message processes.
async function dpapi(bytes: Buffer, protect: boolean): Promise<Buffer> {
  if (process.platform !== "win32")
    throw new Error("This release requires Windows credential protection");
  const script =
    "$ErrorActionPreference='Stop';Add-Type -AssemblyName System.Security;$b=[Convert]::FromBase64String([Console]::In.ReadToEnd());$e=[Text.Encoding]::UTF8.GetBytes('hk.copypaste.agent.v1');$r=[Security.Cryptography.ProtectedData]::" +
    (protect ? "Protect" : "Unprotect") +
    "($b,$e,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($r));";
  return new Promise((resolve, reject) => {
    const exe = path.join(
      process.env.SystemRoot ?? "C:\\Windows",
      "System32",
      "WindowsPowerShell",
      "v1.0",
      "powershell.exe",
    );
    const child = spawn(
      exe,
      ["-NoProfile", "-NonInteractive", "-Command", script],
      { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
    );
    const chunks: Buffer[] = [];
    let size = 0;
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Windows credential protection timed out"));
    }, 15000);
    child.stdout.on("data", (b) => {
      size += b.length;
      if (size > 65536) {
        child.kill();
        reject(new Error("Invalid Windows credential response"));
      } else chunks.push(b);
    });
    child.stderr.on("data", () => {});
    child.on("error", () => {
      clearTimeout(timer);
      reject(new Error("Windows credential protection is unavailable"));
    });
    child.stdin.on("error", () => {});
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error("Windows credential protection failed"));
      else
        resolve(Buffer.from(Buffer.concat(chunks).toString().trim(), "base64"));
    });
    // Secret bytes are carried on stdin, never in process arguments or logs.
    child.stdin.end(bytes.toString("base64"));
  });
}
const prefix = Buffer.from("CPVAULT1");
export class LocalVault {
  private keyPromise?: Promise<Buffer>;
  constructor(private root: string) {}
  private key() {
    return (this.keyPromise ??= exclusive(
      path.join(this.root, "vault"),
      async () => {
        const dir = path.join(this.root, "vault"),
          file = path.join(dir, "key.dpapi");
        await mkdir(dir, { recursive: true });
        let wrapped: Buffer;
        try {
          wrapped = await readFile(file);
        } catch (e: any) {
          if (e.code !== "ENOENT") throw e;
          const key = randomBytes(32);
          wrapped = await dpapi(key, true);
          await writeFile(file, wrapped, { flag: "wx", mode: 0o600 });
          return key;
        }
        const key = await dpapi(wrapped, false);
        if (key.length !== 32) throw new Error("Invalid local credential key");
        return key;
      },
    ));
  }
  async encrypt(value: string) {
    if (Buffer.byteLength(value) > 32_000_000)
      throw new Error("Local encrypted state exceeds its limit");
    const nonce = randomBytes(12),
      cipher = createCipheriv("aes-256-gcm", await this.key(), nonce);
    cipher.setAAD(prefix);
    const bytes = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
    return Buffer.concat([prefix, nonce, cipher.getAuthTag(), bytes]);
  }
  async decrypt(bytes: Buffer) {
    if (
      bytes.length < 36 ||
      bytes.length > 32_000_036 ||
      !bytes.subarray(0, 8).equals(prefix)
    )
      throw new Error("Invalid local encrypted state");
    const cipher = createDecipheriv(
      "aes-256-gcm",
      await this.key(),
      bytes.subarray(8, 20),
    );
    cipher.setAAD(prefix);
    cipher.setAuthTag(bytes.subarray(20, 36));
    return Buffer.concat([
      cipher.update(bytes.subarray(36)),
      cipher.final(),
    ]).toString("utf8");
  }
}
