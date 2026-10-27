import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, copyFile, writeFile, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
const source = process.env.COPYPASTE_LOCAL_CODEX_BIN;
assert.ok(source && path.isAbsolute(source), "Set COPYPASTE_LOCAL_CODEX_BIN to the explicit locked native codex.exe. No PATH lookup or download is performed.");
assert.equal(process.platform, "win32");
const lock = JSON.parse(await readFile("contracts/local-codex-runtime.json"));
const input = await realpath(source), output = path.resolve(".data/runtime/windows-x64"), sha = bytes => createHash("sha256").update(bytes).digest("hex");
assert.equal(sha(await readFile(input)), lock.windows_x64_sha256, "Native Codex differs from the product lock");
assert.equal(execFileSync(input, ["--version"], { encoding: "utf8", windowsHide: true }).trim(), "codex-cli " + lock.runtime_version);
await mkdir(output, { recursive: true });
const files = {};
for (const name of ["codex.exe", "codex-command-runner.exe", "codex-windows-sandbox-setup.exe", "codex-code-mode-host.exe"]) {
  const file = path.join(path.dirname(input), name), bytes = await readFile(file);
  assert.ok(bytes.length > 100000, "Incomplete native helper");
  const target = path.join(output, name); if (path.resolve(file).toLowerCase() !== target.toLowerCase()) await copyFile(file, target);
  files[name] = { sha256: sha(bytes), bytes: bytes.length };
  assert.equal(sha(await readFile(target)), files[name].sha256);
}
await writeFile(path.join(output, "runtime-manifest.json"), JSON.stringify({ runtime: lock.runtime_version, platform: "windows-x64", files }, null, 2) + "\n");
console.log(JSON.stringify({ status: "prepared", runtime: lock.runtime_version, destination: ".data/runtime/windows-x64", files }));
