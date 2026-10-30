import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readRevisionPending, revisionMicros, revisionReference, textRevisionTarget, clearDeliveryRevisionDrafts, revisionDraftPrefix } from "../src/delivery-revision-state.js";

test("HKD revision budgets retain exact micros and reject rounding, exponents, negatives and excessive amounts", () => {
  assert.equal(revisionMicros("0.01"), 10000); assert.equal(revisionMicros("19.99"), 19990000); assert.equal(revisionMicros("10000.00"), 10000000000);
  for (const value of ["0", "-1", "1.001", "1e3", "NaN", "Infinity", "10000.01", " 1", ""]) assert.throws(() => revisionMicros(value));
});
test("browser text selections are translated from UTF-16 to exact Unicode code-point anchors", () => {
  const text = "😀香港😀 original";
  assert.deepEqual(textRevisionTarget(text, 2, 6), { kind: "text", start: 1, end: 4, quote: "香港😀" });
  const version = randomUUID(); assert.equal((textRevisionTarget(text, 2, 6, version) as any).asset_version_id, version);
  assert.throws(() => textRevisionTarget(text, 2, 2)); assert.throws(() => textRevisionTarget("字".repeat(4001), 0, 4001));
});
test("unknown-outcome retry retains the original immutable body and cannot move across task or local/cloud execution", () => {
  const task = randomUUID(), pending = { key: randomUUID(), local: false, body: { source_task_id: task, expected_version: 4, expected_delivery_hash: "a".repeat(64),
    target: { kind: "image", asset_version_id: randomUUID(), x: .1, y: .2, width: .3, height: .4 }, instructions: "Retain this exact original instruction", budget_micros: 1000000 } };
  assert.deepEqual(readRevisionPending(JSON.stringify(pending), task, false), pending);
  assert.equal(readRevisionPending(JSON.stringify(pending), randomUUID(), false), null); assert.equal(readRevisionPending(JSON.stringify(pending), task, true), null);
  for (const patch of [{ budget_micros: -1 }, { expected_delivery_hash: "invalid" }, { expected_version: 0 }, { target: null }])
    assert.equal(readRevisionPending(JSON.stringify({ ...pending, body: { ...pending.body, ...patch } }), task, false), null);
  const ref = revisionReference(pending.body as any); (ref.target as any).x = .9; assert.equal(pending.body.target.x, .1); assert.equal("instructions" in ref, false);
});
test("sign out clears only owned revision drafts and preserves unrelated user data", () => {
  const values = new Map([[revisionDraftPrefix + "a", "secret-a"], ["unrelated-user-key", "keep"], [revisionDraftPrefix + "b", "secret-b"]]);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { get length() { return values.size; }, key: (i: number) => [...values.keys()][i], removeItem: (key: string) => values.delete(key) } });
  try { clearDeliveryRevisionDrafts(); assert.deepEqual([...values.entries()], [["unrelated-user-key", "keep"]]); }
  finally { Reflect.deleteProperty(globalThis, "localStorage"); }
});
