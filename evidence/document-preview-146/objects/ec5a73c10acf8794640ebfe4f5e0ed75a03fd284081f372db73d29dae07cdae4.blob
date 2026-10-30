import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { loadConfig } from "../src/config.js";
import {
  publicationDraft, publicationFormats, publicationSpecification, publicationProtocol, publicationDigest,
  type PublicationFormat, type PublicationSpecification,
} from "../src/publication-model.js";
import { nextPublicationStep, type PublicationEffect, type PublicationProgress } from "../src/publication-plan.js";
import {
  publicationJSON, executePublicationWrite, observePublicationProvider, PublicationProviderFailure,
  publicationSettings, publicationAuthorizationURL,
} from "../src/publication-provider.js";

const sha = "a".repeat(64), key = "b".repeat(64), now = Date.now();
function specification(format: PublicationFormat): PublicationSpecification {
  const count = format === "facebook_post" ? 0 : format.endsWith("gallery") || format.endsWith("carousel") ? 2 : 1;
  const target = randomUUID();
  const sources = Array.from({ length: count }, (_, i) => ({
    asset_id: randomUUID(), version: i + 1, expected_sha256: sha, alt_text: "產品資料 / Product details", jpeg_background: "#ffffff",
  }));
  const draft = publicationDraft.parse({ target_id: target, format,
    caption: format === "instagram_story" ? "" : "香港品牌 · 秋季新品 ✨\nDesigned in Hong Kong",
    title: format === "facebook_video" ? "新品介紹" : "", sources,
  });
  return publicationSpecification.parse({ protocol: publicationProtocol,
    tenant_id: randomUUID(), project_id: randomUUID(), actor_id: randomUUID(), actor_auth_version: 1,
    connection_id: randomUUID(), connection_auth_version: 1, configuration_sha256: sha,
    target: { id: target, kind: format.startsWith("facebook_") ? "facebook_page" : "instagram_professional",
      external_id: "125001", page_id: "125000", name: "香港品牌", auth_version: 1 },
    policy_id: randomUUID(), policy_version: 1, policy_sha256: sha, draft,
    sources: sources.map((source, i) => ({ asset_id: source.asset_id, asset_version_id: randomUUID(), version: source.version,
      name: "產品 " + (i + 1), source_sha256: sha, source_mime: "image/png", source_bytes: 200,
      storage_key: "objects/" + randomUUID(), sha256: sha,
      mime: format === "facebook_video" || format === "instagram_reel" || format === "instagram_carousel" && i === 1 ? "video/mp4" : "image/jpeg",
      bytes: 100, width: 1080, height: 1920, duration_ms: 5000, alt_text: source.alt_text, jpeg_background: "#ffffff",
    })), previous_unknown_ids: [], data_mode: "simulated", expires_at: new Date(now + 600_000).toISOString(),
  });
}
const applied = (step_key: string, remote_id: string): PublicationEffect => ({ step_key, state: "applied", remote_id });
const mediaURLs = ["https://api.example.invalid/v1/publication-media/a", "https://api.example.invalid/v1/publication-media/b"];

for (const format of publicationFormats) test(`complete ${format} plan preserves exact fields and needs attributed receipts`, () => {
  const spec = specification(format), effects: PublicationEffect[] = [], progress: PublicationProgress = {};
  let writes = 0, reads = 0, publicEffects = 0;
  for (let i = 0; i < 30; i++) {
    const next = nextPublicationStep(spec, effects, progress, mediaURLs, now);
    if (next.kind === "succeeded") {
      assert.equal(publicEffects, 1);
      assert.ok(writes >= 1 && writes <= 4);
      if (format.startsWith("instagram_") || format === "facebook_video") assert.ok(reads > 0);
      return;
    }
    if (next.kind === "read") {
      reads++;
      if (next.purpose === "container") (progress.containers ??= {})[next.remote_id] = {
        status: "FINISHED", checked_at: new Date(now).toISOString(),
      };
      else if (next.purpose === "quota") progress.quota = { usage: 1, total: 2, checked_at: new Date(now).toISOString() };
      else progress.video = { published: true, status: "ready", checked_at: new Date(now).toISOString() };
      continue;
    }
    assert.equal(next.kind, "write", JSON.stringify(next));
    if (next.kind !== "write") return;
    writes++; publicEffects += Number(next.public_effect);
    assert.equal(next.owner_id, spec.target.external_id);
    if (next.edge === "feed") {
      assert.equal(next.parameters.message, spec.draft.caption);
      assert.equal(next.parameters.published, "true");
      if (format !== "facebook_post") assert.equal(JSON.parse(next.parameters.attached_media).length, spec.sources.length);
    }
    if (next.edge === "photos") assert.equal(next.parameters.published, "false");
    if (next.step_key === "container" && format !== "instagram_story") assert.equal(next.parameters.caption, spec.draft.caption);
    if (next.edge === "media_publish") {
      assert.equal(next.public_effect, true);
      assert.equal(next.parameters.creation_id, effects.find(e => e.step_key === "container")!.remote_id);
    }
    effects.push(applied(next.step_key, String(80000 + writes)));
  }
  assert.fail("The bounded publication plan did not complete");
});

test("a lost response at every format's first or public effect never produces another write", () => {
  for (const format of publicationFormats) {
    const spec = specification(format), first = nextPublicationStep(spec, [], {}, mediaURLs, now);
    assert.equal(first.kind, "write");
    if (first.kind !== "write") continue;
    for (const state of ["dispatched", "unknown"] as const)
      for (const step_key of [first.step_key, "publish"])
        assert.equal(nextPublicationStep(spec, [{ step_key, state, remote_id: null }], {}, mediaURLs, now).kind, "unknown");
  }
});
test("a Facebook video upload receipt does not prove publication or successful processing", () => {
  const spec = specification("facebook_video"), effects = [applied("publish", "80000")];
  assert.equal(nextPublicationStep(spec, effects, {}, mediaURLs, now).kind, "read");
  assert.equal(nextPublicationStep(spec, effects, { video: { status: "ready", published: false, checked_at: new Date(now).toISOString() } }, mediaURLs, now).kind, "read");
  assert.equal(nextPublicationStep(spec, effects, { video: { status: "error", published: false, checked_at: new Date(now).toISOString() } }, mediaURLs, now).kind, "failed");
  assert.equal(nextPublicationStep(spec, effects, { video: { status: "error", published: true, checked_at: new Date(now).toISOString() } }, mediaURLs, now).kind, "unknown");
});
test("carousel waits for every child and parent, then reads the actual runtime quota", () => {
  const spec = specification("instagram_carousel"), effects = [applied("child_0", "80001"), applied("child_1", "80002")];
  const progress: PublicationProgress = { containers: { "80001": { status: "FINISHED", checked_at: new Date(now).toISOString() } } };
  assert.deepEqual(nextPublicationStep(spec, effects, progress, mediaURLs, now), { kind: "read", purpose: "container", remote_id: "80002" });
  progress.containers!["80002"] = { status: "FINISHED", checked_at: new Date(now).toISOString() };
  const parent = nextPublicationStep(spec, effects, progress, mediaURLs, now);
  assert.equal(parent.kind, "write");
  if (parent.kind === "write") assert.equal(parent.parameters.children, "80001,80002");
  effects.push(applied("container", "80003"));
  progress.containers!["80003"] = { status: "FINISHED", checked_at: new Date(now).toISOString() };
  assert.deepEqual(nextPublicationStep(spec, effects, progress, mediaURLs, now), { kind: "read", purpose: "quota", remote_id: spec.target.external_id });
  progress.quota = { usage: 2, total: 2, checked_at: new Date(now).toISOString() };
  assert.equal(nextPublicationStep(spec, effects, progress, mediaURLs, now).kind, "failed");
});
test("stale, future and invalid container observations cannot authorize publication", () => {
  const spec = specification("instagram_photo"), effects = [applied("container", "80001")];
  for (const checked_at of [new Date(now - 300001).toISOString(), new Date(now + 1001).toISOString(), "invalid"])
    assert.equal(nextPublicationStep(spec, effects, { containers: { "80001": { status: "FINISHED", checked_at } } }, mediaURLs, now).kind, "read");
  assert.equal(nextPublicationStep(spec, effects, { containers: { "80001": { status: "PUBLISHED", checked_at: new Date(now).toISOString() } } }, mediaURLs, now).kind, "unknown");
});
test("approval identity changes when the target, exact text, asset version or outgoing rendition changes", () => {
  const original = specification("facebook_photo"), digest = publicationDigest(original);
  for (const change of [
    (s: PublicationSpecification) => { s.draft.caption += " revised"; },
    (s: PublicationSpecification) => { s.target.auth_version++; },
    (s: PublicationSpecification) => { s.policy_version++; },
    (s: PublicationSpecification) => { s.sources[0].sha256 = "b".repeat(64); },
    (s: PublicationSpecification) => { s.sources[0].version++; s.draft.sources[0].version++; },
  ]) { const revised = structuredClone(original); change(revised); assert.notEqual(publicationDigest(revised), digest); }
  const mismatch = structuredClone(original); mismatch.sources[0].source_sha256 = "c".repeat(64);
  assert.equal(publicationSpecification.safeParse(mismatch).success, false);
});
test("draft rejects ignored fields, duplicates, unsafe links and malformed Unicode", () => {
  const original = specification("facebook_post").draft;
  for (const change of [{ share_to_feed: false }, { link: "https://user:secret@example.invalid" },
    { link: "http://example.invalid" }, { title: "ignored" }, { caption: "\ud800" }, { unexpected: "field" }])
    assert.equal(publicationDraft.safeParse({ ...original, ...change }).success, false, JSON.stringify(change));
  const photo = specification("instagram_carousel").draft;
  assert.equal(publicationDraft.safeParse({ ...photo, sources: [photo.sources[0], photo.sources[0]] }).success, false);
  assert.equal(publicationDraft.safeParse({ ...photo, caption: "𠮷".repeat(2201) }).success, false);
  assert.equal(publicationDraft.safeParse({ ...photo, caption: "𠮷".repeat(2200) }).success, true);
});

async function transportFixture(fn: (c: ReturnType<typeof loadConfig>, controls: {
  set(status: number, body: unknown, action?: "disconnect" | "partial" | "redirect"): void;
  calls: Array<{ path: string; method: string; body: string; auth: string | undefined }>;
}) => Promise<void>) {
  const calls: Array<{ path: string; method: string; body: string; auth: string | undefined }> = [];
  let status = 200, body: unknown = { id: "80000" }, action: string | undefined;
  const server = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const chunk of req) chunks.push(Buffer.from(chunk));
    calls.push({ path: req.url!, method: req.method!, body: Buffer.concat(chunks).toString(), auth: req.headers.authorization });
    if (action === "disconnect") { res.destroy(); return; }
    if (action === "partial") { res.writeHead(200, { "content-length": "1000" }); res.write('{"id":'); res.destroy(); return; }
    if (action === "redirect") { res.writeHead(302, { location: "https://example.invalid" }); res.end(); return; }
    res.writeHead(status, { "content-type": "application/json", "connection": "close" });
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  });
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
  const origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await fn(loadConfig({ NODE_ENV: "test", DEMO_MODE: "true", HOST: "127.0.0.1", MASTER_KEY: key,
      PUBLICATION_FIXTURE_ORIGIN: origin, PUBLICATION_FIXTURE_KEY: "fixture-" + key }), {
        set: (s, b, a) => { status = s; body = b; action = a; }, calls,
      });
  } finally { server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(e => e ? reject(e) : resolve())); }
}
test("write transport sends one exact form and credentials only in the authorization channel", async () => {
  await transportFixture(async (config, controls) => {
    const command = nextPublicationStep(specification("facebook_post"), [], {}, [], now);
    assert.equal(command.kind, "write");
    if (command.kind !== "write") return;
    const receipt = await executePublicationWrite(config, "customer-private-token", command);
    assert.equal(receipt.remote_id, "80000"); assert.equal(controls.calls.length, 1);
    assert.equal(new URLSearchParams(controls.calls[0].body).get("message"), command.parameters.message);
    assert.equal(controls.calls[0].auth, "Bearer customer-private-token");
    assert.equal(controls.calls[0].path.includes("customer-private-token"), false);
    assert.equal(controls.calls[0].body.includes("customer-private-token"), false);
  });
});
test("timeouts, lost or invalid receipts, redirects and transient errors are unknown and never retried", async () => {
  await transportFixture(async (config, controls) => {
    const command = nextPublicationStep(specification("facebook_post"), [], {}, [], now);
    assert.equal(command.kind, "write"); if (command.kind !== "write") return;
    for (const failure of [
      { status: 200, body: { id: "80000" }, action: "disconnect" as const },
      { status: 200, body: {}, action: "partial" as const },
      { status: 200, body: {}, action: "redirect" as const },
      { status: 200, body: "invalid" }, { status: 200, body: { success: true } },
      { status: 429, body: { error: { code: 4 } } }, { status: 503, body: { error: { code: 100 } } },
      { status: 400, body: { error: { code: 100, is_transient: true } } },
      { status: 400, body: {} },
    ]) {
      controls.set(failure.status, failure.body, failure.action);
      const before = controls.calls.length;
      await assert.rejects(executePublicationWrite(config, "private-token", command), e =>
        e instanceof PublicationProviderFailure && e.outcome === "unknown" && !e.message.includes("private-token"));
      assert.equal(controls.calls.length, before + 1);
    }
    for (const code of [100, 190]) {
      controls.set(400, { error: { code, message: "secret provider message" } });
      await assert.rejects(executePublicationWrite(config, "private-token", command), e =>
        e instanceof PublicationProviderFailure && e.outcome === "rejected" && e.reauthorize === (code === 190) &&
        !e.message.includes("secret provider message"));
    }
  });
});
test("synthetic mode cannot fall through to real network and only official fixed hosts are accepted", async () => {
  const config = loadConfig({ NODE_ENV: "test", DEMO_MODE: "true", HOST: "127.0.0.1", MASTER_KEY: key });
  for (const url of ["https://example.invalid/v26.0/125001/feed", "http://graph.facebook.com/v26.0/125001/feed",
    "https://user:secret@graph.facebook.com/v26.0/125001/feed", "https://graph.facebook.com:444/v26.0/125001/feed"])
    await assert.rejects(publicationJSON(config, new URL(url)), (e: any) => e.code === "PUBLICATION_ENDPOINT_DENIED");
  await assert.rejects(publicationJSON(config, new URL("https://graph.facebook.com/v26.0/125001/feed")),
    (e: any) => e.code === "PUBLICATION_FIXTURE_REQUIRED");
  assert.equal(publicationSettings(config).available, false);
  assert.throws(() => publicationAuthorizationURL(config, "state"));
  const analyticsOnly = loadConfig({ NODE_ENV: "test", MASTER_KEY: key, META_APP_ID: "125000", META_APP_SECRET: "analytics-only",
    META_GRAPH_VERSION: "v26.0", API_ORIGIN: "https://api.example.invalid" });
  assert.equal(publicationSettings(analyticsOnly).available, false);
});
test("provider status reads parse actual dynamic quota and reject unbounded or ambiguous response shapes", async () => {
  await transportFixture(async (config, controls) => {
    controls.set(200, { data: [{ quota_usage: 3, config: { quota_total: 7, quota_duration: 86400 } }] });
    const quota = await observePublicationProvider(config, "secret", "quota", "125001");
    assert.equal(quota.quota!.usage, 3); assert.equal(quota.quota!.total, 7);
    controls.set(200, { status_code: "PUBLISHED" });
    assert.equal((await observePublicationProvider(config, "secret", "container", "80000")).containers!["80000"].status, "PUBLISHED");
    controls.set(200, { published: false, status: { video_status: "processing" } });
    assert.equal((await observePublicationProvider(config, "secret", "video", "80000")).video!.published, false);
    controls.set(200, { data: [{ quota_usage: 3 }] });
    await assert.rejects(observePublicationProvider(config, "secret", "quota", "125001"));
    assert.equal(controls.calls.every(call => call.method === "GET" && !call.path.includes("access_token=")), true);
  });
});
