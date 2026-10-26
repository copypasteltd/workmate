import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { Storage } from "../src/storage.js";
import { loadConfig } from "../src/config.js";

async function fixture(
  run: (storage: Storage, directory: string) => Promise<void>,
) {
  const base = path.resolve(".data"),
    directory = path.join(base, "orphan-race-" + randomUUID());
  assert.equal(path.dirname(directory), base);
  await fs.mkdir(directory, { recursive: true });
  try {
    await run(
      new Storage({
        ...loadConfig(),
        DATA_DIR: directory,
        S3_BUCKET: undefined,
      }),
      directory,
    );
  } finally {
    assert.equal(path.dirname(path.resolve(directory)), base);
    await fs.rm(directory, {
      recursive: true,
      force: true,
      maxRetries: 3,
      retryDelay: 100,
    });
  }
}

test("orphan scan survives an actual unlink between enumeration and stat and still returns the other candidate", async () => {
  await fixture(async (storage, directory) => {
    const deleted = await storage.put(
        Buffer.from("deleted concurrently"),
        "text/plain",
      ),
      retained = await storage.put(Buffer.from("other orphan"), "text/plain"),
      target = path.resolve(directory, deleted),
      original = fs.lstat;
    let removed = false;
    fs.lstat = (async (file: any, ...options: any[]) => {
      if (file === target && !removed) {
        removed = true;
        await fs.unlink(target);
      }
      return (original as any)(file, ...options);
    }) as typeof fs.lstat;
    syncBuiltinESMExports();
    try {
      assert.deepEqual(
        await storage.orphanCandidates(new Date(Date.now() + 1000)),
        [retained],
      );
      assert.equal(removed, true);
      await assert.rejects(fs.access(target), { code: "ENOENT" });
    } finally {
      fs.lstat = original;
      syncBuiltinESMExports();
    }
  });
});

test("orphan scan propagates permission and busy-storage failures instead of treating them as completed deletion", async () => {
  await fixture(async (storage, directory) => {
    const key = await storage.put(Buffer.from("must remain"), "text/plain"),
      target = path.resolve(directory, key),
      original = fs.lstat;
    for (const code of ["EACCES", "EBUSY"]) {
      fs.lstat = (async (file: any, ...options: any[]) => {
        if (file === target)
          throw Object.assign(new Error("controlled storage fault"), { code });
        return (original as any)(file, ...options);
      }) as typeof fs.lstat;
      syncBuiltinESMExports();
      try {
        await assert.rejects(
          storage.orphanCandidates(new Date(Date.now() + 1000)),
          { code },
        );
        assert.equal(await fs.readFile(target, "utf8"), "must remain");
      } finally {
        fs.lstat = original;
        syncBuiltinESMExports();
      }
    }
  });
});
