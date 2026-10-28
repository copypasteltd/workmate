import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import { pathToFileURL } from "node:url";
import path from "node:path";
import { LocalVault } from "../src/vault.js";
test("Windows DPAPI vault decrypts across native processes and rejects tampering", async () => {
  await mkdir(".data", { recursive: true });
  const root = await mkdtemp(path.resolve(".data/vault-test-"));
  try {
    const v = new LocalVault(root),
      text = "Native bridge credential fixture · 香港";
    const bytes = await v.encrypt(text);
    assert.ok(!bytes.toString("utf8").includes(text));
    assert.equal(await new LocalVault(root).decrypt(bytes), text);
    const altered = Buffer.from(bytes);
    altered[altered.length - 1] ^= 1;
    await assert.rejects(v.decrypt(altered));
    const file = path.join(root, "fixture.enc");
    await writeFile(file, bytes);
    const script = `import{LocalVault}from ${JSON.stringify(pathToFileURL(path.resolve("src/vault.ts")).href)};import{readFile}from'node:fs/promises';const value=await new LocalVault(process.argv[1]).decrypt(await readFile(process.argv[2]));process.stdout.write(value);`;
    const result = await new Promise<string>((resolve, reject) => {
      const c = spawn(
        process.execPath,
        ["--import", "tsx", "--input-type=module", "-e", script, root, file],
        { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
      let out = "";
      c.stdout.on("data", (b) => (out += b));
      c.stderr.on("data", () => {});
      const timer = setTimeout(() => {
        c.kill();
        reject(new Error("Cross-process vault test timed out"));
      }, 20000);
      c.once("error", reject);
      c.once("close", (code) => {
        clearTimeout(timer);
        code === 0
          ? resolve(out)
          : reject(new Error("Cross-process vault failed"));
      });
    });
    assert.equal(result, text);
  } finally {
    assert.ok(root.startsWith(path.resolve(".data") + path.sep));
    await rm(root, { recursive: true, force: true });
  }
});
