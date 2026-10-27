import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { seedRuntimeProfile } from "../src/runtime-profiles.js";
import pg from "pg";
import { RetentionService } from "../src/retention.js";
import { adoptionPreview, adoptionResult } from "../src/agent-adoption.js";

let ddl: pg.Pool;
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>;
let s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string };
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  idempotencyKey = randomUUID(),
) {
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: s.db.config.WEB_ORIGIN,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      "idempotency-key": idempotencyKey,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
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
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
async function login(
  email = `adoption-${randomUUID()}@example.invalid`,
): Promise<Client> {
  const ch = await ok(undefined, "POST", "/v1/auth/challenge", { email });
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
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const cookie = r.raw.cookies.find((c) => c.name === "cp_session")!;
  return {
    id: r.data.user.id,
    cookie: `${cookie.name}=${cookie.value}`,
    csrf: r.data.csrf_token,
  };
}
async function fixture() {
  const owner = await login(),
    member = await login();
  const w = await ok(owner, "POST", "/v1/tenants", {
    name: "Explicit adoption",
    project_name: "Shared specialists",
  });
  const tenant = w.tenant.id,
    project = w.project.id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  await s.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
    [tenant, member.id],
  );
  await s.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",
    [tenant, project, member.id],
  );
  await s.db.control.query(
    "UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1",
    [tenant],
  );
  const definition = {
    name: "Campaign analyst",
    role_key: "marketing-analyst",
    instructions:
      "Private brand brief, retained only in actual agent versions.",
    brand_id: null,
    enabled: true,
  };
  const { enabled: _, ...creation } = definition;
  const agent = await ok(owner, "POST", base + "/agents", creation);
  const conversation = await ok(owner, "POST", base + "/conversations", {
    name: "My campaign",
    agent_id: agent.id,
  });
  return {
    owner,
    member,
    tenant,
    project,
    base,
    agent,
    conversation,
    definition,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
const proposal = (f: Fixture) => ({
  expected_version: f.agent.version,
  definition: {
    ...f.definition,
    instructions: "A different private working brief.",
  },
});
async function preview(
  f: Fixture,
  body: unknown = proposal(f),
  resource = `/agents/${f.agent.id}/version-previews`,
  c = f.owner,
  k = randomUUID(),
) {
  const r = await call(c, "POST", f.base + resource, body, k);
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.raw.headers["cache-control"], "no-store");
  adoptionPreview.parse(r.data);
  return { p: r.data, body };
}
const confirmation = (v: Awaited<ReturnType<typeof preview>>) => ({
  preview_hash: v.p.preview_hash,
  proposal: v.body,
});
const confirm = (
  f: Fixture,
  v: Awaited<ReturnType<typeof preview>>,
  c = f.owner,
  k = randomUUID(),
) =>
  call(
    c,
    "POST",
    `${f.base}/version-adoption-previews/${v.p.id}/confirmations`,
    confirmation(v),
    k,
  );
const refresh = (
  f: Fixture,
  v: Awaited<ReturnType<typeof preview>>,
  c = f.owner,
) => call(c, "GET", `${f.base}/version-adoption-previews/${v.p.id}`);
async function facts(f: Fixture) {
  const result: any = {};
  for (const table of [
    "tasks",
    "ledger",
    "reservations",
    "agent_versions",
    "skill_installations",
  ])
    result[table] = (
      await s.db.control.query(
        `SELECT count(*)::int AS n FROM ${table} WHERE tenant_id=$1`,
        [f.tenant],
      )
    ).rows[0].n;
  result.agent = (
    await s.db.control.query("SELECT version FROM agents WHERE id=$1", [
      f.agent.id,
    ])
  ).rows[0].version;
  return result;
}
async function changeModel() {
  s.db.config.AI_REASONING_EFFORT =
    s.db.config.AI_REASONING_EFFORT === "high" ? "low" : "high";
  s.db.config.AI_INPUT_HKD_MICROS_PER_MILLION =
    (s.db.config.AI_INPUT_HKD_MICROS_PER_MILLION ?? 0) + 1;
  await seedRuntimeProfile(s.db, s.catalog);
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  ddl = new pg.Pool({ connectionString: isolated.env.OWNER_DATABASE_URL });
  s = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      WORKER_ENABLED: "false",
      DEMO_MODE: "false",
      AI_BASE_URL: "http://127.0.0.1:9/v1",
      AI_ALLOWED_HOSTS: "127.0.0.1",
      AI_API_KEY: "controlled-fixture",
      AI_MODEL: "internal-test-text",
      AI_VERIFIED: "true",
      AI_REASONING_EFFORT: "high",
      AI_INPUT_HKD_MICROS_PER_MILLION: "1000001",
      AI_OUTPUT_HKD_MICROS_PER_MILLION: "2000001",
    }),
    { worker: false },
  );
});
after(async () => {
  try {
    if (s) await s.app.close();
    if (ddl) await ddl.end();
  } finally {
    await isolated?.cleanup();
  }
});

test("preview freezes exact models, effort and micro rates without creating work, charges, installations or agent versions", async () => {
  const f = await fixture(),
    before = await facts(f),
    v = await preview(f);
  assert.deepEqual(await facts(f), before);
  const text = v.p.comparison.target.capabilities.find(
    (c: any) => c.profile_key === "internal-text-v1",
  );
  assert.equal(text.model_alias, "internal-test-text");
  assert.equal(text.reasoning_effort, "high");
  assert.equal(text.input_micros_per_million, "1000001");
  assert.equal(text.output_micros_per_million, "2000001");
  assert.equal(v.p.comparison.effect, "future_tasks_only");
  assert.deepEqual(v.p.comparison.changed_fields, ["instructions"]);
  const persisted = (
    await s.db.control.query(
      "SELECT * FROM agent_adoption_previews WHERE id=$1",
      [v.p.id],
    )
  ).rows[0];
  assert.ok(!JSON.stringify(persisted).includes("private working brief"));
  assert.ok(!JSON.stringify(persisted).includes(f.definition.instructions));
  const replays = (
    await s.db.control.query(
      "SELECT response FROM request_replays WHERE actor_id=$1 AND action LIKE 'agent-adoption.%'",
      [f.owner.id],
    )
  ).rows;
  assert.ok(!JSON.stringify(replays).includes("private working brief"));
});
test("specialist confirmation is atomic, replayable and keeps conversations on their original version", async () => {
  const f = await fixture(),
    v = await preview(f),
    k = randomUUID();
  const accepted = await confirm(f, v, f.owner, k);
  assert.equal(accepted.status, 200, JSON.stringify(accepted.data));
  adoptionResult.parse(accepted.data);
  assert.equal(accepted.data.version, 2);
  assert.deepEqual((await confirm(f, v, f.owner, k)).data, accepted.data);
  assert.equal(
    (await confirm(f, v)).data.error.code,
    "ADOPTION_PREVIEW_CONSUMED",
  );
  const reloaded = await call(
    f.owner,
    "POST",
    `${f.base}/agents/${f.agent.id}/version-previews`,
    v.body,
  );
  assert.equal(reloaded.data.error.code, "VERSION_CONFLICT");
  assert.equal(
    (await ok(f.owner, "GET", `${f.base}/conversations/${f.conversation.id}`))
      .agent_version,
    1,
  );
});
test("confirmed comparisons recover the current consumed state after a lost preview response", async () => {
  const f = await fixture(),
    b = proposal(f),
    k = randomUUID(),
    v = await preview(f, b, undefined, f.owner, k);
  assert.equal((await confirm(f, v)).status, 200);
  const retry = await preview(f, b, undefined, f.owner, k);
  assert.equal(retry.p.id, v.p.id);
  assert.equal(retry.p.state, "consumed");
  assert.equal(retry.p.result.version, 2);
  const c = await ok(
    f.owner,
    "GET",
    `${f.base}/conversations/${f.conversation.id}`,
  );
  assert.equal(c.agent_version, 1);
});
test("same key with a different proposal or reviewed hash is rejected without any version increment", async () => {
  const f = await fixture(),
    b = proposal(f),
    k = randomUUID(),
    v = await preview(f, b, undefined, f.owner, k);
  const different = await call(
    f.owner,
    "POST",
    `${f.base}/agents/${f.agent.id}/version-previews`,
    { ...b, definition: { ...b.definition, name: "Another name" } },
    k,
  );
  assert.equal(different.status, 409);
  const wrong = await call(
    f.owner,
    "POST",
    `${f.base}/version-adoption-previews/${v.p.id}/confirmations`,
    { ...confirmation(v), preview_hash: "a".repeat(64) },
  );
  assert.equal(wrong.data.error.code, "ADOPTION_PROPOSAL_CHANGED");
  const changed = await call(
    f.owner,
    "POST",
    `${f.base}/version-adoption-previews/${v.p.id}/confirmations`,
    {
      ...confirmation(v),
      proposal: {
        ...b,
        definition: { ...b.definition, name: "Changed after review" },
      },
    },
  );
  assert.equal(changed.data.error.code, "ADOPTION_PROPOSAL_CHANGED");
  assert.equal((await facts(f)).agent, 1);
});
test("two confirmations race once, with one version, one skill binding set and one adoption audit", async () => {
  const f = await fixture(),
    v = await preview(f);
  const results = await Promise.all([confirm(f, v), confirm(f, v)]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
  assert.equal((await facts(f)).agent, 2);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM audit_log WHERE target=$1 AND action='agent.version.adopt'",
        [f.agent.id],
      )
    ).rows[0].n,
    1,
  );
});
test("a comparison is private to its actor, actual login session, project and tenant", async () => {
  const f = await fixture(),
    v = await preview(f);
  assert.equal((await refresh(f, v, f.member)).status, 404);
  assert.equal((await confirm(f, v, f.member)).status, 404);
  const u = (
    await s.db.control.query("SELECT email FROM users WHERE id=$1", [
      f.owner.id,
    ])
  ).rows[0];
  const anotherSession = await login(u.email);
  assert.equal((await refresh(f, v, anotherSession)).status, 404);
  const other = await fixture();
  assert.equal(
    (
      await call(
        other.owner,
        "GET",
        `${other.base}/version-adoption-previews/${v.p.id}`,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        undefined,
        "GET",
        `${f.base}/version-adoption-previews/${v.p.id}`,
      )
    ).status,
    401,
  );
});
test("read-only members and non-owning editors cannot create or confirm shared specialist changes", async () => {
  const f = await fixture(),
    v = await preview(f);
  assert.equal(
    (
      await call(
        f.member,
        "POST",
        `${f.base}/agents/${f.agent.id}/version-previews`,
        proposal(f),
      )
    ).status,
    403,
  );
  await s.db.control.query(
    "UPDATE memberships SET role='viewer',version=version+1 WHERE tenant_id=$1 AND user_id=$2",
    [f.tenant, f.owner.id],
  );
  await s.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'viewer') ON CONFLICT(project_id,user_id) DO UPDATE SET role='viewer'",
    [f.tenant, f.project, f.owner.id],
  );
  assert.equal((await confirm(f, v)).status, 403);
});
test("default adoption requires project management and rejects the former one-click refresh", async () => {
  const f = await fixture(),
    c = await ok(f.owner, "POST", f.base + "/conversations", {
      name: "Default conversation",
    }),
    b = { expected_version: 1 };
  assert.equal(
    (
      await call(
        f.member,
        "POST",
        `${f.base}/agents/${c.agent_id}/version-previews`,
        b,
      )
    ).status,
    403,
  );
  assert.equal(
    (await call(f.owner, "POST", f.base + "/default-assistant/versions", b))
      .data.error.code,
    "ADOPTION_PREVIEW_REQUIRED",
  );
  const v = await preview(f, b, `/agents/${c.agent_id}/version-previews`);
  assert.equal(v.p.kind, "default_assistant");
  assert.equal((await confirm(f, v)).data.agent_version, 2);
  assert.equal(
    (await ok(f.owner, "GET", `${f.base}/conversations/${c.id}`)).agent_version,
    1,
  );
});
test("conversation adoption reviews the exact current agent and atomically saves its name and pinned agent version", async () => {
  const f = await fixture(),
    v = await preview(f);
  assert.equal((await confirm(f, v)).status, 200);
  const b = {
    expected_version: 1,
    target_agent_version: 2,
    name: "Renamed after review",
  };
  assert.equal(
    (
      await call(
        f.owner,
        "PATCH",
        `${f.base}/conversations/${f.conversation.id}`,
        { expected_version: 1, adopt_agent_version: 2 },
      )
    ).data.error.code,
    "ADOPTION_PREVIEW_REQUIRED",
  );
  const cp = await preview(
    f,
    b,
    `/conversations/${f.conversation.id}/adoption-previews`,
  );
  assert.equal(cp.p.comparison.source.agent_version, 1);
  assert.equal(cp.p.comparison.target.agent_version, 2);
  assert.ok(cp.p.comparison.changed_fields.includes("name"));
  assert.equal((await confirm(f, cp)).status, 200);
  const c = await ok(
    f.owner,
    "GET",
    `${f.base}/conversations/${f.conversation.id}`,
  );
  assert.equal(c.name, b.name);
  assert.equal(c.agent_version, 2);
  assert.equal(c.version, 2);
  assert.equal(
    (
      await call(
        f.member,
        "POST",
        `${f.base}/conversations/${f.conversation.id}/adoption-previews`,
        { expected_version: 2, target_agent_version: 2 },
      )
    ).status,
    404,
  );
});
test("ordinary legacy edits keep exact frozen bindings; a changed current model or rate requires a new comparison", async () => {
  const f = await fixture(),
    saved = await ok(f.owner, "PATCH", `${f.base}/agents/${f.agent.id}`, {
      ...f.definition,
      expected_version: 1,
    });
  assert.equal(saved.version, 2);
  assert.deepEqual(
    saved.body.capability_version_ids,
    f.agent.body.capability_version_ids,
  );
  await changeModel();
  const refused = await call(
    f.owner,
    "PATCH",
    `${f.base}/agents/${f.agent.id}`,
    { ...f.definition, expected_version: 2 },
  );
  assert.equal(refused.data.error.code, "ADOPTION_PREVIEW_REQUIRED");
});
test("a changed model, effort or rate invalidates both refresh and confirmation; an old compared rate is never silently replaced", async () => {
  const f = await fixture(),
    v = await preview(f);
  await changeModel();
  assert.equal((await refresh(f, v)).data.error.code, "ADOPTION_PREVIEW_STALE");
  assert.equal((await confirm(f, v)).data.error.code, "ADOPTION_PREVIEW_STALE");
  assert.equal((await facts(f)).agent, 1);
  const next = await preview(f);
  assert.ok(next.p.comparison.changed_fields.includes("rates"));
  assert.ok(next.p.comparison.changed_fields.includes("reasoning_effort"));
});
test("concurrent edits invalidate a previously reviewed comparison", async () => {
  const f = await fixture(),
    v = await preview(f);
  await ok(f.owner, "PATCH", `${f.base}/agents/${f.agent.id}`, {
    ...f.definition,
    name: "Changed elsewhere",
    expected_version: 1,
  });
  assert.equal((await refresh(f, v)).data.error.code, "ADOPTION_PREVIEW_STALE");
  assert.equal((await confirm(f, v)).data.error.code, "VERSION_CONFLICT");
});
test("a disable and re-enable cycle changes the installation revision and invalidates old approval", async () => {
  const f = await fixture(),
    v = await preview(f),
    installation = (await ok(f.owner, "GET", f.base + "/skill-installations"))
      .items[0];
  await ok(
    f.owner,
    "PATCH",
    `${f.base}/skill-installations/${installation.id}`,
    { expected_version: installation.version, enabled: false },
  );
  await ok(
    f.owner,
    "PATCH",
    `${f.base}/skill-installations/${installation.id}`,
    { expected_version: installation.version + 1, enabled: true },
  );
  assert.equal((await refresh(f, v)).data.error.code, "ADOPTION_PREVIEW_STALE");
  assert.equal((await confirm(f, v)).data.error.code, "ADOPTION_PREVIEW_STALE");
});
test("uninstalled required methods cannot be silently restored by a preview or confirmation", async () => {
  const f = await fixture(),
    v = await preview(f),
    installation = (await ok(f.owner, "GET", f.base + "/skill-installations"))
      .items[0];
  await ok(
    f.owner,
    "DELETE",
    `${f.base}/skill-installations/${installation.id}`,
  );
  const before = await facts(f);
  assert.equal(
    (await confirm(f, v)).data.error.code,
    "SKILL_INSTALLATION_REQUIRED",
  );
  assert.deepEqual(await facts(f), before);
});
test("session revocation prevents replay of an accepted confirmation", async () => {
  const f = await fixture(),
    v = await preview(f),
    k = randomUUID();
  assert.equal((await confirm(f, v, f.owner, k)).status, 200);
  await s.db.control.query(
    "UPDATE sessions SET revoked_at=now() WHERE user_id=$1",
    [f.owner.id],
  );
  assert.equal((await confirm(f, v, f.owner, k)).status, 401);
});

test("expired comparisons refuse confirmation and bounded retention removes only sufficiently old comparisons", async () => {
  const f = await fixture(),
    v = await preview(f),
    row = (
      await s.db.control.query(
        "SELECT * FROM agent_adoption_previews WHERE id=$1",
        [v.p.id],
      )
    ).rows[0],
    id = randomUUID();
  // Test fixture inserts an already expired copy; immutable production rows are never rewritten.
  await s.db.control.query(
    `INSERT INTO agent_adoption_previews(id,tenant_id,project_id,actor_id,session_id,auth_version,kind,resource_id,agent_id,expected_version,source_hash,proposal_hash,context_hash,preview_hash,comparison,guards,created_at,expires_at)
    VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,now()-interval '2 days',now()-interval '2 days'+interval '5 minutes')`,
    [
      id,
      row.tenant_id,
      row.project_id,
      row.actor_id,
      row.session_id,
      row.auth_version,
      row.kind,
      row.resource_id,
      row.agent_id,
      row.expected_version,
      row.source_hash,
      row.proposal_hash,
      row.context_hash,
      row.preview_hash,
      row.comparison,
      row.guards,
    ],
  );
  const expired = { ...v, p: { ...v.p, id } };
  assert.equal(
    (await refresh(f, expired)).data.error.code,
    "ADOPTION_PREVIEW_EXPIRED",
  );
  assert.equal(
    (await confirm(f, expired)).data.error.code,
    "ADOPTION_PREVIEW_EXPIRED",
  );
  const result = await new RetentionService(s.db, s.storage).expireContent(100);
  assert.equal(result?.adoption_previews, 1);
  assert.equal((await refresh(f, v)).status, 200);
});
test("adoption audit failure rolls back version, skill bindings, comparison consumption and idempotent receipt", async () => {
  const f = await fixture(),
    v = await preview(f),
    k = randomUUID(),
    before = await facts(f);
  await ddl.query(
    "CREATE FUNCTION test_adoption_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='agent.version.adopt' THEN RAISE EXCEPTION 'controlled adoption audit failure'; END IF; RETURN NEW; END $$",
  );
  await ddl.query(
    "CREATE TRIGGER test_adoption_audit_failure BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION test_adoption_audit_failure()",
  );
  try {
    assert.equal((await confirm(f, v, f.owner, k)).status, 500);
    assert.deepEqual(await facts(f), before);
    assert.equal((await refresh(f, v)).data.state, "ready");
  } finally {
    await ddl.query("DROP TRIGGER test_adoption_audit_failure ON audit_log");
    await ddl.query("DROP FUNCTION test_adoption_audit_failure()");
  }
  assert.equal((await confirm(f, v, f.owner, k)).status, 200);
});

test("unknown historical capabilities stay unknown instead of borrowing today's prices", async () => {
  const f = await fixture(),
    body = { ...f.agent.body };
  delete body.capability_version_ids;
  await s.db.control.query("UPDATE agents SET version=2 WHERE id=$1", [
    f.agent.id,
  ]);
  await s.db.control.query(
    "INSERT INTO agent_versions(tenant_id,agent_id,version,body,created_by) VALUES($1,$2,2,$3,$4)",
    [f.tenant, f.agent.id, body, f.owner.id],
  );
  const v = await preview(f, { ...proposal(f), expected_version: 2 });
  assert.equal(v.p.comparison.source.recorded, false);
  assert.deepEqual(v.p.comparison.source.capabilities, []);
  assert.equal(v.p.comparison.source.runtime_version, null);
  assert.equal(v.p.comparison.target.recorded, true);
});

test("brand revisions changed after review invalidate both refresh and confirmation", async () => {
  const f = await fixture(),
    brand = (
      await s.db.control.query(
        "INSERT INTO brand_profiles(tenant_id,project_id,name,body) VALUES($1,$2,'Original brand','{}') RETURNING *",
        [f.tenant, f.project],
      )
    ).rows[0];
  const v = await preview(f, {
    ...proposal(f),
    definition: { ...f.definition, brand_id: brand.id },
  });
  assert.deepEqual(v.p.comparison.target.brand, { id: brand.id, version: 1 });
  await s.db.control.query(
    "UPDATE brand_profiles SET version=version+1 WHERE id=$1",
    [brand.id],
  );
  assert.equal((await refresh(f, v)).data.error.code, "ADOPTION_PREVIEW_STALE");
  assert.equal((await confirm(f, v)).data.error.code, "ADOPTION_PREVIEW_STALE");
});

test("the per-actor project preview bound is enforced without installing methods or changing work", async () => {
  const f = await fixture(),
    before = await facts(f);
  for (let i = 0; i < 20; i++) await preview(f);
  const rejected = await call(
    f.owner,
    "POST",
    `${f.base}/agents/${f.agent.id}/version-previews`,
    proposal(f),
  );
  assert.equal(rejected.status, 429);
  assert.equal(rejected.data.error.code, "ADOPTION_PREVIEW_LIMIT");
  assert.deepEqual(await facts(f), before);
});

test("a revoked Codex runtime refuses confirmation without creating a version or reversing revocation", async () => {
  const f = await fixture(),
    v = await preview(f);
  await s.db.control.query(
    "UPDATE codex_runtime_profiles SET state='revoked' WHERE id=$1",
    [s.catalog.runtimeProfile.id],
  );
  const refused = await confirm(f, v);
  assert.equal(refused.status, 403);
  assert.equal(refused.data.error.code, "RUNTIME_PROFILE_UNAVAILABLE");
  assert.equal((await facts(f)).agent, 1);
});
