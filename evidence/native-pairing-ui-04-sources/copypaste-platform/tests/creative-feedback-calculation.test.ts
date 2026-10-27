import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { freezeCreativeMapping, calculateCreativeFeedback, type CreativeSource, type CreativeMapping } from "../src/creative-feedback-model.js";
import { canonical, hash } from "../src/lib.js";

const project = randomUUID(), tenant = randomUUID(), asset = { id: randomUUID(), asset_id: randomUUID(), version: 1, sha256: hash("image"), name: "Same creative name", mime_type: "image/png" };
function dataset(overrides: Partial<CreativeSource> = {}): CreativeSource {
  return { id: randomUUID(), tenant_id: tenant, project_id: project, source: "meta_ads", currency: "HKD", timezone: "Asia/Hong_Kong",
    rows: [{ date: "2026-10-20", channel: "meta", campaign: "Autumn", entity_id: "ad-1", impressions: 1000, clicks: 100, spend_micros: 10000001, conversions: "1.5", revenue_micros: 30000000 }],
    import_spec: { account_id: "account-1", entity_level: "ad", attribution_definition: "7-day-click", conversion_definition: "purchases" },
    spec_hash: hash("spec"), source_sha256: hash("csv"), source_asset_version_id: null, ...overrides };
}
function mapping(d: CreativeSource, overrides: any = {}, version = asset): CreativeMapping {
  const input = { name: "User-confirmed identity", asset_version_id: version.id, dataset_id: d.id, channel: d.rows[0].channel, campaign: "Autumn", ad_id: "ad-1", creative_id: "creative-1",
    date_from: "2026-10-20", date_to: "2026-10-21", match_source: "manual" as const, match_note: "Confirmed a single creative throughout the ad period", allocation: "single_creative_entire_ad" as const, ...overrides };
  return { id: randomUUID(), version: 2, state: "confirmed", confirmed_by: randomUUID(), confirmed_at: "2026-10-24T00:00:00Z", body: freezeCreativeMapping(input, d, version) };
}
function calculate(m: CreativeMapping[], d: CreativeSource[]) {
  return calculateCreativeFeedback(randomUUID(), { name: "Bound evidence", mapping_ids: m.map(x => x.id), date_from: "2026-10-20", date_to: "2026-10-21" }, m, d);
}
test("same names never merge different accounts, currencies, platforms or attribution definitions", () => {
  const a = dataset(), b = dataset({ import_spec: { ...a.import_spec, account_id: "account-2" } }), c = dataset({ currency: "USD" }),
    d = dataset({ source: "google_ads", rows: a.rows.map(r => ({ ...r, channel: "google" })) }), e = dataset({ import_spec: { ...a.import_spec, attribution_definition: "1-day-view" } });
  const sources = [a, b, c, d, e], result = calculate(sources.map(s => mapping(s)), sources);
  assert.equal(result.groups.length, 5);
  assert.ok(result.groups.every(g => g.metrics.exact.spend === "10.00000100"));
  assert.ok(!("total" in result));
});
test("overlapping immutable snapshots count identical daily facts once and retain both mapping origins", () => {
  const a = dataset(), b = dataset(), ma = mapping(a), mb = mapping(b), result = calculate([ma, mb], [a, b]);
  assert.equal(result.groups.length, 1); assert.equal(result.deduplicated_rows, 1);
  assert.equal(result.groups[0].metrics.exact.spend, "10.00000100");
  assert.equal(result.groups[0].mapping_ids.length, 2); assert.equal(result.groups[0].dataset_ids.length, 2);
  assert.deepEqual(result.groups[0].observed_days, ["2026-10-20"]);
});
test("changed daily facts or two creative versions for one measured ad-day reject instead of double allocation", () => {
  const a = dataset(), b = dataset({ rows: a.rows.map(r => ({ ...r, clicks: r.clicks + 1 })) });
  assert.throws(() => calculate([mapping(a), mapping(b)], [a, b]), { code: "CREATIVE_OVERLAPPING_FACTS" });
  const c = dataset(), other = { ...asset, id: randomUUID(), version: 2, sha256: hash("revised image") };
  assert.throws(() => calculate([mapping(a), mapping(c, {}, other)], [a, c]), { code: "CREATIVE_OVERLAPPING_FACTS" });
  assert.throws(() => calculate([mapping(a), mapping(c, { creative_id: "creative-2" })], [a, c]), { code: "CREATIVE_OVERLAPPING_FACTS" });
});
test("source mutation, corrected-parent overlap and pending or withdrawn confirmation cannot reuse frozen evidence", () => {
  const a = dataset(), m = mapping(a), changed = { ...a, rows: a.rows.map(r => ({ ...r, spend_micros: 1 })) };
  assert.throws(() => calculate([m], [changed]), { code: "CREATIVE_SOURCE_CHANGED" });
  const corrected = dataset({ supersedes_id: a.id });
  assert.throws(() => calculate([m, mapping(corrected)], [a, corrected]), { code: "CREATIVE_CORRECTION_OVERLAP" });
  for (const state of ["candidate", "withdrawn"]) assert.throws(() => calculate([{ ...m, state }], [a]), { code: "CREATIVE_CONFIRMATION_REQUIRED" });
  const original = canonical(m.body);
  calculate([m], [a]); assert.equal(canonical(m.body), original);
});
