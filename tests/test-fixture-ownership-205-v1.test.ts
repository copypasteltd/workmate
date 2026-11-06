import test from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, lstat, rm } from "node:fs/promises";
import { processIsGone, validateFixtureOwner } from "../scripts/test-fixture-ownership.js";
const token = "91c4ab40-8537-457b-948b-8bf862c87d34", id = "a".repeat(32), base = path.resolve(".data/test-runs");
const item = { id, token, directory: path.join(base, id), worker_pid: 123 };
test("interrupted fixture reclamation requires the exact durable owner and child path", () => {
  assert.equal(validateFixtureOwner(item, { token }, base, id + ".json"), item);
  for (const changed of [{ token: "wrong" }, { directory: path.dirname(base) }, { worker_pid: 0 }, { id: "../escape" }])
    assert.throws(() => validateFixtureOwner({ ...item, ...changed }, { token }, base, id + ".json"));
});
test("only a confirmed missing process permits reclamation; live and inaccessible owners remain protected", () => {
  assert.equal(processIsGone(123, (() => true) as any), false);
  assert.equal(processIsGone(123, (() => { throw Object.assign(new Error(), { code: "ESRCH" }); }) as any), true);
  assert.throws(() => processIsGone(123, (() => { throw Object.assign(new Error(), { code: "EPERM" }); }) as any));
  assert.throws(() => processIsGone(-1));
});
test("interrupted workers are actually reclaimed using prior ownership while unrelated and live fixtures remain intact", async () => {
  const dead = spawnSync(process.execPath, ["-e", "process.exit(0)"], { windowsHide: true });
  assert.equal(dead.status, 0); assert.ok(processIsGone(dead.pid));
  for (const live of [false, true]) {
    const runId = randomUUID(), fixtureId = randomUUID().replaceAll("-", ""), otherId = randomUUID().replaceAll("-", ""), run = path.resolve(".data/test-fixture-reclamation", runId), directory = path.join(base, fixtureId), unrelated = path.join(base, otherId), runToken = randomUUID();
    try {
      await mkdir(path.join(run, "owned"), { recursive: true }); await mkdir(directory, { recursive: true }); await mkdir(unrelated, { recursive: true });
      await writeFile(path.join(directory, "owned.txt"), "private synthetic fixture"); await writeFile(path.join(unrelated, "keep.txt"), "unrelated");
      await writeFile(path.join(run, "manifest.json"), JSON.stringify({ owner_pid: dead.pid, token: runToken }));
      await writeFile(path.join(run, "owned", fixtureId + ".json"), JSON.stringify({ id: fixtureId, directory, worker_pid: live ? process.pid : dead.pid, token: runToken }));
      const result = spawnSync(process.execPath, ["--import", "tsx", "scripts/reclaim-test-fixtures-v2.ts"], { windowsHide: true, encoding: "utf8", env: { ...process.env, COPYPASTE_TEST_RECLAMATION_DIR: run, COPYPASTE_TEST_RECLAMATION_TOKEN: runToken, COPYPASTE_TEST_RECOVER_INTERRUPTED: "true" } });
      assert.equal(result.status, live ? 1 : 0, result.stderr);
      const receipt = JSON.parse(await readFile(path.join(run, "result.json"), "utf8")); assert.equal(receipt.results.length, 1); assert.equal(receipt.results[0].reclaimed, !live);
      if (live) assert.ok((await lstat(directory)).isDirectory()); else await assert.rejects(lstat(directory), (error: any) => error.code === "ENOENT");
      assert.equal(await readFile(path.join(unrelated, "keep.txt"), "utf8"), "unrelated");
    } finally { for (const target of [directory, unrelated, run]) await rm(target, { recursive: true, force: true }); }
  }
});

test('reclamation waits for the exact briefly live worker to close without killing it',async()=>{const {spawn}=await import('node:child_process');const dead=spawnSync(process.execPath,['-e','process.exit(0)'],{windowsHide:true});const worker=spawn(process.execPath,['-e','setTimeout(()=>process.exit(0),750)'],{windowsHide:true,stdio:'ignore'});assert.ok(worker.pid);const closed=new Promise<void>(r=>worker.once('close',()=>r()));const runId=randomUUID(),fixtureId=randomUUID().replaceAll('-',''),run=path.resolve('.data/test-fixture-reclamation',runId),directory=path.join(base,fixtureId),runToken=randomUUID();try{await mkdir(path.join(run,'owned'),{recursive:true});await mkdir(directory,{recursive:true});await writeFile(path.join(run,'manifest.json'),JSON.stringify({owner_pid:dead.pid,token:runToken}));await writeFile(path.join(run,'owned',fixtureId+'.json'),JSON.stringify({id:fixtureId,directory,worker_pid:worker.pid,token:runToken}));const p=spawn(process.execPath,['--import','tsx','scripts/reclaim-test-fixtures-v2.ts'],{windowsHide:true,stdio:'ignore',env:{...process.env,COPYPASTE_TEST_RECLAMATION_DIR:run,COPYPASTE_TEST_RECLAMATION_TOKEN:runToken,COPYPASTE_TEST_RECOVER_INTERRUPTED:'true'}});const code=await new Promise(r=>p.once('close',r));assert.equal(code,0);await closed;assert.ok(processIsGone(worker.pid));assert.equal(JSON.parse(await readFile(path.join(run,'result.json'),'utf8')).workers_exited,true);await assert.rejects(lstat(directory),(e:any)=>e.code==='ENOENT');}finally{await closed;for(const target of[directory,run]){assert.ok(target.startsWith(path.resolve('.data')+path.sep));await rm(target,{recursive:true,force:true});}}});
