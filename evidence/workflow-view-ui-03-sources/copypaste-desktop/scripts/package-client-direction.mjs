import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { build, Platform, Arch } from "electron-builder";

// This candidate contains the supervisor library, but the product entry point
// still uses the cloud/file-bridge baseline. Do not label it a local Agent UI.
const output = "release/client-direction-70-01";
await assert.rejects(access(output), (error) => error.code === "ENOENT");
await build({
  targets: Platform.WINDOWS.createTarget(["portable", "nsis"], Arch.x64),
  config: { directories: { output } },
});
