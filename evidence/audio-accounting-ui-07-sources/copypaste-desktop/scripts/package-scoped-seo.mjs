import assert from "node:assert/strict";
import { access } from "node:fs/promises";
import { build, Platform, Arch } from "electron-builder";

// Keep every previously reviewed package intact, including failed candidates.
const output = "release/scoped-seo-62-02";
await assert.rejects(access(output), (error) => error.code === "ENOENT");
await build({
  targets: Platform.WINDOWS.createTarget(["portable", "nsis"], Arch.x64),
  config: { directories: { output } },
});
