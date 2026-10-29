import { test } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { removeOwnedUUIDDirectory } from "../src/owned-directory-cleanup.js";

const runs = path.resolve(".data/test-fixture-reclamation"),
  fixtures = path.resolve(".data/test-runs");
async function record(
  id: string,
  worker: number,
  directory = path.join(fixtures, id),
) {
  const runId = randomUUID(),
    run = path.join(runs, runId),
    token = randomUUID();
  await mkdir(run, { recursive: true });
  await writeFile(
    path.join(run, "manifest.json"),
    JSON.stringify({ owner_pid: process.pid, token }),
  );
  await writeFile(
    path.join(run, id + ".json"),
    JSON.stringify({ id, directory, worker_pid: worker, token }),
  );
  return { runId, run, token };
}
async function reclaim(owned: Awaited<ReturnType<typeof record>>) {
  const child = spawn(
    process.execPath,
    ["--import", "tsx", "scripts/reclaim-test-fixtures.ts"],
    {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: "ignore",
      env: {
        ...process.env,
        COPYPASTE_TEST_RECLAMATION_DIR: owned.run,
        COPYPASTE_TEST_RECLAMATION_TOKEN: owned.token,
      },
    },
  );
  return new Promise<number | null>((resolve, reject) => {
    child.once("close", resolve);
    child.once("error", reject);
  });
}
test(
  "fixture reclamation rejects a live worker and confirms actual removal after that worker exits",
  { timeout: 30000 },
  async () => {
    const id = randomUUID().replaceAll("-", ""),
      directory = path.join(fixtures, id),
      records: Awaited<ReturnType<typeof record>>[] = [];
    await mkdir(directory, { recursive: true });
    await writeFile(
      path.join(directory, "owned.txt"),
      "owned synthetic test fixture",
    );
    const worker = spawn(
      process.execPath,
      ["-e", "process.send('ready');setInterval(()=>{},1000)"],
      { windowsHide: true, stdio: ["ignore", "ignore", "ignore", "ipc"] },
    );
    const closed = new Promise<void>((resolve, reject) => {
      worker.once("close", () => resolve());
      worker.once("error", reject);
    });
    await new Promise<void>((resolve, reject) => {
      worker.once("message", () => resolve());
      worker.once("error", reject);
    });
    try {
      const first = await record(id, worker.pid!);
      records.push(first);
      assert.equal(await reclaim(first), 1);
      const failed = JSON.parse(
        await readFile(path.join(first.run, "result.json"), "utf8"),
      );
      assert.equal(failed.status, "failed");
      assert.equal(failed.workers_exited, false);
      assert.equal(failed.results[0].reclaimed, false);
      await access(path.join(directory, "owned.txt"));
      worker.kill();
      await closed;
      const second = await record(id, worker.pid!);
      records.push(second);
      assert.equal(await reclaim(second), 0);
      const passed = JSON.parse(
        await readFile(path.join(second.run, "result.json"), "utf8"),
      );
      assert.equal(passed.status, "passed");
      assert.equal(passed.workers_exited, true);
      assert.equal(passed.actual_filesystem_checked, true);
      assert.equal(passed.results[0].reclaimed, true);
      await assert.rejects(access(directory), (e: any) => e.code === "ENOENT");
    } finally {
      if (worker.exitCode === null) worker.kill();
      await closed;
      await removeOwnedUUIDDirectory(fixtures, id);
      for (const item of records)
        await removeOwnedUUIDDirectory(runs, item.runId);
    }
  },
);
test(
  "fixture reclamation refuses a record whose target differs from its owned UUID child",
  { timeout: 15000 },
  async () => {
    const id = randomUUID().replaceAll("-", ""),
      other = randomUUID().replaceAll("-", ""),
      directory = path.join(fixtures, other);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "retained.txt"), "must be retained");
    const owned = await record(id, process.pid, directory);
    try {
      assert.equal(await reclaim(owned), 1);
      await access(path.join(directory, "retained.txt"));
      await assert.rejects(
        access(path.join(owned.run, "result.json")),
        (e: any) => e.code === "ENOENT",
      );
    } finally {
      await removeOwnedUUIDDirectory(fixtures, other);
      await removeOwnedUUIDDirectory(runs, owned.runId);
    }
  },
);
