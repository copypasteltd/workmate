import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { unzipSync } from "fflate";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { Worker } from "../src/worker.js";
import {
  CodexRuntimeAdapter,
  type RuntimeContext,
  type RuntimeResult,
} from "../src/runtime.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { advanceConnectors } from "../src/connectors.js";
import { desktopCompanyToolSchema } from "../src/desktop-tool-policy.js";
import { hash } from "../src/lib.js";
import { saveAsset } from "../src/storage.js";
import {
  demoVectorInput,
  demoSlidesInput,
} from "../src/editable-design-demo.js";
import { PNG } from "pngjs";
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string };
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  tenant?: string,
  key: string = randomUUID(),
) {
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: "http://localhost:4317",
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      ...(tenant ? { "x-tenant-id": tenant } : {}),
      "idempotency-key": key,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
  return {
    status: raw.statusCode,
    data: raw.headers["content-type"]?.includes("application/json")
      ? raw.json()
      : raw.body,
    raw,
  };
}
async function ok(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  tenant?: string,
  key?: string,
) {
  const r = await call(c, method, url, body, tenant, key);
  assert.ok(
    r.status >= 200 && r.status < 300,
    `${r.status} ${JSON.stringify(r.data)}`,
  );
  return r.data;
}
async function user(): Promise<Client> {
  const ch = await ok(undefined, "POST", "/v1/auth/challenge", {
    email: `analysis-role-${randomUUID()}@example.invalid`,
  });
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${ch.challenge_id}.json`,
      "utf8",
    ),
  );
  const r = await call(undefined, "POST", "/v1/auth/verify", {
    challenge_id: ch.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
  });
  assert.equal(r.status, 200);
  return {
    id: r.data.user.id,
    cookie:
      r.raw.cookies.find((c) => c.name === "cp_session")!.name +
      "=" +
      r.raw.cookies.find((c) => c.name === "cp_session")!.value,
    csrf: r.data.csrf_token,
  };
}
async function fixture(role = "brand-visual") {
  const owner = await user(),
    w = await ok(owner, "POST", "/v1/tenants", {
      name: "Synthetic role checks",
      project_name: "Marketing workspace",
    });
  const tenant = w.tenant.id,
    project = w.project.id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  await ok(owner, "POST", `/v1/tenants/${tenant}/demo-credit`, {});
  const d = await ok(owner, "POST", base + "/analytics/import", {
    name: "Confirmed campaign source",
    csv: "date,channel,campaign,impressions,clicks,spend,conversions,revenue,currency\n2026-10-01,Google,Launch,100,10,10,1,20,HKD\n2026-10-02,Google,Launch,1000,200,90,3,180,HKD",
    currency: "HKD",
    account_id: "account",
    attribution_definition: "7d click",
    conversion_definition: "Purchase",
  });
  const templates = await ok(
    owner,
    "GET",
    "/v1/agent-templates?limit=30",
    undefined,
    tenant,
  );
  const template = templates.items.find((t: any) => t.role_key === role);
  assert.ok(template, JSON.stringify(templates));
  const input = { project_id: project, template_version: template.version };
  const preflight = await ok(
    owner,
    "POST",
    `/v1/agent-templates/${template.id}/preflights`,
    input,
    tenant,
  );
  assert.equal(preflight.state, "ready", JSON.stringify(preflight));
  assert.equal(preflight.qualification_state, "unverified");
  const agent = await ok(
    owner,
    "POST",
    `/v1/agent-templates/${template.id}/instances`,
    input,
    tenant,
  );
  const conversation = await ok(owner, "POST", base + "/conversations", {
    name: "Actual file delivery, synthetic model",
    agent_id: agent.id,
  });
  const specification = {
    prompt: "Review campaign evidence and propose a creative experiment",
    snapshot_ids: [d.id],
    date_from: "2026-10-01",
    date_to: "2026-10-02",
    timezone: "Asia/Hong_Kong",
    currency_policy: "group_by_currency",
    metrics: ["spend", "ctr", "cpa", "roas"],
    dimensions: [],
  };
  return {
    owner,
    tenant,
    project,
    base,
    d,
    agent,
    conversation,
    specification,
    template,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function message(f: Fixture, mode = "execute") {
  const c = await ok(
    f.owner,
    "GET",
    f.base + `/conversations/${f.conversation.id}`,
  );
  return ok(
    f.owner,
    "POST",
    f.base + `/conversations/${f.conversation.id}/messages`,
    {
      body: "Create or revise the clearly simulated evidence report.",
      expected_version: c.version,
      intent: "delegate",
      mode,
      budget_micros: 1000000,
      client_message_id: randomUUID(),
    },
  );
}
class FixtureRuntime extends CodexRuntimeAdapter {
  failure: unknown;
  constructor(private perform: (ctx: RuntimeContext) => Promise<unknown>) {
    super(s.db.config);
  }
  override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
    try {
      await this.perform(ctx);
    } catch (error) {
      this.failure = error;
      throw error;
    }
    return {
      status: "completed",
      text: "Clearly simulated role check; real files were created through the company tools.",
      inputTokens: 20,
      outputTokens: 10,
      usageKnown: true,
      accepted: true,
      thread: "synthetic-role-thread",
      turn: randomUUID(),
    };
  }
}
async function run(
  f: Fixture,
  perform: (ctx: RuntimeContext) => Promise<unknown>,
  mode = "execute",
) {
  const accepted = await message(f, mode);
  const runtime = new FixtureRuntime(perform);
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    accepted.task.id,
  );
  if (runtime.failure) throw runtime.failure;
  const task = await ok(f.owner, "GET", f.base + "/tasks/" + accepted.task.id);
  return { accepted, task };
}
const tool = (ctx: RuntimeContext, name: string) => {
  const t = ctx.tools.find((t) => t.name === name);
  assert.ok(t, `Missing ${name}`);
  return t;
};
const renderInput = (specification: any, facts: any, extra = {}): any => ({
  specification,
  calculation_sha256: facts.calculation_sha256,
  title: "Campaign evidence review",
  locale: "en-HK",
  metrics: ["spend", "ctr"],
  scope_ids: facts.scopes.map((g: any) => g.id),
  ...extra,
});
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
after(async () => {
  try {
    await s?.app.close();
  } finally {
    await isolated?.cleanup();
  }
});

async function deliver(ctx: RuntimeContext, role: string, input?: any) {
  if (role === "brand-visual")
    return tool(ctx, "vector_render").run(
      input ?? demoVectorInput(),
      randomUUID(),
    ) as Promise<any>;
  const prepared: any = await tool(ctx, "slides_build").run(
    input ?? demoSlidesInput(),
    randomUUID(),
  );
  assert.equal(prepared.state, "prepared");
  assert.equal(prepared.requires_render, true);
  return tool(ctx, "slides_render").run(
    { source_version_id: prepared.source_version_id, sha256: prepared.sha256 },
    randomUUID(),
  ) as Promise<any>;
}
for (const role of ["brand-visual", "presentation"]) {
  test(`${role}: fixed specialist brand cannot be omitted or replaced and channel rights remain enforced`, async () => {
    const f = await fixture(role);
    const brand = await ok(f.owner, "POST", f.base + "/brand/definitions", {
      schema_version: 2,
      name: "Fixed brand for editable delivery",
      colors: ["#1F5EFF", "#F6F6F4"],
      tone: "Clear and direct",
      approved_copy: "Approved customer copy",
      fonts: [],
      logos: [],
      font_bindings: [
        {
          key: "body",
          label: "Noto Sans TC",
          source: { builtin: "noto-sans-tc" },
          rights: {
            source: "Repository fixed font and OFL",
            license: "SIL Open Font License 1.1",
            channels: ["social"],
            valid_until: null,
          },
        },
      ],
      facts: [],
      locales: ["zh-Hant-HK", "en-HK"],
      channels: ["social", "print"],
      restrictions: "Use the frozen brand and declared channel",
    });
    const agent = await ok(f.owner, "POST", f.base + "/agents", {
      name: "Brand-bound editable specialist",
      role_key: role,
      brand_id: brand.id,
    });
    const conversation = await ok(f.owner, "POST", f.base + "/conversations", {
      name: "Fixed-brand private delivery",
      agent_id: agent.id,
    });
    const bound = { ...f, agent, conversation };
    let delivered: any;
    const result = await run(bound, async (ctx) => {
      const writer = tool(
        ctx,
        role === "brand-visual" ? "vector_render" : "slides_build",
      );
      const input =
        role === "brand-visual" ? demoVectorInput() : demoSlidesInput();
      input.locale = "en-HK";
      const binding = {
        id: brand.id,
        version: brand.version,
        channel: "social",
        locale: "en-HK",
      };
      for (const value of [
        undefined,
        { ...binding, id: randomUUID() },
        { ...binding, version: brand.version + 1 },
      ])
        await assert.rejects(
          writer.run({ ...input, brand: value }, randomUUID()),
          (error: any) => error.code === "BRAND_BINDING_REQUIRED",
        );
      for (const [channel, code] of [
        ["unknown", "BRAND_USAGE_DENIED"],
        ["print", "BRAND_FONT_USAGE_DENIED"],
      ])
        await assert.rejects(
          writer.run(
            { ...input, brand: { ...binding, channel } },
            randomUUID(),
          ),
          (error: any) => error.code === code,
        );
      assert.equal(
        (
          await s.db.control.query(
            "SELECT count(*)::int AS n FROM assets WHERE project_id=$1 AND kind='deliverable'",
            [f.project],
          )
        ).rows[0].n,
        0,
      );
      delivered = await deliver(ctx, role, { ...input, brand: binding });
    });
    assert.equal(result.task.status, "succeeded", JSON.stringify(result.task));
    const file = delivered.files.find(
      (file: any) => file.filename === "manifest.json",
    );
    const manifest = await ok(
      f.owner,
      "GET",
      f.base + `/assets/${file.asset_id}/download`,
    );
    assert.ok(
      manifest.sources.some(
        (source: any) =>
          source.kind === "brand_version" &&
          source.id === brand.id &&
          source.version === brand.version,
      ),
    );
    let unbound: any;
    await run(f, async (ctx) => {
      const input =
        role === "brand-visual" ? demoVectorInput() : demoSlidesInput();
      unbound = await deliver(ctx, role, {
        ...input,
        brand: {
          id: brand.id,
          version: brand.version,
          channel: "social",
          locale: "zh-Hant-HK",
        },
      });
    });
    await s.db.control.query(
      "UPDATE brand_profiles SET content_state='quarantined' WHERE id=$1",
      [brand.id],
    );
    assert.notEqual(
      (await call(f.owner, "GET", f.base + `/assets/${file.asset_id}/download`))
        .status,
      200,
    );
    for (const file of unbound.files)
      assert.equal(
        (
          await call(
            f.owner,
            "GET",
            f.base + `/assets/${file.asset_id}/download`,
          )
        ).status,
        404,
        "An explicitly selected brand must fence every derivative even when the specialist has no frozen brand",
      );
  });
  test(`${role}: ready template, fixed Skills, genuine private files, same-input replay and one task reservation`, async () => {
    const f = await fixture(role);
    let delivered: any;
    const result = await run(f, async (ctx) => {
      for (const t of ctx.tools) desktopCompanyToolSchema(t.inputSchema);
      assert.ok(ctx.skills.some((s) => s.content.includes("Version: 1.1.0.")));
      const name = role === "brand-visual" ? "vector_render" : "slides_build",
        input = role === "brand-visual" ? demoVectorInput() : demoSlidesInput(),
        writer = tool(ctx, name),
        id = randomUUID();
      const first: any = await writer.run(input, id);
      assert.deepEqual(await writer.run(input, id), first);
      assert.deepEqual(await writer.run(input, randomUUID()), first);
      await assert.rejects(
        writer.run({ ...input, title: "Different title" }, id),
        (e: any) => e.code === "IDEMPOTENCY_CONFLICT",
      );
      if (role === "presentation") {
        const renderer = tool(ctx, "slides_render"),
          args = {
            source_version_id: first.source_version_id,
            sha256: first.sha256,
          };
        await assert.rejects(
          renderer.run({ ...args, sha256: "0".repeat(64) }, randomUUID()),
          (e: any) => e.code === "DESIGN_SOURCE_CHANGED",
        );
        delivered = await renderer.run(args, randomUUID());
        assert.deepEqual(await renderer.run(args, randomUUID()), delivered);
      } else delivered = first;
    });
    assert.equal(result.task.status, "succeeded", JSON.stringify(result.task));
    assert.equal(delivered.state, "delivered");
    assert.equal(delivered.provider_calls, 0);
    assert.equal(delivered.additional_ai_charge_micros, "0");
    const count = (
      await s.db.control.query(
        "SELECT (SELECT count(*)::int FROM assets WHERE project_id=$1 AND kind='deliverable') AS assets,(SELECT count(*)::int FROM reservations WHERE task_id=$2) AS reservations",
        [f.project, result.task.id],
      )
    ).rows[0];
    assert.equal(count.reservations, 1);
    assert.equal(
      count.assets,
      delivered.files.length + (role === "presentation" ? 1 : 0),
    );
    const outsider = await user();
    await s.db.control.query(
      "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
      [f.tenant, outsider.id],
    );
    await s.db.control.query(
      "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",
      [f.tenant, f.project, outsider.id],
    );
    let archive: Buffer | undefined;
    for (const file of delivered.files) {
      const own = await call(
        f.owner,
        "GET",
        f.base + `/assets/${file.asset_id}/download`,
      );
      assert.equal(own.status, 200);
      assert.equal(hash(own.raw.rawPayload), file.sha256);
      assert.equal(
        (
          await call(
            outsider,
            "GET",
            f.base + `/assets/${file.asset_id}/download`,
          )
        ).status,
        404,
      );
      if (file.filename === "editable-design.zip") archive = own.raw.rawPayload;
    }
    assert.ok(archive);
    const parts = unzipSync(archive),
      manifest = JSON.parse(Buffer.from(parts["manifest.json"]).toString());
    assert.equal(manifest.data_mode, "simulated");
    assert.equal(
      manifest.kind,
      role === "brand-visual" ? "vector" : "presentation",
    );
    for (const row of manifest.files)
      assert.equal(hash(Buffer.from(parts[row.filename])), row.sha256);
    assert.ok(parts["fonts/OFL.txt"]);
    assert.ok(
      parts[role === "brand-visual" ? "brand-vector.svg" : "presentation.pptx"],
    );
  });
  test(`${role}: actual revision preserves prior bytes and binds private source provenance`, async () => {
    const f = await fixture(role);
    let first: any, second: any;
    await run(f, async (ctx) => {
      first = await deliver(ctx, role);
    });
    const oldFile = first.files.find(
      (f: any) =>
        f.filename ===
        (role === "brand-visual" ? "brand-vector.svg" : "presentation.pptx"),
    );
    const before = await call(
      f.owner,
      "GET",
      f.base + `/assets/${oldFile.asset_id}/download`,
    );
    const changed = await run(f, async (ctx) => {
      const source: any = await tool(ctx, "design_source_read").run(
        { source_version_id: first.editable_source.asset_version_id },
        randomUUID(),
      );
      const input =
        role === "brand-visual" ? demoVectorInput(true) : demoSlidesInput(true);
      input.revision_of = {
        source_version_id: source.source_version_id,
        sha256: source.sha256,
      };
      second = await deliver(ctx, role, input);
    });
    assert.equal(changed.task.status, "succeeded");
    assert.deepEqual(second.revision_of, {
      source_version_id: first.editable_source.asset_version_id,
      sha256: first.editable_source.sha256,
    });
    const after = await call(
      f.owner,
      "GET",
      f.base + `/assets/${oldFile.asset_id}/download`,
    );
    assert.deepEqual(after.raw.rawPayload, before.raw.rawPayload);
    const latest = second.files.find(
      (f: any) => f.filename === oldFile.filename,
    );
    assert.notEqual(latest.sha256, oldFile.sha256);
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*)::int AS n FROM task_source_reads WHERE task_id=$1 AND asset_version_id=$2",
          [changed.task.id, first.editable_source.asset_version_id],
        )
      ).rows[0].n,
      1,
    );
    const sourceAsset = first.files.find(
      (f: any) => f.asset_version_id === first.editable_source.asset_version_id,
    );
    await s.db.control.query(
      "UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",
      [sourceAsset.asset_id],
    );
    assert.notEqual(
      (
        await call(
          f.owner,
          "GET",
          f.base + `/assets/${latest.asset_id}/download`,
        )
      ).status,
      200,
    );
  });
  for (const mode of ["ask", "plan"])
    test(`${role}: ${mode} exposes only current read tools, never design writers`, async () => {
      const f = await fixture(role);
      const result = await run(
        f,
        async (ctx) => {
          assert.ok(ctx.tools.some((t) => t.name === "design_source_read"));
          assert.ok(ctx.tools.some((t) => t.name === "design_sources"));
          for (const name of [
            "vector_render",
            "slides_build",
            "slides_render",
            "chart_render",
            "design_render",
          ])
            assert.ok(!ctx.tools.some((t) => t.name === name));
        },
        mode,
      );
      assert.equal(result.task.status, "succeeded");
    });
}
test("design sources reject other conversations, malformed image bytes and stale hashes without saving deliverables", async () => {
  const f = await fixture(),
    other = await ok(f.owner, "POST", f.base + "/conversations", {
      name: "Other private design",
      agent_id: f.agent.id,
    });
  const png = new PNG({ width: 32, height: 16 });
  png.data.fill(255);
  const bytes = PNG.sync.write(png);
  const privateImage = await s.db.tx(
    (tx) =>
      saveAsset(tx, s.storage, {
        tenant: f.tenant,
        project: f.project,
        user: f.owner.id,
        conversation: other.id,
        name: "other-private.png",
        mime: "image/png",
        bytes,
      }),
    f.tenant,
    false,
    f.owner.id,
  );
  const invalidImage = await s.db.tx(
    (tx) =>
      saveAsset(tx, s.storage, {
        tenant: f.tenant,
        project: f.project,
        user: f.owner.id,
        conversation: f.conversation.id,
        name: "broken.png",
        mime: "image/png",
        bytes: Buffer.from("not a PNG"),
      }),
    f.tenant,
    false,
    f.owner.id,
  );
  const otherText = await s.db.tx(
    (tx) =>
      saveAsset(tx, s.storage, {
        tenant: f.tenant,
        project: f.project,
        user: f.owner.id,
        conversation: other.id,
        name: "other-private-source.json",
        mime: "application/json",
        bytes: Buffer.from(
          JSON.stringify({
            private_copy: "Not authorized in this conversation",
          }),
        ),
      }),
    f.tenant,
    false,
    f.owner.id,
  );
  const result = await run(f, async (ctx) => {
    const generic: any = await tool(ctx, "project_assets").run(
      {},
      randomUUID(),
    );
    assert.ok(
      !generic.items.some((item: any) =>
        [privateImage.id, otherText.id].includes(item.id),
      ),
    );
    await assert.rejects(
      tool(ctx, "asset_text_read").run(
        { asset_id: otherText.id },
        randomUUID(),
      ),
      (error: any) => error.code === "NOT_FOUND",
    );
    const directory: any = await tool(ctx, "design_sources").run(
      { kind: "images" },
      randomUUID(),
    );
    assert.ok(
      !directory.items.some(
        (a: any) => a.asset_version_id === privateImage.version.id,
      ),
    );
    for (const [asset, expected] of [
      [privateImage, "NOT_FOUND"],
      [invalidImage, "DESIGN_IMAGE_INVALID"],
    ] as const) {
      const input = demoVectorInput();
      input.scene.layers = [
        {
          kind: "image",
          id: "image",
          x: 0,
          y: 0,
          w: 100,
          h: 100,
          asset_version_id: asset.version.id,
          sha256: asset.version.sha256,
          alt: "Image",
          fit: "contain",
        },
      ];
      await assert.rejects(
        tool(ctx, "vector_render").run(input, randomUUID()),
        (e: any) => e.code === expected,
      );
      if (asset === invalidImage) {
        const image = input.scene.layers[0];
        assert.equal(image.kind, "image");
        if (image.kind !== "image") throw new Error("Invalid test image");
        image.sha256 = "0".repeat(64);
        await assert.rejects(
          tool(ctx, "vector_render").run(input, randomUUID()),
          (e: any) => e.code === "DESIGN_SOURCE_CHANGED",
        );
      }
    }
  });
  assert.equal(result.task.status, "succeeded");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM assets WHERE project_id=$1 AND kind='deliverable'",
        [f.project],
      )
    ).rows[0].n,
    0,
  );
});
test("a generated image from the same task fences every editable derivative when the image is withdrawn", async () => {
  const f = await fixture();
  let image: any, delivered: any;
  const result = await run(f, async (ctx) => {
    const task = (
      await s.db.control.query(
        "SELECT id FROM tasks WHERE conversation_id=$1 AND status='running'",
        [f.conversation.id],
      )
    ).rows[0];
    const png = new PNG({ width: 32, height: 16 });
    png.data.fill(255);
    image = await s.db.tx(
      (tx) =>
        saveAsset(tx, s.storage, {
          tenant: f.tenant,
          project: f.project,
          user: f.owner.id,
          name: "actual-same-task-image.png",
          mime: "image/png",
          bytes: PNG.sync.write(png),
          metadata: { task_id: task.id },
        }),
      f.tenant,
      false,
      f.owner.id,
    );
    const input = demoVectorInput();
    input.scene.layers = [
      {
        kind: "image",
        id: "actual-generated-image",
        x: 64,
        y: 64,
        w: 400,
        h: 200,
        asset_version_id: image.version.id,
        sha256: image.version.sha256,
        alt: "Actual same-task PNG",
        fit: "contain",
      },
    ];
    delivered = await deliver(ctx, "brand-visual", input);
  });
  assert.equal(result.task.status, "succeeded");
  for (const file of delivered.files) {
    const metadata = (
      await s.db.control.query(
        "SELECT metadata FROM asset_versions WHERE id=$1",
        [file.asset_version_id],
      )
    ).rows[0].metadata;
    assert.ok(
      metadata.editable_design_source_versions.includes(image.version.id),
    );
    assert.equal(
      (await call(f.owner, "GET", f.base + `/assets/${file.asset_id}/download`))
        .status,
      200,
    );
  }
  await assert.rejects(
    s.db.control.query(
      "UPDATE asset_versions SET metadata=metadata-'editable_design_source_versions' WHERE id=$1",
      [delivered.files[0].asset_version_id],
    ),
    /Editable design source binding is immutable/,
  );
  await s.db.control.query(
    "UPDATE assets SET state='quarantined',moderation_version=moderation_version+1 WHERE id=$1",
    [image.id],
  );
  for (const file of delivered.files)
    assert.equal(
      (await call(f.owner, "GET", f.base + `/assets/${file.asset_id}/download`))
        .status,
      404,
    );
});

test("presentation charts use actual deterministic analysis evidence and reject forged IDs or mixed metric scopes", async () => {
  const f = await fixture("presentation");
  let delivered: any;
  const result = await run(f, async (ctx) => {
    const facts: any = await tool(ctx, "sheet_calculate").run(
      { specification: f.specification },
      randomUUID(),
    );
    const analysis: any = await tool(ctx, "chart_render").run(
      renderInput(f.specification, facts),
      randomUUID(),
    );
    const source = analysis.files.find(
      (a: any) => a.filename === "analysis.source.json",
    );
    const evidence: any = await tool(ctx, "design_chart_read").run(
      { source_version_id: source.asset_version_id },
      randomUUID(),
    );
    const spend = evidence.evidence.find((e: any) => e.metric_id === "spend"),
      ctr = evidence.evidence.find((e: any) => e.metric_id === "ctr");
    assert.equal(spend.value, "100.00000000");
    const input = demoSlidesInput();
    input.slides = input.slides.slice(0, 1);
    const chart = {
      kind: "chart" as const,
      id: "chart",
      x: 64,
      y: 160,
      w: 1000,
      h: 350,
      source_version_id: source.asset_version_id,
      sha256: evidence.sha256,
      title: "Actual spend evidence",
      evidence_ids: [spend.id],
      color: "#1F5EFF",
    };
    input.slides[0].scene.layers = [chart];
    chart.evidence_ids = [randomUUID()];
    await assert.rejects(
      tool(ctx, "slides_build").run(input, randomUUID()),
      (e: any) => e.code === "DESIGN_EVIDENCE_INVALID",
    );
    chart.evidence_ids = [spend.id, ctr.id];
    await assert.rejects(
      tool(ctx, "slides_build").run(input, randomUUID()),
      (e: any) => e.code === "DESIGN_EVIDENCE_SCOPE",
    );
    chart.evidence_ids = [spend.id];
    delivered = await deliver(ctx, "presentation", input);
  });
  assert.equal(result.task.status, "succeeded", JSON.stringify(result.task));
  const csv = delivered.files.find((f: any) => f.filename === "evidence.csv"),
    file = await call(
      f.owner,
      "GET",
      f.base + `/assets/${csv.asset_id}/download`,
    );
  assert.match(file.raw.rawPayload.toString(), /100\.00000000/);
  await s.db.control.query(
    "UPDATE analytics_datasets SET content_state='quarantined' WHERE id=$1",
    [f.d.id],
  );
  const pptx = delivered.files.find(
    (f: any) => f.filename === "presentation.pptx",
  );
  assert.notEqual(
    (await call(f.owner, "GET", f.base + `/assets/${pptx.asset_id}/download`))
      .status,
    200,
  );
});
for (const role of ["brand-visual", "presentation"])
  test(`${role}: pinned native Codex calls actual new company tools and saves genuine files`, async () => {
    const f = await fixture(role),
      accepted = await message(f);
    const runtime = new CodexRuntimeAdapter(s.db.config);
    await new Worker(s.db, s.catalog, s.storage, runtime).run(
      f.tenant,
      accepted.task.id,
    );
    const task = await ok(
      f.owner,
      "GET",
      f.base + "/tasks/" + accepted.task.id,
    );
    assert.equal(task.status, "succeeded", JSON.stringify(task));
    const rows = (
      await s.db.control.query(
        "SELECT tool_name,result FROM task_tool_receipts WHERE task_id=$1 ORDER BY created_at",
        [accepted.task.id],
      )
    ).rows;
    assert.ok(
      rows.some(
        (r: any) =>
          r.tool_name ===
          (role === "brand-visual" ? "vector_render" : "slides_render"),
      ),
      JSON.stringify(rows),
    );
    const delivered = rows.find(
      (r: any) => r.result.state === "delivered",
    )!.result;
    const asset = delivered.files.find(
      (f: any) =>
        f.filename ===
        (role === "brand-visual" ? "brand-vector.svg" : "presentation.pptx"),
    );
    const downloaded = await call(
      f.owner,
      "GET",
      f.base + `/assets/${asset.asset_id}/download`,
    );
    assert.equal(downloaded.status, 200);
    assert.equal(hash(downloaded.raw.rawPayload), asset.sha256);
  });
