import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { connectorFact, connectorQuery, fact } from "../src/connector-model.js";
import { canonical, hash } from "../src/lib.js";
import {
  calculateWebAnalytics, checkedWebSnapshot, renderWebAnalytics, webAnalyticsOptions,
  webAnalyticsPage, type WebAnalyticsSelection,
} from "../src/web-analytics.js";

function fixture(profile: WebAnalyticsSelection["profile"] = "ga4_traffic") {
  const project = randomUUID(), q = connectorQuery.parse({
    provider: profile === "search_performance" ? "search_console" : "ga4", api_version: "v1beta",
    account: { account_id: profile === "search_performance" ? "sc-domain:example.hk" : "201", name: "Hong Kong website",
      timezone: profile === "search_performance" ? "America/Los_Angeles" : "Asia/Hong_Kong",
      currency: profile === "search_performance" ? null : "HKD", readable: true, kind: profile === "search_performance" ? "site" : "property",
      login_customer_id: null, reporting_identity: "BLENDED", reporting_identity_source: "provider", permission_level: null },
    profile, date_from: "2026-10-01", date_to: "2026-10-07", page_size: 100, version: "marketing-read/1.0.0",
  });
  const specification = { queries: [q], project_ids: [project] };
  const facts = profile === "ga4_traffic" ? [
    fact(q, "2026-10-01", { sessionDefaultChannelGroup: "Organic Search", landingPagePlusQueryString: "/" }, { sessions: "10", totalUsers: "8", screenPageViews: "20", keyEvents: "1", totalRevenue: "10.000000000001" }),
    fact(q, "2026-10-02", { sessionDefaultChannelGroup: "Paid Search", landingPagePlusQueryString: "/offer" }, { sessions: "30", totalUsers: "7", screenPageViews: "100", keyEvents: "9", totalRevenue: "-20" }),
  ] : profile === "ga4_events" ? [
    fact(q, "2026-10-01", { eventName: "purchase" }, { eventCount: "2", totalUsers: "2", keyEvents: "2" }),
    fact(q, "2026-10-02", { eventName: "page_view" }, { eventCount: "200", totalUsers: "100", keyEvents: "0" }),
  ] : [
    fact(q, "2026-10-01", { query: "香港品牌", page: "https://example.hk/", country: "hkg", device: "MOBILE" }, { clicks: "1", impressions: "10", ctr: "0.9", position: "2" }),
    fact(q, "2026-10-02", { query: "企業網站", page: "https://example.hk/", country: "hkg", device: "DESKTOP" }, { clicks: "99", impressions: "990", ctr: "0.7", position: "10" }),
  ];
  const body = { schema: "copypaste-connector-snapshot-1" as const, source_mode: "simulated" as const,
    spec_hash: hash(canonical(specification)), specification, facts, limitations: [], captured_at: "2026-10-27T01:00:00.000Z", data_as_of: null };
  const bytes = Buffer.from(JSON.stringify(body)), row = { id: randomUUID(), sha256: hash(bytes), spec_hash: body.spec_hash,
    state: "complete", data_mode: "simulated", row_count: facts.length, project_id: project };
  const selection: WebAnalyticsSelection = { profile, account_id: q.account.account_id, date_from: q.date_from, date_to: q.date_to, group_by: [] };
  return { q, body, row, bytes, selection };
}
test("GA4 exact observed sums, signed refund revenue, non-additive users and sparse dates", () => {
  const f = fixture(), body = checkedWebSnapshot(f.row, f.bytes), report = calculateWebAnalytics(f.row, body, f.selection);
  assert.equal(report.summary.metrics.sessions.value, "40");
  assert.equal(report.summary.metrics.key_events_per_session.value, "0.25");
  assert.equal(report.summary.metrics.totalRevenue.value, "-9.999999999999");
  assert.equal(report.summary.metrics.totalRevenue.unit, "HKD");
  assert.equal(report.summary.metrics.totalUsers.value, null);
  assert.equal(report.summary.metrics.totalUsers.null_reason, "non_additive_unique_users");
  assert.equal(report.coverage.days_without_rows.length, 5);
  assert.equal(report.coverage.missing_dates_are_zero, false);
  assert.equal(report.groups.length, 0);
  assert.equal(report.additional_ai_calls, 0);
  assert.equal(report.additional_ai_charge_micros, "0");
  assert.equal(report.calculation_sha256, calculateWebAnalytics(f.row, body, { ...f.selection }).calculation_sha256);
  const groups = calculateWebAnalytics(f.row, body, { ...f.selection, group_by: ["channel", "date"] });
  assert.deepEqual(groups.groups.map(g => g.metrics.totalUsers.value).sort(), ["7", "8"]);
  assert.equal(groups.calculation_sha256, calculateWebAnalytics(f.row, body, { ...f.selection, group_by: ["date", "channel"] }).calculation_sha256);
});
test("GA4 event reports remain independent and do not invent sessions, revenue or combined unique users", () => {
  const f = fixture("ga4_events"), r = calculateWebAnalytics(f.row, f.body, { ...f.selection, group_by: ["event"] });
  assert.equal(r.summary.metrics.eventCount.value, "202");
  assert.equal(r.summary.metrics.keyEvents.value, "2");
  assert.equal(r.summary.metrics.totalUsers.value, null);
  assert.equal(r.summary.metrics.sessions, undefined);
  assert.equal(r.summary.metrics.totalRevenue, undefined);
  assert.throws(() => calculateWebAnalytics(f.row, f.body, { ...f.selection, group_by: ["channel"] }), (e: any) => e.code === "WEB_ANALYTICS_DIMENSION");
});
test("Search Console recomputes CTR from counts and weights reported positions by impressions", () => {
  const f = fixture("search_performance"), r = calculateWebAnalytics(f.row, f.body, f.selection);
  assert.equal(r.summary.metrics.clicks.value, "100");
  assert.equal(r.summary.metrics.impressions.value, "1000");
  assert.equal(r.summary.metrics.ctr.value, "0.1");
  assert.equal(r.summary.metrics.weighted_position.value, "9.92");
  assert.equal(r.source.timezone, "America/Los_Angeles");
  assert.equal(r.source.currency, null);
  assert.equal(r.summary.metrics.spend, undefined);
  assert.ok(r.limitations.includes("GSC_TOP_ROWS_ONLY_NOT_FULL_COVERAGE"));
  assert.ok(r.limitations.includes("GSC_ANONYMIZED_QUERIES_OMITTED"));
});
test("Missing counts, zero denominators and no rows have distinct null reasons", () => {
  const f = fixture("search_performance");
  const noRows = calculateWebAnalytics(f.row, f.body, { ...f.selection, date_from: "2026-10-07" });
  assert.equal(noRows.summary.metrics.clicks.value, null);
  assert.equal(noRows.summary.metrics.clicks.null_reason, "no_rows");
  f.body.facts[0].metrics.impressions = null;
  const missing = calculateWebAnalytics(f.row, f.body, f.selection);
  assert.equal(missing.summary.metrics.ctr.null_reason, "missing_source_metric");
  assert.equal(missing.summary.metrics.weighted_position.value, null);
  f.body.facts[0].metrics.impressions = "0"; f.body.facts[0].metrics.position = null;
  const ignoredZero = calculateWebAnalytics(f.row, f.body, f.selection);
  assert.equal(ignoredZero.summary.metrics.weighted_position.value, "10");
  f.body.facts[1].metrics.impressions = "0";
  assert.equal(calculateWebAnalytics(f.row, f.body, f.selection).summary.metrics.ctr.null_reason, "zero_denominator");
});
test("Captured dates, accounts, dimensions, currency, source keys and uniqueness are mandatory", () => {
  const f = fixture();
  for (const patch of [{ account_id: "other" }, { profile: "ga4_events" }, { date_from: "2026-09-30" }, { date_to: "2026-11-01" }, { date_from: "2026-10-05", date_to: "2026-10-02" }, { group_by: ["date", "date"] }, { group_by: ["query"] }])
    assert.throws(() => calculateWebAnalytics(f.row, f.body, { ...f.selection, ...patch }));
  for (const mutate of [
    (r: any) => r.facts[0].currency = "USD",
    (r: any) => r.facts[0].timezone = "UTC",
    (r: any) => r.facts[0].key = "0".repeat(64),
    (r: any) => r.facts.push(structuredClone(r.facts[0])),
    (r: any) => r.facts[0].dimensions.extra = "unconfirmed",
  ]) { const body = structuredClone(f.body); mutate(body); assert.throws(() => calculateWebAnalytics(f.row, body, f.selection), (e: any) => e.code === "WEB_ANALYTICS_FACT_SCOPE"); }
});
test("Only GA4 totalRevenue supports signed values; counts and ad spend stay non-negative", () => {
  const f = fixture();
  assert.equal(connectorFact.safeParse(f.body.facts[1]).success, true);
  for (const key of ["sessions", "totalUsers", "keyEvents", "spend"])
    assert.equal(connectorFact.safeParse({ ...f.body.facts[0], metrics: { [key]: "-1" } }).success, false);
  assert.equal(connectorFact.safeParse({ ...f.body.facts[0], profile: "campaign", metrics: { totalRevenue: "-1" } }).success, false);
});
test("Byte, schema, spec, count and project integrity failures cannot produce a report", () => {
  const f = fixture();
  for (const row of [{ ...f.row, sha256: "0".repeat(64) }, { ...f.row, spec_hash: "0".repeat(64) }, { ...f.row, row_count: 99 }, { ...f.row, project_id: randomUUID() }, { ...f.row, state: "failed" }])
    assert.throws(() => checkedWebSnapshot(row, f.bytes), (e: any) => e.code === "CONNECTOR_SNAPSHOT_INTEGRITY");
  const broken = Buffer.from("not-json");
  assert.throws(() => checkedWebSnapshot({ ...f.row, sha256: hash(broken) }, broken), (e: any) => e.code === "CONNECTOR_SNAPSHOT_INTEGRITY");
  const altered = structuredClone(f.body); altered.specification.queries[0].date_to = "2026-10-08";
  assert.throws(() => webAnalyticsOptions(altered), (e: any) => e.code === "CONNECTOR_SNAPSHOT_INTEGRITY");
});
test("Paginated evidence and complete exports retain source/digest, partial warning and escaped labels", () => {
  const f = fixture("search_performance");
  const r = calculateWebAnalytics({ ...f.row, state: "partial" }, f.body, { ...f.selection, group_by: ["query"] });
  assert.ok(r.limitations.includes("WEB_ANALYTICS_PARTIAL_SOURCE"));
  const first = webAnalyticsPage(r, 0, 1), second = webAnalyticsPage(r, 1, 1);
  assert.equal(first.total_groups, 2); assert.equal(first.groups.length, 1); assert.equal(first.next_offset, 1);
  assert.equal(first.calculation_sha256, second.calculation_sha256); assert.equal(second.next_offset, null);
  assert.throws(() => webAnalyticsPage(r, 3, 1));
  assert.equal(JSON.parse(renderWebAnalytics(r, "json", "en-HK").toString()).groups.length, 2);
  const csv = renderWebAnalytics(r, "csv", "en-HK").toString();
  assert.ok(csv.includes(r.source.sha256)); assert.ok(csv.includes(r.calculation_sha256)); assert.ok(csv.includes("sum(clicks)/sum(impressions)"));
  const evil = structuredClone(r); evil.source.account_name = '<img src=x onerror="fetch(1)">';
  const html = renderWebAnalytics(evil, "html", "zh-HK").toString();
  assert.ok(!html.includes("<img")); assert.ok(html.includes("&lt;img")); assert.ok(html.includes("default-src 'none'")); assert.ok(!html.includes("<script"));
});
