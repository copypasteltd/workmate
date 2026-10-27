import { test } from "node:test";
import assert from "node:assert/strict";
import { BrowserResources } from "../src/browser-resources.js";
const gate = () => { let resolve!: () => void; const promise = new Promise<void>(done => { resolve = done; }); return { promise, resolve }; };

test("two actual contexts are reserved before asynchronous reset and reused without creating extra contexts", async () => {
  const reset = gate(), made: number[] = [];
  const resources = new BrowserResources(index => { made.push(index); return { index }; }, () => reset.promise);
  const first = resources.acquire("task-a"), second = resources.acquire("task-b");
  await assert.rejects(resources.acquire("task-c"), { code: "BROWSER_CONTEXT_LIMIT" });
  assert.deepEqual(made, [0, 1]); reset.resolve();
  const a = await first, b = await second; await resources.release(a);
  const c = await resources.acquire("task-c"); assert.equal(c.value, a.value); assert.deepEqual(made, [0, 1]);
  await resources.release(b); await resources.release(c);
});

test("normal pages and popups across drivers share a three-page task quota until actual page destruction", async () => {
  const resources = new BrowserResources(index => index, async () => {});
  const a = await resources.acquire("one-task"), b = await resources.acquire("one-task");
  const releases = [resources.page(a), resources.page(b), resources.page(a)];
  assert.equal(resources.canOpen(a), false); assert.equal(resources.canOpen(b), false);
  assert.throws(() => resources.page(b), { code: "BROWSER_TAB_LIMIT" });
  await assert.rejects(resources.release(a), { code: "BROWSER_PAGES_STILL_OWNED" });
  releases[0](); releases[0](); assert.equal(resources.canOpen(b), true);
  const popup = resources.page(b); assert.equal(resources.canOpen(a), false);
  releases[1](); releases[2](); popup(); await resources.release(a); await resources.release(b);
});

test("context release excludes opens and new owners while storage cleanup remains pending", async () => {
  let resetCount = 0; const clearing = gate();
  const resources = new BrowserResources(index => index, async () => { if (++resetCount === 3) await clearing.promise; });
  const a = await resources.acquire("a"), b = await resources.acquire("b"), closing = resources.release(a);
  assert.equal(resources.canOpen(a), false); assert.throws(() => resources.page(a), { code: "BROWSER_TAB_LIMIT" });
  await assert.rejects(resources.acquire("c"), { code: "BROWSER_CONTEXT_LIMIT" });
  const sameClose = resources.release(a); clearing.resolve(); await Promise.all([closing, sameClose]);
  const c = await resources.acquire("c"), release = resources.page(c);
  await resources.release(a); assert.equal(resources.canOpen(c), true);
  release(); await resources.release(c); await resources.release(b); assert.equal(resetCount, 6);
});

test("failed initial or final storage cleanup quarantines the actual context instead of leaking old task data", async () => {
  let count = 0; const made: number[] = [];
  const resources = new BrowserResources(index => { made.push(index); return index; }, async () => { if (++count === 1 || count === 3) throw new Error("Storage cleanup failed"); });
  await assert.rejects(resources.acquire("first"), /Storage cleanup failed/);
  const second = await resources.acquire("second"); await assert.rejects(resources.release(second), /Storage cleanup failed/);
  assert.equal(resources.canOpen(second), false); await assert.rejects(resources.acquire("third"), { code: "BROWSER_CONTEXT_LIMIT" });
  assert.deepEqual(made, [0, 1]);
});
