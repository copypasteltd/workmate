import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import {
  seoInput,
  seoURL,
  assertSeoScope,
  seoPolicyPath,
  seoLimits,
} from "../src/seo-model.js";
import {
  publicSeoAddress,
  resolveSeoAddress,
  createSeoTransport,
} from "../src/seo-http.js";
import { parseSeoPage, decodeSeoHTML } from "../src/seo-page.js";
import { parseSeoRobots } from "../src/seo-robots.js";
import { startSeoFixture } from "../src/seo-fixture.js";
import { hash } from "../src/lib.js";
import {
  advanceSeoCrawl,
  createSeoCheckpoint,
  collectSeoFindings,
  compareSeoFindings,
  validateSeoCheckpoint,
  type SeoCheckpoint,
  type SeoDocument,
  type SeoCrawlStore,
} from "../src/seo-crawl.js";

const spec = seoInput.parse({
  prompt: "Audit the synthetic campaign",
  start_urls: ["https://marketing.example.invalid/"],
  allowed_hosts: ["marketing.example.invalid"],
  max_pages: 10,
});
let fixture: Awaited<ReturnType<typeof startSeoFixture>>,
  fetchPage: ReturnType<typeof createSeoTransport>;
before(async () => {
  fixture = await startSeoFixture({
    DEMO_MODE: true,
    NODE_ENV: "test",
    HOST: "127.0.0.1",
  });
  fetchPage = createSeoTransport({
    simulated: true,
    production: false,
    fixtureOrigin: fixture.origin,
    fixtureKey: fixture.key,
  });
});
after(async () => {
  await fixture?.close();
});

test("SEO scope normalizes exact hosts and URL fragments, with segment-bound path prefixes", () => {
  const parsed = seoInput.parse({
    prompt: "Check",
    start_urls: ["https://例子.hk/campaign/海報#hero"],
    allowed_hosts: ["例子.hk"],
    allowed_path_prefixes: ["/campaign/"],
    max_pages: 5,
  });
  assert.equal(parsed.allowed_hosts[0], "xn--fsqu00a.hk");
  assert.equal(
    parsed.start_urls[0],
    "https://xn--fsqu00a.hk/campaign/%E6%B5%B7%E5%A0%B1",
  );
  assert.throws(
    () => assertSeoScope("https://例子.hk/campaign-other", parsed),
    { code: "SEO_PATH_DENIED" },
  );
  assert.throws(() => assertSeoScope("https://sub.例子.hk/campaign/", parsed), {
    code: "SEO_HOST_DENIED",
  });
  assert.equal(
    assertSeoScope("https://例子.hk/robots.txt", parsed, true).pathname,
    "/robots.txt",
  );
});
test("SEO rejects ambiguous nested encodings, credentials, protocols, ports and unconfirmed seeds", () => {
  for (const url of [
    "file:///secret",
    "https://a:b@example.invalid/",
    "https://example.invalid:9000/",
    "https://example.invalid./",
    "https://example.invalid/a%252fb",
    "https://example.invalid/a%5cb",
    "https://example.invalid/a%0ab",
  ])
    assert.throws(() => seoURL(url), url);
  for (const path of ["/a/%252e%252e/b", "/a%25252525252fb", "/a\\b", "/a%"])
    assert.throws(() => seoPolicyPath(path), path);
  assert.equal(seoPolicyPath("/campaign/%E9%A6%99%E6%B8%AF"), "/campaign/香港");
  assert.equal(
    seoInput.safeParse({
      ...spec,
      start_urls: ["https://outside.example.invalid/"],
    }).success,
    false,
  );
  assert.equal(
    seoInput.safeParse({ ...spec, allowed_hosts: ["*.example.invalid"] })
      .success,
    false,
  );
  assert.equal(
    seoInput.safeParse({
      ...spec,
      allowed_hosts: ["marketing.example.invalid", "MARKETING.example.invalid"],
    }).success,
    false,
  );
  assert.equal(seoInput.safeParse({ ...spec, max_pages: 1001 }).success, false);
});
test("SEO public address policy denies private, metadata, transition and reserved IPv4/IPv6 ranges", () => {
  for (const value of [
    "127.0.0.1",
    "0.0.0.0",
    "10.0.0.1",
    "100.64.0.1",
    "169.254.169.254",
    "172.31.0.1",
    "192.168.1.1",
    "192.0.2.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "255.255.255.255",
    "::",
    "::1",
    "::ffff:127.0.0.1",
    "fc00::1",
    "fe80::1",
    "2001:db8::1",
    "2002:7f00:1::",
    "64:ff9b::7f00:1",
    "ff02::1",
  ])
    assert.equal(publicSeoAddress(value), false, value);
  assert.equal(publicSeoAddress("1.1.1.1"), true);
  assert.equal(publicSeoAddress("2606:4700:4700::1111"), true);
  assert.equal(publicSeoAddress("::ffff:1.1.1.1"), true);
});
test("SEO resolution rejects all mixed public/private answers and avoids DNS for literal addresses", async () => {
  let calls = 0;
  const resolver = async () => {
    calls++;
    return [
      { address: "1.1.1.1", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ];
  };
  await assert.rejects(resolveSeoAddress("example.invalid", resolver), {
    code: "SEO_IP_DENIED",
  });
  assert.equal(calls, 1);
  await assert.rejects(resolveSeoAddress("[::1]", resolver), {
    code: "SEO_IP_DENIED",
  });
  assert.equal(calls, 1);
  assert.deepEqual(await resolveSeoAddress("1.1.1.1", resolver), {
    address: "1.1.1.1",
    family: 4,
  });
  await assert.rejects(
    resolveSeoAddress("example.invalid", async () => []),
    { code: "SEO_IP_DENIED" },
  );
  await assert.rejects(
    resolveSeoAddress("example.invalid", async () => [
      { address: "1.1.1.1", family: 6 },
    ]),
    { code: "SEO_IP_DENIED" },
  );
});
test("simulated SEO transport requires private fixture configuration and is forbidden in production", () => {
  assert.throws(
    () => createSeoTransport({ simulated: true, production: false }),
    { code: "SEO_FIXTURE_REQUIRED" },
  );
  for (const origin of [
    "https://127.0.0.1",
    "http://example.invalid",
    "http://127.0.0.1/path",
  ])
    assert.throws(
      () =>
        createSeoTransport({
          simulated: true,
          production: false,
          fixtureOrigin: origin,
          fixtureKey: "key",
        }),
      { code: "SEO_FIXTURE_DENIED" },
    );
  assert.throws(
    () =>
      createSeoTransport({
        simulated: true,
        production: true,
        fixtureOrigin: fixture.origin,
        fixtureKey: fixture.key,
      }),
    { code: "SEO_FIXTURE_DENIED" },
  );
});
test("actual fixture HTTP requires its private key and preserves raw response hashes", async () => {
  const unauthorized = await fetch(
    fixture.origin + "/site/marketing.example.invalid/",
  );
  assert.equal(unauthorized.status, 403);
  await unauthorized.arrayBuffer();
  const response = await fetchPage(spec.start_urls[0], spec);
  assert.equal(response.status, 200);
  assert.equal(response.source_mode, "simulated");
  assert.equal(response.sha256, hash(response.body));
  assert.equal(response.peer, null);
  assert.equal(response.url, spec.start_urls[0]);
  assert.ok(response.body.toString().includes("Synthetic Hong Kong"));
});
test("actual transport exposes one redirect hop and never follows an unconfirmed host or private literal", async () => {
  const before = fixture.calls.length;
  const response = await fetchPage(
    "https://marketing.example.invalid/redirect-cross-host",
    spec,
  );
  assert.equal(response.status, 302);
  assert.equal(response.body.length, 0);
  await assert.rejects(fetchPage(response.headers.location, spec), {
    code: "SEO_HOST_DENIED",
  });
  assert.equal(fixture.calls.length, before + 1);
  await assert.rejects(
    fetchPage("http://127.0.0.1/", {
      allowed_hosts: ["127.0.0.1"],
      allowed_path_prefixes: [],
    }),
    { code: "SEO_IP_DENIED" },
  );
  assert.equal(fixture.calls.length, before + 1);
});
test("actual transport enforces response size, encoding and caller cancellation", async () => {
  await assert.rejects(
    fetchPage("https://marketing.example.invalid/too-large", spec),
    { code: "SEO_RESPONSE_LIMIT" },
  );
  await assert.rejects(
    fetchPage("https://marketing.example.invalid/encoded", spec),
    { code: "SEO_ENCODING_UNSUPPORTED" },
  );
  const controller = new AbortController();
  controller.abort();
  const before = fixture.calls.length;
  await assert.rejects(
    fetchPage(spec.start_urls[0], spec, { signal: controller.signal }),
    { code: "SEO_CANCELLED" },
  );
  assert.equal(fixture.calls.length, before);
});
test("actual HTTP conditional read returns 304 with no fabricated content", async () => {
  const first = await fetchPage(
    "https://marketing.example.invalid/offer",
    spec,
  );
  const second = await fetchPage(first.url, spec, { etag: first.headers.etag });
  assert.equal(second.status, 304);
  assert.equal(second.body.length, 0);
  assert.equal(second.sha256, hash(Buffer.alloc(0)));
  assert.equal(fixture.calls.at(-1)?.conditional, true);
});
test("HTML decoding preserves BOM, legacy encoding, original hash and decoded hash", () => {
  const body = Buffer.concat([
    Buffer.from([0xef, 0xbb, 0xbf]),
    Buffer.from("<title>香港 🎨</title>"),
  ]);
  const decoded = decodeSeoHTML({
    body,
    headers: { "content-type": "text/html; charset=windows-1252" },
  });
  assert.equal(decoded.charset, "utf-8");
  assert.equal(decoded.text, "<title>香港 🎨</title>");
  assert.equal(decoded.raw_sha256, hash(body));
  assert.equal(decoded.source_sha256, hash(decoded.text));
  const legacy = decodeSeoHTML({
    body: Buffer.from(
      "<meta charset=windows-1252><title>caf\xe9</title>",
      "latin1",
    ),
    headers: { "content-type": "text/html" },
  });
  assert.ok(legacy.text.includes("café"));
  assert.throws(
    () =>
      decodeSeoHTML({
        body: Buffer.from([0xff]),
        headers: { "content-type": "text/html; charset=utf-8" },
      }),
    { code: "SEO_CHARSET_INVALID" },
  );
  assert.throws(
    () =>
      decodeSeoHTML({ body, headers: { "content-type": "application/json" } }),
    { code: "SEO_CONTENT_TYPE_UNSUPPORTED" },
  );
});
test("HTML parser ignores script/comment/template impostors and decodes title entities", () => {
  const source =
    '<!--<title>Fake</title>--><script>"<h1>Fake</h1>"</script><title>Campaign &amp; 🎨</title><template><a href="/fake">Fake</a><h1>Hidden</h1></template><h1>Main</h1><a href="/offer#one">Offer</a><a href="mailto:hello@example.invalid">Mail</a>';
  const page = parseSeoPage(spec.start_urls[0], source);
  assert.equal(page.title, "Campaign & 🎨");
  assert.deepEqual(page.headings, ["Main"]);
  assert.deepEqual(
    page.links.map((l) => l.url),
    ["https://marketing.example.invalid/offer"],
  );
  assert.equal(page.source_sha256, hash(source));
  const loc = page.links[0].location;
  assert.equal(loc.unit, "utf16_code_units");
  assert.equal(source.slice(loc.start, loc.end), loc.quote);
  assert.equal(loc.quote, 'href="/offer#one"');
});
test("HTML page evidence captures canonical, JSON-LD, named directives and login limitations", () => {
  const source =
    '<title>Marketing campaign details</title><meta name="description" content="Campaign"><meta name="robots" content="noindex,follow"><link rel="canonical" href="https://outside.example.invalid/"><script type="application/ld+json">{bad}</script><h1>Main</h1><input type="password"><a href="/offer" rel="NOFOLLOW">Offer</a>';
  const page = parseSeoPage(spec.start_urls[0], source, {
    "x-robots-tag": "googlebot: nofollow",
  });
  assert.equal(page.nofollow, false);
  assert.equal(page.links[0].nofollow, true);
  assert.equal(page.login_page, true);
  assert.equal(page.json_ld[0].valid, false);
  for (const code of [
    "indexing_disabled",
    "canonical_cross_host",
    "json_ld_invalid",
    "login_form",
  ])
    assert.ok(
      page.issues.some((i) => i.code === code),
      code,
    );
  for (const issue of page.issues)
    if (issue.location)
      assert.equal(
        source.slice(issue.location.start, issue.location.end),
        issue.location.quote,
      );
});
test("link discovery honors first base URL and reports a bounded frontier", () => {
  const page = parseSeoPage(
    spec.start_urls[0],
    '<base href="https://outside.example.invalid/path/"><base href="/ignored/"><title>A complete campaign title</title>' +
      '<a href="relative">Link</a>'.repeat(seoLimits.linksPerPage + 1),
  );
  assert.equal(page.links.length, seoLimits.linksPerPage);
  assert.equal(
    page.links[0].url,
    "https://outside.example.invalid/path/relative",
  );
  assert.ok(
    page.limitations.includes("Link discovery stopped at the per-page limit."),
  );
});
test("robots matching selects named groups, merges groups, uses longest match and favors allow on a tie", () => {
  const policy = parseSeoRobots(
    spec.start_urls[0],
    "User-agent: *\nDisallow: /all\nUser-agent: CopyPasteBot\nDisallow: /private\nAllow: /private/public\nDisallow: /tie\nAllow: /tie\nUser-agent: CopyPasteBot\nDisallow: /second\nCrawl-delay: 1.25\n",
  );
  assert.equal(
    policy.decide("https://marketing.example.invalid/all").allowed,
    true,
  );
  assert.equal(
    policy.decide("https://marketing.example.invalid/private/a").allowed,
    false,
  );
  assert.equal(
    policy.decide("https://marketing.example.invalid/private/public/a").allowed,
    true,
  );
  assert.equal(
    policy.decide("https://marketing.example.invalid/tie").allowed,
    true,
  );
  assert.equal(
    policy.decide("https://marketing.example.invalid/second").allowed,
    false,
  );
  assert.equal(policy.crawl_delay_ms, 1250);
  assert.equal(
    policy.decide("https://marketing.example.invalid/other").line,
    null,
  );
});
test("robots matching preserves reserved encoding, decodes unreserved octets and supports Unicode, wildcard and end markers", () => {
  const policy = parseSeoRobots(
    spec.start_urls[0],
    "User-agent: *\nDisallow: /%7euser\nDisallow: /香港\nDisallow: /*?secret=*$\nAllow: /%7Euser/public\n",
  );
  assert.equal(
    policy.decide("https://marketing.example.invalid/~user").allowed,
    false,
  );
  assert.equal(
    policy.decide("https://marketing.example.invalid/%7euser/public").allowed,
    true,
  );
  assert.equal(
    policy.decide("https://marketing.example.invalid/香港").allowed,
    false,
  );
  assert.equal(
    policy.decide("https://marketing.example.invalid/page?secret=abc").allowed,
    false,
  );
  assert.throws(() => policy.decide("https://outside.example.invalid/"));
});
test("robots reads at least 500 KiB but blocks unsupported policy complexity instead of discarding rules", () => {
  const padding = "# harmless comment padding\n".repeat(21000);
  assert.ok(Buffer.byteLength(padding) >= 500 * 1024);
  const policy = parseSeoRobots(
    spec.start_urls[0],
    padding + "User-agent: *\nDisallow: /private\n",
  );
  assert.equal(
    policy.decide("https://marketing.example.invalid/private").allowed,
    false,
  );
  assert.throws(
    () =>
      parseSeoRobots(
        spec.start_urls[0],
        "User-agent: *\n" + "Disallow: /a\n".repeat(4097),
      ),
    { code: "SEO_ROBOTS_COMPLEXITY" },
  );
});

function crawlFixture(input = spec, cache: SeoDocument[] = []) {
  let current = createSeoCheckpoint(input),
    time = Date.now(),
    allowed = true,
    crashPage = false;
  const documents = new Map<string, SeoDocument>(),
    intents: SeoCheckpoint[] = [];
  const store: SeoCrawlStore = {
    async authorize() {
      if (!allowed)
        throw new (await import("../src/lib.js")).Problem(
          403,
          "SEO_AUTHORIZATION_CHANGED",
          "Revoked",
        );
    },
    async commit(state, document) {
      if (document?.kind === "page" && crashPage) {
        crashPage = false;
        throw new Error("Synthetic crash before atomic result commit");
      }
      current = JSON.parse(JSON.stringify(state));
      intents.push(structuredClone(current));
      if (document)
        documents.set(document.id, {
          ...structuredClone(document),
          raw: Buffer.from(document.raw),
        });
    },
    async read(id) {
      await store.authorize();
      const document = documents.get(id) ?? cache.find((d) => d.id === id);
      assert.ok(document, id);
      return document;
    },
    async cached(url) {
      return (
        cache.find((d) => d.url === url && d.effective_status === 200) ?? null
      );
    },
  };
  return {
    documents,
    intents,
    store,
    get state() {
      return current;
    },
    revoke() {
      allowed = false;
    },
    crashNextPageCommit() {
      crashPage = true;
    },
    async step(signal?: AbortSignal) {
      time = Math.max(time, Date.parse(current.next_at));
      current = await advanceSeoCrawl(current, fetchPage, store, {
        now: () => time,
        signal,
      });
      return current;
    },
    async drain() {
      for (let n = 0; n < 100; n++) {
        if (["complete", "partial", "cancelled"].includes(current.state))
          return current;
        await this.step();
      }
      throw new Error("SEO queue did not finish within the bounded fixture");
    },
  };
}
test("actual multi-page crawl records robots decisions, broken links and duplicate title evidence without leaving scope", async () => {
  fixture.setRevision(1);
  fixture.setFaults([]);
  const before = fixture.calls.length,
    f = crawlFixture();
  await f.drain();
  assert.equal(f.state.state, "partial");
  assert.equal(
    f.state.visits["https://marketing.example.invalid/blocked"].reason,
    "SEO_ROBOTS_DISALLOWED",
  );
  assert.equal(
    f.state.visits["https://marketing.example.invalid/login"].state,
    "success",
  );
  assert.equal(f.state.visits["https://outside.example.invalid/"], undefined);
  assert.equal(
    f.state.visits["https://marketing.example.invalid/nofollow"],
    undefined,
  );
  const calls = fixture.calls.slice(before);
  assert.equal(calls[0].path, "/robots.txt");
  assert.equal(
    calls.some((c) => c.path === "/blocked"),
    false,
  );
  assert.equal(calls.filter((c) => c.path === "/offer").length, 1);
  const findings = collectSeoFindings(f.state, [...f.documents.values()]);
  assert.equal(findings.filter((v) => v.code === "duplicate_title").length, 2);
  const broken = findings.find((v) => v.code === "broken_link")!;
  assert.ok(broken);
  assert.equal(broken.target_url, "https://marketing.example.invalid/missing");
  assert.equal(broken.related_source_ids.length, 1);
  const source = f.documents.get(broken.source_id)!;
  assert.equal(
    source.text!.slice(broken.location!.start, broken.location!.end),
    broken.location!.quote,
  );
  assert.ok(
    f.intents.some((s) => s.active?.kind === "page" && s.page_requests === 1),
  );
});
test("page budget counts redirects and leaves remaining URLs explicitly unvisited", async () => {
  const input = seoInput.parse({
    ...spec,
    start_urls: ["https://marketing.example.invalid/redirect"],
    max_pages: 1,
  });
  const before = fixture.calls.length,
    f = crawlFixture(input);
  await f.drain();
  assert.equal(f.state.page_requests, 1);
  assert.equal(f.state.state, "partial");
  assert.equal(
    f.state.visits["https://marketing.example.invalid/offer"].state,
    "unvisited",
  );
  assert.equal(
    fixture.calls.slice(before).filter((c) => c.path !== "/robots.txt").length,
    1,
  );
});
test("cross-host and private redirects terminate before an out-of-scope request", async () => {
  const before = fixture.calls.length;
  const f = crawlFixture(
    seoInput.parse({
      ...spec,
      start_urls: [
        "https://marketing.example.invalid/redirect-cross-host",
        "https://marketing.example.invalid/redirect-private",
      ],
    }),
  );
  await f.drain();
  for (const path of ["/redirect-cross-host", "/redirect-private"])
    assert.equal(
      f.state.visits["https://marketing.example.invalid" + path].reason,
      "SEO_HOST_DENIED",
    );
  assert.ok(
    fixture.calls
      .slice(before)
      .every((c) => c.host === "marketing.example.invalid"),
  );
});
test("robots server failures retry within bounds and never fetch a protected page", async () => {
  fixture.setFaults([
    "robots_unavailable",
    "robots_unavailable",
    "robots_unavailable",
  ]);
  const before = fixture.calls.length,
    f = crawlFixture();
  await f.drain();
  assert.equal(f.state.robots_requests, 3);
  assert.equal(f.state.page_requests, 0);
  assert.equal(f.state.visits[spec.start_urls[0]].state, "blocked");
  assert.deepEqual(
    fixture.calls.slice(before).map((c) => c.path),
    ["/robots.txt", "/robots.txt", "/robots.txt"],
  );
});
test("rate limits retain actual failed responses, respect retry time and consume page attempts", async () => {
  fixture.setFaults(["rate_limit"]);
  const f = crawlFixture();
  await f.step();
  await f.step();
  const request = [...f.documents.values()].find((d) => d.status === 429)!;
  assert.ok(request);
  assert.equal(f.state.page_requests, 1);
  assert.ok(Date.parse(f.state.next_at) > Date.parse(f.state.updated_at));
  await f.drain();
  assert.equal(f.state.visits[spec.start_urls[0]].attempts, 2);
});
test("an interrupted committed intent is unknown, consumes its reservation and cannot exceed the page budget on recovery", async () => {
  const before = fixture.calls.length,
    f = crawlFixture(seoInput.parse({ ...spec, max_pages: 2 }));
  await f.step();
  f.crashNextPageCommit();
  await assert.rejects(f.step(), /Synthetic crash/);
  assert.equal(f.state.active?.kind, "page");
  assert.equal(f.state.page_requests, 1);
  const reserved = f.state.byte_budget_used;
  assert.ok(reserved >= seoLimits.responseBytes);
  await f.step();
  assert.equal(f.state.active, null);
  assert.equal(f.state.byte_budget_used, reserved);
  await f.drain();
  assert.equal(f.state.page_requests, 2);
  assert.ok(f.state.limitations.includes("SEO_REQUEST_OUTCOME_UNKNOWN"));
  assert.equal(
    fixture.calls.slice(before).filter((c) => c.path === "/").length,
    2,
  );
});
test("authorization loss stops collection without publishing a document or consuming another network request", async () => {
  const f = crawlFixture();
  await f.step();
  const before = fixture.calls.length;
  f.revoke();
  await assert.rejects(f.step(), { code: "SEO_AUTHORIZATION_CHANGED" });
  assert.equal(fixture.calls.length, before);
  assert.equal(f.documents.size, 1);
});

test("worker shutdown aborts actual HTTP while preserving the durable intent and budget for recovery", async () => {
  fixture.setFaults([]);
  const f = crawlFixture(seoInput.parse({ ...spec, max_pages: 2 }));
  const stopped = new AbortController();
  stopped.abort();
  const checkpoint = structuredClone(f.state),
    before = fixture.calls.length;
  await f.step(stopped.signal);
  assert.deepEqual(f.state, checkpoint);
  assert.equal(fixture.calls.length, before);
  await f.step();
  fixture.setFaults(["slow"]);
  const controller = new AbortController(),
    requestCount = fixture.calls.length;
  const running = f.step(controller.signal);
  // Observe the real fixture request before aborting its socket, not a transport mock.
  const deadline = Date.now() + 5000;
  while (fixture.calls.length === requestCount && Date.now() < deadline)
    await new Promise((resolve) => setTimeout(resolve, 5));
  assert.ok(fixture.calls.length > requestCount);
  controller.abort();
  await assert.rejects(running, { code: "SEO_WORKER_STOPPED" });
  assert.equal(f.state.state, "running");
  assert.equal(f.state.active?.kind, "page");
  assert.equal(f.state.page_requests, 1);
  const reserved = f.state.byte_budget_used;
  await f.step();
  assert.equal(f.state.active, null);
  assert.equal(f.state.byte_budget_used, reserved);
  await f.drain();
  assert.equal(f.state.page_requests, 2);
  assert.ok(f.state.limitations.includes("SEO_REQUEST_OUTCOME_UNKNOWN"));
  assert.notEqual(f.state.state, "cancelled");
});
test("same-scope recheck resolves only observed repairs and retains both immutable sets of source evidence", async () => {
  fixture.setRevision(1);
  const before = crawlFixture();
  await before.drain();
  const oldFindings = collectSeoFindings(before.state, [
    ...before.documents.values(),
  ]);
  const oldHashes = [...before.documents.values()].map((d) => d.raw_sha256);
  fixture.setRevision(2);
  const after = crawlFixture();
  await after.drain();
  const findings = collectSeoFindings(after.state, [
    ...after.documents.values(),
  ]);
  const compared = compareSeoFindings(
    { state: before.state, findings: oldFindings },
    { state: after.state, findings },
  );
  for (const old of oldFindings.filter((f) =>
    ["duplicate_title", "broken_link"].includes(f.code),
  ))
    assert.equal(
      compared.changes.find((c) => c.previous_finding_id === old.id)?.state,
      "resolved",
    );
  assert.deepEqual(
    [...before.documents.values()].map((d) => d.raw_sha256),
    oldHashes,
  );
  assert.equal(
    findings.some((f) => f.code === "broken_link"),
    false,
  );
  fixture.setRevision(1);
});
test("same-budget recheck does not report unvisited or inaccessible targets as repaired", async () => {
  fixture.setRevision(1);
  const before = crawlFixture();
  await before.drain();
  const oldFindings = collectSeoFindings(before.state, [
    ...before.documents.values(),
  ]);
  fixture.setFaults(["unavailable", "unavailable", "unavailable"]);
  const after = crawlFixture();
  await after.drain();
  const findings = collectSeoFindings(after.state, [
    ...after.documents.values(),
  ]);
  const compared = compareSeoFindings(
    { state: before.state, findings: oldFindings },
    { state: after.state, findings },
  );
  assert.ok(compared.changes.every((c) => c.state === "not_rechecked"));
  assert.throws(
    () =>
      compareSeoFindings(
        { state: before.state, findings: oldFindings },
        {
          state: createSeoCheckpoint(seoInput.parse({ ...spec, max_pages: 1 })),
          findings: [],
        },
      ),
    { code: "SEO_COMPARISON_METHOD_CHANGED" },
  );
});
test("conditional cache reuse preserves the empty 304 response and original content capture as separate facts", async () => {
  fixture.setRevision(1);
  fixture.setFaults([]);
  const before = crawlFixture();
  await before.drain();
  const after = crawlFixture(
    seoInput.parse({ ...spec, cache_policy: "reuse_valid" }),
    [...before.documents.values()],
  );
  await after.drain();
  const document = [...after.documents.values()].find((d) => d.status === 304)!;
  assert.ok(document);
  assert.equal(document.response_sha256, hash(Buffer.alloc(0)));
  const cached = before.documents.get(document.cache_source_id!)!;
  assert.equal(document.raw_sha256, cached.raw_sha256);
  assert.equal(document.content_captured_at, cached.content_captured_at);
  assert.equal(document.effective_status, 200);
  assert.ok(document.page);
});
test("resuming a modified specification or invalid checkpoint fails before I/O", () => {
  const state = createSeoCheckpoint(spec);
  state.spec.max_pages++;
  assert.throws(() => validateSeoCheckpoint(state), {
    code: "SEO_CHECKPOINT_INVALID",
  });
  const invalid = createSeoCheckpoint(spec);
  invalid.frontier.push(invalid.frontier[0]);
  assert.throws(() => validateSeoCheckpoint(invalid), {
    code: "SEO_CHECKPOINT_INVALID",
  });
});
