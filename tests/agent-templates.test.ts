import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { Worker } from "../src/worker.js";
import { CodexRuntimeAdapter, type RuntimeContext } from "../src/runtime.js";
import { seedRuntimeProfile } from "../src/runtime-profiles.js";
import { tokenCharge } from "../src/billing.js";
import { presetBrandDefinition } from "./preset-brand-fixture.js";
import { resolveWorkContext, freezeWorkContext, getAgentVersion } from "../src/persistent-work.js";
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>;
let s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string };
async function call(
  client: Client | undefined,
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
      ...(client ? { cookie: client.cookie, "x-csrf-token": client.csrf } : {}),
      ...(tenant ? { "x-tenant-id": tenant } : {}),
      "idempotency-key": key,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { payload: JSON.stringify(body) }),
  });
  return { status: raw.statusCode, data: raw.json(), raw };
}
async function ok(
  client: Client,
  method: string,
  url: string,
  body?: unknown,
  tenant?: string,
  key?: string,
) {
  const response = await call(client, method, url, body, tenant, key);
  assert.ok(
    [200, 201].includes(response.status),
    JSON.stringify(response.data),
  );
  return response.data;
}
async function user(): Promise<Client> {
  const email = `template-${randomUUID()}@example.invalid`,
    challenge = await call(undefined, "POST", "/v1/auth/challenge", { email }),
    mail = JSON.parse(
      await readFile(
        `${s.db.config.DATA_DIR}/mailbox/${challenge.data.challenge_id}.json`,
        "utf8",
      ),
    ),
    verified = await call(undefined, "POST", "/v1/auth/verify", {
      challenge_id: challenge.data.challenge_id,
      code: mail.text.match(/\b\d{6}\b/)[0],
    });
  assert.equal(verified.status, 200);
  return {
    id: verified.data.user.id,
    cookie: verified.raw.cookies[0].name + "=" + verified.raw.cookies[0].value,
    csrf: verified.data.csrf_token,
  };
}
async function fixture() {
  const owner = await user(),
    workspace = await ok(owner, "POST", "/v1/tenants", {
      name: "Template test studio",
      project_name: "Reviewed assistants",
    }),
    tenant = workspace.tenant.id,
    project = workspace.project.id;
  const template = (
    await ok(owner, "GET", "/v1/agent-templates", undefined, tenant)
  ).items.find((row: any) => row.kind === "default_helper");
  return {
    owner,
    tenant,
    project,
    base: `/v1/tenants/${tenant}/projects/${project}`,
    template,
    input: { project_id: project, template_version: template.version },
  };
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      DEMO_MODE: "true",
      WORKER_ENABLED: "false",
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

test("template directory uses persisted IDs, strict category/cursor pages, current tenant authorization and unqualified synthetic labels", async () => {
  const f = await fixture(),
    all: any[] = [];
  let cursor: string | null = null;
  do {
    const page = await ok(
      f.owner,
      "GET",
      "/v1/agent-templates?limit=3" + (cursor ? "&cursor=" + cursor : ""),
      undefined,
      f.tenant,
    );
    assert.ok(page.items.length <= 3);
    all.push(...page.items);
    cursor = page.next_cursor;
  } while (cursor);
  assert.equal(all.length, 19);
  assert.equal(new Set(all.map((row) => row.id)).size, 19);
  for (const row of all) {
    assert.equal(row.data_mode, "simulated");
    assert.equal(row.qualification_state, "unverified");
    assert.ok(
      (
        await s.db.control.query(
          "SELECT 1 FROM agent_template_versions WHERE id=$1 AND template_id=$2 AND version=$3",
          [row.template_version_id, row.id, row.version],
        )
      ).rowCount,
    );
    assert.ok(
      (
        await s.db.control.query(
          "SELECT 1 FROM codex_runtime_profiles WHERE id=$1 AND kernel='codex' AND NOT automatic_fallback",
          [row.runtime_profile_id],
        )
      ).rowCount,
    );
    assert.equal(
      (
        await ok(
          f.owner,
          "GET",
          `/v1/agent-templates/${row.id}?version=${row.version}`,
          undefined,
          f.tenant,
        )
      ).definition_hash,
      row.definition_hash,
    );
  }
  assert.ok(
    (
      await ok(
        f.owner,
        "GET",
        "/v1/agent-templates?category=design",
        undefined,
        f.tenant,
      )
    ).items.every((row: any) => row.category === "design"),
  );
  assert.equal(
    (await ok(f.owner, "GET", "/v1/agent-templates?q=%25", undefined, f.tenant))
      .items.length,
    0,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "GET",
        "/v1/agent-templates?cursor=" + randomUUID(),
        undefined,
        f.tenant,
      )
    ).status,
    410,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "GET",
        "/v1/agent-templates?limit=101",
        undefined,
        f.tenant,
      )
    ).status,
    400,
  );
  assert.equal((await call(f.owner, "GET", "/v1/agent-templates")).status, 400);
  assert.equal(
    (
      await call(
        await user(),
        "GET",
        "/v1/agent-templates",
        undefined,
        f.tenant,
      )
    ).status,
    404,
  );
  assert.equal(
    (await call(undefined, "GET", "/v1/agent-templates", undefined, f.tenant))
      .status,
    401,
  );
  const serialized = JSON.stringify(all);
  for (const field of [
    "AI_API_KEY",
    "gateway_fingerprint",
    "model_alias",
    "rates",
    "CONTROL_DATABASE_URL",
  ])
    assert.ok(!serialized.includes(field));
});
test("preflights persist one current receipt without installing methods, reserving funds or claiming unsupported tools", async () => {
  const f = await fixture(),
    key = randomUUID(),
    url = `/v1/agent-templates/${f.template.id}/preflights`,
    one = await ok(f.owner, "POST", url, f.input, f.tenant, key),
    two = await ok(f.owner, "POST", url, f.input, f.tenant, key);
  assert.equal(one.id, two.id);
  assert.equal(one.state, "ready");
  assert.equal(one.qualification_state, "unverified");
  assert.equal(one.resolved_skill_version_ids.length, 1);
  assert.equal(one.resolved_capability_version_ids.length, 1);
  assert.ok(Number.isInteger(one.policy_version));
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM agent_template_preflights WHERE project_id=$1",
        [f.project],
      )
    ).rows[0].n,
    1,
  );
  for (const table of ["skill_installations", "agents", "tasks"])
    assert.equal(
      (
        await s.db.control.query(
          `SELECT count(*)::int AS n FROM ${table} WHERE project_id=$1`,
          [f.project],
        )
      ).rows[0].n,
      0,
    );
  assert.equal(
    Number(
      (
        await s.db.control.query(
          "SELECT reserved_micros FROM wallets WHERE tenant_id=$1",
          [f.tenant],
        )
      ).rows[0].reserved_micros,
    ),
    0,
  );
  const brand = await ok(
    f.owner,
    "POST",
    url,
    { ...f.input, overrides: { brand_version_id: randomUUID() } },
    f.tenant,
  );
  assert.equal(brand.state, "needs_configuration");
  assert.ok(
    brand.missing_required_dependencies.includes(
      "BRAND_VERSION_UNAVAILABLE",
    ),
  );
  const all = (
      await ok(f.owner, "GET", "/v1/agent-templates", undefined, f.tenant)
    ).items,
    engineering = all.find((row: any) => row.role_key === "fullstack"),
    missing = await ok(
      f.owner,
      "POST",
      `/v1/agent-templates/${engineering.id}/preflights`,
      { ...f.input, template_version: engineering.version },
      f.tenant,
    );
  assert.equal(missing.state, "unavailable");
  assert.ok(
    missing.missing_required_dependencies.includes(
      "TOOL_NOT_IMPLEMENTED:process.run.allowed",
    ),
  );
  for (const overrides of [
    { kernel: "dsh" },
    { api_base_url: "https://outside.example.invalid" },
    { skill_version_ids: [randomUUID()] },
  ])
    assert.equal(
      (await call(f.owner, "POST", url, { ...f.input, overrides }, f.tenant))
        .status,
      400,
    );
});
test("brand choices have opaque immutable revisions, scoped paging and exact template bindings that survive later publications", async () => {
  const f = await fixture(), original = presetBrandDefinition(), brand = await ok(f.owner, "POST", f.base + "/brand/definitions", original, f.tenant);
  const choicesUrl = `/v1/brand-version-options?project_id=${f.project}`, choices = await ok(f.owner, "GET", choicesUrl, undefined, f.tenant), fixed = choices.items.find((row: any) => row.brand_id === brand.id);
  assert.equal(fixed.version, 1); assert.equal(fixed.current, true); assert.equal(fixed.available, true);
  assert.ok(!JSON.stringify(choices).includes(original.tone));
  const body = { ...f.input, overrides: { name: "Pinned brand expert", brand_version_id: fixed.id, role_description: "Read the exact approved brand" } };
  const preflight = await ok(f.owner, "POST", `/v1/agent-templates/${f.template.id}/preflights`, body, f.tenant);
  assert.equal(preflight.state, "ready");
  await ok(f.owner, "PUT", f.base + "/brand/" + brand.id, { expected_version: 1, definition: presetBrandDefinition("PRESET_BRAND_LATER_GUIDANCE") }, f.tenant);
  const agent = await ok(f.owner, "POST", `/v1/agent-templates/${f.template.id}/instances`, body, f.tenant), actor = { id: f.owner.id, audience: "user" as const, authVersion: 1, sessionId: "", sessionHash: "", email: "fixture@example.invalid", name: "Fixture" };
  await s.db.tx(async tx => {
    const version = await getAgentVersion(tx, f.project, agent.id);
    assert.deepEqual(version.body.brand, { id: brand.id, version: 1 }); assert.equal(version.body.brand_version_id, fixed.id);
    const context = await freezeWorkContext(tx, actor, f.tenant, f.project, version, undefined, s.catalog);
    const resolved = await resolveWorkContext(tx, actor, f.tenant, f.project, context);
    assert.ok(resolved.instructions.includes(original.tone)); assert.ok(!resolved.instructions.includes("PRESET_BRAND_LATER_GUIDANCE"));
  }, f.tenant, false, f.owner.id);
  const before = (await s.db.control.query("SELECT sha256,body,id FROM brand_profile_versions WHERE brand_id=$1 AND version=1", [brand.id])).rows[0];
  assert.equal(before.id, fixed.id);
  await assert.rejects(s.db.control.query("UPDATE brand_profile_versions SET id=$2 WHERE id=$1", [fixed.id, randomUUID()]), { code: "23514" });
  const first = await ok(f.owner, "GET", choicesUrl + "&limit=1", undefined, f.tenant);
  assert.equal(first.items.length, 1); assert.ok(first.next_cursor);
  const next = await ok(f.owner, "GET", choicesUrl + "&limit=1&cursor=" + first.next_cursor, undefined, f.tenant);
  assert.equal(next.items.length, 1); assert.notEqual(first.items[0].id, next.items[0].id);
  assert.equal((await call(f.owner, "GET", choicesUrl + "&cursor=" + randomUUID(), undefined, f.tenant)).status, 410);
  const outsider = await fixture();
  // Unknown workspaces keep the existing non-enumerating access response.
  assert.equal((await call(outsider.owner, "GET", choicesUrl, undefined, f.tenant)).status, 404);
  const foreign = await ok(outsider.owner, "POST", `/v1/agent-templates/${outsider.template.id}/preflights`, { ...outsider.input, overrides: { brand_version_id: fixed.id } }, outsider.tenant);
  assert.ok(foreign.missing_required_dependencies.includes("BRAND_VERSION_UNAVAILABLE"));
  await s.db.control.query("UPDATE brand_profiles SET content_state='quarantined' WHERE id=$1", [brand.id]);
  const rejected = await ok(f.owner, "POST", `/v1/agent-templates/${f.template.id}/preflights`, body, f.tenant);
  assert.notEqual(rejected.state, "ready");
  assert.equal((await call(f.owner, "POST", `/v1/agent-templates/${f.template.id}/instances`, body, f.tenant)).status, 409);
  assert.equal((await s.db.control.query("SELECT count(*)::int AS n FROM tasks WHERE project_id=$1", [f.project])).rows[0].n, 0);
  assert.equal((await s.db.control.query("SELECT body,sha256,id FROM brand_profile_versions WHERE id=$1", [fixed.id])).rows[0].sha256, before.sha256);
});

test("canonical instantiation atomically pins real versions and replay creates only one authorized specialist", async () => {
  const f = await fixture(),
    key = randomUUID(),
    url = `/v1/agent-templates/${f.template.id}/instances`,
    input = {
      ...f.input,
      overrides: {
        name: "Pinned campaign reviewer",
        role_description: "Use approved information and cite missing facts.",
        locale: "zh-HK",
        delivery_preferences: ["Deliver a Markdown review"],
      },
    },
    responses = await Promise.all([
      ok(f.owner, "POST", url, input, f.tenant, key),
      ok(f.owner, "POST", url, input, f.tenant, key),
    ]);
  assert.deepEqual(responses[0], responses[1]);
  const agent = responses[0];
  assert.equal(agent.name, input.overrides.name);
  assert.equal(agent.template_version_id, f.template.template_version_id);
  assert.ok(agent.agent_version_id);
  assert.equal(agent.runtime_profile_id, f.template.runtime_profile_id);
  const version = (
    await s.db.control.query("SELECT * FROM agent_versions WHERE id=$1", [
      agent.agent_version_id,
    ])
  ).rows[0];
  assert.equal(version.runtime_profile_id, agent.runtime_profile_id);
  assert.equal(version.body.kernel, "codex");
  assert.equal(version.body.runtime_version, s.db.config.CODEX_VERSION);
  assert.match(version.body.instructions, /zh-HK/);
  assert.equal(version.body.capability_version_ids.length, 1);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM agents WHERE project_id=$1",
        [f.project],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        url,
        { ...input, project_id: randomUUID() },
        f.tenant,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        url,
        { ...input, template_version: 9999 },
        f.tenant,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        url,
        { ...input, name: "Different replay input" },
        f.tenant,
        key,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        url,
        { ...input, overrides: { ...input.overrides, kernel: "other" } },
        f.tenant,
      )
    ).status,
    400,
  );
});
test("instantiation rechecks disabled or revoked project methods after an earlier ready preflight", async () => {
  const f = await fixture(),
    url = `/v1/agent-templates/${f.template.id}/instances`,
    agent = await ok(f.owner, "POST", url, f.input, f.tenant),
    installation = agent.skill_installation_ids[0];
  assert.equal(
    (
      await ok(
        f.owner,
        "POST",
        `/v1/agent-templates/${f.template.id}/preflights`,
        f.input,
        f.tenant,
      )
    ).state,
    "ready",
  );
  await s.db.control.query(
    "UPDATE skill_installations SET enabled=false,version=version+1 WHERE id=$1",
    [installation],
  );
  assert.equal(
    (await call(f.owner, "POST", url, f.input, f.tenant)).status,
    409,
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM agents WHERE project_id=$1",
        [f.project],
      )
    ).rows[0].n,
    1,
  );
  await s.db.control.query(
    "UPDATE skill_installations SET enabled=true,state='revoked',version=version+1 WHERE id=$1",
    [installation],
  );
  const rejected = await ok(
    f.owner,
    "POST",
    `/v1/agent-templates/${f.template.id}/preflights`,
    f.input,
    f.tenant,
  );
  assert.notEqual(rejected.state, "ready");
});
test("runtime and template definitions are immutable in PostgreSQL and cannot be forged by the app identity", async () => {
  const f = await fixture(),
    profile = f.template.runtime_profile_id;
  await assert.rejects(
    s.db.control.query(
      "UPDATE codex_runtime_profiles SET kernel='dsh' WHERE id=$1",
      [profile],
    ),
    { code: "23514" },
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE codex_runtime_profiles SET pinned_version='changed' WHERE id=$1",
      [profile],
    ),
    { code: "23514" },
  );
  await assert.rejects(
    s.db.app.query(
      "UPDATE codex_runtime_profiles SET state='revoked' WHERE id=$1",
      [profile],
    ),
    { code: "42501" },
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE agent_template_versions SET body='{}' WHERE id=$1",
      [f.template.template_version_id],
    ),
    { code: "42501" },
  );
});
test("designer instances render private PDF and editable source with bounded formats and idempotent delivery", async () => {
  const f = await fixture(),
    template = (
      await ok(f.owner, "GET", "/v1/agent-templates", undefined, f.tenant)
    ).items.find((row: any) => row.role_key === "designer"),
    input = { project_id: f.project, template_version: template.version };
  const ready = await ok(
    f.owner,
    "POST",
    `/v1/agent-templates/${template.id}/preflights`,
    input,
    f.tenant,
  );
  assert.equal(ready.state, "ready", JSON.stringify(ready));
  assert.equal(ready.qualification_state, "unverified");
  const agent = await ok(
    f.owner,
    "POST",
    `/v1/agent-templates/${template.id}/instances`,
    input,
    f.tenant,
  );
  await ok(f.owner, "POST", `/v1/tenants/${f.tenant}/demo-credit`, {});
  const conversation = await ok(f.owner, "POST", f.base + "/conversations", {
    name: "PDF review",
    agent_id: agent.id,
  });
  const document = {
    width: 320,
    height: 400,
    background: "#F6F6F4",
    layers: [
      {
        type: "text",
        text: "春日新章 · Brand review",
        x: 20,
        y: 100,
        font_size: 24,
        color: "#15171A",
        font_family: "sans",
        weight: "bold",
      },
    ],
  };
  let delivered: any;
  class ReviewRuntime extends CodexRuntimeAdapter {
    override async start(ctx: RuntimeContext) {
      const tool = ctx.tools.find((t) => t.name === "design_render");
      assert.ok(tool);
      assert.deepEqual((tool.inputSchema as any).properties.format.enum, [
        "svg",
        "png",
        "pdf",
      ]);
      await assert.rejects(
        tool.run(
          { filename: "forbidden", document, format: "mp4" },
          randomUUID(),
        ),
      );
      assert.equal(
        (
          await s.db.control.query(
            "SELECT count(*)::int AS n FROM assets WHERE project_id=$1",
            [f.project],
          )
        ).rows[0].n,
        0,
      );
      const key = randomUUID(),
        args = { filename: "campaign-review", document, format: "pdf" };
      delivered = await tool.run(args, key);
      const replayed: any = await tool.run(args, key);
      assert.equal(replayed.source.id, delivered.source.id);
      assert.equal(replayed.rendered.id, delivered.rendered.id);
      assert.equal(
        (
          await s.db.control.query(
            "SELECT count(*)::int AS n FROM assets WHERE project_id=$1",
            [f.project],
          )
        ).rows[0].n,
        2,
      );
      await assert.rejects(
        tool.run({ ...args, filename: "changed" }, key),
        (e: any) => e.code === "IDEMPOTENCY_CONFLICT",
      );
      return {
        text: "Simulated designer test; PDF is a raster review copy.",
        inputTokens: 10,
        outputTokens: 5,
        usageKnown: true,
        accepted: true,
        status: "completed",
        thread: "fixture",
        turn: "fixture",
      };
    }
  }
  const accepted = await ok(
    f.owner,
    "POST",
    f.base + `/conversations/${conversation.id}/messages`,
    {
      body: "Create a clearly simulated review proof.",
      expected_version: conversation.version,
      intent: "delegate",
      mode: "execute",
      budget_micros: 1000000,
      client_message_id: randomUUID(),
    },
  );
  await new Worker(
    s.db,
    s.catalog,
    s.storage,
    new ReviewRuntime(s.db.config),
  ).run(f.tenant, accepted.task.id);
  const task = await ok(f.owner, "GET", f.base + "/tasks/" + accepted.task.id);
  assert.equal(task.status, "succeeded", JSON.stringify(task));
  const outsider = await user();
  await s.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
    [f.tenant, outsider.id],
  );
  await s.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",
    [f.tenant, f.project, outsider.id],
  );
  for (const asset of [delivered.source, delivered.rendered]) {
    assert.equal(asset.private_owner, f.owner.id);
    assert.equal(
      (await call(outsider, "GET", f.base + `/assets/${asset.id}/download`))
        .status,
      404,
    );
  }
  const pdf = await s.app.inject({
    method: "GET",
    url: f.base + `/assets/${delivered.rendered.id}/download`,
    headers: { cookie: f.owner.cookie },
  });
  assert.equal(pdf.statusCode, 200);
  assert.equal(pdf.rawPayload.subarray(0, 5).toString(), "%PDF-");
  const versions = (
    await s.db.control.query(
      "SELECT asset_id,mime_type,metadata,storage_key FROM asset_versions WHERE asset_id=ANY($1::uuid[])",
      [[delivered.source.id, delivered.rendered.id]],
    )
  ).rows;
  const source = versions.find(
      (row: any) => row.asset_id === delivered.source.id,
    ),
    rendered = versions.find(
      (row: any) => row.asset_id === delivered.rendered.id,
    );
  assert.deepEqual(
    JSON.parse((await s.storage.get(source.storage_key)).toString()),
    document,
  );
  assert.equal(rendered.mime_type, "application/pdf");
  assert.equal(rendered.metadata.source_asset_id, delivered.source.id);
  assert.equal(rendered.metadata.probe.editable_text, false);
  assert.equal(rendered.metadata.data_mode, "simulated");
});

test("frozen task capability survives default changes, and active runtime revocation blocks the next tool and final publication", async () => {
  const f = await fixture(),
    agent = await ok(
      f.owner,
      "POST",
      `/v1/agent-templates/${f.template.id}/instances`,
      f.input,
      f.tenant,
    );
  await ok(f.owner, "POST", `/v1/tenants/${f.tenant}/demo-credit`, {});
  const conversation = await ok(f.owner, "POST", f.base + "/conversations", {
    name: "Pinned runtime conversation",
    agent_id: agent.id,
  });
  const task = await ok(
    f.owner,
    "POST",
    f.base + `/conversations/${conversation.id}/messages`,
    {
      body: "Write a clearly simulated campaign review.",
      expected_version: conversation.version,
      intent: "delegate",
      mode: "execute",
      budget_micros: 1000000,
      client_message_id: randomUUID(),
    },
  );
  const taskId = task.task.id,
    oldCapability = (
      await s.db.control.query(
        "SELECT body->'capability_version_ids' AS ids FROM agent_versions WHERE id=$1",
        [agent.agent_version_id],
      )
    ).rows[0].ids[0];
  const oldDefinition = (
    await s.db.control.query(
      "SELECT body FROM internal_capability_versions WHERE id=$1",
      [oldCapability],
    )
  ).rows[0].body;
  class Controlled extends CodexRuntimeAdapter {
    calls = 0;
    selections: RuntimeContext["selection"][] = [];
    async start(context: RuntimeContext) {
      this.calls++;
      this.selections.push(context.selection);
      return {
        text: "Synthetic model result",
        inputTokens: 1,
        outputTokens: 1,
        usageKnown: true,
        accepted: true,
        thread: "fixture",
        turn: "fixture",
        status: "completed",
      };
    }
  }
  const model = new Controlled(s.db.config),
    worker = new Worker(s.db, s.catalog, s.storage, model);
  s.db.config.AI_MODEL = "controlled-model-version-two";
  await seedRuntimeProfile(s.db, s.catalog);
  await worker.run(f.tenant, taskId);
  const completed = await ok(f.owner, "GET", f.base + "/tasks/" + taskId);
  assert.equal(model.calls, 1);
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.attempt, 1);
  const selection = model.selections[0];
  assert.ok(selection);
  assert.equal(selection.capabilityVersionId, oldCapability);
  assert.equal(selection.model, oldDefinition.model_alias);
  assert.equal(selection.reasoningEffort, oldDefinition.reasoning_effort);
  assert.equal(selection.inputRate, oldDefinition.rates[0]);
  assert.equal(selection.outputRate, oldDefinition.rates[1]);
  assert.equal(
    Number(completed.charged_micros),
    tokenCharge(1, 1, oldDefinition.rates[0], oldDefinition.rates[1]),
  );
  assert.notEqual(
    s.catalog.capabilityVersions.get("internal-text-v1").id,
    oldCapability,
  );
  const currentConversation = await ok(
    f.owner,
    "GET",
    f.base + "/conversations/" + conversation.id,
  );
  const before = (
    await s.db.control.query(
      "SELECT count(*)::int AS n FROM tasks WHERE project_id=$1",
      [f.project],
    )
  ).rows[0].n;
  const rejected = await call(
    f.owner,
    "POST",
    f.base + `/conversations/${conversation.id}/messages`,
    {
      expected_version: currentConversation.version,
      body: "A stale specialist must fail before reserving another budget.",
      intent: "delegate",
      mode: "execute",
      budget_micros: 1000000,
      client_message_id: randomUUID(),
    },
  );
  assert.equal(rejected.status, 409);
  assert.equal(rejected.data.error.code, "CAPABILITY_VERSION_UNAVAILABLE");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM tasks WHERE project_id=$1",
        [f.project],
      )
    ).rows[0].n,
    before,
  );
  assert.equal(
    Number(
      (
        await s.db.control.query(
          "SELECT reserved_micros FROM wallets WHERE tenant_id=$1",
          [f.tenant],
        )
      ).rows[0].reserved_micros,
    ),
    0,
  );
  const newAgent = await ok(
      f.owner,
      "POST",
      `/v1/agent-templates/${f.template.id}/instances`,
      f.input,
      f.tenant,
    ),
    newConversation = await ok(f.owner, "POST", f.base + "/conversations", {
      name: "Revocation during execution",
      agent_id: newAgent.id,
    }),
    accepted = await ok(
      f.owner,
      "POST",
      f.base + `/conversations/${newConversation.id}/messages`,
      {
        body: "Produce a simulated answer while permission is valid.",
        expected_version: newConversation.version,
        intent: "delegate",
        mode: "execute",
        budget_micros: 1000000,
        client_message_id: randomUUID(),
      },
    );
  class Revoking extends Controlled {
    async start(context: RuntimeContext) {
      this.calls++;
      await s.db.control.query(
        "UPDATE codex_runtime_profiles SET state='revoked' WHERE id=$1",
        [newAgent.runtime_profile_id],
      );
      await assert.rejects(
        context.tools
          .find((tool) => tool.name === "deliver_text")!
          .run(
            {
              filename: "must-not-publish.md",
              mime_type: "text/markdown",
              content: "Unavailable profile",
            },
            randomUUID(),
          ),
      );
      return {
        text: "Must not publish",
        inputTokens: 1,
        outputTokens: 1,
        usageKnown: true,
        accepted: true,
        thread: "fixture",
        turn: "fixture",
        status: "completed",
      };
    }
  }
  const revoking = new Revoking(s.db.config);
  await new Worker(s.db, s.catalog, s.storage, revoking).run(
    f.tenant,
    accepted.task.id,
  );
  const result = await ok(
    f.owner,
    "GET",
    f.base + "/tasks/" + accepted.task.id,
  );
  assert.equal(revoking.calls, 1);
  assert.equal(result.status, "cancelled");
  assert.equal(result.output, "");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM assets WHERE project_id=$1 AND name='must-not-publish.md'",
        [f.project],
      )
    ).rows[0].n,
    0,
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE codex_runtime_profiles SET state='enabled' WHERE id=$1",
      [newAgent.runtime_profile_id],
    ),
    { code: "23514" },
  );
});
