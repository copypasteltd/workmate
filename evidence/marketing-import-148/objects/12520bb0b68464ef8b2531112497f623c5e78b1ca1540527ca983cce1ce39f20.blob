import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, readFile, writeFile, readdir, rm } from "node:fs/promises";
import { randomUUID, createHash } from "node:crypto";
import { saveDownload } from "../src/download.js";
test("streamed downloads verify bytes and digest, reject overwrite and remove temporary files after failures", async () => {
  const root = path.resolve(".data/test/download", randomUUID());
  await mkdir(root, { recursive: true });
  const bytes = Buffer.from("Verified native download");
  const response = (
    b = bytes,
    sha = createHash("sha256").update(bytes).digest("hex"),
  ) =>
    new Response(b, {
      headers: { "content-length": String(b.length), "x-content-sha256": sha },
    });
  try {
    await saveDownload(response(), path.join(root, "valid.txt"));
    assert.deepEqual(await readFile(path.join(root, "valid.txt")), bytes);
    await assert.rejects(
      saveDownload(response(), path.join(root, "wrong.txt"), 2),
      /exceeds/,
    );
    await assert.rejects(
      saveDownload(
        response(bytes, "0".repeat(64)),
        path.join(root, "corrupted.txt"),
      ),
      /checksum/,
    );
    await writeFile(path.join(root, "existing.txt"), "Preserve existing file");
    await assert.rejects(
      saveDownload(response(), path.join(root, "existing.txt")),
      { code: "EEXIST" },
    );
    assert.equal(
      (await readFile(path.join(root, "existing.txt"))).toString(),
      "Preserve existing file",
    );
    assert.deepEqual((await readdir(root)).sort(), [
      "existing.txt",
      "valid.txt",
    ]);
  } finally {
    const allowed = path.resolve(".data/test/download");
    if (path.dirname(root) !== allowed)
      throw new Error("Cleanup escaped test directory");
    await rm(root, { recursive: true, force: true });
  }
});
