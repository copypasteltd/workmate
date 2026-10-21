import { seedProviderBudgetPolicy } from "../src/provider-budgets.js";
import { after, before, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, mkdir, writeFile, access } from "node:fs/promises";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { createServer } from "node:http";
import { crc32, deflateSync } from "node:zlib";
import { PNG } from "pngjs";
import * as OTPAuth from "otpauth";
import pg from "pg";
import { Ajv2020 } from "ajv/dist/2020.js";
import contract from "../contracts/capability-schemas.json" with { type: "json" };
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { runMigrations } from "../scripts/migration-runner.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { seal, canonical, hash } from "../src/lib.js";
import { taskCapabilities } from "../src/capability-bindings.js";
import { Catalog } from "../src/catalog.js";
import {
  purgeCapabilityWorkspaces,
  queueCapabilityWorkspacePurge,
} from "../src/capability-workspace-cleanup.js";
import { removeOwnedUUIDDirectory } from "../src/owned-directory-cleanup.js";
import { validateVerificationPNG } from "../src/png-validation.js";
import { listenLoopbackHTTP } from "../src/loopback-http.js";
import { CodexRuntimeAdapter, type RuntimeContext } from "../src/runtime.js";
import { Worker } from "../src/worker.js";
import { installIsolatedProviderPolicy } from "./provider-policy-fixture.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string; admin: boolean };
const ajv = new Ajv2020({ allErrors: true });
createRequire(import.meta.url)("ajv-formats")(ajv);
const defs = JSON.parse(
  JSON.stringify(contract.schemas).replaceAll(
    "#/components/schemas/",
    "#/$defs/",
  ),
);
function check(name: string, value: unknown) {
  const validator = ajv.compile({ $defs: defs, $ref: "#/$defs/" + name });
  assert.ok(validator(value), JSON.stringify(validator.errors));
}
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  headers: Record<string, string> = {},
) {
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: url.startsWith("/v1/admin")
        ? s.db.config.ADMIN_ORIGIN
        : s.db.config.WEB_ORIGIN,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      "idempotency-key": randomUUID(),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...headers,
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = raw.json();
  if (
    raw.statusCode === 202 &&
    url.startsWith("/v1/admin/capability-releases") &&
    (url.endsWith("/drafts") || /\/(publications|rollbacks)$/.test(url))
  )
    check("AdminOperation", data);
  return { status: raw.statusCode, data, raw };
}
async function login(email: string, secret?: OTPAuth.Secret): Promise<Client> {
  const prefix = secret ? "/v1/admin/auth" : "/v1/auth";
  const ch = await call(undefined, "POST", prefix + "/challenge", { email });
  assert.equal(ch.status, 200, JSON.stringify(ch.data));
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${ch.data.challenge_id}.json`,
      "utf8",
    ),
  );
  const r = await call(undefined, "POST", prefix + "/verify", {
    challenge_id: ch.data.challenge_id,
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
    cookie: `${cookie.name}=${cookie.value}`,
    csrf: r.data.csrf_token,
    admin: !!secret,
  };
}
async function administrator(
  options: {
    permissions?: string[];
    scope?: "global" | "tenant" | "project";
    id?: string;
  } = {},
) {
  const secret = new OTPAuth.Secret({ size: 20 }),
    email = randomUUID() + "@example.invalid";
  const p = (
    await s.db.control.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Plan operator',$2) RETURNING id",
      [email, seal(s.db.config.MASTER_KEY!, secret.base32)],
    )
  ).rows[0];
  let role = "super_admin";
  if (options.permissions) {
    role = "plan-" + randomUUID();
    await s.db.control.query(
      "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
      [role, JSON.stringify(options.permissions)],
    );
  }
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,$2,$3,$4)",
    [p.id, role, options.scope ?? "global", options.id ?? null],
  );
  return { ...(await login(email, secret)), id: p.id };
}

const root = "/v1/admin/capability-releases";
let price = 1200000;
const document = () => ({
  profile_key: "internal-text-v1",
  kernel: "codex",
  gateway_policy: "company_internal_only",
  model_alias: "copypaste-demo",
  reasoning_effort: "medium",
  rates: [++price, ++price],
});
const command = (v: any) => ({
  expected_version: v.version,
  reason: "Independent model capability review",
});
async function draft(a: Client, doc: any = document(), k = randomUUID()) {
  const b = { document: doc, reason: "Controlled capability document" };
  const r = await call(a, "POST", root + "/drafts", b, {
    "idempotency-key": k,
  });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  assert.equal(r.data.state, "succeeded");
  const detail = await call(a, "GET", root + "/" + r.data.result_ids[0]);
  assert.equal(detail.status, 200, JSON.stringify(detail.data));
  return { v: detail.data, op: r.data, b, k };
}
async function validate(a: Client, v: any, k = randomUUID()) {
  const r = await call(a, "POST", `${root}/${v.id}/validations`, command(v), {
    "idempotency-key": k,
  });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  return r.data;
}
async function preview(a: Client, v: any, rollback = false) {
  const b = command(v),
    suffix = rollback ? "rollbacks" : "publications";
  const r = await call(a, "POST", `${root}/${v.id}/${suffix}-previews`, b);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.decision, "independent_approval");
  assert.equal(r.data.creates_business_effect, false);
  return { b, p: r.data, suffix };
}
async function submit(
  a: Client,
  v: any,
  p: Awaited<ReturnType<typeof preview>>,
) {
  const r = await call(a, "POST", `${root}/${v.id}/${p.suffix}`, p.b, {
    "x-admin-preview-id": p.p.preview_id,
  });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  assert.equal(r.data.state, "pending_approval");
  return r.data;
}
async function approve(
  a: Client,
  op: any,
  decision: "approve" | "reject" = "approve",
) {
  const r = await call(a, "GET", `/v1/admin/operations/${op.id}/approval`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return call(a, "POST", `/v1/admin/approvals/${r.data.id}/decisions`, {
    expected_version: r.data.version,
    payload_hash: r.data.payload_hash,
    decision,
    reason: "Independent capability review",
  });
}
async function publish(a: Client, reviewer: Client, v: any, rollback = false) {
  const op = await submit(a, v, await preview(a, v, rollback));
  const r = await approve(reviewer, op);
  assert.equal(r.status, 202, JSON.stringify(r.data));
  assert.equal(r.data.state, "succeeded");
  return op;
}
async function fixture() {
  const owner = await login(randomUUID() + "@example.invalid");
  const r = await call(owner, "POST", "/v1/tenants", {
    name: "Capability customer",
    project_name: "Version confirmation",
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const tenant = r.data.tenant.id,
    project = r.data.project.id;
  await s.db.control.query(
    "UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1",
    [tenant],
  );
  return {
    owner,
    tenant,
    project,
    headers: { "x-tenant-id": tenant },
    base: `/v1/tenants/${tenant}/projects/${project}`,
  };
}
async function task(f: Awaited<ReturnType<typeof fixture>>) {
  const r = await call(f.owner, "POST", f.base + "/tasks", {
    title: "Frozen capability",
    prompt: "Keep the confirmed model and price",
    role_key: "marketing-analyst",
    budget_micros: 1000000,
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return (
    await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [r.data.id])
  ).rows[0];
}
async function binding(t: any) {
  return s.db.tx(
    (tx) => taskCapabilities(tx, s.db.config, s.catalog, t),
    undefined,
    true,
  );
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  const configuredCodex = isolated.env.CODEX_BIN ?? "codex";
  const pinnedCodex = path.isAbsolute(configuredCodex)
    ? configuredCodex
    : execFileSync(
        process.platform === "win32" ? "where.exe" : "which",
        [configuredCodex],
        { encoding: "utf8", windowsHide: true },
      )
        .split(/\r?\n/)
        .find((p) => path.isAbsolute(p.trim()))!
        .trim();
  assert.ok(path.isAbsolute(pinnedCodex));
  s = await buildApp(
    loadConfig({
      ...isolated.env,
      CODEX_BIN: pinnedCodex,
      NODE_ENV: "test",
      DEV_MAILBOX: "true",
      WORKER_ENABLED: "false",
      DEMO_MODE: "true",
      AI_VERIFICATION_PER_RUN_BUDGET_MICROS: "100000000",
      AI_PLATFORM_VERIFICATION_DAILY_BUDGET_MICROS: "1000000000000",
    }),
    { worker: false },
  );
  await installIsolatedProviderPolicy(s.db);
});
after(async () => {
  if (s) await s.app.close();
  if (isolated) await isolated.cleanup();
});

test("capability contract fixture preserves the exact original schemas and digest", async () => {
  const raw = await readFile("../../docs/contracts/openapi.json"),
    original = JSON.parse(raw.toString());
  assert.equal(
    createHash("sha256").update(raw).digest("hex"),
    contract.normative_source_sha256,
  );
  for (const [name, schema] of Object.entries(contract.schemas))
    assert.deepEqual(schema, original.components.schemas[name]);
});
test("capability management requires the Admin audience, whole-global permission, current MFA and no overlapping deny", async () => {
  const u = await login(randomUUID() + "@example.invalid");
  assert.equal((await call(undefined, "GET", root)).status, 401);
  assert.equal((await call(u, "GET", root)).status, 401);
  const scoped = await administrator({
    permissions: ["admin.catalog.read", "admin.catalog.draft"],
    scope: "project",
    id: randomUUID(),
  });
  assert.equal((await call(scoped, "GET", root)).status, 403);
  assert.equal(
    (
      await call(scoped, "POST", root + "/drafts", {
        document: document(),
        reason: "Scoped write rejected",
      })
    ).status,
    403,
  );
  const stale = await administrator();
  await s.db.control.query(
    "UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",
    [stale.id],
  );
  assert.equal(
    (await call(stale, "GET", root)).data.error.code,
    "MFA_REQUIRED",
  );
  const denied = await administrator(),
    role = "capability-deny-" + randomUUID();
  await s.db.control.query(
    "INSERT INTO admin_roles(key,name,permissions) VALUES($1,$1,$2)",
    [role, JSON.stringify(["admin.catalog.read"])],
  );
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id,effect) VALUES($1,$2,'project',$3,'deny')",
    [denied.id, role, randomUUID()],
  );
  assert.equal((await call(denied, "GET", root)).status, 403);
});
test("typed drafts reject engine, endpoint, credentials and unavailable protocols; replay and immutable documents retain exact bytes", async () => {
  const a = await administrator(),
    d = await draft(a);
  const replay = await call(a, "POST", root + "/drafts", d.b, {
    "idempotency-key": d.k,
  });
  assert.equal(replay.status, 202);
  assert.equal(replay.data.id, d.op.id);
  assert.equal(
    (
      await call(
        a,
        "POST",
        root + "/drafts",
        { ...d.b, reason: "A changed reason" },
        { "idempotency-key": d.k },
      )
    ).status,
    409,
  );
  for (const doc of [
    { ...document(), kernel: "dsh" },
    { ...document(), api_key: "never-accept-credentials" },
    { ...document(), base_url: "https://example.invalid" },
    { ...document(), profile_key: "internal-video-v1" },
    { ...document(), rates: [-1, 1] },
    { ...document(), reasoning_effort: "unsupported" },
  ])
    assert.equal(
      (
        await call(a, "POST", root + "/drafts", {
          document: doc,
          reason: "Invalid draft rejected",
        })
      ).status,
      400,
    );
  const owner = new pg.Client({
    connectionString: isolated.env.OWNER_DATABASE_URL,
  });
  await owner.connect();
  try {
    await assert.rejects(
      owner.query(
        "UPDATE capability_releases SET reason='Changed' WHERE id=$1",
        [d.v.id],
      ),
      (e: any) => e.code === "23514",
    );
    await assert.rejects(
      owner.query("DELETE FROM capability_releases WHERE id=$1", [d.v.id]),
      (e: any) => e.code === "23514",
    );
  } finally {
    await owner.end();
  }
  assert.equal(
    (
      await call(
        a,
        "POST",
        `${root}/${d.v.id}/publications-previews`,
        command(d.v),
      )
    ).data.error.code,
    "CAPABILITY_VERIFICATION_REQUIRED",
  );
});
test("actual pinned Codex performs a tool loop with requested model/effort and known usage; a validation key never repeats the call", async () => {
  const a = await administrator(),
    d = await draft(a),
    k = randomUUID(),
    v = await validate(a, d.v, k);
  assert.equal(v.state, "passed", JSON.stringify(v));
  assert.equal(v.result.data_mode, "simulated");
  assert.equal(v.result.model_alias, d.v.document.model_alias);
  assert.equal(v.result.reasoning_effort, "medium");
  assert.match(v.result.codex_binary_sha256, /^[a-f0-9]{64}$/);
  assert.ok(v.result.checks.includes("tool_call_and_result"));
  assert.ok(v.result.input_tokens > 0);
  assert.ok(v.result.output_tokens > 0);
  assert.equal(v.result.usage_known, true);
  if (v.result.workspace_cleanup_completed === false) {
    assert.equal(v.workspace_cleanup.state, "queued");
    assert.equal(v.workspace_cleanup.validation_id, v.id);
  } else {
    assert.equal(v.result.workspace_cleanup_completed, true);
    assert.equal(v.workspace_cleanup, null);
  }
  assert.ok(BigInt(v.result.known_cost_micros) > 0n);
  assert.deepEqual(await validate(a, d.v, k), v);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM capability_validation_events WHERE validation_id=$1",
        [v.id],
      )
    ).rows[0].n,
    3,
  );
  const authorized = (
    await s.db.control.query(
      "SELECT body FROM capability_validation_events WHERE validation_id=$1 AND body->>'event'='gateway.request_authorized'",
      [v.id],
    )
  ).rows;
  assert.equal(authorized.length, 2);
  assert.equal(new Set(authorized.map((row) => row.body.operation_id)).size, 2);
  for (const { body } of authorized) {
    assert.equal(body.operation, "responses");
    assert.equal(body.model_alias, d.v.document.model_alias);
    assert.match(body.request_hash, /^[a-f0-9]{64}$/);
    assert.ok(body.request_bytes > 0);
  }
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM capability_publications WHERE release_id=$1",
        [d.v.id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (await call(a, "GET", `${root}/validations/${v.id}`)).data.state,
    "passed",
  );
  assert.ok(!canonical(v).includes(s.db.config.AI_API_KEY!));
  assert.ok(!canonical(v).includes(s.db.config.AI_BASE_URL!));
});
test("an unsupported text model cannot qualify and keeps an honest known or reconciling receipt", async () => {
  const a = await administrator(),
    d = await draft(a, { ...document(), model_alias: "not-the-demo-model" }),
    v = await validate(a, d.v);
  assert.ok(["failed", "reconciling"].includes(v.state), JSON.stringify(v));
  if (v.state === "reconciling") {
    assert.equal(v.result.accepted, true);
    assert.equal(v.result.usage_known, false);
  } else assert.ok(v.result.usage_known || !v.result.accepted);
  assert.equal(v.capability_version_id, null);
  assert.notEqual(v.result.error_code, "CAPABILITY_SETUP_REQUIRED");
  assert.equal(
    (
      await call(
        a,
        "POST",
        `${root}/${d.v.id}/publications-previews`,
        command(d.v),
      )
    ).data.error.code,
    "CAPABILITY_VERIFICATION_REQUIRED",
  );
});
test("publication requires another currently authorized Admin and atomically advances the database head seen by other catalogs", async () => {
  const a = await administrator(),
    reviewer = await administrator(),
    d = await draft(a),
    v = await validate(a, d.v);
  assert.equal(v.state, "passed", JSON.stringify(v));
  const op = await submit(a, d.v, await preview(a, d.v));
  assert.equal((await approve(a, op)).status, 403);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM capability_publications WHERE release_id=$1",
        [d.v.id],
      )
    ).rows[0].n,
    0,
  );
  const approvals = await call(reviewer, "GET", "/v1/admin/approvals");
  assert.equal(approvals.status, 200, JSON.stringify(approvals.data));
  assert.ok(approvals.data.items.some((x: any) => x.operation_id === op.id));
  const r = await approve(reviewer, op);
  assert.equal(r.status, 202, JSON.stringify(r.data));
  assert.equal(r.data.state, "succeeded");
  assert.equal(
    (await call(a, "GET", root + "/" + d.v.id)).data.state,
    "published",
  );
  const other = new Catalog();
  await other.load();
  other.runtimeProfile = s.catalog.runtimeProfile;
  other.capabilityVersions = new Map(s.catalog.capabilityVersions);
  const current = await s.db.tx(
    (tx) => other.currentCapabilities(tx),
    undefined,
    true,
  );
  assert.equal(current.get("internal-text-v1").id, v.capability_version_id);
  assert.deepEqual(
    current.get("internal-text-v1").body.rates,
    d.v.document.rates,
  );
  const facts = (
    await s.db.control.query(
      "SELECT * FROM capability_publications WHERE release_id=$1",
      [d.v.id],
    )
  ).rows;
  assert.equal(facts.length, 1);
  assert.equal(facts[0].actor_id, a.id);
  const operation = (
    await s.db.control.query(
      "SELECT approved_by FROM admin_operations WHERE id=$1",
      [op.id],
    )
  ).rows[0];
  assert.equal(operation.approved_by, reviewer.id);
});
test("canonical customer capabilities follow strict schemas and scoped signed pagination without accepting a third cursor segment", async () => {
  const f = await fixture();
  assert.equal(
    (await call(undefined, "GET", "/v1/capabilities", undefined, f.headers))
      .status,
    401,
  );
  const r = await call(
    f.owner,
    "GET",
    "/v1/capabilities?limit=1",
    undefined,
    f.headers,
  );
  assert.equal(r.status, 200, JSON.stringify(r.data));
  check("CapabilityList", r.data);
  assert.ok(r.data.next_cursor);
  const next = await call(
    f.owner,
    "GET",
    "/v1/capabilities?limit=1&cursor=" + encodeURIComponent(r.data.next_cursor),
    undefined,
    f.headers,
  );
  assert.equal(next.status, 200, JSON.stringify(next.data));
  check("CapabilityList", next.data);
  assert.notEqual(next.data.items[0].id, r.data.items[0].id);
  const extra = await call(
    f.owner,
    "GET",
    "/v1/capabilities?limit=1&cursor=" +
      encodeURIComponent(r.data.next_cursor + ".extra"),
    undefined,
    f.headers,
  );
  assert.equal(extra.status, 400, JSON.stringify(extra.data));
  const outsider = await login(randomUUID() + "@example.invalid");
  assert.equal(
    (await call(outsider, "GET", "/v1/capabilities", undefined, f.headers))
      .status,
    404,
  );
  const all = await call(
    f.owner,
    "GET",
    "/v1/capabilities",
    undefined,
    f.headers,
  );
  check("CapabilityList", all.data);
  assert.ok(
    all.data.items
      .filter((x: any) => ["video", "audio"].includes(x.kind))
      .every((x: any) => x.state === "disabled"),
  );
  assert.ok(!canonical(all.data).includes(s.db.config.AI_BASE_URL!));
  assert.ok(!canonical(all.data).includes(s.db.config.AI_API_KEY!));
});
test("new tasks bind the published version while queued tasks retain original prices across a later publication and rollback", async () => {
  const a = await administrator(),
    reviewer = await administrator(),
    f = await fixture(),
    before = await task(f),
    old = await binding(before);
  const d = await draft(a),
    v = await validate(a, d.v);
  assert.equal(v.state, "passed", JSON.stringify(v));
  const previous = (
    await s.db.control.query(
      "SELECT r.* FROM capability_heads h JOIN capability_publications p ON p.id=h.publication_id JOIN capability_releases r ON r.id=p.release_id WHERE h.profile_key='internal-text-v1' AND h.data_mode='simulated'",
    )
  ).rows[0];
  await publish(a, reviewer, d.v);
  const fresh = await task(await fixture()),
    current = await binding(fresh);
  assert.equal(current.text.id, v.capability_version_id);
  assert.deepEqual(current.text.body.rates, d.v.document.rates);
  assert.equal((await binding(before)).text.id, old.text.id);
  assert.deepEqual(
    (await binding(before)).text.body.rates,
    old.text.body.rates,
  );
  const op = await publish(a, reviewer, previous, true);
  const restored = await task(await fixture());
  assert.equal((await binding(restored)).text.id, old.text.id);
  const fact = (
    await s.db.control.query(
      "SELECT * FROM capability_publications WHERE operation_id=$1",
      [op.id],
    )
  ).rows[0];
  assert.equal(fact.rollback, true);
  assert.ok(fact.previous_publication_id);
  assert.equal((await binding(fresh)).text.id, current.text.id);
});
test("head changes invalidate an exact reviewed preview and a pending approval rather than rebasing the change", async () => {
  const a = await administrator(),
    reviewer = await administrator(),
    first = await draft(a),
    second = await draft(a);
  assert.equal((await validate(a, first.v)).state, "passed");
  assert.equal((await validate(a, second.v)).state, "passed");
  const p = await preview(a, first.v),
    pending = await submit(a, first.v, p),
    stale = await preview(a, first.v);
  await publish(a, reviewer, second.v);
  const commit = await call(
    a,
    "POST",
    `${root}/${first.v.id}/publications`,
    stale.b,
    { "x-admin-preview-id": stale.p.preview_id },
  );
  assert.equal(commit.status, 409, JSON.stringify(commit.data));
  assert.equal(commit.data.error.code, "TARGET_CHANGED");
  const decision = await approve(reviewer, pending);
  assert.equal(decision.status, 409, JSON.stringify(decision.data));
  assert.equal(decision.data.error.code, "TARGET_CHANGED");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT state FROM admin_operations WHERE id=$1",
        [pending.id],
      )
    ).rows[0].state,
    "pending_approval",
  );
});
test("expired unknown verifications become reconciling and keep the same receipt on replay without restarting a model call", async () => {
  const a = await administrator(),
    d = await draft(a),
    k = randomUUID();
  const session = (
    await s.db.control.query(
      "SELECT id FROM sessions WHERE admin_id=$1 ORDER BY created_at DESC LIMIT 1",
      [a.id],
    )
  ).rows[0].id;
  const receipt = (
    await s.db.control.query(
      "INSERT INTO capability_validations(release_id,principal_id,session_id,idempotency_hash,payload_hash,execution_nonce,lease_until) VALUES($1,$2,$3,$4,$5,$6,now()-interval '1 minute') RETURNING id",
      [
        d.v.id,
        a.id,
        session,
        hash(k),
        hash(canonical(command(d.v))),
        randomUUID(),
      ],
    )
  ).rows[0];
  const r = await validate(a, d.v, k);
  assert.equal(r.id, receipt.id);
  assert.equal(r.state, "reconciling");
  assert.equal(r.result.usage_known, false);
  assert.equal(r.capability_version_id, null);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM capability_validation_events WHERE validation_id=$1",
        [receipt.id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await call(
        a,
        "POST",
        `${root}/${d.v.id}/publications-previews`,
        command(d.v),
      )
    ).data.error.code,
    "CAPABILITY_VERIFICATION_REQUIRED",
  );
});
test("a populated 063 to 064 upgrade preserves all prior table bytes and migration checksums without fabricating publication facts", async () => {
  const previous = await isolatedTestEnvironment({ throughVersion: 63 }),
    owner = new pg.Client({
      connectionString: previous.env.OWNER_DATABASE_URL,
    });
  await owner.connect();
  try {
    await owner.query("INSERT INTO users(email) VALUES($1)", [
      randomUUID() + "@example.invalid",
    ]);
    const tables = (
      await owner.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'schema_migrations' ORDER BY tablename",
      )
    ).rows.map((r) => r.tablename as string);
    const snapshot = async () => {
      const values: Record<string, string> = {};
      for (const n of tables) {
        assert.match(n, /^[a-z_]+$/);
        values[n] = hash(
          canonical(
            (
              await owner.query(
                `SELECT to_jsonb(t) AS row FROM public.${n} t ORDER BY to_jsonb(t)::text`,
              )
            ).rows,
          ),
        );
      }
      return values;
    };
    const before = await snapshot(),
      history = (
        await owner.query("SELECT * FROM schema_migrations ORDER BY version")
      ).rows;
    assert.ok(tables.length >= 125);
    await runMigrations(owner, "populated capability-release upgrade", {
      throughVersion: 64,
    });
    assert.deepEqual(await snapshot(), before);
    assert.deepEqual(
      (
        await owner.query(
          "SELECT * FROM schema_migrations WHERE version<=63 ORDER BY version",
        )
      ).rows,
      history,
    );
    for (const n of [
      "capability_releases",
      "capability_validations",
      "capability_publications",
      "capability_heads",
      "capability_validation_events",
      "capability_workspace_purges",
    ])
      assert.equal(
        (await owner.query(`SELECT count(*)::int AS n FROM ${n}`)).rows[0].n,
        0,
      );
    await runMigrations(owner, "unchanged capability-release replay", {
      throughVersion: 64,
    });
    assert.deepEqual(await snapshot(), before);
  } finally {
    await owner.end();
    await previous.cleanup();
  }
});
test("application credentials cannot mutate capability documents, validation receipts or publication heads", async () => {
  const app = await s.db.app.connect();
  try {
    for (const sql of [
      "INSERT INTO capability_releases DEFAULT VALUES",
      "UPDATE capability_validations SET state='passed'",
      "DELETE FROM capability_heads",
      "UPDATE current_internal_capabilities SET ready=true",
      "SELECT * FROM capability_workspace_purges",
      "UPDATE capability_workspace_purges SET state='completed'",
    ])
      await assert.rejects(app.query(sql), (e: any) =>
        ["42501", "55000"].includes(e.code),
      );
  } finally {
    app.release();
  }
});

test("verification refuses a PATH-only Codex command with a useful safe setup receipt", async () => {
  const a = await administrator(),
    d = await draft(a),
    prior = s.db.config.CODEX_BIN;
  try {
    s.db.config.CODEX_BIN = "codex";
    const r = await validate(a, d.v);
    assert.equal(r.state, "failed");
    assert.equal(r.result.error_code, "CODEX_BINARY_PIN_REQUIRED");
    assert.equal(r.result.accepted, false);
    assert.equal(r.result.known_cost_micros, "0");
  } finally {
    s.db.config.CODEX_BIN = prior;
  }
});
const imageDocument = () => ({
  profile_key: "internal-image2-v1",
  kernel: "codex",
  gateway_policy: "company_internal_only",
  model_alias: "copypaste-demo-image",
  reasoning_effort: null,
  rates: [++price],
});
async function rejectedImageGateway(
  status: number,
  work: (calls: () => number) => Promise<void>,
) {
  let count = 0;
  const original = s.db.config.AI_BASE_URL;
  const server = createServer(async (req, res) => {
    for await (const _ of req) {
    }
    count++;
    res
      .writeHead(status, { "Content-Type": "application/json" })
      .end(JSON.stringify({ error: { code: "CONTROLLED_FIXTURE_REJECTION" } }));
  });
  await listenLoopbackHTTP(server);
  s.db.config.AI_BASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  try {
    await work(() => count);
  } finally {
    s.db.config.AI_BASE_URL = original;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((e) => (e ? reject(e) : resolve())),
    );
  }
}
test("image verification actually generates and edits bounded PNG bytes and records both confirmed operation prices", async () => {
  const a = await administrator(),
    doc = imageDocument(),
    d = await draft(a, doc),
    v = await validate(a, d.v);
  assert.equal(v.state, "passed", JSON.stringify(v));
  assert.equal(v.result.usage_known, true);
  assert.equal(v.result.known_cost_micros, String(BigInt(doc.rates[0]) * 2n));
  assert.ok(v.result.checks.includes("images.generate"));
  assert.ok(v.result.checks.includes("images.edit"));
  assert.equal(
    v.result.checks.filter((x: string) => /^[a-f0-9]{64}$/.test(x)).length,
    2,
  );
});
test("an accepted image verification with an unknown result keeps a durable reconciling receipt and never automatically replays", async () => {
  const a = await administrator(),
    d = await draft(a, imageDocument()),
    k = randomUUID();
  await rejectedImageGateway(503, async (count) => {
    const r = await validate(a, d.v, k);
    assert.equal(r.state, "reconciling", JSON.stringify(r));
    assert.equal(r.result.accepted, true);
    assert.equal(r.result.usage_known, false);
    assert.equal(r.capability_version_id, null);
    assert.equal(count(), 1);
    assert.deepEqual(await validate(a, d.v, k), r);
    assert.equal(count(), 1);
  });
  assert.equal(
    (
      await call(
        a,
        "POST",
        `${root}/${d.v.id}/publications-previews`,
        command(d.v),
      )
    ).data.error.code,
    "CAPABILITY_VERIFICATION_REQUIRED",
  );
});

test(
  "a published image capability executes generation and edit through the real worker when the environment verification flag is false",
  { timeout: 120000 },
  async () => {
    const a = await administrator(),
      reviewer = await administrator(),
      doc = imageDocument(),
      d = await draft(a, doc);
    assert.equal((await validate(a, d.v)).state, "passed");
    await publish(a, reviewer, d.v);
    const prior = s.db.config.AI_IMAGE_VERIFIED;
    s.db.config.AI_IMAGE_VERIFIED = false;
    try {
      const f = await fixture();
      const created = await call(f.owner, "POST", f.base + "/tasks", {
        title: "Published image capability",
        prompt: "Summarize the two controlled generated images.",
        role_key: "designer",
        budget_micros: 10000000,
      });
      assert.equal(created.status, 200, JSON.stringify(created.data));
      let generated = false,
        edited = false;
      class PublishedImageRuntime extends CodexRuntimeAdapter {
        override async start(ctx: RuntimeContext) {
          const asset: any = await ctx.tools
            .find((tool) => tool.name === "image2_generate")!
            .run(
              {
                prompt: "A square blue paper shape",
                filename: "published.png",
              },
              "published-generation",
            );
          generated = true;
          await ctx.tools
            .find((tool) => tool.name === "image2_edit")!
            .run(
              {
                asset_id: asset.id,
                prompt: "A square blue paper shape with a lighter edge",
                filename: "published-edit.png",
              },
              "published-edit",
            );
          edited = true;
          // The worker's two real media calls were exercised above. Keep the
          // demo text provider from intentionally requesting a third image.
          return super.start({
            ...ctx,
            tools: ctx.tools.filter((tool) => !tool.name.startsWith("image2_")),
          });
        }
      }
      await new Worker(
        s.db,
        s.catalog,
        s.storage,
        new PublishedImageRuntime(s.db.config),
      ).run(f.tenant, created.data.id);
      const completed = (
        await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [
          created.data.id,
        ])
      ).rows[0];
      assert.equal(generated && edited, true, completed.error_code);
      assert.equal(completed.status, "succeeded", completed.error_code);
      const operations = (
        await s.db.control.query(
          "SELECT state,charge_micros FROM tool_operations WHERE task_id=$1 ORDER BY created_at",
          [completed.id],
        )
      ).rows;
      assert.deepEqual(operations, [
        { state: "succeeded", charge_micros: String(doc.rates[0]) },
        { state: "succeeded", charge_micros: String(doc.rates[0]) },
      ]);
      assert.ok(BigInt(completed.charged_micros) >= BigInt(doc.rates[0]) * 2n);
    } finally {
      s.db.config.AI_IMAGE_VERIFIED = prior;
    }
  },
);

function pngChunk(kind: string, data: Buffer) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length);
  bytes.write(kind, 4, 4, "latin1");
  data.copy(bytes, 8);
  bytes.writeUInt32BE(crc32(bytes.subarray(4, -4)), bytes.length - 4);
  return bytes;
}
const imagePayload = (bytes: Buffer) => ({
  data: [{ b64_json: bytes.toString("base64") }],
});
function blankVerificationPNG() {
  const bitmap = new PNG({ width: 1024, height: 1024 });
  bitmap.data.fill(0);
  return PNG.sync.write(bitmap);
}
test("a kernel-listening forbidden Fetch port receives no HTTP and the owned loopback listener rebinds to a usable port", async (t) => {
  let calls = 0,
    blocked = 0;
  const server = createServer((_request, response) => {
    calls++;
    response.end("owned HTTP fixture");
  });
  for (const port of [6000, 3659, 4045, 10080]) {
    const bound = await new Promise<boolean>((resolve, reject) => {
      const onError = (error: NodeJS.ErrnoException) => {
        server.off("listening", onListening);
        if (error.code === "EADDRINUSE" || error.code === "EACCES")
          resolve(false);
        else reject(error);
      };
      const onListening = () => {
        server.off("error", onError);
        resolve(true);
      };
      server.once("error", onError);
      server.once("listening", onListening);
      server.listen(port, "127.0.0.1");
    });
    if (bound) {
      blocked = port;
      break;
    }
  }
  assert.notEqual(blocked, 0, "A fresh owned counterexample port is required");
  try {
    await assert.rejects(
      fetch(`http://127.0.0.1:${blocked}/`),
      (error: any) => error.cause?.message === "bad port",
    );
    assert.equal(calls, 0);
    const selected = await listenLoopbackHTTP(server);
    assert.notEqual(selected, blocked);
    assert.equal(
      await (await fetch(`http://127.0.0.1:${selected}/`)).text(),
      "owned HTTP fixture",
    );
    assert.equal(calls, 1);
    t.diagnostic(
      JSON.stringify({
        blocked_port: blocked,
        blocked_received_calls: 0,
        selected_port: selected,
        selected_received_calls: calls,
      }),
    );
  } finally {
    server.closeAllConnections();
    if (server.listening)
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
  }
});
async function controlledImagePayloads(
  payloads: unknown[],
  work: (calls: () => number) => Promise<void>,
  afterRequest?: (count: number) => Promise<void>,
) {
  const original = s.db.config.AI_BASE_URL;
  let calls = 0;
  let hookFailure: unknown;
  const server = createServer(async (req, res) => {
    for await (const _ of req) {
      /* Drain the actual request body. */
    }
    const payload = payloads[calls++];
    try {
      await afterRequest?.(calls);
    } catch (error) {
      hookFailure = error;
      res
        .writeHead(500, { "content-type": "application/json" })
        .end(JSON.stringify({ error: { code: "FIXTURE_HOOK_FAILED" } }));
      return;
    }
    res
      .writeHead(payload === undefined ? 503 : 200, {
        "content-type": "application/json",
      })
      .end(JSON.stringify(payload ?? { error: { code: "UNEXPECTED_REPEAT" } }));
  });
  await listenLoopbackHTTP(server);
  s.db.config.AI_BASE_URL = `http://127.0.0.1:${(server.address() as { port: number }).port}/v1`;
  try {
    await work(() => calls);
  } finally {
    s.db.config.AI_BASE_URL = original;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    if (hookFailure) throw hookFailure;
  }
}

test("each administrator image operation rechecks the real session, MFA, permissions and runtime while retaining the first known fee", async (t) => {
  const png = imagePayload(blankVerificationPNG());
  for (const condition of [
    "session revoked",
    "MFA expired",
    "binding removed",
    "administrator suspended",
    "runtime revoked",
  ] as const)
    await t.test(condition, async () => {
      const originalProfile = s.catalog.runtimeProfile;
      if (condition === "runtime revoked")
        s.catalog.runtimeProfile = (
          await s.db.control.query(
            "INSERT INTO codex_runtime_profiles(fingerprint,profile_key,kernel,pinned_version,transport,gateway_policy,automatic_fallback) SELECT $1,profile_key,kernel,pinned_version,transport,gateway_policy,automatic_fallback FROM codex_runtime_profiles WHERE id=$2 RETURNING *",
            [hash(randomUUID()), originalProfile.id],
          )
        ).rows[0];
      const a = await administrator(),
        inspector = await administrator({
          permissions: ["admin.catalog.read"],
        }),
        doc = imageDocument(),
        d = await draft(a, doc),
        key = randomUUID();
      const profileId = (
        await s.db.control.query(
          "SELECT runtime_profile_id FROM capability_releases WHERE id=$1",
          [d.v.id],
        )
      ).rows[0].runtime_profile_id;
      let calls = 0;
      try {
        await controlledImagePayloads(
          [png, png],
          async (count) => {
            const result = await call(
              a,
              "POST",
              `${root}/${d.v.id}/validations`,
              command(d.v),
              { "idempotency-key": key },
            );
            calls = count();
            assert.equal(calls, 1);
            const validation = (
              await s.db.control.query(
                "SELECT * FROM capability_validations WHERE release_id=$1",
                [d.v.id],
              )
            ).rows[0];
            assert.ok(validation);
            assert.equal(
              validation.state,
              "cancelled",
              JSON.stringify(result.data),
            );
            assert.equal(validation.capability_version_id, null);
            assert.equal(
              validation.result.error_code,
              "AI_REQUEST_AUTHORIZATION_CHANGED",
            );
            assert.equal(validation.result.accepted, true);
            assert.equal(validation.result.usage_known, true);
            assert.equal(
              validation.result.known_cost_micros,
              String(doc.rates[0]),
            );
            assert.ok(validation.result.checks.includes("images.generate"));
            assert.ok(!validation.result.checks.includes("images.edit"));
            const events = (
              await s.db.control.query(
                "SELECT body FROM capability_validation_events WHERE validation_id=$1",
                [validation.id],
              )
            ).rows.map((row) => row.body);
            assert.equal(
              events.filter(
                (event) => event.event === "gateway.request_authorized",
              ).length,
              1,
            );
            assert.equal(
              events.filter((event) => "actor_authorized" in event).length,
              1,
            );
            assert.equal(
              events.find((event) => "actor_authorized" in event)
                .actor_authorized,
              false,
            );
            if (condition !== "runtime revoked") {
              const detail = await call(
                inspector,
                "GET",
                `${root}/validations/${validation.id}`,
              );
              assert.equal(detail.status, 200, JSON.stringify(detail.data));
              assert.equal(
                detail.data.result.known_cost_micros,
                String(doc.rates[0]),
              );
            }
            assert.equal(result.status, 403, JSON.stringify(result.data));
          },
          async (count) => {
            assert.equal(
              count,
              1,
              "a second provider operation is not authorized",
            );
            const mutations = {
              "session revoked": [
                "UPDATE sessions SET revoked_at=now() WHERE admin_id=$1",
                a.id,
              ],
              "MFA expired": [
                "UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",
                a.id,
              ],
              "binding removed": [
                "DELETE FROM admin_bindings WHERE principal_id=$1",
                a.id,
              ],
              "administrator suspended": [
                "UPDATE admin_principals SET status='suspended' WHERE id=$1",
                a.id,
              ],
              "runtime revoked": [
                "UPDATE codex_runtime_profiles SET state='revoked' WHERE id=$1",
                profileId,
              ],
            } as const;
            const [sql, id] = mutations[condition];
            await s.db.control.query(sql, [id]);
          },
        );
      } finally {
        s.catalog.runtimeProfile = originalProfile;
      }
      assert.equal(calls, 1);
    });
});

test("accepted malformed PNG, base64 and image-count responses cannot qualify or replay as a free failed call", async () => {
  const a = await administrator(),
    valid = blankVerificationPNG(),
    header = valid.subarray(0, 33),
    signature = valid.subarray(0, 8),
    ihdr = valid.subarray(8, 33),
    ending = pngChunk("IEND", Buffer.alloc(0)),
    raw = Buffer.alloc(1024 * (1024 * 4 + 1)),
    wrapped = (compressed: Buffer) =>
      Buffer.concat([signature, ihdr, pngChunk("IDAT", compressed), ending]),
    corrupt = Buffer.from(valid);
  corrupt[29] ^= 1; // The original IHDR checksum no longer matches.
  const invalidFilter = Buffer.from(raw);
  invalidFilter[0] = 5;
  const fixtures = [
    imagePayload(header.subarray(0, 24)),
    imagePayload(valid.subarray(0, -6)),
    imagePayload(corrupt),
    imagePayload(wrapped(Buffer.from([0x78, 0x9c, 0]))),
    imagePayload(wrapped(deflateSync(Buffer.alloc(raw.length + 1)))),
    imagePayload(wrapped(deflateSync(invalidFilter))),
    imagePayload(Buffer.concat([valid, Buffer.from("trailing")])),
    { data: [{ b64_json: valid.toString("base64") + "!" }] },
    { data: [...imagePayload(valid).data, ...imagePayload(valid).data] },
    { data: [{ url: "https://example.invalid/image.png" }] },
  ];
  for (const [index, payload] of fixtures.entries()) {
    await controlledImagePayloads([payload], async (calls) => {
      const d = await draft(a, imageDocument()),
        key = randomUUID(),
        result = await validate(a, d.v, key);
      assert.equal(result.state, "reconciling", `malformed fixture ${index}`);
      assert.equal(result.result.accepted, true);
      assert.equal(result.result.usage_known, false);
      assert.equal(result.result.known_cost_micros, "0");
      assert.equal(result.capability_version_id, null);
      assert.ok(!result.result.checks.includes("images.generate"));
      assert.deepEqual(await validate(a, d.v, key), result);
      assert.equal(calls(), 1, `fixture ${index}: ${JSON.stringify(result)}`);
      assert.equal(
        (
          await call(
            a,
            "POST",
            `${root}/${d.v.id}/publications-previews`,
            command(d.v),
          )
        ).data.error.code,
        "CAPABILITY_VERIFICATION_REQUIRED",
      );
    });
  }
});

test("an accepted corrupt edit preserves the confirmed generation price while its remaining cost stays unknown", async () => {
  const a = await administrator(),
    doc = imageDocument(),
    valid = blankVerificationPNG();
  await controlledImagePayloads(
    [imagePayload(valid), imagePayload(valid.subarray(0, 24))],
    async (calls) => {
      const d = await draft(a, doc),
        key = randomUUID(),
        result = await validate(a, d.v, key);
      assert.equal(result.state, "reconciling");
      assert.equal(result.result.usage_known, false);
      assert.equal(result.result.known_cost_micros, String(doc.rates[0]));
      assert.ok(result.result.checks.includes("images.generate"));
      assert.ok(!result.result.checks.includes("images.edit"));
      assert.equal(result.capability_version_id, null);
      assert.deepEqual(await validate(a, d.v, key), result);
      assert.equal(calls(), 2);
    },
  );
});

test("complete grayscale, palette and 16-bit Adam7 PNG pixels decode within the verification bound", () => {
  // Independent fixtures use fixed known scanline sizes for a 1024-square image.
  // Adam7 contains 1920 rows; RGBA16 pixel data contains exactly 8388608 bytes.
  const layouts = [
    { color: 0, depth: 1, interlace: 0, size: 1024 * 129 },
    { color: 3, depth: 8, interlace: 0, size: 1024 * 1025 },
    { color: 6, depth: 16, interlace: 1, size: 8388608 + 1920 },
  ];
  for (const layout of layouts) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1024, 0);
    ihdr.writeUInt32BE(1024, 4);
    ihdr[8] = layout.depth;
    ihdr[9] = layout.color;
    ihdr[12] = layout.interlace;
    const png = Buffer.concat([
      Buffer.from("89504e470d0a1a0a", "hex"),
      pngChunk("IHDR", ihdr),
      ...(layout.color === 3 ? [pngChunk("PLTE", Buffer.from([0, 0, 0]))] : []),
      pngChunk("IDAT", deflateSync(Buffer.alloc(layout.size))),
      pngChunk("IEND", Buffer.alloc(0)),
    ]);
    assert.doesNotThrow(
      () => validateVerificationPNG(png),
      JSON.stringify(layout),
    );
  }
});
test("a later failed verification blocks an earlier passed receipt for the same immutable document", async () => {
  const a = await administrator(),
    d = await draft(a, imageDocument());
  assert.equal((await validate(a, d.v)).state, "passed");
  await rejectedImageGateway(400, async (count) => {
    const r = await validate(a, d.v);
    assert.equal(r.state, "failed", JSON.stringify(r));
    assert.equal(r.result.usage_known, true);
    assert.equal(count(), 1);
  });
  assert.equal(
    (
      await call(
        a,
        "POST",
        `${root}/${d.v.id}/publications-previews`,
        command(d.v),
      )
    ).data.error.code,
    "CAPABILITY_VERIFICATION_REQUIRED",
  );
});
test("an audit write failure rolls back publication, head advance, operation and approval decision together", async () => {
  const a = await administrator(),
    reviewer = await administrator(),
    d = await draft(a);
  assert.equal((await validate(a, d.v)).state, "passed");
  const op = await submit(a, d.v, await preview(a, d.v));
  const before = (
    await s.db.control.query(
      "SELECT * FROM capability_heads WHERE profile_key='internal-text-v1' AND data_mode='simulated'",
    )
  ).rows;
  const request = (
    await call(reviewer, "GET", `/v1/admin/operations/${op.id}/approval`)
  ).data;
  const owner = new pg.Client({
    connectionString: isolated.env.OWNER_DATABASE_URL,
  });
  await owner.connect();
  try {
    await owner.query(
      "CREATE FUNCTION controlled_capability_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action='admin.catalog.publish' AND NEW.outcome='succeeded' THEN RAISE EXCEPTION 'controlled capability audit failure'; END IF; RETURN NEW; END $$",
    );
    await owner.query(
      "CREATE TRIGGER controlled_capability_audit BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION controlled_capability_audit_failure()",
    );
    const failed = await approve(reviewer, op);
    assert.equal(failed.status, 500, JSON.stringify(failed.data));
    assert.deepEqual(
      (
        await s.db.control.query(
          "SELECT * FROM capability_heads WHERE profile_key='internal-text-v1' AND data_mode='simulated'",
        )
      ).rows,
      before,
    );
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*)::int AS n FROM capability_publications WHERE operation_id=$1",
          [op.id],
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await s.db.control.query(
          "SELECT state FROM admin_operations WHERE id=$1",
          [op.id],
        )
      ).rows[0].state,
      "pending_approval",
    );
    assert.equal(
      (
        await s.db.control.query(
          "SELECT state FROM admin_approval_requests WHERE id=$1",
          [request.id],
        )
      ).rows[0].state,
      "pending",
    );
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*)::int AS n FROM admin_approval_decisions WHERE approval_id=$1",
          [request.id],
        )
      ).rows[0].n,
      0,
    );
  } finally {
    await owner.query(
      "DROP TRIGGER IF EXISTS controlled_capability_audit ON audit_log",
    );
    await owner.query(
      "DROP FUNCTION IF EXISTS controlled_capability_audit_failure()",
    );
    await owner.end();
  }
  const recovered = await approve(reviewer, op);
  assert.equal(recovered.status, 202, JSON.stringify(recovered.data));
  assert.equal(recovered.data.state, "succeeded");
});
test("approval rechecks the original operator's current MFA before any publication or approval effect", async () => {
  const a = await administrator(),
    reviewer = await administrator(),
    d = await draft(a);
  assert.equal((await validate(a, d.v)).state, "passed");
  const op = await submit(a, d.v, await preview(a, d.v));
  await s.db.control.query(
    "UPDATE sessions SET mfa_at=now()-interval '11 minutes' WHERE admin_id=$1",
    [a.id],
  );
  const denied = await approve(reviewer, op);
  assert.equal(denied.data.error.code, "MFA_REQUIRED");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM capability_publications WHERE operation_id=$1",
        [op.id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT state FROM admin_operations WHERE id=$1",
        [op.id],
      )
    ).rows[0].state,
    "pending_approval",
  );
});

test("resuming and retrying confirmed old work uses its original binding even when a newer default is revoked", async () => {
  const a = await administrator(),
    reviewer = await administrator(),
    f = await fixture(),
    t = await task(f),
    original = await binding(t),
    url = f.base + "/tasks/" + t.id + "/controls";
  const paused = await call(f.owner, "POST", url, {
    action: "pause",
    expected_version: t.version,
  });
  assert.equal(paused.status, 202, JSON.stringify(paused.data));
  const d = await draft(a),
    v = await validate(a, d.v);
  assert.equal(v.state, "passed");
  await publish(a, reviewer, d.v);
  await s.db.control.query(
    "UPDATE internal_capability_versions SET revoked=true WHERE id=$1",
    [v.capability_version_id],
  );
  const resumed = await call(f.owner, "POST", url, {
    action: "resume",
    expected_version: paused.data.version,
  });
  assert.equal(resumed.status, 202, JSON.stringify(resumed.data));
  assert.equal(resumed.data.status, "queued");
  assert.equal((await binding(t)).text.id, original.text.id);
  const cancelled = await call(
    f.owner,
    "POST",
    f.base + "/tasks/" + t.id + "/cancel",
  );
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.data));
  assert.equal(cancelled.data.status, "cancelled");
  const retry = await call(f.owner, "POST", f.base + "/tasks", {
    title: "Original model retry",
    prompt: "Keep the original model and price",
    role_key: "marketing-analyst",
    budget_micros: 1000000,
    parent_id: t.id,
  });
  assert.equal(retry.status, 200, JSON.stringify(retry.data));
  const row = (
    await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [retry.data.id])
  ).rows[0];
  assert.equal((await binding(row)).text.id, original.text.id);
  const fresh = await call(f.owner, "POST", f.base + "/tasks", {
    title: "A new default task",
    prompt: "Never fall back from a revoked default",
    role_key: "marketing-analyst",
    budget_micros: 1000000,
  });
  assert.equal(fresh.status, 503, JSON.stringify(fresh.data));
});

// These fixtures model reclamation failures, never successful AI verification.
async function purgeFixture() {
  const admin = await administrator(),
    d = await draft(admin);
  const session = (
    await s.db.control.query(
      "SELECT id FROM sessions WHERE admin_id=$1 ORDER BY created_at DESC LIMIT 1",
      [admin.id],
    )
  ).rows[0].id;
  const v = (
    await s.db.control.query(
      "INSERT INTO capability_validations(release_id,principal_id,session_id,idempotency_hash,payload_hash,execution_nonce) VALUES($1,$2,$3,$4,$5,$6) RETURNING *",
      [
        d.v.id,
        admin.id,
        session,
        hash(randomUUID()),
        hash(randomUUID()),
        randomUUID(),
      ],
    )
  ).rows[0];
  const evidence = {
    test_fixture: true,
    error_code: "CONTROLLED_FAILED_VERIFICATION",
    accepted: true,
    usage_known: true,
    known_cost_micros: "37",
    workspace_cleanup_completed: false,
    workspace_cleanup_error_code: "EBUSY",
  };
  await s.db.control.query(
    "UPDATE capability_validations SET state='failed',result=$2,finished_at=now() WHERE id=$1",
    [v.id, evidence],
  );
  await s.db.tx(
    async (tx) => {
      await queueCapabilityWorkspacePurge(tx, v.id, evidence);
      await queueCapabilityWorkspacePurge(tx, v.id, evidence);
    },
    undefined,
    true,
  );
  const directory = path.resolve(
    s.db.config.DATA_DIR,
    "capability-verification",
    v.id,
  );
  await mkdir(path.join(directory, ".codex"), { recursive: true });
  await writeFile(
    path.join(directory, ".codex", "fixture.txt"),
    "Controlled reclamation fixture; no user files or credentials.",
  );
  return { admin, release: d.v, v, evidence, directory };
}

test("verification cache reclamation persists busy retries and completion separately from immutable usage without invoking a model", async () => {
  const f = await purgeFixture();
  const snapshot = (
    await s.db.control.query(
      "SELECT * FROM capability_validations WHERE id=$1",
      [f.v.id],
    )
  ).rows[0];
  await s.db.control.query(
    "UPDATE capability_workspace_purges SET next_attempt_at=now()-interval '1 second' WHERE validation_id=$1",
    [f.v.id],
  );
  let calls = 0;
  await purgeCapabilityWorkspaces(
    s.db,
    async (parent, id) => {
      if (id === f.v.id) {
        calls++;
        throw Object.assign(new Error("sensitive-filesystem-details"), {
          code: "EBUSY",
        });
      }
      await removeOwnedUUIDDirectory(parent, id, { retry: false });
    },
    100,
  );
  assert.equal(calls, 1);
  let state = (await call(f.admin, "GET", `${root}/validations/${f.v.id}`))
    .data;
  assert.equal(state.state, "failed");
  assert.equal(state.result.known_cost_micros, "37");
  assert.equal(state.workspace_cleanup.state, "queued");
  assert.equal(state.workspace_cleanup.attempts, 1);
  assert.equal(state.workspace_cleanup.error_code, "WORKSPACE_BUSY");
  assert.ok(!canonical(state).includes("sensitive-filesystem-details"));
  assert.ok(Date.parse(state.workspace_cleanup.next_attempt_at) > Date.now());
  await access(f.directory);
  // A separate maintenance pass/restart resumes the durable job, not the AI call.
  await s.db.control.query(
    "UPDATE capability_workspace_purges SET next_attempt_at=now()-interval '1 second' WHERE validation_id=$1",
    [f.v.id],
  );
  await purgeCapabilityWorkspaces(s.db, undefined, 100);
  state = (await call(f.admin, "GET", `${root}/validations/${f.v.id}`)).data;
  assert.equal(state.workspace_cleanup.state, "completed");
  assert.equal(state.workspace_cleanup.attempts, 2);
  await assert.rejects(access(f.directory), { code: "ENOENT" });
  assert.deepEqual(
    (
      await s.db.control.query(
        "SELECT * FROM capability_validations WHERE id=$1",
        [f.v.id],
      )
    ).rows[0],
    snapshot,
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM capability_validation_events WHERE validation_id=$1",
        [f.v.id],
      )
    ).rows[0].n,
    0,
  );
  await purgeCapabilityWorkspaces(s.db, undefined, 100);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT attempts FROM capability_workspace_purges WHERE validation_id=$1",
        [f.v.id],
      )
    ).rows[0].attempts,
    2,
  );
  await assert.rejects(
    purgeCapabilityWorkspaces(s.db, undefined, 0),
    /CAPABILITY_PURGE_BATCH_INVALID/,
  );
});

test("exhausted verification cleanup has an authorized versioned idempotent retry and leaves verification and cost facts unchanged", async () => {
  const f = await purgeFixture();
  await s.db.control.query(
    "UPDATE capability_workspace_purges SET attempts=7,next_attempt_at=now()-interval '1 second' WHERE validation_id=$1",
    [f.v.id],
  );
  await purgeCapabilityWorkspaces(
    s.db,
    async (parent, id) => {
      if (id === f.v.id)
        throw Object.assign(new Error("private-operating-system-error"), {
          code: "EACCES",
        });
      await removeOwnedUUIDDirectory(parent, id, { retry: false });
    },
    100,
  );
  const before = (await call(f.admin, "GET", `${root}/validations/${f.v.id}`))
    .data;
  assert.equal(before.workspace_cleanup.state, "failed");
  assert.equal(before.workspace_cleanup.attempts, 8);
  const url = `${root}/validations/${f.v.id}/workspace-purge-retries`,
    body = {
      expected_version: before.workspace_cleanup.version,
      reason: "Retry cache reclamation after resolving the filesystem lock",
    },
    readOnly = await administrator({ permissions: ["admin.catalog.read"] });
  assert.equal((await call(readOnly, "POST", url, body)).status, 403);
  assert.equal(
    (
      await call(f.admin, "POST", url, {
        ...body,
        expected_version: body.expected_version + 1,
      })
    ).status,
    409,
  );
  const k = randomUUID(),
    r = await call(f.admin, "POST", url, body, { "idempotency-key": k });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  assert.equal(r.data.state, "queued");
  assert.equal(r.data.attempts, 0);
  assert.deepEqual(
    (await call(f.admin, "POST", url, body, { "idempotency-key": k })).data,
    r.data,
  );
  assert.equal(
    (
      await call(
        f.admin,
        "POST",
        url,
        { ...body, reason: "Changed replay contents" },
        { "idempotency-key": k },
      )
    ).status,
    409,
  );
  await purgeCapabilityWorkspaces(s.db, undefined, 100);
  const after = (await call(f.admin, "GET", `${root}/validations/${f.v.id}`))
    .data;
  assert.deepEqual(after.result, before.result);
  assert.equal(after.state, "failed");
  assert.equal(after.capability_version_id, null);
  assert.equal(after.workspace_cleanup.state, "completed");
  const publication = await call(
    f.admin,
    "POST",
    `${root}/${f.v.release_id}/publications-previews`,
    command(f.release),
  );
  assert.equal(publication.status, 409);
  assert.equal(publication.data.error.code, "CAPABILITY_VERIFICATION_REQUIRED");
  assert.ok(!canonical(after).includes("private-operating-system-error"));
});

test("publishing then rolling back to the same model identity still invalidates the customer's earlier comparison", async () => {
  const operator = await administrator(),
    reviewer = await administrator();
  const first = (await draft(operator)).v;
  assert.equal((await validate(operator, first)).state, "passed");
  await publish(operator, reviewer, first);
  const f = await fixture(),
    definition = {
      name: "Reviewed publication analyst",
      role_key: "marketing-analyst",
      instructions: "Initial brief",
      brand_id: null,
    };
  const created = await call(f.owner, "POST", f.base + "/agents", definition);
  assert.equal(created.status, 200, JSON.stringify(created.data));
  const proposal = {
    expected_version: 1,
    definition: {
      ...definition,
      instructions: "Private proposed brief",
      enabled: true,
    },
  };
  const compared = await call(
    f.owner,
    "POST",
    `${f.base}/agents/${created.data.id}/version-previews`,
    proposal,
  );
  assert.equal(compared.status, 201, JSON.stringify(compared.data));
  const original = compared.data.comparison.target.capabilities.find(
    (c: any) => c.profile_key === "internal-text-v1",
  ).id;
  const second = (await draft(operator)).v;
  assert.equal((await validate(operator, second)).state, "passed");
  await publish(operator, reviewer, second);
  await publish(operator, reviewer, first, true);
  const current = await s.db.tx(
    (tx) => s.catalog.currentCapabilities(tx),
    undefined,
    true,
  );
  assert.equal(current.get("internal-text-v1").id, original);
  const stale = await call(
    f.owner,
    "GET",
    `${f.base}/version-adoption-previews/${compared.data.id}`,
  );
  assert.equal(stale.status, 409);
  assert.equal(stale.data.error.code, "ADOPTION_PREVIEW_STALE");
  const confirmation = await call(
    f.owner,
    "POST",
    `${f.base}/version-adoption-previews/${compared.data.id}/confirmations`,
    { preview_hash: compared.data.preview_hash, proposal },
  );
  assert.equal(confirmation.status, 409);
  assert.equal(confirmation.data.error.code, "ADOPTION_PREVIEW_STALE");
  assert.equal(
    (
      await s.db.control.query("SELECT version FROM agents WHERE id=$1", [
        created.data.id,
      ])
    ).rows[0].version,
    1,
  );
});

test("administrator verification shares a bounded run budget and retains the first image fee when the second is denied", async () => {
  const a = await administrator(),
    doc = imageDocument();
  const original = s.db.config.AI_VERIFICATION_PER_RUN_BUDGET_MICROS;
  try {
    s.db.config.AI_VERIFICATION_PER_RUN_BUDGET_MICROS = doc.rates[0];
    await seedProviderBudgetPolicy(s.db);
    const d = await draft(a, doc),
      v = await validate(a, d.v);
    assert.equal(v.state, "failed", JSON.stringify(v));
    assert.equal(v.result.error_code, "AI_REQUEST_BUDGET_EXHAUSTED");
    assert.equal(v.result.known_cost_micros, String(doc.rates[0]));
    assert.equal(v.result.usage_known, true);
    assert.equal(v.capability_version_id, null);
    const calls = (
      await s.db.control.query(
        "SELECT * FROM ai_gateway_requests WHERE validation_id=$1 ORDER BY created_at,id",
        [v.id],
      )
    ).rows;
    assert.deepEqual(
      calls.map((r) => r.state),
      ["completed", "cancelled"],
    );
    assert.equal(calls[1].dispatched_at, null);
    assert.equal(calls[1].known_charge_micros, "0");
  } finally {
    s.db.config.AI_VERIFICATION_PER_RUN_BUDGET_MICROS = original;
    await seedProviderBudgetPolicy(s.db);
  }
});

test("administrator daily platform budget is shared across validations and never uses customer wallets", async () => {
  const a = await administrator(),
    doc = imageDocument();
  const original = s.db.config.AI_PLATFORM_VERIFICATION_DAILY_BUDGET_MICROS;
  try {
    const used = (
      await s.db.control.query(
        "SELECT ai_budget_used(NULL,id)::text AS numerator FROM ai_platform_budget_periods WHERE data_mode='simulated' AND purpose='verification' AND utc_day=(clock_timestamp() AT TIME ZONE 'UTC')::date",
      )
    ).rows;
    assert.equal(used.length, 1);
    const current = Number((BigInt(used[0].numerator) + 999999n) / 1000000n);
    s.db.config.AI_PLATFORM_VERIFICATION_DAILY_BUDGET_MICROS =
      current + doc.rates[0];
    await seedProviderBudgetPolicy(s.db);
    const before = (
      await s.db.control.query(
        "SELECT id,balance_micros,reserved_micros FROM wallets ORDER BY id",
      )
    ).rows;
    const first = await draft(a, doc),
      v = await validate(a, first.v);
    assert.equal(v.state, "failed", JSON.stringify(v));
    assert.equal(v.result.error_code, "AI_REQUEST_PLATFORM_BUDGET_EXHAUSTED");
    assert.equal(v.result.known_cost_micros, String(doc.rates[0]));
    const second = await draft(a, imageDocument()),
      denied = await validate(a, second.v);
    assert.equal(denied.state, "failed", JSON.stringify(denied));
    assert.equal(denied.result.known_cost_micros, "0");
    assert.equal(
      denied.result.error_code,
      "AI_REQUEST_PLATFORM_BUDGET_EXHAUSTED",
    );
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*) FROM ai_gateway_requests WHERE validation_id=$1 AND dispatched_at IS NOT NULL",
          [denied.id],
        )
      ).rows[0].count,
      "0",
    );
    assert.deepEqual(
      (
        await s.db.control.query(
          "SELECT id,balance_micros,reserved_micros FROM wallets ORDER BY id",
        )
      ).rows,
      before,
    );
  } finally {
    s.db.config.AI_PLATFORM_VERIFICATION_DAILY_BUDGET_MICROS = original;
    await seedProviderBudgetPolicy(s.db);
  }
});

test("administrator text verification accounts for its explicit counting fee entirely within platform funds", async () => {
  const a = await administrator(),
    doc = document();
  const original = s.db.config.AI_INPUT_COUNT_HKD_MICROS_PER_CALL;
  try {
    s.db.config.AI_INPUT_COUNT_HKD_MICROS_PER_CALL = 17;
    await seedProviderBudgetPolicy(s.db);
    const d = await draft(a, doc);
    const wallets = (
      await s.db.control.query(
        "SELECT id,balance_micros,reserved_micros FROM wallets ORDER BY id",
      )
    ).rows;
    const v = await validate(a, d.v);
    assert.equal(v.state, "passed", JSON.stringify(v));
    const counts = (
      await s.db.control.query(
        "SELECT * FROM ai_input_count_requests WHERE validation_id=$1",
        [v.id],
      )
    ).rows;
    assert.equal(
      counts.length,
      2,
      "The real Codex tool loop counts both generation contexts",
    );
    assert.equal(counts[0].price_micros, "17");
    assert.equal(counts[0].state, "completed");
    const numerator = (
      await s.db.control.query(
        "SELECT coalesce(sum(charge_numerator),0)::text AS n FROM ai_gateway_requests WHERE validation_id=$1",
        [v.id],
      )
    ).rows[0].n;
    assert.equal(
      v.result.known_cost_micros,
      String(
        (BigInt(numerator) + BigInt(counts.length) * 17000000n + 999999n) /
          1000000n,
      ),
    );
    assert.deepEqual(
      (
        await s.db.control.query(
          "SELECT id,balance_micros,reserved_micros FROM wallets ORDER BY id",
        )
      ).rows,
      wallets,
    );
  } finally {
    s.db.config.AI_INPUT_COUNT_HKD_MICROS_PER_CALL = original;
    await seedProviderBudgetPolicy(s.db);
  }
});
