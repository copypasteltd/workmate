import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { displayExact, exactScaled, barWidths, comparisonNotes, reviewGroups } from "../renderer/src/analysis-review-model.ts";
import { validAnalysisPending, keepAnalysisPending, readAnalysisPending, forgetAnalysisPending, clearAnalysisPending, uncertainAnalysisResult } from "../renderer/src/analysis-request-state.ts";
import { readReviewBlob } from "../renderer/src/review-download.ts";
test("eight-decimal facts display exact money, negative changes and percentage ratios without unsafe floating-point conversion", () => {
  assert.equal(exactScaled("-0.00000001"), -1n);
  assert.equal(displayExact("9007199254740993.12567800", "spend", "HKD"), "HKD 9,007,199,254,740,993.13");
  assert.equal(displayExact("-0.12345678", "spend", "HKD", true), "−12.35%");
  assert.equal(displayExact("0.12345678", "ctr", "HKD"), "12.35%");
  assert.equal(displayExact("2.12500000", "roas", "USD"), "2.13×");
  assert.equal(displayExact(null, "spend", "HKD"), "—");
  assert.throws(() => exactScaled("NaN")); assert.throws(() => exactScaled("1.000000001"));
  assert.deepEqual(barWidths("9007199254740993.00000000", "4503599627370496.50000000"), [100, 50]);
  assert.deepEqual(barWidths("0", null), [0, 0]);
});
test("all scopes remain searchable and sortable beyond the old twelve-entry preview, preserving source indices and unknown values", () => {
  const groups = Array.from({ length: 27 }, (_, i) => ({ scope: { source: "google_ads", currency: i % 2 ? "USD" : "HKD", campaign: "Campaign " + i }, periods: { current: { summary: { exact: { spend: i === 26 ? null : String(i) + ".00000000" } } }, comparison: { summary: { exact: { spend: "1.00000000" } } } } }));
  assert.equal(reviewGroups(groups, "Campaign 26", "spend", "source", false)[0].index, 26);
  assert.equal(reviewGroups(groups, "", "spend", "high", false)[0].index, 25);
  assert.equal(reviewGroups(groups, "", "spend", "high", false).at(-1)?.index, 26);
  assert.deepEqual(reviewGroups(groups, "", "spend", "source", true).map(x => x.index), [26]);
  assert.equal(reviewGroups(groups, "USD", "spend", "source", false).length, 13);
  assert.deepEqual(comparisonNotes({ date_from: "2026-10-01", date_to: "2026-10-10", comparison: { date_from: "2026-10-05", date_to: "2026-10-07" } }), ["overlapping_periods", "unequal_periods"]);
});
test("a paid request retains its original key and complete body across reopening, partitions owners and clears only explicitly", () => {
  const map = new Map<string, string>(); const store = { getItem: (k: string) => map.get(k) ?? null, setItem: (k: string, v: string) => { map.set(k, v); }, removeItem: (k: string) => { map.delete(k); }, key: (i: number) => [...map.keys()][i] ?? null, get length() { return map.size; } };
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: store });
  const actor = randomUUID(), tenant = randomUUID(), project = randomUUID(), scope = [actor, tenant, project].join(":"), request = { schema: 1 as const, at: Date.now(), key: randomUUID(), body: { project_id: project, agent_id: randomUUID(), expected_calculation_sha256: "a".repeat(64), budget: { currency: "HKD", amount_micros: "1000000" }, analysis: { prompt: "Review exact evidence", snapshot_ids: [randomUUID()], metrics: ["spend"], dimensions: [], timezone: "Asia/Hong_Kong", date_from: "2026-10-01", date_to: "2026-10-02" } } };
  keepAnalysisPending(scope, request); assert.deepEqual(readAnalysisPending(scope), request);
  assert.equal(readAnalysisPending([randomUUID(), tenant, project].join(":")), null);
  assert.equal(validAnalysisPending({ ...request, body: { ...request.body, project_id: randomUUID() } }, scope), false);
  assert.equal(uncertainAnalysisResult({ status: 503 }), true); assert.equal(uncertainAnalysisResult({ status: 0 }), true); assert.equal(uncertainAnalysisResult({ status: 401 }), true); assert.equal(uncertainAnalysisResult({ status: 409, code: "ANALYSIS_PREVIEW_CHANGED" }), false);
  // Old unknown outcomes stay locked rather than silently expiring into a new paid request.
  const old = { ...request, at: Date.now() - 30 * 86400000 }; keepAnalysisPending(scope, old); assert.deepEqual(readAnalysisPending(scope), old);
  forgetAnalysisPending(scope); assert.equal(readAnalysisPending(scope), null); keepAnalysisPending(scope, request); map.set("unrelated", "preserve"); clearAnalysisPending(); assert.equal(readAnalysisPending(scope), null); assert.equal(map.get("unrelated"), "preserve");
  Object.defineProperty(globalThis, "sessionStorage", { configurable: true, value: { ...store, setItem: () => { throw new Error("Storage blocked"); } } });
  assert.throws(() => keepAnalysisPending(scope, request), /Storage blocked/);
});
test("review downloads bound streamed bytes and reject size mismatches and stale sessions before saving", async () => {
  assert.equal(await (await readReviewBlob(new Response("actual bytes", { headers: { "content-length": "12" } }), () => {})).text(), "actual bytes");
  await assert.rejects(readReviewBlob(new Response("small", { headers: { "content-length": String(8 * 1024 ** 2 + 1) } }), () => {}), /limit/);
  await assert.rejects(readReviewBlob(new Response("actual", { headers: { "content-length": "1" } }), () => {}), /mismatch/);
  await assert.rejects(readReviewBlob(new Response("actual"), () => { throw Error("Session changed"); }), /Session changed/);
  await assert.rejects(readReviewBlob(new Response(new Uint8Array(8 * 1024 ** 2 + 1)), () => {}), /limit/);
});
