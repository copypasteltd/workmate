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
