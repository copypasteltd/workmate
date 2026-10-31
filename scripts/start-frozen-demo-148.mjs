// First frozen release entry: use the same explicit Codex pin as Desktop.
// Importing the existing controller preserves its native shutdown/port handling.
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";

assert.equal(process.platform, "win32", "This frozen demo runtime is Windows x64");
const root = path.resolve(process.env.COPYPASTE_DEV_ROOT ?? path.join(import.meta.dirname, "../.."));
const desktop = path.join(root, "copypaste-desktop");
const pin = JSON.parse(await readFile(path.join(desktop, "contracts/local-codex-runtime.json"), "utf8"));
const runtime = path.resolve(process.env.COPYPASTE_LOCAL_CODEX_BIN ?? path.join(desktop, ".data/runtime/windows-x64/codex.exe"));
const digest = createHash("sha256").update(await readFile(runtime)).digest("hex");
assert.equal(digest, pin.windows_x64_sha256, "Prepare the frozen Desktop runtime first: npm run runtime:prepare");
const version = execFileSync(runtime, ["--version"], { windowsHide: true, encoding: "utf8", timeout: 20000 }).trim().replace(/^codex-cli\s+/, "");
assert.equal(version, pin.runtime_version);
process.env.CODEX_BIN = runtime;
process.env.CODEX_VERSION = version;
console.log(`Frozen development runtime verified: Codex ${version}. Synthetic AI dependencies stay on loopback.`);
if (!process.argv.includes("--check")) {
  if (!process.argv.includes("--demo")) process.argv.push("--demo");
  await import("./dev.mjs");
}
