import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { CodeWorkspace } from "../src/code-workspace.js";
import { unzipSync } from "fflate";
test("source tools reject escaped paths and blind overwrites, package actual UTF-8 sources", async () => {
  const parent = path.resolve(".data/test/code");
  await (await import("node:fs/promises")).mkdir(parent, { recursive: true });
  const dir = await mkdtemp(path.join(parent, "task-"));
  try {
    const w = new CodeWorkspace(dir);
    for (const p of [
      "../outside",
      "C:\\secret",
      ".env",
      ".git/config",
      "sub/../../escape",
    ])
      await assert.rejects(w.write(p, "bad"));
    await w.write("src/index.ts", 'export const greeting="你好";');
    await assert.rejects(w.write("src/index.ts", "overwrite"));
    const old = await w.read("src/index.ts");
    await w.write(
      "src/index.ts",
      'export const greeting="新可能";',
      old.sha256,
    );
    const zip = await w.bundle(),
      files = unzipSync(zip.bytes);
    assert.match(Buffer.from(files["src/index.ts"]).toString(), /新可能/);
    assert.equal(
      JSON.parse(Buffer.from(files["copypaste-manifest.json"]).toString())
        .execution_validation,
      "not_executed",
    );
  } finally {
    if (path.dirname(dir) !== parent)
      throw new Error("Unexpected test cleanup target");
    await rm(dir, { recursive: true, force: true });
  }
});
