import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import * as OTPAuth from "otpauth";
import { seal } from "../src/lib.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { Worker } from "../src/worker.js";
import { readyOutbox } from "../src/execution-capacity.js";
import { saveAsset } from "../src/storage.js";
import { canonicalEvent } from "../src/task-events.js";
import {
  CodexRuntimeAdapter,
  type RuntimeContext,
  type RuntimeResult,
} from "../src/runtime.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>;
let s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string; admin?: boolean };
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  key = randomUUID(),
) {
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: c?.admin ? s.db.config.ADMIN_ORIGIN : s.db.config.WEB_ORIGIN,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      "idempotency-key": key,
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
  assert.ok(
    r.status >= 200 && r.status < 300,
    `${r.status}: ${JSON.stringify(r.data)}`,
  );
  return r.data;
}
async function user(): Promise<Client> {
  const ch = await ok(undefined, "POST", "/v1/auth/challenge", {
    email: `control-${randomUUID()}@example.invalid`,
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
    cookie: r.raw.cookies[0].name + "=" + r.raw.cookies[0].value,
    csrf: r.data.csrf_token,
  };
}
async function fixture() {
  const owner = await user(),
    member = await user(),
    r = await ok(owner, "POST", "/v1/tenants", {
      name: "Task control fixture",
      project_name: "Initial checkpoint",
    }),
    tenant = r.tenant.id,
    project = r.project.id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  await s.db.control.query(
    "UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1",
    [tenant],
  );
  await s.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
    [tenant, member.id],
  );
  await s.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",
    [tenant, project, member.id],
  );
  return { owner, member, tenant, project, base };
}
async function operator(tenant: string): Promise<Client> {
  const email = `control-admin-${randomUUID()}@example.invalid`,
    secret = new OTPAuth.Secret({ size: 20 });
  const principal = (
    await s.db.control.query(
      "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Scoped control operator',$2) RETURNING id",
      [email, seal(s.db.config.MASTER_KEY!, secret.base32)],
    )
  ).rows[0];
  await s.db.control.query(
    "INSERT INTO admin_bindings(principal_id,role_key,scope_kind,scope_id) VALUES($1,'content_admin','tenant',$2)",
    [principal.id, tenant],
  );
  const ch = await ok(undefined, "POST", "/v1/admin/auth/challenge", { email });
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${ch.challenge_id}.json`,
      "utf8",
    ),
  );
  const r = await call(undefined, "POST", "/v1/admin/auth/verify", {
    challenge_id: ch.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
    totp: new OTPAuth.TOTP({
      secret,
      digits: 6,
      period: 30,
      algorithm: "SHA1",
    }).generate(),
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return {
    id: principal.id,
    cookie: r.raw.cookies[0].name + "=" + r.raw.cookies[0].value,
    csrf: r.data.csrf_token,
    admin: true,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function task(f: Fixture, extra: Record<string, unknown> = {}) {
  return ok(f.owner, "POST", f.base + "/tasks", {
    title: "Pause before provider acceptance",
    prompt: "Write an approved campaign brief.",
    role_key: "assistant",
    budget_micros: 1000000,
    mode: "execute",
    ...extra,
  });
}
const url = (f: Fixture, t: any) => f.base + "/tasks/" + t.id + "/controls";
const row = async (t: any) =>
  (await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [t.id])).rows[0];
class FixtureRuntime extends CodexRuntimeAdapter {
  calls = 0;
  entered?: () => void;
  hold?: Promise<void>;
  constructor() {
    super(s.db.config);
  }
  override async start(_ctx: RuntimeContext): Promise<RuntimeResult> {
    this.calls++;
    this.entered?.();
    await this.hold;
    return {
      text: "Clearly simulated completed brief.",
      inputTokens: 10,
      outputTokens: 20,
      accepted: true,
      usageKnown: true,
      status: "completed",
      thread: "fixture-thread",
      turn: "fixture-turn",
    };
  }
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  s = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      WORKER_ENABLED: "false",
      DEMO_MODE: "false",
      AI_BASE_URL: "http://127.0.0.1:9/v1",
      AI_ALLOWED_HOSTS: "127.0.0.1",
      AI_API_KEY: "controlled-fixture",
      AI_MODEL: "controlled-fixture",
      AI_VERIFIED: "true",
      AI_INPUT_HKD_MICROS_PER_MILLION: "1000000",
      AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000",
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

test("initial pause/resume preserves one task and hold, is versioned/idempotent, hides paused outbox, then settles once", async () => {
  const f = await fixture(),
    t = await task(f),
    runtime = new FixtureRuntime(),
    worker = new Worker(s.db, s.catalog, s.storage, runtime),
    requestKey = randomUUID(),
    input = { action: "pause", expected_version: t.version };
  const paused = await call(f.owner, "POST", url(f, t), input, requestKey);
  assert.equal(paused.status, 202);
  assert.equal(paused.data.status, "paused");
  assert.deepEqual(
    (await call(f.owner, "POST", url(f, t), input, requestKey)).data,
    paused.data,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "POST",
        url(f, t),
        { ...input, action: "resume" },
        requestKey,
      )
    ).status,
    409,
  );
  assert.equal(
    (await call(f.owner, "POST", url(f, t), input)).data.error.code,
    "VERSION_CONFLICT",
  );
  await worker.run(f.tenant, t.id);
  assert.equal(runtime.calls, 0);
  const outbox = await s.db.tx(
    (tx) => readyOutbox(tx, "configured_services"),
    undefined,
    true,
  );
  assert.ok(!outbox.some((o) => o.payload.task_id === t.id));
  const held = (
    await s.db.control.query("SELECT * FROM reservations WHERE task_id=$1", [
      t.id,
    ])
  ).rows[0];
  assert.equal(held.status, "reserved");
  assert.equal(held.amount_micros, "1000000");
  const resumeKey = randomUUID(),
    resumeInput = { action: "resume", expected_version: paused.data.version };
  const resumed = await call(
    f.owner,
    "POST",
    url(f, t),
    resumeInput,
    resumeKey,
  );
  assert.equal(resumed.status, 202);
  assert.equal(resumed.data.id, t.id);
  assert.equal(resumed.data.status, "queued");
  assert.deepEqual(
    (await call(f.owner, "POST", url(f, t), resumeInput, resumeKey)).data,
    resumed.data,
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM outbox WHERE topic='task.run' AND payload->>'task_id'=$1 AND dispatched_at IS NULL",
        [t.id],
      )
    ).rows[0].n,
    1,
  );
  await Promise.all([worker.run(f.tenant, t.id), worker.run(f.tenant, t.id)]);
  const done = await row(t);
  assert.equal(done.status, "succeeded");
  assert.equal(done.attempt, 1);
  assert.equal(done.charged_micros, "30");
  assert.equal(runtime.calls, 1);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'",
        [t.id],
      )
    ).rows[0].n,
    1,
  );
  const wallet = (
    await s.db.control.query("SELECT * FROM wallets WHERE tenant_id=$1", [
      f.tenant,
    ])
  ).rows[0];
  assert.equal(wallet.reserved_micros, "0");
  assert.equal(wallet.spent_micros, "30");
  const events = (
    await s.db.control.query(
      "SELECT * FROM task_events WHERE task_id=$1 AND kind IN ('task.paused','task.resumed') ORDER BY seq",
      [t.id],
    )
  ).rows;
  assert.equal(events.length, 2);
  assert.deepEqual(
    events.map((e) => canonicalEvent(e).payload.status),
    ["paused", "queued"],
  );
});

test("a worker claim winning the race prevents pause; completed and uncertain tasks never requeue", async () => {
  const f = await fixture(),
    t = await task(f),
    runtime = new FixtureRuntime();
  let release!: () => void, entered!: () => void;
  runtime.hold = new Promise<void>((r) => {
    release = r;
  });
  const started = new Promise<void>((r) => {
    entered = r;
  });
  runtime.entered = entered;
  const execution = new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    t.id,
  );
  try {
    await started;
    const running = await row(t);
    assert.equal(
      (
        await call(f.owner, "POST", url(f, t), {
          action: "pause",
          expected_version: t.version,
        })
      ).data.error.code,
      "VERSION_CONFLICT",
    );
    assert.equal(
      (
        await call(f.owner, "POST", url(f, t), {
          action: "pause",
          expected_version: running.version,
        })
      ).data.error.code,
      "CANNOT_PAUSE",
    );
  } finally {
    release();
    await execution;
  }
  const done = await row(t);
  assert.equal(
    (
      await call(f.owner, "POST", url(f, t), {
        action: "resume",
        expected_version: done.version,
      })
    ).status,
    409,
  );
  await s.db.control.query(
    "UPDATE tasks SET status='reconciling' WHERE id=$1",
    [t.id],
  );
  assert.equal(
    (
      await call(f.owner, "POST", url(f, t), {
        action: "resume",
        expected_version: done.version,
      })
    ).data.error.code,
    "CANNOT_RESUME",
  );
  assert.equal(runtime.calls, 1);
});

test("cross-tenant, private and read-only controls are denied, including replay after access revocation", async () => {
  const f = await fixture(),
    other = await fixture(),
    t = await task(f),
    k = randomUUID(),
    input = { action: "pause", expected_version: t.version };
  assert.equal((await call(other.owner, "POST", url(f, t), input)).status, 404);
  assert.equal((await call(f.owner, "POST", url(other, t), input)).status, 404);
  await s.db.control.query("UPDATE tasks SET private_owner=$2 WHERE id=$1", [
    t.id,
    f.owner.id,
  ]);
  assert.equal((await call(f.member, "POST", url(f, t), input)).status, 404);
  await s.db.control.query("UPDATE tasks SET private_owner=NULL WHERE id=$1", [
    t.id,
  ]);
  await s.db.control.query(
    "UPDATE project_members SET role='viewer' WHERE project_id=$1 AND user_id=$2",
    [f.project, f.member.id],
  );
  assert.equal((await call(f.member, "POST", url(f, t), input)).status, 403);
  await s.db.control.query(
    "UPDATE project_members SET role='editor' WHERE project_id=$1 AND user_id=$2",
    [f.project, f.member.id],
  );
  assert.equal((await call(f.member, "POST", url(f, t), input, k)).status, 202);
  await s.db.control.query(
    "UPDATE memberships SET status='removed' WHERE tenant_id=$1 AND user_id=$2",
    [f.tenant, f.member.id],
  );
  assert.equal((await call(f.member, "POST", url(f, t), input, k)).status, 404);
  assert.equal((await row(t)).status, "paused");
});

test("scoped MFA Admin shares pause guards; resume rechecks beneficiary authorization and original reservation", async () => {
  const f = await fixture(),
    t = await task(f),
    admin = await operator(f.tenant),
    adminUrl = `/v1/admin/execution/${t.id}/action`;
  assert.equal(
    (
      await call(admin, "POST", adminUrl, {
        action: "pause",
        version: t.version,
        reason: "Review queued work",
      })
    ).status,
    200,
  );
  const paused = await row(t);
  assert.equal(paused.status, "paused");
  await s.db.control.query(
    "UPDATE users SET auth_version=auth_version+1 WHERE id=$1",
    [f.owner.id],
  );
  assert.equal(
    (
      await call(f.member, "POST", url(f, t), {
        action: "resume",
        expected_version: paused.version,
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await call(admin, "POST", adminUrl, {
        action: "resume",
        version: paused.version,
        reason: "Resume original user work",
      })
    ).status,
    404,
    "Admin authority cannot restore a beneficiary's revoked authorization",
  );
  await s.db.control.query(
    "UPDATE users SET auth_version=auth_version-1 WHERE id=$1",
    [f.owner.id],
  );
  await s.db.control.query(
    "UPDATE reservations SET status='reconciling' WHERE task_id=$1",
    [t.id],
  );
  assert.equal(
    (
      await call(f.owner, "POST", url(f, t), {
        action: "resume",
        expected_version: paused.version,
      })
    ).data.error.code,
    "CHECKPOINT_UNAVAILABLE",
  );
  assert.equal(
    (
      await call(admin, "POST", adminUrl, {
        action: "resume",
        version: paused.version,
        reason: "Review held cost",
      })
    ).data.error.code,
    "CHECKPOINT_UNAVAILABLE",
  );
  const other = await fixture(),
    foreign = await task(other);
  assert.equal(
    (
      await call(admin, "POST", `/v1/admin/execution/${foreign.id}/action`, {
        action: "pause",
        version: foreign.version,
        reason: "Outside assigned tenant",
      })
    ).status,
    403,
  );
  assert.equal((await row(t)).status, "paused");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM reservations WHERE task_id=$1",
        [t.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM ledger WHERE task_id=$1",
        [t.id],
      )
    ).rows[0].n,
    0,
  );
});

test("a revoked input during pause reopens the original dependency instead of calling the model", async () => {
  const f = await fixture();
  const a = await s.db.tx(
    (tx) =>
      saveAsset(tx, s.storage, {
        tenant: f.tenant,
        project: f.project,
        user: f.owner.id,
        name: "approved-input.txt",
        mime: "text/plain",
        bytes: Buffer.from("Clearly simulated source."),
        kind: "file",
      }),
    f.tenant,
    false,
    f.owner.id,
  );
  const waiting = await task(f, {
    dependencies: [{ kind: "file", description: "Approved campaign source" }],
  });
  const d = (
    await ok(f.owner, "GET", f.base + "/tasks/" + waiting.id + "/dependencies")
  ).items[0];
  const version = (
    await s.db.control.query(
      "SELECT id FROM asset_versions WHERE asset_id=$1",
      [a.id],
    )
  ).rows[0].id;
  const resolved = await ok(
    f.owner,
    "POST",
    `/v1/tenants/${f.tenant}/task-dependencies/${d.id}/resolutions`,
    {
      expected_version: d.version,
      resource_ids: [version],
    },
  );
  const paused = await ok(f.owner, "POST", url(f, resolved), {
    action: "pause",
    expected_version: resolved.version,
  });
  await s.db.control.query(
    "UPDATE assets SET state='quarantined' WHERE id=$1",
    [a.id],
  );
  const resumed = await ok(f.owner, "POST", url(f, paused), {
    action: "resume",
    expected_version: paused.version,
  });
  assert.equal(resumed.id, waiting.id);
  assert.equal(resumed.status, "needs_input");
  assert.equal(resumed.attempt, 0);
  const runtime = new FixtureRuntime();
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    resumed.id,
  );
  assert.equal(runtime.calls, 0);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT status FROM reservations WHERE task_id=$1",
        [waiting.id],
      )
    ).rows[0].status,
    "reserved",
  );
  assert.equal(
    (
      await ok(
        f.owner,
        "GET",
        f.base + "/tasks/" + waiting.id + "/dependencies",
      )
    ).items[0].state,
    "pending",
  );
});
