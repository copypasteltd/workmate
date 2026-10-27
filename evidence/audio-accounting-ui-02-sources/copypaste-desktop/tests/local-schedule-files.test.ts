import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile, readFile, rm, rename, symlink, open } from "node:fs/promises";
import { directoryIdentity, selectedInput, stableFile, scanFiles, prepareSnapshot, verifyDirectory, scheduleLimits } from "../src/local-schedule-files.js";
const guard = async () => {};
async function fixture() {
  const parent = path.resolve(".data/schedule-file-tests"); await mkdir(parent, { recursive: true });
  const folder = await mkdtemp(path.join(parent, "owned-")), workspace = path.join(folder, "workspace"), outside = path.join(folder, "outside");
  await mkdir(workspace); await mkdir(outside); await writeFile(path.join(outside, "private.txt"), "Not selected");
  return { workspace, outside, clean: async () => { assert.equal(path.dirname(folder), parent); await rm(folder, { recursive: true, force: true }); } };
}
test("folder scans exclude product outputs and dependencies, enforce file extensions and preserve exact source bytes", async () => {
  const f = await fixture(); try {
    await writeFile(path.join(f.workspace, "source.csv"), Buffer.from([0xef, 0xbb, 0xbf, 0x61, 0x0a])); await writeFile(path.join(f.workspace, "ignore.bin"), "ignored");
    for (const name of [".copypaste-local-jobs", ".git", "node_modules"]) { await mkdir(path.join(f.workspace, name)); await writeFile(path.join(f.workspace, name, "never.csv"), "ignored"); }
    const root = await directoryIdentity(f.workspace), files = await scanFiles(root, [".csv"], guard);
    assert.equal(files.length, 1); assert.equal(files[0].path, "source.csv");
    const rule = randomUUID(), job = randomUUID(), prepared = await prepareSnapshot(root, root, rule, job, files[0], guard);
    assert.deepEqual(await readFile(path.join(f.workspace, prepared.source)), await readFile(path.join(f.workspace, "source.csv")));
    assert.equal((await scanFiles(root, [".csv"], guard)).length, 1);
    assert.deepEqual(await prepareSnapshot(root, root, rule, job, files[0], guard), prepared);
    await writeFile(path.join(f.workspace, prepared.source), "tampered");
    await assert.rejects(prepareSnapshot(root, root, rule, job, files[0], guard), { code: "LOCAL_SCHEDULE_FILE_CONFLICT" });
  } finally { await f.clean(); }
});
test("outside, absolute, traversal, UNC and junction inputs cannot acquire a source snapshot", async () => {
  const f = await fixture(); try {
    const root = await directoryIdentity(f.workspace);
    await assert.rejects(selectedInput(root, f.outside));
    for (const relative of ["../outside/private.txt", path.join(f.outside, "private.txt"), "\\\\server\\share\\file.txt", "private.txt:stream"])
      await assert.rejects(stableFile(root, relative, guard));
    await symlink(f.outside, path.join(f.workspace, "linked"), "junction");
    await assert.rejects(selectedInput(root, path.join(f.workspace, "linked")));
    await assert.rejects(scanFiles(root, [".txt"], guard), { code: "LOCAL_SCHEDULE_LINK_REJECTED" });
    assert.equal(await readFile(path.join(f.outside, "private.txt"), "utf8"), "Not selected");
  } finally { await f.clean(); }
});
test("a replaced root and a file modified while its handle is being read fail before dispatch", async () => {
  const f = await fixture(); try {
    const root = await directoryIdentity(f.workspace); await writeFile(path.join(f.workspace, "source.txt"), "original");
    let checks = 0;
    await assert.rejects(stableFile(root, "source.txt", async () => { if (++checks === 2) await writeFile(path.join(f.workspace, "source.txt"), "a new file body"); }), { code: "LOCAL_SCHEDULE_FILE_CONFLICT" });
    await rename(f.workspace, f.workspace + "-old"); await mkdir(f.workspace);
    await assert.rejects(verifyDirectory(root), { code: "LOCAL_SCHEDULE_DIRECTORY_CHANGED" });
  } finally { await f.clean(); }
});
test("a source replaced after enqueue and an oversized sparse file cannot be prepared", async () => {
  const f = await fixture(); try {
    const root = await directoryIdentity(f.workspace); await writeFile(path.join(f.workspace, "source.txt"), "original");
    const first = (await stableFile(root, "source.txt", guard)).fingerprint;
    await rename(path.join(f.workspace, "source.txt"), path.join(f.workspace, "old.txt")); await writeFile(path.join(f.workspace, "source.txt"), "original");
    await assert.rejects(prepareSnapshot(root, root, randomUUID(), randomUUID(), first, guard), { code: "LOCAL_SCHEDULE_FILE_CONFLICT" });
    const handle = await open(path.join(f.workspace, "large.txt"), "w"); await handle.truncate(scheduleLimits.fileBytes + 1); await handle.close();
    await assert.rejects(stableFile(root, "large.txt", guard), { code: "LOCAL_SCHEDULE_FILE_INVALID" });
  } finally { await f.clean(); }
});
