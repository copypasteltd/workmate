import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { lstat } from "node:fs/promises";
import path from "node:path";
import { ErasureService } from "../src/erasure.js";
import { hash } from "../src/lib.js";
import { s, fixture, handoff, completed, returned, ok, call } from "./task-local-handoff-fixture-147-v2.js";

// Real HTTP uploads, stored bytes and erasure jobs; the imported native fixture
// reports control-plane completion only. These tests do not prove OS execution.
type F = Awaited<ReturnType<typeof fixture>>;
const csv = Buffer.from("campaign,clicks\nlaunch,42\n");
async function upload(f: F, extra: Record<string, unknown> = {}, bytes = csv) {
  const result = await call(s, f.web, "POST", f.base + "/uploads", {
    project_id: f.project, source_task_id: f.task.id, filename: "customer-selected.csv",
    content_type: "text/csv", size_bytes: bytes.length, sha256: hash(bytes), ...extra,
  });
  assert.equal(result.status, 201, JSON.stringify(result.data));
  const id: string = result.data.upload_id, url = f.base + "/uploads/" + id;
  await ok(s, f.web, "POST", url + "/parts/0", { sha256: hash(bytes), base64: bytes.toString("base64") });
  const asset = await ok(s, f.web, "POST", url + "/complete", { sha256: hash(bytes), size_bytes: bytes.length });
  return { id, url, asset };
}
async function shared(f: F): Promise<F> {
  const task = await ok(s, f.web, "POST", f.base + "/tasks", {
    title: "Shared customer input", prompt: "Read the explicitly selected shared campaign CSV.",
    role_key: "assistant", budget_micros: 1000000,
    dependencies: [{ kind: "file", description: "Prepare the selected campaign CSV locally." }],
  });
  assert.equal(task.private_owner, null);
  const dep = (await ok(s, f.web, "GET", f.base + "/tasks/" + task.id + "/dependencies")).items[0];
  return { ...f, fields: { ...f.fields, local_session_id: randomUUID() }, task, dep,
    requestURL: f.base + "/tasks/" + task.id + "/local-handoffs" };
}
async function erase(f: F, assetId: string) {
  const result = await call(s, f.web, "POST", f.base + "/deletions", {
    target_type: "asset", target_id: assetId, reason: "Customer explicitly deletes the selected upload",
  });
  assert.equal(result.status, 202, JSON.stringify(result.data));
  await drain(f);
  const job = (await s.db.control.query("SELECT * FROM deletion_jobs WHERE id=$1", [result.data.id])).rows[0];
  assert.equal(job.state, "completed", JSON.stringify(job.exceptions));
  assert.equal((await s.db.control.query("SELECT count(*)::int n FROM deletion_items WHERE job_id=$1 AND state<>'completed'", [job.id])).rows[0].n, 0);
  return job;
}
async function drain(f: F) {
  const service = new ErasureService(s.db, s.storage);
  for (let i = 0; i < 3; i++) {
    await s.db.control.query("UPDATE deletion_jobs SET next_attempt_at=now() WHERE tenant_id=$1 AND state='queued'", [f.tenant]);
    await service.advance(40);
  }
}
async function receipt(id: string) {
  return (await s.db.control.query("SELECT id,state,filename,result,source_task_id,expires_at FROM upload_sessions WHERE id=$1", [id])).rows[0];
}
async function removed(id: string, key: string) {
  await assert.rejects(s.storage.get(key), (e: any) => e.code === "ENOENT");
  await assert.rejects(lstat(path.join(s.db.config.DATA_DIR, "uploads", id)), (e: any) => e.code === "ENOENT");
}
const retired = (r: any) => {
  assert.equal(r.state, "cancelled"); assert.equal(r.filename, "[deleted]"); assert.equal(r.result, null);
};

test("deleting a private returned task input erases its bytes without authorizing unrelated completed receipts", async () => {
  const f = await fixture(), h = await handoff(f), done = await completed(f, h);
  const selected = await upload(f), other = await upload(f, {}, Buffer.from("campaign,clicks\nkept,7\n"));
  assert.equal(selected.asset.private_owner, f.web.id);
  const key = (await s.db.control.query("SELECT storage_key FROM asset_versions WHERE id=$1", [selected.asset.version.id])).rows[0].storage_key;
  assert.deepEqual(await s.storage.get(key), csv);
  await ok(s, f.web, "POST", f.base + "/local-handoffs/" + h.id + "/complete", returned(done.h, [selected.asset.version.id]));
  const money = (await s.db.control.query("SELECT task_id,amount_micros,status,created_at FROM reservations WHERE task_id=ANY($1::uuid[]) ORDER BY task_id", [[f.task.id, done.native.task_id]])).rows;
  const untouched = await receipt(other.id);
  await erase(f, selected.asset.id);
  retired(await receipt(selected.id));
  await removed(selected.id, key);
  assert.deepEqual(await receipt(other.id), untouched);
  assert.equal((await s.db.control.query("SELECT state FROM assets WHERE id=$1", [other.asset.id])).rows[0].state, "active");
  assert.deepEqual((await s.db.control.query("SELECT task_id,amount_micros,status,created_at FROM reservations WHERE task_id=ANY($1::uuid[]) ORDER BY task_id", [[f.task.id, done.native.task_id]])).rows, money);
  assert.notEqual((await call(s, f.web, "POST", selected.url + "/complete", { sha256: hash(csv), size_bytes: csv.length })).status, 200);
  // A deletion journal for the same owner/project and a generic erasure flag
  // do not authorize another live asset's terminal state to be changed.
  await assert.rejects(s.db.tx(async tx => {
    await tx.query("SELECT set_config('app.erasing_content','true',true)");
    await tx.query("UPDATE upload_sessions SET state='cancelled',filename='[deleted]',result=NULL WHERE id=$1", [other.id]);
  }, undefined, true), (e: any) => e.code === "23514" && e.message.includes("RESOURCE_IDENTITY_IMMUTABLE"));
  assert.deepEqual(await receipt(other.id), untouched);
  await assert.rejects(s.db.control.query("UPDATE upload_sessions SET state='pending' WHERE id=$1", [selected.id]), (e: any) => e.code === "23514");
  await assert.rejects(s.db.control.query("UPDATE upload_sessions SET expires_at=expires_at+interval '1 hour' WHERE id=$1", [selected.id]), (e: any) => e.code === "23514");
  await assert.rejects(s.db.control.query("UPDATE upload_sessions SET mime_type='text/plain' WHERE id=$1", [selected.id]), (e: any) => e.code === "23514");
});

test("deleting a shared task input with a later normal upload version erases every matching version and staging receipt", async () => {
  const f = await shared(await fixture()), h = await handoff(f);
  await completed(f, h);
  const first = await upload(f);
  assert.equal(first.asset.private_owner, null);
  const nextBytes = Buffer.from("campaign,clicks\nrevised,84\n");
  const next = await upload(f, { source_task_id: undefined, asset_id: first.asset.id, expected_version: first.asset.current_version }, nextBytes);
  assert.equal(next.asset.id, first.asset.id); assert.equal(next.asset.current_version, 2);
  const versions = (await s.db.control.query("SELECT * FROM asset_versions WHERE asset_id=$1 ORDER BY version", [first.asset.id])).rows;
  assert.equal(versions.length, 2); assert.equal(versions[0].upload_session_id, first.id); assert.equal(versions[1].upload_session_id, next.id);
  await erase(f, first.asset.id);
  retired(await receipt(first.id));
  const ordinary = await receipt(next.id);
  assert.equal(ordinary.source_task_id, null); assert.equal(ordinary.filename, "[deleted]"); assert.equal(ordinary.result, null);
  // Ordinary uploads keep their pre-existing terminal behavior; only the
  // narrowly task-bound upload receives the new erasure cancellation permit.
  assert.equal(ordinary.state, "completed");
  for (const [index, u] of [first, next].entries()) await removed(u.id, versions[index].storage_key);
  const erased = (await s.db.control.query("SELECT erased_at,metadata FROM asset_versions WHERE asset_id=$1", [first.asset.id])).rows;
  assert.ok(erased.every(v => v.erased_at && Object.keys(v.metadata).length === 0));
  assert.equal((await s.db.control.query("SELECT status,content_state FROM tasks WHERE id=$1", [f.task.id])).rows[0].content_state, "active");
});

test("erasing a shared source task retires only its uploads while preserving explicitly shared asset visibility and finance", async () => {
  const f = await shared(await fixture()), h = await handoff(f), done = await completed(f, h), u = await upload(f);
  const key = (await s.db.control.query("SELECT storage_key FROM asset_versions WHERE id=$1", [u.asset.version.id])).rows[0].storage_key;
  await ok(s, f.web, "POST", f.base + "/tasks/" + f.task.id + "/cancel", {});
  const money = (await s.db.control.query("SELECT task_id,amount_micros,status FROM reservations WHERE task_id=ANY($1::uuid[]) ORDER BY task_id", [[f.task.id, done.native.task_id]])).rows;
  await s.db.control.query("UPDATE tasks SET content_state='deleted' WHERE id=$1", [f.task.id]);
  await drain(f);
  retired(await receipt(u.id));
  const job = (await s.db.control.query("SELECT state,exceptions FROM deletion_jobs WHERE target_type='tasks' AND target_id=$1", [f.task.id])).rows[0];
  assert.equal(job.state, "completed", JSON.stringify(job.exceptions));
  await assert.rejects(lstat(path.join(s.db.config.DATA_DIR, "uploads", u.id)), (e: any) => e.code === "ENOENT");
  assert.equal((await s.db.control.query("SELECT state FROM assets WHERE id=$1", [u.asset.id])).rows[0].state, "active");
  assert.deepEqual(await s.storage.get(key), csv);
  assert.deepEqual((await s.db.control.query("SELECT task_id,amount_micros,status FROM reservations WHERE task_id=ANY($1::uuid[]) ORDER BY task_id", [[f.task.id, done.native.task_id]])).rows, money);
  assert.equal((await s.db.control.query("SELECT state FROM task_local_handoffs WHERE id=$1", [h.id])).rows[0].state, "cancelled");
});
