import { before, beforeEach, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PNG } from "pngjs";
import { createCanvas } from "@napi-rs/canvas";
import pg from "pg";
import * as OTPAuth from "otpauth";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { loadConfig } from "../src/config.js";
import { buildApp } from "../src/server.js";
import { advanceCreativeMatrices } from "../src/creative-matrices.js";
import { renderMatrixUnit } from "../src/creative-matrix-layout.js";
import {
  matrixCreate,
  matrixCreated,
  matrixUpdated,
  matrixCancelled,
  matrixList,
  matrixDetail,
} from "../src/creative-matrix-model.js";
import { saveAsset } from "../src/storage.js";
import { hash, canonical, seal } from "../src/lib.js";
import { ErasureService } from "../src/erasure.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string; admin?: boolean };
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEMO_MODE: "true",
      WORKER_ENABLED: "false",
      DEV_MAILBOX: "true",
    }),
    { worker: false },
  );
});
beforeEach(async () => {
  // Close only this suite's previous pending fixtures; production DBs are isolated.
  await s.db.control.query(
    "UPDATE creative_projects SET body=jsonb_set(body,'{cancelled}','true') WHERE kind='creative_matrix' AND content_state='active'",
  );
  await s.db.control.query(
    "UPDATE creative_matrix_attempts SET state='cancelled',finished_at=clock_timestamp() WHERE state='rendering'",
  );
  await s.db.control.query(
    "UPDATE creative_matrix_units SET state='cancelled' WHERE state IN('queued','rendering')",
  );
});
after(async () => {
  try {
    await s?.app.close();
  } finally {
    await isolated?.cleanup();
  }
});
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  requestKey = randomUUID(),
) {
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: url.startsWith("/v1/admin/")
        ? s.db.config.ADMIN_ORIGIN
        : s.db.config.WEB_ORIGIN,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      "idempotency-key": requestKey,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
  let data: any;
  try {
    data = raw.json();
  } catch {
    data = null;
  }
  if (raw.statusCode === 200 && url.includes("/creative-batches")) {
    const dto = /\/units\/[^/]+\/(edit|retry)$/.test(url)
      ? matrixUpdated
      : url.endsWith("/cancel")
        ? matrixCancelled
        : method === "POST"
          ? matrixCreated
          : /\/creative-batches(?:\?|$)/.test(url)
            ? matrixList
            : matrixDetail;
    assert.ok(dto.safeParse(data).success, JSON.stringify(dto.safeParse(data)));
  }
  return { status: raw.statusCode, data, raw };
}
function ok(r: Awaited<ReturnType<typeof call>>) {
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
async function user(): Promise<Client> {
  const c = ok(
    await call(undefined, "POST", "/v1/auth/challenge", {
      email: `matrix-${randomUUID()}@example.invalid`,
    }),
  );
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${c.challenge_id}.json`,
      "utf8",
    ),
  );
  const r = await call(undefined, "POST", "/v1/auth/verify", {
    challenge_id: c.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
  });
  const body = ok(r);
  return {
    id: body.user.id,
    csrf: body.csrf_token,
    cookie: r.raw.cookies[0].name + "=" + r.raw.cookies[0].value,
  };
}
async function fixture() {
  const owner = await user(),
    w = ok(
      await call(owner, "POST", "/v1/tenants", {
        name: "Matrix fixture",
        project_name: "Campaign",
      }),
    );
  return {
    owner,
    tenant: w.tenant.id as string,
    project: w.project.id as string,
    base: `/v1/tenants/${w.tenant.id}/projects/${w.project.id}`,
  };
}
async function operator(role: string, tenant: string): Promise<Client> {
  const email = `matrix-admin-${randomUUID()}@example.invalid`,
    secret = new OTPAuth.Secret({ size: 20 });
  const p = (
    await s.db.control.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,$2,$3) RETURNING id",
      [email, role, seal(s.db.config.MASTER_KEY!, secret.base32)],
    )
  ).rows[0];
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,'tenant',$3)",
    [p.id, role, tenant],
  );
  const c = ok(
    await call(undefined, "POST", "/v1/admin/auth/challenge", { email }),
  );
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${c.challenge_id}.json`,
      "utf8",
    ),
  );
  const r = await call(undefined, "POST", "/v1/admin/auth/verify", {
    challenge_id: c.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
    totp: new OTPAuth.TOTP({
      secret,
      digits: 6,
      period: 30,
      algorithm: "SHA1",
    }).generate(),
  });
  const b = ok(r),
    cookie = r.raw.cookies.find((v) => v.name === "cp_admin_session")!;
  return {
    id: p.id,
    csrf: b.csrf_token,
    cookie: cookie.name + "=" + cookie.value,
    admin: true,
  };
}
const copy = (language = "en") =>
  language === "en"
    ? {
        brand_line: "HONG KONG",
        headline: "Room for a new idea",
        body: "One direction. Every format.",
        action: "Discover more",
      }
    : {
        brand_line: "香港",
        headline: "為下一個創意騰出空間",
        body: "同一個方向，逐個版位調整。",
        action: "立即了解",
      };
function spec(count = 1) {
  return {
    name: "Campaign matrix",
    locales: ["zh-HK", "en"],
    sizes: [
      { key: "square", name: "Square", width: 512, height: 512 },
      { key: "portrait", name: "Portrait", width: 512, height: 640 },
      { key: "landscape", name: "Landscape", width: 768, height: 384 },
    ],
    creatives: Array.from({ length: count }, (_, i) => ({
      key: `direction-${i + 1}`,
      name: `Direction ${i + 1}`,
      theme: { background: "#F6F6F4", ink: "#15171A", accent: "#1F5EFF" },
      image: null as { asset_id: string; version: number } | null,
      copy: ["zh-HK", "en"].map((locale) => ({ locale, text: copy(locale) })),
    })),
  };
}
async function create(f: Awaited<ReturnType<typeof fixture>>, body = spec()) {
  return ok(await call(f.owner, "POST", f.base + "/creative-batches", body))
    .id as string;
}
async function detail(f: Awaited<ReturnType<typeof fixture>>, id: string) {
  return ok(await call(f.owner, "GET", `${f.base}/creative-batches/${id}`));
}
async function finish() {
  for (let i = 0; i < 250; i++) {
    const result = await advanceCreativeMatrices(s.db, s.storage);
    if (!result) return;
  }
  throw new Error("Unbounded matrix execution");
}
function one() {
  const b = spec();
  b.locales = ["en"];
  b.sizes = [b.sizes[0]];
  b.creatives[0].copy = [b.creatives[0].copy[1]];
  return b;
}
async function png(
  f: Awaited<ReturnType<typeof fixture>>,
  extra: Record<string, unknown> = {},
) {
  const canvas = createCanvas(64, 64),
    ctx = canvas.getContext("2d");
  ctx.fillStyle = "#1F5EFF";
  ctx.fillRect(0, 0, 64, 64);
  return s.db.tx(
    (tx) =>
      saveAsset(tx, s.storage, {
        tenant: f.tenant,
        project: f.project,
        user: f.owner.id,
        name: "Source.png",
        mime: "image/png",
        bytes: canvas.toBuffer("image/png"),
        ...extra,
      }),
    f.tenant,
    true,
    f.owner.id,
  );
}
function held() {
  let release!: () => void, entered!: () => void;
  const ready = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r));
  return {
    ready,
    release,
    render: async (...args: Parameters<typeof renderMatrixUnit>) => {
      entered();
      await gate;
      return renderMatrixUnit(...args);
    },
  };
}
async function ownerQuery(sql: string) {
  const client = new pg.Client({
    connectionString: isolated.env.OWNER_DATABASE_URL,
  });
  await client.connect();
  try {
    return await client.query(sql);
  } finally {
    await client.end();
  }
}

test("matrix admission rejects duplicate axes, missing translations, cost overrides and more than 60 units before persistence", async () => {
  const f = await fixture();
  const invalid: any[] = [
    spec(11),
    { ...spec(), locales: ["en", "en"] },
    { ...spec(), sizes: [spec().sizes[0], spec().sizes[0]] },
    { ...spec(), creatives: [spec().creatives[0], spec().creatives[0]] },
    { ...spec(), ai_cost_micros: 0 },
  ];
  const missing = spec();
  missing.creatives[0].copy.pop();
  invalid.push(missing);
  for (const body of invalid)
    assert.equal(
      (await call(f.owner, "POST", f.base + "/creative-batches", body)).status,
      400,
    );
  assert.equal(
    Number(
      (
        await s.db.control.query(
          "SELECT count(*) FROM creative_projects WHERE project_id=$1",
          [f.project],
        )
      ).rows[0].count,
    ),
    0,
  );
  assert.ok(matrixCreate.safeParse(spec(10)).success);
});
test("TC-017: 18 real units preserve 16 siblings when one fails, another changes, and only the failed unit retries", async () => {
  const f = await fixture(),
    image = await png(f),
    b = spec(3);
  for (const c of b.creatives) c.image = { asset_id: image.id, version: 1 };
  const id = await create(f, b),
    get = s.storage.get.bind(s.storage);
  let failOnce = true;
  s.storage.get = async (key) => {
    if (failOnce) {
      failOnce = false;
      throw Object.assign(new Error("fixture transient object read"), {
        code: "EIO",
      });
    }
    return get(key);
  };
  try {
    await finish();
  } finally {
    s.storage.get = get;
  }
  const initial = await detail(f, id);
  assert.equal(initial.units.length, 18);
  assert.equal(initial.counts.succeeded, 17);
  assert.equal(initial.counts.failed, 1);
  assert.equal(initial.state, "partially_succeeded");
  const bad = initial.units.find((u: any) => u.state === "failed"),
    changed = initial.units.find((u: any) => u.state === "succeeded");
  const siblings = initial.units.filter(
    (u: any) => u.id !== bad.id && u.id !== changed.id,
  );
  ok(
    await call(
      f.owner,
      "POST",
      `${f.base}/creative-batches/${id}/units/${changed.id}/edit`,
      {
        expected_revision: 1,
        copy: { ...changed.input.copy, headline: "A revised direction" },
      },
    ),
  );
  ok(
    await call(
      f.owner,
      "POST",
      `${f.base}/creative-batches/${id}/units/${bad.id}/retry`,
      { expected_revision: 1 },
    ),
  );
  await finish();
  const final = await detail(f, id);
  assert.equal(final.state, "succeeded");
  for (const sibling of siblings)
    assert.deepEqual(
      final.units.find((u: any) => u.id === sibling.id),
      sibling,
    );
  assert.equal(
    final.units.find((u: any) => u.id === changed.id).attempts.length,
    2,
  );
  assert.equal(
    final.units.find((u: any) => u.id === bad.id).attempts.length,
    2,
  );
  for (const unit of final.units) {
    const attempt = unit.attempts.at(-1);
    assert.equal(attempt.ai_cost_micros, "0");
    assert.equal(attempt.cost_source, "local_composition_no_ai");
    const out = await call(
      f.owner,
      "GET",
      `${f.base}/assets/${attempt.png_asset_id}/download`,
    );
    assert.equal(out.status, 200);
    const decoded = PNG.sync.read(out.raw.rawPayload);
    assert.equal(decoded.width, unit.input.size.width);
    assert.equal(decoded.height, unit.input.size.height);
    const source = await call(
      f.owner,
      "GET",
      `${f.base}/assets/${attempt.source_asset_id}/download`,
    );
    assert.equal(source.status, 200);
    const layout = JSON.parse(source.raw.body);
    assert.equal(layout.input.copy.headline, unit.input.copy.headline);
    assert.equal(layout.input.locale, unit.locale);
  }
  assert.equal(
    Number(
      (
        await s.db.control.query(
          "SELECT count(*) FROM ledger WHERE tenant_id=$1",
          [f.tenant],
        )
      ).rows[0].count,
    ),
    0,
  );
  const events = (
    await s.db.control.query(
      "SELECT tenant_id,outcome FROM audit_log WHERE target=$1 AND action LIKE 'creative.matrix.%'",
      [id],
    )
  ).rows;
  assert.equal(events.length, 23);
  assert.ok(events.every((e) => e.tenant_id === f.tenant));
  assert.equal(events.filter((e) => e.outcome === "failed").length, 1);
  assert.ok(!JSON.stringify(final).includes("lease_token"));
});
test("a full 60-unit matrix renders real independent files and refuses 66 without adding rows", async () => {
  const f = await fixture(),
    b = spec(10);
  b.sizes = b.sizes.map((size) => ({
    ...size,
    width: 256,
    height: size.key === "portrait" ? 320 : 256,
  }));
  for (const c of b.creatives)
    c.copy = c.copy.map((v) => ({
      ...v,
      text: { brand_line: "", headline: "香港 HK", body: "", action: "" },
    }));
  const id = await create(f, b);
  await finish();
  const d = await detail(f, id);
  assert.equal(d.counts.succeeded, 60);
  assert.equal(
    new Set(d.units.map((u: any) => u.attempts[0].png_asset_id)).size,
    60,
  );
  assert.equal(
    (await call(f.owner, "POST", f.base + "/creative-batches", spec(11)))
      .status,
    400,
  );
  assert.equal(
    Number(
      (
        await s.db.control.query(
          "SELECT count(*) FROM creative_matrix_units WHERE project_id=$1",
          [f.project],
        )
      ).rows[0].count,
    ),
    60,
  );
});
test("creation and per-unit updates bind idempotency to exact content and revision", async () => {
  const f = await fixture(),
    k = randomUUID(),
    input = one();
  const [a, b] = await Promise.all([
    call(f.owner, "POST", f.base + "/creative-batches", input, k),
    call(f.owner, "POST", f.base + "/creative-batches", input, k),
  ]);
  assert.equal(ok(a).id, ok(b).id);
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        f.base + "/creative-batches",
        { ...input, name: "Changed" },
        k,
      )
    ).status,
    409,
  );
  const d = await detail(f, a.data.id),
    u = d.units[0],
    path = `${f.base}/creative-batches/${d.id}/units/${u.id}/edit`;
  const edits = await Promise.all([
    call(f.owner, "POST", path, {
      expected_revision: 1,
      copy: { ...copy(), headline: "First" },
    }),
    call(f.owner, "POST", path, {
      expected_revision: 1,
      copy: { ...copy(), headline: "Second" },
    }),
  ]);
  assert.deepEqual(edits.map((v) => v.status).sort(), [200, 409]);
  assert.equal(
    Number(
      (
        await s.db.control.query(
          "SELECT count(*) FROM creative_matrix_revisions WHERE unit_id=$1",
          [u.id],
        )
      ).rows[0].count,
    ),
    2,
  );
  assert.equal(
    (
      await call(f.owner, "PUT", f.base + "/creative/" + d.id, {
        name: "Bypass",
        version: 1,
        body: { width: 256, height: 256, background: "#ffffff", layers: [] },
      })
    ).status,
    409,
  );
});
test("server layout reflows three aspect ratios, preserves Unicode/price and reports overflow without truncating", async () => {
  const raw = {
    renderer: "copypaste-layout-1" as const,
    locale: "zh-HK" as const,
    creative_key: "test",
    creative_name: "Test",
    size: spec().sizes[0],
    theme: spec().creatives[0].theme,
    copy: {
      brand_line: "香港 HONG KONG",
      headline: "繁中 & English HK$128",
      body: "<script>不是程式</script>",
      action: "了解更多",
    },
    image: null,
  };
  const layouts = [];
  for (const size of spec().sizes) {
    const out = await renderMatrixUnit({ ...raw, size });
    layouts.push(out.layout);
    assert.ok(out.svg.toString().includes("&lt;script&gt;"));
    assert.equal(out.layout.input.copy.headline, raw.copy.headline);
    assert.equal(PNG.sync.read(out.png).width, size.width);
  }
  assert.deepEqual(
    layouts.map((l) => l.arrangement),
    ["square", "portrait", "landscape"],
  );
  assert.notDeepEqual(layouts[0].text_boxes, layouts[2].text_boxes);
  await assert.rejects(
    renderMatrixUnit({
      ...raw,
      size: { key: "small", name: "Small", width: 256, height: 256 },
      copy: { ...raw.copy, headline: "繁".repeat(240) },
    }),
    (e: any) => e.code === "TEXT_OVERFLOW",
  );
});
test("project viewers and other enterprises cannot read, create, edit or cancel a matrix", async () => {
  const f = await fixture(),
    other = await fixture(),
    viewer = await user(),
    id = await create(f, one());
  await s.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'viewer')",
    [f.tenant, viewer.id],
  );
  await s.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'viewer')",
    [f.tenant, f.project, viewer.id],
  );
  const d = await detail(f, id);
  assert.equal(
    (await call(other.owner, "GET", `${f.base}/creative-batches/${id}`)).status,
    404,
  );
  assert.equal(
    (await call(f.owner, "GET", `${other.base}/creative-batches/${id}`)).status,
    404,
  );
  assert.equal(
    (await call(viewer, "GET", `${f.base}/creative-batches/${id}`)).status,
    200,
  );
  for (const [url, body] of [
    [f.base + "/creative-batches", one()],
    [`${f.base}/creative-batches/${id}/cancel`, { expected_version: 1 }],
    [
      `${f.base}/creative-batches/${id}/units/${d.units[0].id}/edit`,
      { expected_revision: 1, copy: copy() },
    ],
  ] as const)
    assert.equal((await call(viewer, "POST", url, body)).status, 403);
  assert.equal(
    (
      await s.db.tx(
        (tx) =>
          tx.query("SELECT id FROM creative_matrix_units WHERE batch_id=$1", [
            id,
          ]),
        other.tenant,
      )
    ).rowCount,
    0,
  );
});
test("fixed image versions survive later uploads, and source quarantine immediately blocks derived downloads", async () => {
  const f = await fixture(),
    image = await png(f),
    b = one();
  b.creatives[0].image = { asset_id: image.id, version: 1 };
  const id = await create(f, b);
  await png(f, { asset: image.id, expectedVersion: 1 });
  await finish();
  const d = await detail(f, id);
  assert.equal(d.units[0].input.image.version, 1);
  const a = d.units[0].attempts[0];
  assert.equal(
    (await call(f.owner, "GET", `${f.base}/assets/${a.png_asset_id}/download`))
      .status,
    200,
  );
  await s.db.control.query(
    "UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",
    [image.id],
  );
  const blocked = await detail(f, id);
  assert.equal(blocked.units[0].source_available, false);
  assert.equal(blocked.units[0].attempts[0].output_available, false);
  for (const asset of [a.png_asset_id, a.svg_asset_id, a.source_asset_id])
    assert.equal(
      (await call(f.owner, "GET", `${f.base}/assets/${asset}/download`)).status,
      404,
    );
  await s.db.control.query(
    "UPDATE assets SET state='active',moderation_version=moderation_version+1 WHERE id=$1",
    [image.id],
  );
  assert.equal(
    (await call(f.owner, "GET", `${f.base}/assets/${a.png_asset_id}/download`))
      .status,
    200,
  );
  assert.equal(
    (await detail(f, id)).units[0].attempts[0].output_available,
    true,
  );
});
test("cancelling during rendering fences the late completion and preserves already completed siblings", async () => {
  const f = await fixture(),
    b = one();
  b.creatives.push({ ...b.creatives[0], key: "second" });
  const id = await create(f, b);
  await advanceCreativeMatrices(s.db, s.storage);
  const initial = await detail(f, id),
    done = initial.units.find((u: any) => u.state === "succeeded");
  const hold = held(),
    pending = advanceCreativeMatrices(s.db, s.storage, hold.render);
  try {
    await hold.ready;
    ok(
      await call(f.owner, "POST", `${f.base}/creative-batches/${id}/cancel`, {
        expected_version: 1,
      }),
    );
  } finally {
    hold.release();
    await pending;
  }
  const d = await detail(f, id);
  assert.equal(d.counts.succeeded, 1);
  assert.equal(d.counts.cancelled, 1);
  assert.deepEqual(
    d.units.find((u: any) => u.id === done.id),
    done,
  );
  assert.equal(
    Number(
      (
        await s.db.control.query(
          "SELECT count(*) FROM assets WHERE project_id=$1",
          [f.project],
        )
      ).rows[0].count,
    ),
    3,
  );
});
test("concurrent workers enforce one tenant render and two global renders with no duplicate claims", async () => {
  const f = await fixture(),
    g = await fixture(),
    h = await fixture(),
    b = one();
  b.creatives.push({ ...b.creatives[0], key: "second" });
  await create(f, b);
  await create(g, one());
  await create(h, one());
  const first = held(),
    second = held(),
    p1 = advanceCreativeMatrices(s.db, s.storage, first.render);
  let p2: Promise<any> | undefined;
  try {
    await first.ready;
    p2 = advanceCreativeMatrices(s.db, s.storage, second.render);
    await second.ready;
    assert.equal(await advanceCreativeMatrices(s.db, s.storage), null);
    const active = (
      await s.db.control.query(
        "SELECT tenant_id,count(*)::int AS n FROM creative_matrix_attempts WHERE state='rendering' GROUP BY tenant_id",
      )
    ).rows;
    assert.equal(active.length, 2);
    assert.ok(active.every((v) => v.n === 1));
  } finally {
    first.release();
    second.release();
    await Promise.all([p1, p2]);
  }
});
test("authorization loss during rendering prevents publication; an authorized owner can explicitly retry", async () => {
  const f = await fixture(),
    member = await user();
  await s.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
    [f.tenant, member.id],
  );
  await s.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",
    [f.tenant, f.project, member.id],
  );
  const id = ok(
      await call(member, "POST", f.base + "/creative-batches", one()),
    ).id,
    hold = held(),
    pending = advanceCreativeMatrices(s.db, s.storage, hold.render);
  try {
    await hold.ready;
    await s.db.control.query(
      "DELETE FROM project_members WHERE project_id=$1 AND user_id=$2",
      [f.project, member.id],
    );
  } finally {
    hold.release();
    await pending;
  }
  const d = await detail(f, id);
  assert.equal(d.counts.failed, 1);
  assert.equal(
    Number(
      (
        await s.db.control.query(
          "SELECT count(*) FROM assets WHERE project_id=$1",
          [f.project],
        )
      ).rows[0].count,
    ),
    0,
  );
  ok(
    await call(
      f.owner,
      "POST",
      `${f.base}/creative-batches/${id}/units/${d.units[0].id}/retry`,
      { expected_revision: 1 },
    ),
  );
  await finish();
  assert.equal((await detail(f, id)).counts.succeeded, 1);
});
test("storage failure rolls back every output reference and a retry preserves the failed receipt", async () => {
  const f = await fixture(),
    id = await create(f, one()),
    put = s.storage.put.bind(s.storage);
  let n = 0;
  s.storage.put = async (...args) => {
    if (++n === 2) throw new Error("fixture storage write failure");
    return put(...args);
  };
  try {
    await advanceCreativeMatrices(s.db, s.storage);
  } finally {
    s.storage.put = put;
  }
  let d = await detail(f, id);
  assert.equal(d.counts.failed, 1);
  assert.equal(
    Number(
      (
        await s.db.control.query(
          "SELECT count(*) FROM assets WHERE project_id=$1",
          [f.project],
        )
      ).rows[0].count,
    ),
    0,
  );
  ok(
    await call(
      f.owner,
      "POST",
      `${f.base}/creative-batches/${id}/units/${d.units[0].id}/retry`,
      { expected_revision: 1 },
    ),
  );
  await finish();
  d = await detail(f, id);
  assert.deepEqual(
    d.units[0].attempts.map((a: any) => a.state),
    ["failed", "succeeded"],
  );
});
test("expired leases retain an interrupted receipt and prevent late publication after another worker recovers", async () => {
  const f = await fixture(),
    id = await create(f, one()),
    hold = held(),
    pending = advanceCreativeMatrices(s.db, s.storage, hold.render, {
      leaseSeconds: 1,
    });
  try {
    await hold.ready;
    await new Promise((r) => setTimeout(r, 1200));
    await advanceCreativeMatrices(s.db, s.storage);
  } finally {
    hold.release();
    await pending;
  }
  const d = await detail(f, id);
  assert.equal(d.units[0].attempts[0].error_code, "RENDER_INTERRUPTED");
  assert.equal(d.counts.failed, 1);
  assert.equal(
    Number(
      (
        await s.db.control.query(
          "SELECT count(*) FROM assets WHERE project_id=$1",
          [f.project],
        )
      ).rows[0].count,
    ),
    0,
  );
  ok(
    await call(
      f.owner,
      "POST",
      `${f.base}/creative-batches/${id}/units/${d.units[0].id}/retry`,
      { expected_revision: 1 },
    ),
  );
  await finish();
  assert.equal((await detail(f, id)).counts.succeeded, 1);
});
test("audit insertion failure prevents all publication and cannot report success", async () => {
  const f = await fixture(),
    id = await create(f, one());
  await ownerQuery(
    "CREATE FUNCTION fixture_matrix_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN IF NEW.action='creative.matrix.render' THEN RAISE EXCEPTION 'fixture audit unavailable'; END IF; RETURN NEW; END$$; CREATE TRIGGER fixture_matrix_audit_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fixture_matrix_audit_failure()",
  );
  try {
    await advanceCreativeMatrices(s.db, s.storage);
  } finally {
    await ownerQuery(
      "DROP TRIGGER fixture_matrix_audit_failure ON audit_log; DROP FUNCTION fixture_matrix_audit_failure()",
    );
  }
  assert.equal((await detail(f, id)).counts.failed, 1);
  assert.equal(
    Number(
      (
        await s.db.control.query(
          "SELECT count(*) FROM assets WHERE project_id=$1",
          [f.project],
        )
      ).rows[0].count,
    ),
    0,
  );
});
test("parent quarantine stops queued/running work and denies existing outputs; restore requires explicit retry", async () => {
  const f = await fixture(),
    b = one();
  b.creatives.push({ ...b.creatives[0], key: "second" });
  const id = await create(f, b);
  await advanceCreativeMatrices(s.db, s.storage);
  const d = await detail(f, id),
    a = d.units.find((u: any) => u.state === "succeeded").attempts[0];
  await s.db.control.query(
    "UPDATE creative_projects SET content_state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",
    [id],
  );
  assert.equal(
    (await call(f.owner, "GET", `${f.base}/creative-batches/${id}`)).status,
    404,
  );
  assert.equal(
    (await call(f.owner, "GET", `${f.base}/assets/${a.png_asset_id}/download`))
      .status,
    404,
  );
  await s.db.control.query(
    "UPDATE creative_projects SET content_state='active',moderation_version=moderation_version+1 WHERE id=$1",
    [id],
  );
  const restored = await detail(f, id);
  assert.equal(restored.counts.cancelled, 1);
  assert.equal(await advanceCreativeMatrices(s.db, s.storage), null);
});
test("deletion erases all input revisions, replay copies and real output objects through the existing journal", async () => {
  const f = await fixture(),
    id = await create(f, one());
  await finish();
  let d = await detail(f, id);
  const unit = d.units[0];
  ok(
    await call(
      f.owner,
      "POST",
      `${f.base}/creative-batches/${id}/units/${unit.id}/edit`,
      {
        expected_revision: 1,
        copy: { ...copy(), headline: "Remove this private campaign wording" },
      },
    ),
  );
  await finish();
  await s.db.control.query(
    "UPDATE creative_projects SET content_state='deleted',moderation_version=moderation_version+1 WHERE id=$1",
    [id],
  );
  const service = new ErasureService(s.db, s.storage);
  for (let i = 0; i < 8; i++) {
    await s.db.control.query(
      "UPDATE deletion_jobs SET next_attempt_at=now() WHERE state='queued'",
    );
    await service.advance(20);
  }
  assert.equal(
    (await call(f.owner, "GET", `${f.base}/creative-batches/${id}`)).status,
    404,
  );
  assert.ok(
    (
      await s.db.control.query(
        "SELECT input FROM creative_matrix_revisions WHERE unit_id=$1",
        [unit.id],
      )
    ).rows.every((r) => canonical(r.input) === "{}"),
  );
  const files = (
    await s.db.control.query(
      "SELECT v.storage_key,v.erased_at FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE a.project_id=$1",
      [f.project],
    )
  ).rows;
  assert.equal(files.length, 6);
  for (const file of files) {
    assert.ok(file.erased_at);
    await assert.rejects(s.storage.get(file.storage_key));
  }
  assert.equal(
    (
      await s.db.control.query(
        "SELECT body FROM creative_projects WHERE id=$1",
        [id],
      )
    ).rows[0].body.constructor,
    Object,
  );
  assert.deepEqual(
    (
      await s.db.control.query(
        "SELECT body FROM creative_projects WHERE id=$1",
        [id],
      )
    ).rows[0].body,
    {},
  );
  assert.ok(
    (
      await s.db.control.query(
        "SELECT response FROM request_replays WHERE action LIKE $1",
        [`%${unit.id}`],
      )
    ).rows.every((r) => canonical(r.response) === "{}"),
  );
});
test("completed receipts and input revisions cannot be overwritten, including by the control identity", async () => {
  const f = await fixture(),
    id = await create(f, one());
  await finish();
  const d = await detail(f, id),
    unit = d.units[0];
  await assert.rejects(
    s.db.control.query(
      "UPDATE creative_matrix_revisions SET input='{}' WHERE unit_id=$1",
      [unit.id],
    ),
    (e: any) => e.code === "23514",
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE creative_matrix_attempts SET error_code='REWRITTEN' WHERE unit_id=$1",
      [unit.id],
    ),
    (e: any) => e.code === "23514",
  );
  await assert.rejects(
    s.db.app.query("UPDATE creative_matrix_attempts SET state='succeeded'"),
    (e: any) => e.code === "42501",
  );
});
test("source quarantine follows nested matrices and source deletion physically removes every embedded derived copy", async () => {
  const f = await fixture(),
    image = await png(f),
    b = one();
  b.creatives[0].image = { asset_id: image.id, version: 1 };
  const first = await create(f, b);
  await finish();
  const output = (await detail(f, first)).units[0].attempts[0];
  const secondSpec = one();
  secondSpec.creatives[0].image = { asset_id: output.png_asset_id, version: 1 };
  const second = await create(f, secondSpec);
  await finish();
  const nested = (await detail(f, second)).units[0].attempts[0];
  await s.db.control.query(
    "UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",
    [image.id],
  );
  assert.equal(
    (
      await call(
        f.owner,
        "GET",
        `${f.base}/assets/${nested.svg_asset_id}/download`,
      )
    ).status,
    404,
  );
  await s.db.control.query(
    "UPDATE assets SET state='deleted',moderation_version=moderation_version+1 WHERE id=$1",
    [image.id],
  );
  const files = (
    await s.db.control.query(
      "SELECT v.storage_key,a.state FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE a.project_id=$1",
      [f.project],
    )
  ).rows;
  assert.equal(files.length, 7);
  assert.ok(files.every((v) => v.state === "deleted"));
  const service = new ErasureService(s.db, s.storage);
  for (let i = 0; i < 10; i++) {
    await s.db.control.query(
      "UPDATE deletion_jobs SET next_attempt_at=now() WHERE state='queued'",
    );
    await service.advance(20);
  }
  for (const file of files)
    await assert.rejects(s.storage.get(file.storage_key));
  assert.ok(
    (
      await s.db.control.query(
        "SELECT state FROM deletion_jobs WHERE target_type='assets' AND tenant_id=$1",
        [f.tenant],
      )
    ).rows.every((r) => r.state === "completed"),
  );
});

test("Admin body permission is independent and scoped; real content actions stop and erase matrices", async () => {
  const f = await fixture(),
    id = await create(f, one());
  await finish();
  let d = await detail(f, id);
  const u = d.units[0];
  ok(
    await call(
      f.owner,
      "POST",
      `${f.base}/creative-batches/${id}/units/${u.id}/edit`,
      {
        expected_revision: 1,
        copy: { ...copy(), headline: "Second input revision" },
      },
    ),
  );
  await finish();
  const a = await operator("super_admin", f.tenant),
    support = await operator("support_agent", f.tenant),
    outside = await operator("super_admin", randomUUID());
  const endpoint = "/v1/admin/content/" + id;
  assert.equal((await call(support, "GET", endpoint + "/body")).status, 403);
  assert.equal((await call(outside, "GET", endpoint + "/body")).status, 403);
  const body = JSON.parse(ok(await call(a, "GET", endpoint + "/body")).text);
  assert.equal(body.revisions.length, 2);
  assert.equal(body.attempts.length, 2);
  assert.ok(!JSON.stringify(body).includes("lease_token"));
  assert.equal(
    (
      await call(outside, "POST", endpoint + "/action", {
        action: "quarantine",
        version: 1,
        reason: "Outside scoped operator",
      })
    ).status,
    403,
  );
  ok(
    await call(a, "POST", endpoint + "/action", {
      action: "quarantine",
      version: 1,
      reason: "Quarantine actual matrix content",
    }),
  );
  assert.equal(
    (await call(f.owner, "GET", f.base + "/creative-batches/" + id)).status,
    404,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "GET",
        `${f.base}/assets/${u.attempts[0].png_asset_id}/download`,
      )
    ).status,
    404,
  );
  ok(
    await call(a, "POST", endpoint + "/action", {
      action: "restore",
      version: 2,
      reason: "Restore actual matrix content",
    }),
  );
  d = await detail(f, id);
  assert.equal(d.units[0].attempts.length, 2);
  ok(
    await call(a, "POST", endpoint + "/action", {
      action: "delete",
      version: 3,
      reason: "Erase all matrix revisions and derived files",
    }),
  );
  assert.equal((await call(a, "GET", endpoint + "/body")).status, 410);
  const service = new ErasureService(s.db, s.storage);
  for (let i = 0; i < 8; i++) {
    await s.db.control.query(
      "UPDATE deletion_jobs SET next_attempt_at=now() WHERE state='queued'",
    );
    await service.advance(20);
  }
  assert.ok(
    (
      await s.db.control.query(
        "SELECT input FROM creative_matrix_revisions WHERE unit_id=$1",
        [u.id],
      )
    ).rows.every((r) => canonical(r.input) === "{}"),
  );
  const events = (
    await s.db.control.query(
      "SELECT action,outcome FROM audit_log WHERE target=$1 AND action LIKE 'admin.content.%'",
      [id],
    )
  ).rows;
  for (const action of ["body.read", "quarantine", "restore", "delete"])
    assert.ok(
      events.some(
        (e) =>
          e.action === "admin.content." + action && e.outcome === "succeeded",
      ),
    );
});

test("private or other-project PNG inputs are rejected, and corrupt fixed bytes cannot publish", async () => {
  const f = await fixture(),
    g = await fixture(),
    image = await png(f),
    other = await png(g),
    b = one();
  for (const ref of [
    { asset_id: other.id, version: 1 },
    { asset_id: image.id, version: 2 },
  ]) {
    b.creatives[0].image = ref;
    assert.equal(
      (await call(f.owner, "POST", f.base + "/creative-batches", b)).status,
      422,
    );
  }
  await s.db.control.query("UPDATE assets SET private_owner=$2 WHERE id=$1", [
    image.id,
    f.owner.id,
  ]);
  b.creatives[0].image = { asset_id: image.id, version: 1 };
  assert.equal(
    (await call(f.owner, "POST", f.base + "/creative-batches", b)).status,
    422,
  );
  await s.db.control.query("UPDATE assets SET private_owner=NULL WHERE id=$1", [
    image.id,
  ]);
  const id = await create(f, b),
    get = s.storage.get.bind(s.storage);
  s.storage.get = async () => Buffer.from("invalid image bytes");
  try {
    await finish();
  } finally {
    s.storage.get = get;
  }
  const d = await detail(f, id);
  assert.equal(d.counts.failed, 1);
  assert.equal(d.units[0].attempts[0].error_code, "IMAGE_SOURCE_INTEGRITY");
  assert.equal(
    Number(
      (
        await s.db.control.query(
          "SELECT count(*) FROM assets WHERE project_id=$1",
          [f.project],
        )
      ).rows[0].count,
    ),
    1,
  );
});
