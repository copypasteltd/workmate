import { Ajv2020 } from "ajv/dist/2020.js";
import { createRequire } from "node:module";
import contract from "../contracts/brand-production-openapi.json" with { type: "json" };
import { Worker } from "../src/worker.js";
import {
  CodexRuntimeAdapter,
  type RuntimeContext,
  type RuntimeResult,
} from "../src/runtime.js";
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as OTPAuth from "otpauth";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { saveAsset } from "../src/storage.js";
import { hash } from "../src/lib.js";
import { projectAccess } from "../src/access.js";
import { resolveWorkContext } from "../src/persistent-work.js";
import { inspectBrandFont } from "../src/brand-font.js";
import { brandDefinition } from "../src/brand-production.js";
import { PNG } from "pngjs";
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string; admin?: boolean };
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  key: string | null = randomUUID(),
  headers: Record<string, string> = {},
) {
  const tenant = /^\/v1\/tenants\/([a-f0-9-]{36})/.exec(url)?.[1];
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: c?.admin ? s.db.config.ADMIN_ORIGIN : s.db.config.WEB_ORIGIN,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      ...(key ? { "idempotency-key": key } : {}),
      ...(tenant ? { "x-tenant-id": tenant } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: raw.statusCode, data: raw.json(), raw };
}
async function ok(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
) {
  const r = await call(c, method, url, body);
  assert.ok(
    r.status >= 200 && r.status < 300,
    `${r.status}: ${JSON.stringify(r.data)}`,
  );
  return r.data;
}
async function user(
  secret?: OTPAuth.Secret,
  address = `brand-production-${randomUUID()}@example.invalid`,
): Promise<Client> {
  const prefix = secret ? "/v1/admin/auth" : "/v1/auth";
  const challenge = await ok(undefined, "POST", prefix + "/challenge", {
    email: address,
  });
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${challenge.challenge_id}.json`,
      "utf8",
    ),
  );
  const r = await call(undefined, "POST", prefix + "/verify", {
    challenge_id: challenge.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
    ...(secret
      ? {
          totp: new OTPAuth.TOTP({
            secret,
            digits: 6,
            period: 30,
            algorithm: "SHA1",
          }).generate(),
        }
      : {}),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const cookie = r.raw.cookies.find(
    (c) => c.name === (secret ? "cp_admin_session" : "cp_session"),
  )!;
  return {
    id: r.data.user?.id ?? r.data.admin?.id,
    cookie: cookie.name + "=" + cookie.value,
    csrf: r.data.csrf_token,
    admin: !!secret,
  };
}

const actor = (u: Client) => ({
  id: u.id,
  email: "fixture@example.invalid",
  name: "Fixture",
  audience: "user" as const,
  authVersion: 1,
  sessionId: "",
  sessionHash: "",
});
async function fixture() {
  const owner = await user(),
    w = await ok(owner, "POST", "/v1/tenants", {
      name: "Actual brand checks",
      project_name: "Isolated brand",
    });
  await s.db.control.query(
    "UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1",
    [w.tenant.id],
  );
  return {
    owner,
    tenant: w.tenant.id,
    project: w.project.id,
    base: `/v1/tenants/${w.tenant.id}/projects/${w.project.id}`,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const definition = (overrides: any = {}) => ({
  schema_version: 2,
  name: "春日 · Spring",
  colors: ["#1F5EFF", "#F6F6F4"],
  tone: "Clear Traditional Chinese and English",
  approved_copy: "Approved product facts only",
  fonts: [],
  logos: [],
  font_bindings: [
    {
      key: "headline",
      label: "Noto Sans TC",
      source: { builtin: "noto-sans-tc" },
      rights: {
        source: "Repository fixed font and OFL",
        license: "SIL Open Font License 1.1",
        channels: ["social", "print"],
        valid_until: null,
      },
    },
  ],
  facts: [
    {
      key: "offer",
      sku: "SKU-01",
      kind: "promotion",
      text: "春日優惠",
      amount_minor: 12800,
      currency: "HKD",
      valid_from: "2020-01-01T00:00:00Z",
      valid_until: "2099-01-01T00:00:00Z",
    },
  ],
  locales: ["zh-Hant-HK", "en-HK"],
  channels: ["social", "print"],
  restrictions: "Never change the approved price",
  ...overrides,
});
const create = (f: Fixture, b = definition()) =>
  ok(f.owner, "POST", f.base + "/brand/definitions", b);
const binding = (b: any) => ({
  id: b.id,
  version: b.version,
  channel: "social",
  locale: "zh-Hant-HK",
});
const document = (b: any, text = "Fixture ignored by fact reference") => ({
  width: 512,
  height: 320,
  background: "#F6F6F4",
  brand: binding(b),
  layers: [
    {
      type: "text",
      text,
      x: 30,
      y: 140,
      font_size: 26,
      color: "#15171A",
      font_key: "headline",
      fact_key: "offer",
    },
  ],
});
async function creative(f: Fixture, b: any, doc = document(b)) {
  return ok(f.owner, "POST", f.base + "/creative", {
    name: "Frozen campaign",
    body: doc,
  });
}
const render = (f: Fixture, c: any, format = "svg", k = randomUUID()) =>
  call(
    f.owner,
    "POST",
    f.base + "/creative/" + c.id + "/render",
    { format, expected_version: c.version },
    k,
  );
const check = (f: Fixture, b: any, extra: any = {}) =>
  call(
    f.owner,
    "POST",
    f.base + "/brand/" + b.id + "/versions/" + b.version + "/check",
    {
      channel: "social",
      locale: "zh-Hant-HK",
      font_key: "headline",
      text: "春日優惠 Brand 2026",
      ...extra,
    },
  );
async function bytes(f: Fixture, id: string) {
  const v = (
    await s.db.control.query(
      "SELECT storage_key FROM asset_versions WHERE asset_id=$1 ORDER BY version DESC LIMIT 1",
      [id],
    )
  ).rows[0];
  return s.storage.get(v.storage_key);
}
async function sharedFile(
  f: Fixture,
  name: string,
  mime: string,
  bytes: Buffer,
  extra: any = {},
) {
  return s.db.tx(async (tx) => {
    await projectAccess(tx, actor(f.owner), f.tenant, f.project, "write");
    return saveAsset(tx, s.storage, {
      tenant: f.tenant,
      project: f.project,
      user: f.owner.id,
      name,
      mime,
      bytes,
      ...extra,
    });
  }, f.tenant);
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      WORKER_ENABLED: "false",
      DEMO_MODE: "true",
    }),
    { worker: false },
  );
});
after(async () => {
  try {
    await s?.app.close();
  } finally {
    await isolated?.cleanup();
  }
});

test("brand publications are immutable, consecutive, audited and retry safe", async () => {
  const f = await fixture(),
    b = definition(),
    key = randomUUID(),
    url = f.base + "/brand/definitions";
  const results = await Promise.all([
    call(f.owner, "POST", url, b, key),
    call(f.owner, "POST", url, b, key),
  ]);
  for (const r of results) assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(results[0].data.id, results[1].data.id);
  const first = results[0].data;
  assert.equal(
    (await call(f.owner, "POST", url, { ...b, name: "Changed" }, key)).status,
    409,
  );
  assert.equal((await call(f.owner, "POST", url, b, null)).status, 400);
  const body = {
      expected_version: 1,
      definition: definition({ name: "Second publication" }),
    },
    put = f.base + "/brand/" + first.id,
    once = randomUUID();
  const second = await call(f.owner, "PUT", put, body, once);
  assert.equal(second.status, 200, JSON.stringify(second.data));
  assert.deepEqual(
    (await call(f.owner, "PUT", put, body, once)).data,
    second.data,
  );
  assert.equal((await call(f.owner, "PUT", put, body)).status, 409);
  const versions = (await ok(f.owner, "GET", put + "/versions")).items;
  assert.equal(versions.length, 2);
  assert.equal(versions[1].body.name, b.name);
  assert.notEqual(versions[0].sha256, versions[1].sha256);
  await assert.rejects(
    s.db.control.query(
      "UPDATE brand_profile_versions SET body='{}' WHERE brand_id=$1",
      [first.id],
    ),
    { code: "23514" },
  );
  await assert.rejects(
    s.db.control.query("UPDATE brand_profiles SET body='{}' WHERE id=$1", [
      first.id,
    ]),
    { code: "23514" },
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int n FROM audit_log WHERE action='brand.version.publish' AND target=$1",
        [first.id],
      )
    ).rows[0].n,
    2,
  );
  const competing = await Promise.all([
    call(f.owner, "PUT", put, { ...body, expected_version: 2 }),
    call(f.owner, "PUT", put, { ...body, expected_version: 2 }),
  ]);
  assert.deepEqual(competing.map((r) => r.status).sort(), [200, 409]);
});
test("fixed specialist context keeps the original body after a new publication and filters expired facts", async () => {
  const f = await fixture(),
    old = await create(f),
    agent = await ok(f.owner, "POST", f.base + "/agents", {
      name: "Fixed branded assistant",
      role_key: "assistant",
      brand_id: old.id,
    });
  const task = await ok(f.owner, "POST", f.base + "/tasks", {
    title: "Frozen task",
    prompt: "Use the approved brand in a clearly simulated answer.",
    role_key: "assistant",
    agent_id: agent.id,
    mode: "ask",
    budget_micros: 1000000,
  });
  await ok(f.owner, "PUT", f.base + "/brand/" + old.id, {
    expected_version: 1,
    definition: definition({
      approved_copy: "Replacement copy must not reach the old task",
      facts: [{ ...definition().facts[0], text: "Changed fact" }],
    }),
  });
  const context = await s.db.tx(async (tx) => {
    await projectAccess(tx, actor(f.owner), f.tenant, f.project);
    return resolveWorkContext(
      tx,
      actor(f.owner),
      f.tenant,
      f.project,
      task.input_context,
    );
  }, f.tenant);
  assert.ok(context.instructions.includes("Approved product facts only"));
  assert.ok(context.instructions.includes("春日優惠"));
  assert.ok(!context.instructions.includes("Replacement copy"));
  assert.equal(context.role.brand.version, 1);
  const expired = await create(
    f,
    definition({
      facts: [
        { ...definition().facts[0], valid_until: "2021-01-01T00:00:00Z" },
      ],
    }),
  );
  const { brandContext } = await import("../src/brand-production.js");
  const safe = await s.db.tx(async (tx) => {
    await projectAccess(tx, actor(f.owner), f.tenant, f.project);
    return brandContext(tx, f.project, expired.id, 1);
  }, f.tenant);
  assert.deepEqual(safe.body.facts, []);
  assert.ok("unavailable_facts" in safe);
  assert.equal(safe.unavailable_facts[0].state, "expired");
});
test("actual branded SVG paths, PNG pixels and PDF pages use frozen facts and preserve source references", async () => {
  const f = await fixture(),
    b = await create(f),
    c = await creative(f, b),
    key = randomUUID(),
    svg = await render(f, c, "svg", key);
  assert.equal(svg.status, 200, JSON.stringify(svg.data));
  assert.equal((await render(f, c, "svg", key)).data.id, svg.data.id);
  const source = (await bytes(f, svg.data.id)).toString();
  assert.match(source, /<path/);
  assert.doesNotMatch(source, /<text[ >]/);
  assert.doesNotMatch(source, /Fixture ignored/);
  const png = await render(f, c, "png");
  assert.equal(png.status, 200, JSON.stringify(png.data));
  const pixels = PNG.sync.read(await bytes(f, png.data.id));
  assert.equal(pixels.width, 512);
  assert.ok(new Set(pixels.data).size > 20);
  const pdf = await render(f, c, "pdf");
  assert.equal(pdf.status, 200, JSON.stringify(pdf.data));
  assert.match(
    (await bytes(f, pdf.data.id)).subarray(0, 8).toString(),
    /^%PDF-/,
  );
  const metadata = (
    await s.db.control.query(
      "SELECT metadata FROM asset_versions WHERE asset_id=$1",
      [svg.data.id],
    )
  ).rows[0].metadata;
  assert.deepEqual(metadata.brand_reference, binding(b));
  assert.equal(metadata.source.layers[0].fact_key, "offer");
  assert.match((await check(f, b, { fact_key: "offer" })).data.text, /128/);
});
test("font coverage, usage, channel and language errors are explicit and create no deliverable", async () => {
  const f = await fixture(),
    b = await create(f),
    missing = await check(f, b, {
      text: "Unavailable " + String.fromCodePoint(0x10ffff),
    });
  assert.equal(missing.status, 422, JSON.stringify(missing.data));
  assert.equal(missing.data.error.code, "BRAND_GLYPH_MISSING");
  assert.ok(JSON.stringify(missing.data).includes("U+10FFFF"));
  for (const input of [
    { channel: "video" },
    { locale: "ja-JP" },
    { font_key: "unknown" },
  ])
    assert.equal((await check(f, b, input)).status, 422);
  const expired = await create(
    f,
    definition({
      font_bindings: [
        {
          ...definition().font_bindings[0],
          rights: {
            ...definition().font_bindings[0].rights,
            valid_until: "2021-01-01T00:00:00Z",
          },
        },
      ],
    }),
  );
  assert.equal(
    (await check(f, expired)).data.error.code,
    "BRAND_FONT_USAGE_DENIED",
  );
  const c = await creative(f, expired);
  assert.equal((await render(f, c)).status, 422);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int n FROM assets WHERE project_id=$1",
        [f.project],
      )
    ).rows[0].n,
    0,
  );
});
test("expired or future promotions cannot be substituted, while retained old outputs remain readable", async () => {
  const f = await fixture(),
    b = await create(f),
    c = await creative(f, b),
    output = await render(f, c);
  assert.equal(output.status, 200);
  for (const change of [
    { valid_until: "2021-01-01T00:00:00Z" },
    { valid_from: "2090-01-01T00:00:00Z" },
  ]) {
    const blocked = await create(
      f,
      definition({ facts: [{ ...definition().facts[0], ...change }] }),
    );
    assert.equal(
      (await check(f, blocked, { fact_key: "offer" })).data.error.code,
      "BRAND_FACT_UNAVAILABLE",
    );
    assert.equal((await render(f, await creative(f, blocked))).status, 422);
  }
  assert.equal(
    (
      await call(
        f.owner,
        "GET",
        f.base + "/assets/" + output.data.id + "/versions",
      )
    ).status,
    200,
  );
  const jpy = await create(
    f,
    definition({
      facts: [{ ...definition().facts[0], amount_minor: 128, currency: "JPY" }],
    }),
  );
  assert.match((await check(f, jpy, { fact_key: "offer" })).data.text, /128/);
});
test("uploaded fonts are pinned by real bytes and version, malformed font structures fail before rendering", async () => {
  const f = await fixture(),
    ttf = await readFile("assets/fonts/noto-sans-tc/NotoSansTC-VF.ttf"),
    font = await sharedFile(f, "declared-font.ttf", "font/ttf", ttf);
  const def = definition({
      font_bindings: [
        {
          ...definition().font_bindings[0],
          source: { asset_id: font.id, version: 1 },
        },
      ],
    }),
    b = await create(f, def);
  assert.equal((await check(f, b)).status, 200);
  await sharedFile(
    f,
    "declared-font.ttf",
    "font/ttf",
    Buffer.from("invalid later version"),
    { asset: font.id, expectedVersion: 1 },
  );
  assert.equal(
    (await check(f, b)).status,
    200,
    "The fixed old file version survives a new upload",
  );
  const invalid = await sharedFile(
    f,
    "bad.ttf",
    "font/ttf",
    Buffer.from("invalid font"),
  );
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        f.base + "/brand/definitions",
        definition({
          font_bindings: [
            {
              ...def.font_bindings[0],
              source: { asset_id: invalid.id, version: 1 },
            },
          ],
        }),
      )
    ).status,
    422,
  );
  for (const buf of [
    Buffer.alloc(0),
    Buffer.alloc(20),
    Buffer.concat([
      Buffer.from("00010000ffff000000000000", "hex"),
      Buffer.alloc(20),
    ]),
  ])
    assert.throws(
      () => inspectBrandFont(buf),
      (e: any) => e.code === "BRAND_FONT_INVALID",
    );
  const v = (
    await s.db.control.query(
      "SELECT v.sha256 FROM brand_version_assets d JOIN asset_versions v ON v.id=d.asset_version_id WHERE d.brand_id=$1",
      [b.id],
    )
  ).rows[0];
  assert.equal(v.sha256, hash(ttf));
});
test("cross-tenant, cross-project, private, viewer and Admin session boundaries remain enforced", async () => {
  const f = await fixture(),
    other = await fixture(),
    b = await create(f),
    foreign = await sharedFile(
      other,
      "foreign.ttf",
      "font/ttf",
      await readFile("assets/fonts/noto-sans-tc/NotoSansTC-VF.ttf"),
    );
  assert.equal(
    (await call(other.owner, "GET", f.base + "/brand/" + b.id + "/versions"))
      .status,
    404,
  );
  assert.equal(
    (await call(f.owner, "GET", other.base + "/brand/" + b.id + "/versions"))
      .status,
    404,
  );
  const cross = await call(
    f.owner,
    "POST",
    f.base + "/brand/definitions",
    definition({
      font_bindings: [
        {
          ...definition().font_bindings[0],
          source: { asset_id: foreign.id, version: 1 },
        },
      ],
    }),
  );
  assert.equal(cross.status, 422);
  const member = await user();
  await s.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'viewer')",
    [f.tenant, member.id],
  );
  await s.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'viewer')",
    [f.tenant, f.project, member.id],
  );
  assert.equal(
    (await call(member, "GET", f.base + "/brand/" + b.id + "/versions")).status,
    200,
  );
  assert.equal(
    (
      await call(member, "PUT", f.base + "/brand/" + b.id, {
        expected_version: 1,
        definition: definition(),
      })
    ).status,
    403,
  );
  assert.equal(
    (await call(f.owner, "GET", "/v1/admin/content/" + b.id + "/body")).status,
    401,
  );
});
test("quarantine and deletion revoke direct render derivatives and sanitize immutable brand history", async () => {
  const f = await fixture(),
    b = await create(f),
    c = await creative(f, b),
    out = await render(f, c);
  assert.equal(out.status, 200);
  await s.db.control.query(
    "UPDATE brand_profiles SET content_state='quarantined' WHERE id=$1",
    [b.id],
  );
  assert.equal((await check(f, b)).status, 409);
  assert.equal(
    (
      await call(
        f.owner,
        "GET",
        f.base + "/assets/" + out.data.id + "/versions",
      )
    ).status,
    404,
  );
  await s.db.control.query(
    "UPDATE brand_profiles SET content_state='active' WHERE id=$1",
    [b.id],
  );
  assert.equal((await check(f, b)).status, 200);
  await s.db.control.query(
    "UPDATE brand_profiles SET content_state='deleted' WHERE id=$1",
    [b.id],
  );
  const versions = (
    await s.db.control.query(
      "SELECT * FROM brand_profile_versions WHERE brand_id=$1",
      [b.id],
    )
  ).rows;
  assert.ok(
    versions.every(
      (v) =>
        v.erased_at &&
        JSON.stringify(v.body) === "{}" &&
        v.name === "[deleted]",
    ),
  );
  assert.equal(
    (await call(f.owner, "GET", f.base + "/brand/" + b.id + "/versions"))
      .status,
    404,
  );
  assert.equal((await ok(f.owner, "GET", f.base + "/brand")).items.length, 0);
});
test("Logo minimum size and clear space are checked against the fixed asset version", async () => {
  const f = await fixture(),
    png = new PNG({ width: 32, height: 32 });
  png.data.fill(255);
  const logo = await sharedFile(
      f,
      "logo.png",
      "image/png",
      PNG.sync.write(png),
    ),
    b = await create(
      f,
      definition({
        logos: [
          {
            key: "primary",
            asset_id: logo.id,
            version: 1,
            usage: "Primary",
            min_width: 60,
            clear_space: 20,
          },
        ],
      }),
    );
  const doc = document(b);
  doc.layers.push({
    type: "image",
    asset_id: logo.id,
    version: 1,
    x: 0,
    y: 0,
    width: 32,
    height: 32,
  } as any);
  assert.equal(
    (await render(f, await creative(f, b, doc))).data.error.code,
    "BRAND_LOGO_LAYOUT_INVALID",
  );
  Object.assign(doc.layers[1], { x: 20, y: 20, width: 64, height: 64 });
  assert.equal((await render(f, await creative(f, b, doc))).status, 200);
  await s.db.control.query(
    "UPDATE assets SET state='quarantined' WHERE id=$1",
    [logo.id],
  );
  assert.equal((await check(f, b)).status, 409);
});
test("legacy brand create remains readable and explicit publication is required for constrained rendering", async () => {
  const f = await fixture(),
    old = await ok(f.owner, "POST", f.base + "/brand", {
      name: "Legacy",
      colors: ["#1F5EFF"],
      tone: "Original guidance",
      fonts: [],
    });
  const history = await ok(
    f.owner,
    "GET",
    f.base + "/brand/" + old.id + "/versions",
  );
  assert.equal(history.items.length, 1);
  assert.equal(history.items[0].body.tone, "Original guidance");
  assert.equal(
    (await render(f, await creative(f, old))).data.error.code,
    "BRAND_UPGRADE_REQUIRED",
  );
  assert.equal(
    (
      await call(f.owner, "PUT", f.base + "/brand/" + old.id, {
        expected_version: 1,
        definition: definition(),
      })
    ).status,
    200,
  );
  assert.equal(
    brandDefinition.safeParse(
      definition({ facts: [{ ...definition().facts[0], valid_until: null }] }),
    ).success,
    false,
  );
  assert.equal(
    brandDefinition.safeParse(definition({ locales: ["not_a_locale"] }))
      .success,
    false,
  );
});

test("a real queued designer task and tool replay enforce the frozen brand and record actual font reads", async () => {
  const f = await fixture(),
    ttf = await readFile("assets/fonts/noto-sans-tc/NotoSansTC-VF.ttf"),
    font = await sharedFile(f, "task-font.ttf", "font/ttf", ttf),
    b = await create(
      f,
      definition({
        font_bindings: [
          {
            ...definition().font_bindings[0],
            source: { asset_id: font.id, version: 1 },
          },
        ],
      }),
    );
  const agent = await ok(f.owner, "POST", f.base + "/agents", {
    name: "Frozen design specialist",
    role_key: "designer",
    brand_id: b.id,
  });
  const task = await ok(f.owner, "POST", f.base + "/tasks", {
    title: "Real brand tool chain",
    prompt:
      "Render the explicitly simulated approved campaign with the original brand and price.",
    role_key: "designer",
    agent_id: agent.id,
    budget_micros: 1000000,
  });
  await ok(f.owner, "PUT", f.base + "/brand/" + b.id, {
    expected_version: 1,
    definition: definition({
      facts: [{ ...definition().facts[0], amount_minor: 18800 }],
    }),
  });
  let delivered: any,
    calls = 0;
  class BrandRuntime extends CodexRuntimeAdapter {
    override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
      calls++;
      assert.ok(ctx.prompt.includes('"amount_minor":12800'));
      assert.ok(!ctx.prompt.includes('"amount_minor":18800'));
      const tool = ctx.tools.find((t) => t.name === "design_render")!;
      assert.ok(tool);
      const args = {
        filename: "fixed-brand",
        document: document(b),
        format: "png",
      };
      await assert.rejects(
        tool.run(
          {
            ...args,
            document: {
              ...args.document,
              brand: { ...args.document.brand, version: 2 },
            },
          },
          "wrong-brand-version",
        ),
        (e: any) => e.code === "BRAND_BINDING_REQUIRED",
      );
      delivered = await tool.run(args, "actual-fixed-render");
      const replayed: any = await tool.run(args, "actual-fixed-render");
      assert.equal(replayed.source.id, delivered.source.id);
      assert.equal(replayed.rendered.id, delivered.rendered.id);
      return {
        status: "completed",
        text: "Explicit simulated model output; actual fixed-brand PNG and editable source.",
        inputTokens: 20,
        outputTokens: 30,
        accepted: true,
        usageKnown: true,
        thread: "brand-fixture",
        turn: "1",
      };
    }
  }
  await new Worker(
    s.db,
    s.catalog,
    s.storage,
    new BrandRuntime(s.db.config),
  ).run(f.tenant, task.id);
  assert.equal(calls, 1);
  const done = await ok(f.owner, "GET", f.base + "/tasks/" + task.id);
  assert.equal(done.status, "succeeded", JSON.stringify(done));
  assert.equal(PNG.sync.read(await bytes(f, delivered.rendered.id)).width, 512);
  const reads = (
    await s.db.control.query(
      "SELECT * FROM task_source_reads WHERE task_id=$1",
      [task.id],
    )
  ).rows;
  assert.equal(reads.length, 1);
  assert.equal(reads[0].sha256, hash(ttf));
  await s.db.control.query(
    "UPDATE assets SET state='quarantined' WHERE id=$1",
    [font.id],
  );
  const available = await s.db.tx(async (tx) => {
    await projectAccess(tx, actor(f.owner), f.tenant, f.project);
    return (
      await tx.query("SELECT task_content_sources_available($1) AS ok", [
        task.id,
      ])
    ).rows[0].ok;
  }, f.tenant);
  assert.equal(available, false);
});

test("additive brand contracts validate real responses and the complete running route inventory", async () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  createRequire(import.meta.url)("ajv-formats")(ajv);
  const defs = JSON.parse(
    JSON.stringify(contract.components.schemas).replaceAll(
      "#/components/schemas/",
      "#/$defs/",
    ),
  );
  const validate = (name: string, value: unknown) => {
    const check = ajv.compile({ $defs: defs, $ref: "#/$defs/" + name });
    assert.ok(check(value), JSON.stringify(check.errors));
  };
  const f = await fixture(),
    b = await create(f);
  validate("BrandDefinition", definition());
  validate("BrandPublication", b);
  validate(
    "BrandVersionList",
    await ok(f.owner, "GET", f.base + "/brand/" + b.id + "/versions"),
  );
  validate("BrandCheck", (await check(f, b)).data);
  assert.deepEqual(
    JSON.parse(
      await readFile(
        "../../docs/contracts/brand-production-openapi.json",
        "utf8",
      ),
    ),
    contract,
  );
  for (const [path, methods] of Object.entries(contract.paths))
    for (const method of Object.keys(methods))
      assert.ok(
        s.app.hasRoute({
          method: method.toUpperCase() as any,
          url: path.replace(/\{([^}]+)\}/g, ":$1"),
        }),
      );
  const inventory = JSON.parse(
      await readFile("contracts/implemented-routes.json", "utf8"),
    ),
    label = (r: { method: string; path: string }) => r.method + " " + r.path,
    actual = new Set(s.routes.map(label)),
    recorded = new Set<string>(
      [
        ...inventory.routes,
        ...(s.db.config.DEMO_MODE ? inventory.conditional_routes : []),
      ].map(label),
    );
  assert.deepEqual(
    [...actual].filter((x) => !recorded.has(x)),
    [],
    "Unrecorded actual operations",
  );
  assert.deepEqual(
    [...recorded].filter((x) => !actual.has(x)),
    [],
    "Inventory operations that are not registered",
  );
  assert.equal(
    actual.size,
    inventory.routes.length +
      (s.db.config.DEMO_MODE ? inventory.conditional_routes.length : 0),
  );
});

test("Unicode coverage prefers full repertoire and never unions inconsistent glyph maps", () => {
  const bytes = Buffer.alloc(132);
  bytes.writeUInt32BE(0x10000, 0);
  bytes.writeUInt16BE(2, 4);
  bytes.write("maxp", 12);
  bytes.writeUInt32BE(44, 20);
  bytes.writeUInt32BE(6, 24);
  bytes.writeUInt32BE(0x5000, 44);
  bytes.writeUInt16BE(8, 48);
  bytes.write("cmap", 28);
  bytes.writeUInt32BE(52, 36);
  bytes.writeUInt32BE(80, 40);
  bytes.writeUInt16BE(2, 54);
  bytes.writeUInt16BE(3, 56);
  bytes.writeUInt16BE(1, 58);
  bytes.writeUInt32BE(20, 60);
  bytes.writeUInt16BE(3, 64);
  bytes.writeUInt16BE(10, 66);
  bytes.writeUInt32BE(52, 68);
  const four = 72;
  for (const [offset, value] of [
    [0, 4],
    [2, 32],
    [6, 4],
    [8, 4],
    [10, 1],
    [14, 65],
    [16, 0xffff],
    [20, 65],
    [22, 0xffff],
    [24, 0xffc2],
    [26, 1],
  ])
    bytes.writeUInt16BE(value, four + offset);
  const twelve = 104;
  bytes.writeUInt16BE(12, twelve);
  bytes.writeUInt32BE(28, twelve + 4);
  bytes.writeUInt32BE(1, twelve + 12);
  bytes.writeUInt32BE(65, twelve + 16);
  bytes.writeUInt32BE(65, twelve + 20);
  assert.equal(
    inspectBrandFont(bytes)(65),
    false,
    "A format-4 glyph cannot override a missing format-12 glyph",
  );
  bytes.writeUInt32BE(3, twelve + 24);
  assert.equal(inspectBrandFont(bytes)(65), true);
  bytes.writeUInt16BE(1, 54);
  assert.equal(
    inspectBrandFont(bytes)(65),
    true,
    "BMP-only fonts still use format 4",
  );
});
