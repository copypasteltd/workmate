import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import {
  readFile,
  mkdir,
  mkdtemp,
  copyFile,
  writeFile,
  rm,
} from "node:fs/promises";
import path from "node:path";
import { inspectInstaller } from "../src/update-native.js";
const hash = (v: Uint8Array) => createHash("sha256").update(v).digest("hex");
const helper = path.resolve(
  ".data/update-installer-host/update-installer-host.exe",
);
async function signedNode() {
  assert.equal(
    process.platform,
    "win32",
    "Native installer qualification requires Windows",
  );
  const script =
    "$s = Get-AuthenticodeSignature -LiteralPath $env:COPYPASTE_INSPECT_CANDIDATE; if ($null -eq $s.SignerCertificate) { throw 'No signing certificate' }; $h = [Security.Cryptography.SHA256]::Create(); [PSCustomObject]@{status=[string]$s.Status; signer=([BitConverter]::ToString($h.ComputeHash($s.SignerCertificate.RawData))).Replace('-','').ToLowerInvariant()} | ConvertTo-Json -Compress";
  const result = await promisify(execFile)(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
    {
      env: { ...process.env, COPYPASTE_INSPECT_CANDIDATE: process.execPath },
      windowsHide: true,
      timeout: 45000,
    },
  );
  const v = JSON.parse(result.stdout);
  assert.equal(v.status, "Valid");
  return {
    file: process.execPath,
    sha256: hash(await readFile(process.execPath)),
    signer: v.signer,
  };
}
test("native WinVerifyTrust validates a real Windows-trusted signed binary and its exact publisher", async () => {
  const v = await signedNode();
  await inspectInstaller(helper, v.file, v.sha256, v.signer);
  await assert.rejects(
    inspectInstaller(helper, v.file, v.sha256, "0".repeat(64)),
    { code: "UPDATE_SIGNER_MISMATCH" },
  );
  console.log(
    JSON.stringify({
      native_authenticode_fixture: {
        sha256: v.sha256,
        signer_sha256: v.signer,
        operation: "inspect_only",
      },
    }),
  );
});
test("native verifier rejects changed bytes and the unsigned development helper without launching anything", async () => {
  await assert.rejects(
    inspectInstaller(helper, helper, "0".repeat(64), "0".repeat(64)),
    { code: "UPDATE_ARTIFACT_MISMATCH" },
  );
  await assert.rejects(
    inspectInstaller(
      helper,
      helper,
      hash(await readFile(helper)),
      "0".repeat(64),
    ),
    { code: "UPDATE_AUTHENTICODE_INVALID" },
  );
});
test("native install handshake locks verified bytes and refuses to start without the exact COMMIT message", async () => {
  const v = await signedNode(),
    parent = path.resolve(".data/update-host-tests");
  await mkdir(parent, { recursive: true });
  const owned = await mkdtemp(path.join(parent, "owned-")),
    file = path.join(owned, "signed-fixture.exe");
  await copyFile(v.file, file);
  const child = spawn(
    helper,
    ["install", file, v.sha256, v.signer, String(process.pid)],
    { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] },
  );
  let stdout = "",
    stderr = "";
  const done = new Promise<number>((r) =>
    child.once("close", (code) => r(code ?? 1)),
  );
  child.stderr.on("data", (b) => {
    stderr += b;
  });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        child.kill();
        reject(new Error("Native signature handshake timed out"));
      }, 45000);
      child.once("error", (e) => {
        clearTimeout(timeout);
        reject(e);
      });
      child.once("exit", () => {
        if (!stdout.includes("READY")) {
          clearTimeout(timeout);
          reject(new Error(stderr));
        }
      });
      child.stdout.on("data", (b) => {
        stdout += b;
        if (stdout.trim() === "READY") {
          clearTimeout(timeout);
          resolve();
        }
      });
    });
    await assert.rejects(writeFile(file, "changed"), (e: any) =>
      ["EACCES", "EPERM", "EBUSY"].includes(e.code),
    );
    child.stdin.end("CANCEL\n");
    assert.equal(await done, 1);
    assert.match(stderr, /UPDATE_COMMIT_REQUIRED/);
    assert.equal(hash(await readFile(file)), v.sha256);
  } finally {
    if (child.exitCode === null) child.kill();
    await done;
    assert.equal(path.dirname(owned), parent);
    await rm(owned, { recursive: true, force: true });
  }
});
