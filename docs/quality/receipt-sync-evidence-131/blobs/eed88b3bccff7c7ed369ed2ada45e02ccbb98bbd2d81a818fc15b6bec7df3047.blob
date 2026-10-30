import { isolatedTestEnvironment } from "./native-test-environment.js";
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>;
import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { Worker } from "../src/worker.js";
import { saveAsset } from "../src/storage.js";
import {
  CodexRuntimeAdapter,
  type RuntimeContext,
  type RuntimeResult,
} from "../src/runtime.js";
let s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string };
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  tenant?: string,
  key = randomUUID(),
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
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: raw.statusCode, data: raw.json(), raw };
}
async function ok(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  tenant?: string,
) {
  const r = await call(c, method, url, body, tenant);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  return r.data;
}
async function user(): Promise<Client> {
  const ch = await ok(undefined, "POST", "/v1/auth/challenge", {
    email: `default-${randomUUID()}@example.invalid`,
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
async function fixture(credit = true) {
  const owner = await user(),
    member = await user(),
    created = await ok(owner, "POST", "/v1/tenants", {
      name: "Default assistant studio",
      project_name: "Unconfigured project",
    });
  const tenant = created.tenant.id,
    project = created.project.id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  await s.db.control.query(
    "INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')",
    [tenant, member.id],
  );
  await s.db.control.query(
    "INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'editor')",
    [tenant, project, member.id],
  );
  if (credit)
    await s.db.control.query(
      "UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1",
      [tenant],
    );
  return { owner, member, tenant, project, base };
}
const brief = (extra: Record<string, unknown> = {}) => ({
  title: "Launch brief",
  prompt: "Write a campaign plan from the information I provide.",
  mode: "execute",
  budget_micros: 1000000,
  client_message_id: randomUUID(),
  ...extra,
});
before(async () => {
  isolated = await isolatedTestEnvironment();
  const env = { ...isolated.env };
  s = await buildApp(
    loadConfig({
      ...env,
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
    if (s) await s.app.close();
  } finally {
    await isolated?.cleanup();
  }
});

async function asset(
  f: Awaited<ReturnType<typeof fixture>>,
  name = "approved.txt",
) {
  const a = await s.db.tx(
    (tx) =>
      saveAsset(tx, s.storage, {
        tenant: f.tenant,
        project: f.project,
        user: f.owner.id,
        name,
        mime: "text/plain",
        bytes: Buffer.from("Clearly simulated, approved source."),
        kind: "file",
      }),
    f.tenant,
    false,
    f.owner.id,
  );
  const version = (
    await s.db.control.query(
      "SELECT id FROM asset_versions WHERE asset_id=$1",
      [a.id],
    )
  ).rows[0].id;
  return { id: a.id, version };
}
const needs = [
  { kind: "file", description: "Approved source material before starting" },
];
async function waiting(
  f: Awaited<ReturnType<typeof fixture>>,
  dependencies: any[] = needs,
) {
  const r = await ok(
    f.owner,
    "POST",
    f.base + "/delegations",
    brief({ dependencies }),
  );
  return {
    task: r.task,
    conversation: r.conversation,
    dependencies: (
      await ok(f.owner, "GET", f.base + "/tasks/" + r.task.id + "/dependencies")
    ).items,
  };
}
const resolution = (f: Awaited<ReturnType<typeof fixture>>, id: string) =>
  `/v1/tenants/${f.tenant}/task-dependencies/${id}/resolutions`;
class CountedRuntime extends CodexRuntimeAdapter {
  calls = 0;
  constructor(private expected?: string) {
    super(s.db.config);
  }
  override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
    this.calls++;
    if (this.expected)
      assert.ok(
        ctx.prompt.includes(this.expected),
        "the exact selected version is included as a data reference",
      );
    await ctx.tools
      .find((t) => t.name === "deliver_text")!
      .run(
        {
          filename: "dependency-result.md",
          mime_type: "text/markdown",
          content: "Controlled simulated result after approved input.",
        },
        randomUUID(),
      );
    return {
      text: "Controlled simulated result.",
      inputTokens: 10,
      outputTokens: 20,
      usageKnown: true,
      accepted: true,
      thread: "controlled-thread",
      turn: "controlled-turn",
      status: "completed",
    };
  }
}

test("resolved inputs permit exactly selected private file versions without exposing other private files or another user's selection", async () => {
  const f = await fixture();
  const makePrivate = (name: string) =>
    s.db.tx(
      (tx) =>
        saveAsset(tx, s.storage, {
          tenant: f.tenant,
          project: f.project,
          user: f.owner.id,
          privateOwner: f.owner.id,
          name,
          mime: "text/plain",
          bytes: Buffer.from("Private input bytes: " + name),
        }),
      f.tenant,
      false,
      f.owner.id,
    );
  const selected = await makePrivate("selected-private.txt"),
    other = await makePrivate("unselected-private.txt");
  const work = await waiting(f, [
    { ...needs[0], resource_ids: [selected.version.id] },
  ]);
  assert.equal(
    (
      await s.db.control.query("SELECT private_owner FROM tasks WHERE id=$1", [
        work.task.id,
      ])
    ).rows[0].private_owner,
    f.owner.id,
  );
  class SelectedReader extends CountedRuntime {
    override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
      const items = (await ctx.tools
        .find((t) => t.name === "project_assets")!
        .run({}, randomUUID())) as any;
      assert.ok(items.items.some((item: any) => item.id === selected.id));
      assert.ok(!items.items.some((item: any) => item.id === other.id));
      const read = ctx.tools.find((t) => t.name === "asset_text_read")!;
      assert.deepEqual(
        await read.run({ asset_id: selected.id }, randomUUID()),
        { text: "Private input bytes: selected-private.txt" },
      );
      await assert.rejects(
        () => read.run({ asset_id: other.id }, randomUUID()),
        (e: any) => e.code === "NOT_FOUND",
      );
      return super.start(ctx);
    }
  }
  const runtime = new SelectedReader(selected.version.id);
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    work.task.id,
  );
  assert.equal(
    (await ok(f.owner, "GET", f.base + "/tasks/" + work.task.id)).status,
    "succeeded",
  );
  const reads = (
    await s.db.control.query(
      "SELECT asset_version_id,sha256 FROM task_source_reads WHERE task_id=$1",
      [work.task.id],
    )
  ).rows;
  assert.deepEqual(
    reads.map((row) => row.asset_version_id),
    [selected.version.id],
  );
  assert.equal(reads[0].sha256, selected.version.sha256);
  const denied = await call(
    f.member,
    "POST",
    f.base + "/delegations",
    brief({
      dependencies: [{ ...needs[0], resource_ids: [selected.version.id] }],
    }),
  );
  assert.equal(denied.status, 404);
});

test("replacing an explicitly selected private input during a run cannot silently authorize its new version or replay the model", async () => {
  const f = await fixture();
  const selected = await s.db.tx(
    (tx) =>
      saveAsset(tx, s.storage, {
        tenant: f.tenant,
        project: f.project,
        user: f.owner.id,
        privateOwner: f.owner.id,
        name: "versioned-private.txt",
        mime: "text/plain",
        bytes: Buffer.from("Approved version one"),
      }),
    f.tenant,
    false,
    f.owner.id,
  );
  const work = await waiting(f, [
    { ...needs[0], resource_ids: [selected.version.id] },
  ]);
  class ReplacingReader extends CodexRuntimeAdapter {
    calls = 0;
    override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
      this.calls++;
      const read = ctx.tools.find((t) => t.name === "asset_text_read")!;
      assert.deepEqual(
        await read.run({ asset_id: selected.id }, randomUUID()),
        { text: "Approved version one" },
      );
      await s.db.tx(
        (tx) =>
          saveAsset(tx, s.storage, {
            tenant: f.tenant,
            project: f.project,
            user: f.owner.id,
            privateOwner: f.owner.id,
            asset: selected.id,
            expectedVersion: 1,
            name: "versioned-private.txt",
            mime: "text/plain",
            bytes: Buffer.from("Unapproved version two"),
          }),
        f.tenant,
        false,
        f.owner.id,
      );
      await assert.rejects(
        () => read.run({ asset_id: selected.id }, randomUUID()),
        (e: any) => e.code === "DEPENDENCY_RESOURCE_REVOKED",
      );
      return {
        text: "Do not publish this revoked-source answer",
        status: "completed",
        inputTokens: 10,
        outputTokens: 20,
        usageKnown: true,
        accepted: true,
        thread: randomUUID(),
        turn: randomUUID(),
      };
    }
  }
  const runtime = new ReplacingReader(s.db.config),
    worker = new Worker(s.db, s.catalog, s.storage, runtime);
  await worker.run(f.tenant, work.task.id);
  await worker.run(f.tenant, work.task.id);
  const final = await ok(f.owner, "GET", f.base + "/tasks/" + work.task.id);
  assert.equal(runtime.calls, 1);
  assert.equal(final.status, "cancelled");
  assert.equal(final.error_code, "CONTEXT_REVOKED");
  assert.equal(final.output, "");
  const reads = (
    await s.db.control.query(
      "SELECT asset_version_id FROM task_source_reads WHERE task_id=$1",
      [work.task.id],
    )
  ).rows;
  assert.deepEqual(
    reads.map((row) => row.asset_version_id),
    [selected.version.id],
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM reservations WHERE task_id=$1",
        [work.task.id],
      )
    ).rows[0].n,
    1,
  );
});

test("input checkpoint holds one original budget without model/outbox, isolates private requests, and repeated callbacks queue exactly once", async () => {
  const f = await fixture(),
    a = await asset(f),
    r = await waiting(f),
    d = r.dependencies[0];
  assert.equal(r.task.status, "needs_input");
  assert.equal(r.task.attempt, 0);
  assert.equal(
    (await ok(f.owner, "GET", f.base + "/conversations/" + r.conversation.id))
      .tasks[0].conversation_id,
    r.conversation.id,
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM reservations WHERE task_id=$1",
        [r.task.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM outbox WHERE payload->>'task_id'=$1",
        [r.task.id],
      )
    ).rows[0].n,
    0,
  );
  const runtime = new CountedRuntime(a.version),
    worker = new Worker(s.db, s.catalog, s.storage, runtime);
  await worker.run(f.tenant, r.task.id);
  assert.equal(runtime.calls, 0);
  assert.equal(
    (
      await call(
        f.member,
        "GET",
        f.base + "/tasks/" + r.task.id + "/dependencies",
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await call(
        f.member,
        "GET",
        `/v1/tenants/${f.tenant}/task-dependencies/${d.id}/resources`,
      )
    ).status,
    404,
  );
  assert.equal(
    (
      await s.db.tx(
        (tx) => tx.query("SELECT 1 FROM task_dependencies WHERE id=$1", [d.id]),
        f.tenant,
      )
    ).rowCount,
    0,
  );
  const wrong = await ok(f.owner, "POST", `/v1/tenants/${f.tenant}/projects`, {
    name: "Other project",
  });
  assert.equal(
    (
      await call(
        f.owner,
        "GET",
        `/v1/tenants/${f.tenant}/projects/${wrong.id}/tasks/${r.task.id}/dependencies`,
      )
    ).status,
    404,
  );
  const candidates = await ok(
    f.owner,
    "GET",
    `/v1/tenants/${f.tenant}/task-dependencies/${d.id}/resources?q=approved`,
  );
  assert.equal(candidates.items[0].id, a.version);
  const callbacks = await Promise.all([
    call(f.owner, "POST", resolution(f, d.id), {
      expected_version: 1,
      resource_ids: [a.version],
    }),
    call(f.owner, "POST", resolution(f, d.id), {
      expected_version: 1,
      resource_ids: [a.version],
    }),
  ]);
  assert.deepEqual(
    callbacks.map((c) => c.status),
    [202, 202],
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM outbox WHERE payload->>'task_id'=$1",
        [r.task.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT reserved_micros::text FROM wallets WHERE tenant_id=$1",
        [f.tenant],
      )
    ).rows[0].reserved_micros,
    "1000000",
  );
  await worker.run(f.tenant, r.task.id);
  const completed = await ok(f.owner, "GET", f.base + "/tasks/" + r.task.id);
  assert.equal(completed.status, "succeeded");
  assert.equal(runtime.calls, 1);
  assert.equal(Number(completed.charged_micros), 30);
  const repeated = await call(f.owner, "POST", resolution(f, d.id), {
    expected_version: 1,
    resource_ids: [a.version],
  });
  assert.equal(repeated.status, 202);
  assert.equal(repeated.data.status, "succeeded");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'",
        [r.task.id],
      )
    ).rows[0].n,
    1,
  );
});

test("cancelled input waits dismiss requests and release the hold; forged, foreign and privately owned resources cannot resolve them", async () => {
  const f = await fixture(),
    foreign = await fixture(),
    a = await asset(foreign),
    r = await waiting(f),
    d = r.dependencies[0];
  assert.equal(
    (
      await call(f.owner, "POST", resolution(f, d.id), {
        expected_version: 1,
        resource_ids: [a.version],
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await call(f.owner, "POST", resolution(f, d.id), {
        expected_version: 2,
        resource_ids: [randomUUID()],
      })
    ).status,
    409,
  );
  const local = await asset(f);
  await s.db.control.query("UPDATE assets SET private_owner=$2 WHERE id=$1", [
    local.id,
    f.member.id,
  ]);
  assert.equal(
    (
      await call(f.owner, "POST", resolution(f, d.id), {
        expected_version: 1,
        resource_ids: [local.version],
      })
    ).status,
    404,
  );
  assert.equal(
    (
      await call(f.owner, "POST", resolution(f, d.id), {
        expected_version: 1,
        resource_ids: [randomUUID(), randomUUID()],
        kernel: "other",
      })
    ).status,
    400,
  );
  const cancelled = await ok(
    f.owner,
    "POST",
    f.base + "/tasks/" + r.task.id + "/cancel",
    {},
  );
  assert.equal(cancelled.status, "cancelled");
  assert.equal(
    (await ok(f.owner, "GET", f.base + "/tasks/" + r.task.id + "/dependencies"))
      .items[0].state,
    "dismissed",
  );
  assert.equal(
    (
      await call(f.owner, "POST", resolution(f, d.id), {
        expected_version: 1,
        resource_ids: [local.version],
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT reserved_micros::text FROM wallets WHERE tenant_id=$1",
        [f.tenant],
      )
    ).rows[0].reserved_micros,
    "0",
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM outbox WHERE payload->>'task_id'=$1",
        [r.task.id],
      )
    ).rows[0].n,
    0,
  );
});

test("shared tasks cannot select even the creator's private input or disclose its name in candidate lists", async () => {
  const f = await fixture(),
    a = await asset(f, "private-input-name.txt");
  await s.db.control.query("UPDATE assets SET private_owner=$2 WHERE id=$1", [
    a.id,
    f.owner.id,
  ]);
  const body = {
    title: "Shared task",
    prompt: "Write a shared campaign plan.",
    role_key: "assistant",
    budget_micros: 1000000,
  };
  const forged = await call(f.owner, "POST", f.base + "/tasks", {
    ...body,
    dependencies: [{ ...needs[0], resource_ids: [a.version] }],
  });
  assert.equal(forged.status, 404);
  assert.equal((await ok(f.owner, "GET", f.base + "/tasks")).items.length, 0);
  const waiting = await ok(f.owner, "POST", f.base + "/tasks", {
    ...body,
    dependencies: needs,
  });
  const d = (
    await ok(f.owner, "GET", f.base + "/tasks/" + waiting.id + "/dependencies")
  ).items[0];
  const candidates = await ok(
    f.owner,
    "GET",
    `/v1/tenants/${f.tenant}/task-dependencies/${d.id}/resources`,
  );
  assert.equal(candidates.items.length, 0);
  assert.ok(!JSON.stringify(candidates).includes("private-input-name"));
  assert.equal(
    (
      await call(f.owner, "POST", resolution(f, d.id), {
        expected_version: 1,
        resource_ids: [a.version],
      })
    ).status,
    404,
  );
  assert.equal(
    (await ok(f.owner, "GET", f.base + "/tasks/" + waiting.id)).status,
    "needs_input",
  );
});

test("revocation after resolution returns an unstarted task to input wait without another reservation or model turn", async () => {
  const f = await fixture(),
    a = await asset(f),
    b = await asset(f, "replacement.txt"),
    r = await waiting(f),
    d = r.dependencies[0];
  assert.equal(
    (
      await call(f.owner, "POST", resolution(f, d.id), {
        expected_version: 1,
        resource_ids: [a.version],
      })
    ).status,
    202,
  );
  await s.db.control.query(
    "UPDATE assets SET state='quarantined' WHERE id=$1",
    [a.id],
  );
  const runtime = new CountedRuntime(b.version),
    worker = new Worker(s.db, s.catalog, s.storage, runtime);
  await worker.run(f.tenant, r.task.id);
  const t = await ok(f.owner, "GET", f.base + "/tasks/" + r.task.id),
    dep = (
      await ok(f.owner, "GET", f.base + "/tasks/" + r.task.id + "/dependencies")
    ).items[0];
  assert.equal(t.status, "needs_input");
  assert.equal(t.attempt, 0);
  assert.equal(runtime.calls, 0);
  assert.equal(dep.version, 3);
  assert.equal(
    (
      await call(f.owner, "POST", resolution(f, d.id), {
        expected_version: 1,
        resource_ids: [a.version],
      })
    ).status,
    409,
  );
  assert.equal(
    (
      await call(f.owner, "POST", resolution(f, d.id), {
        expected_version: 3,
        resource_ids: [b.version],
      })
    ).status,
    202,
  );
  await worker.run(f.tenant, r.task.id);
  assert.equal(runtime.calls, 1);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM reservations WHERE task_id=$1",
        [r.task.id],
      )
    ).rows[0].n,
    1,
  );
  assert.equal(
    (await ok(f.owner, "GET", f.base + "/tasks/" + r.task.id)).status,
    "succeeded",
  );
});

test("all independent requested inputs must be resolved; racing different selections cannot replace the accepted resource", async () => {
  const f = await fixture(),
    a = await asset(f),
    b = await asset(f, "second.txt"),
    r = await waiting(f, [...needs, ...needs]),
    [one, two] = r.dependencies;
  const races = await Promise.all([
    call(f.owner, "POST", resolution(f, one.id), {
      expected_version: 1,
      resource_ids: [a.version],
    }),
    call(f.owner, "POST", resolution(f, one.id), {
      expected_version: 1,
      resource_ids: [b.version],
    }),
  ]);
  assert.deepEqual(races.map((x) => x.status).sort(), [202, 409]);
  assert.equal(
    (await ok(f.owner, "GET", f.base + "/tasks/" + r.task.id)).status,
    "needs_input",
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM outbox WHERE payload->>'task_id'=$1",
        [r.task.id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await call(f.owner, "POST", resolution(f, two.id), {
        expected_version: 1,
        resource_ids: [b.version],
      })
    ).status,
    202,
  );
  assert.equal(
    (await ok(f.owner, "GET", f.base + "/tasks/" + r.task.id)).status,
    "queued",
  );
});

test("connection selection checks the declared provider and current authorization without leaking credentials or granting report accounts", async () => {
  const f = await fixture();
  const t = await ok(f.owner, "POST", f.base + "/tasks", {
    title: "Explicit connection input",
    prompt: "Read only the report that I explicitly approve.",
    role_key: "marketing-analyst",
    budget_micros: 1000000,
    dependencies: [
      {
        kind: "connection",
        provider: "ga4",
        description:
          "Choose an authorized GA4 connection; account selection remains separate.",
      },
    ],
  });
  const d = (
    await ok(f.owner, "GET", f.base + "/tasks/" + t.id + "/dependencies")
  ).items[0];
  const add = async (provider: string) =>
    (
      await s.db.control.query(
        "INSERT INTO connections(tenant_id,project_id,provider,name,state,encrypted_secret,created_by) VALUES($1,$2,$3,$3,'connected','DO_NOT_EXPOSE',$4) RETURNING id",
        [f.tenant, f.project, provider, f.owner.id],
      )
    ).rows[0].id;
  const wrong = await add("meta"),
    right = await add("ga4");
  assert.equal(
    (
      await call(f.owner, "POST", resolution(f, d.id), {
        expected_version: 1,
        resource_ids: [wrong],
      })
    ).status,
    404,
  );
  const candidates = await ok(
    f.owner,
    "GET",
    `/v1/tenants/${f.tenant}/task-dependencies/${d.id}/resources`,
  );
  assert.equal(candidates.items.length, 1);
  assert.equal(candidates.items[0].id, right);
  assert.ok(!JSON.stringify(candidates).includes("DO_NOT_EXPOSE"));
  assert.equal(
    (
      await call(f.owner, "POST", resolution(f, d.id), {
        expected_version: 1,
        resource_ids: [right],
      })
    ).status,
    202,
  );
  await s.db.control.query(
    "UPDATE connections SET state='revoked' WHERE id=$1",
    [right],
  );
  const runtime = new CountedRuntime(),
    worker = new Worker(s.db, s.catalog, s.storage, runtime);
  await worker.run(f.tenant, t.id);
  assert.equal(runtime.calls, 0);
  assert.equal(
    (await ok(f.owner, "GET", f.base + "/tasks/" + t.id)).status,
    "needs_input",
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM analytics_datasets WHERE project_id=$1",
        [f.project],
      )
    ).rows[0].n,
    0,
  );
});

test("parent inputs are inherited for new work, superseded versions need a fresh selection, and erasure removes input descriptions", async () => {
  const f = await fixture(),
    a = await asset(f);
  const parent = await ok(f.owner, "POST", f.base + "/tasks", {
    title: "Pinned initial input",
    prompt: "Produce a written answer based on the selected source.",
    role_key: "assistant",
    budget_micros: 1000000,
    dependencies: [{ ...needs[0], resource_ids: [a.version] }],
  });
  const runtime = new CountedRuntime(a.version),
    worker = new Worker(s.db, s.catalog, s.storage, runtime);
  await worker.run(f.tenant, parent.id);
  const child = await ok(f.owner, "POST", f.base + "/tasks", {
    title: "Follow-up",
    prompt: "Revise the written answer using the same source.",
    role_key: "assistant",
    parent_id: parent.id,
    budget_micros: 1000000,
  });
  assert.equal(
    (await ok(f.owner, "GET", f.base + "/tasks/" + child.id + "/dependencies"))
      .items[0].state,
    "resolved",
  );
  await s.db.tx(
    (tx) =>
      saveAsset(tx, s.storage, {
        tenant: f.tenant,
        project: f.project,
        user: f.owner.id,
        name: "approved.txt",
        mime: "text/plain",
        bytes: Buffer.from("A revised source requiring an explicit choice."),
        asset: a.id,
        expectedVersion: 1,
      }),
    f.tenant,
    false,
    f.owner.id,
  );
  await worker.run(f.tenant, child.id);
  assert.equal(runtime.calls, 1);
  assert.equal(
    (await ok(f.owner, "GET", f.base + "/tasks/" + child.id)).status,
    "needs_input",
  );
  await ok(f.owner, "POST", f.base + "/tasks/" + child.id + "/cancel", {});
  await s.db.control.query(
    "UPDATE tasks SET content_state='deleted' WHERE id=$1",
    [child.id],
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM task_dependencies WHERE task_id=$1",
        [child.id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await call(
        f.owner,
        "GET",
        f.base + "/tasks/" + child.id + "/dependencies",
      )
    ).status,
    404,
  );
});

test("a follow-up requests a fresh input when its inherited source was already superseded", async () => {
  const f = await fixture(),
    a = await asset(f);
  const parent = await ok(f.owner, "POST", f.base + "/tasks", {
    title: "Initial source",
    prompt: "Read my approved source.",
    role_key: "assistant",
    budget_micros: 1000000,
    dependencies: [{ ...needs[0], resource_ids: [a.version] }],
  });
  const runtime = new CountedRuntime(a.version),
    worker = new Worker(s.db, s.catalog, s.storage, runtime);
  await worker.run(f.tenant, parent.id);
  await s.db.tx(
    (tx) =>
      saveAsset(tx, s.storage, {
        tenant: f.tenant,
        project: f.project,
        user: f.owner.id,
        name: "approved.txt",
        mime: "text/plain",
        bytes: Buffer.from("A newer version, not approved for the follow-up."),
        asset: a.id,
        expectedVersion: 1,
      }),
    f.tenant,
    false,
    f.owner.id,
  );
  const child = await ok(f.owner, "POST", f.base + "/tasks", {
    title: "Follow-up",
    prompt: "Continue from the approved source.",
    role_key: "assistant",
    parent_id: parent.id,
    budget_micros: 1000000,
  });
  assert.equal(child.status, "needs_input");
  const dependencies = await ok(
    f.owner,
    "GET",
    f.base + "/tasks/" + child.id + "/dependencies",
  );
  assert.equal(dependencies.items[0].state, "pending");
  await worker.run(f.tenant, child.id);
  assert.equal(runtime.calls, 1);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM outbox WHERE payload->>'task_id'=$1",
        [child.id],
      )
    ).rows[0].n,
    0,
  );
});

test("plans bind selected inputs; changed inputs require a new plan before approval or cancel an unstarted approved execution", async () => {
  for (const timing of ["before_approval", "before_execution"]) {
    const f = await fixture(),
      a = await asset(f);
    const task = await ok(f.owner, "POST", f.base + "/tasks", {
      title: "Plan with pinned input",
      prompt: "Plan the campaign using this approved input.",
      role_key: "assistant",
      mode: "plan",
      budget_micros: 1000000,
      dependencies: [{ ...needs[0], resource_ids: [a.version] }],
    });
    class PlanningRuntime extends CodexRuntimeAdapter {
      calls = 0;
      override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
        this.calls++;
        assert.ok(ctx.prompt.includes(a.version));
        return {
          text: "A plan bound to the approved source.",
          inputTokens: 10,
          outputTokens: 20,
          usageKnown: true,
          accepted: true,
          thread: "controlled-plan-thread",
          turn: "controlled-plan-turn",
          status: "completed",
        };
      }
    }
    const runtime = new PlanningRuntime(s.db.config),
      worker = new Worker(s.db, s.catalog, s.storage, runtime);
    await worker.run(f.tenant, task.id);
    const final = await ok(f.owner, "GET", f.base + "/tasks/" + task.id),
      plan = await ok(f.owner, "GET", f.base + "/tasks/" + task.id + "/plan");
    if (timing === "before_approval")
      await s.db.control.query(
        "UPDATE assets SET state='quarantined' WHERE id=$1",
        [a.id],
      );
    const approved = await call(
      f.owner,
      "POST",
      f.base + "/tasks/" + task.id + "/plan/approve",
      {
        expected_task_version: final.version,
        plan_version: plan.version,
        input_hash: plan.input_hash,
        budget_micros: 1000000,
      },
    );
    if (timing === "before_approval") {
      assert.equal(approved.status, 409);
      assert.equal(approved.data.error.code, "PLAN_STALE");
      assert.equal(
        (await ok(f.owner, "GET", f.base + "/tasks")).items.length,
        1,
      );
    } else {
      assert.equal(approved.status, 200, JSON.stringify(approved.data));
      await s.db.control.query(
        "UPDATE assets SET state='quarantined' WHERE id=$1",
        [a.id],
      );
      await worker.run(f.tenant, approved.data.id);
      const execution = await ok(
        f.owner,
        "GET",
        f.base + "/tasks/" + approved.data.id,
      );
      assert.equal(execution.status, "cancelled");
      assert.equal(execution.error_code, "PLAN_INPUT_CHANGED");
      assert.equal(execution.attempt, 0);
      assert.equal(Number(execution.charged_micros), 0);
      assert.equal(
        (
          await s.db.control.query(
            "SELECT status FROM reservations WHERE task_id=$1",
            [execution.id],
          )
        ).rows[0].status,
        "released",
      );
    }
    assert.equal(runtime.calls, 1);
  }
});

test("revocation during a paid run blocks tools and result publication and never replays the model", async () => {
  const f = await fixture(),
    a = await asset(f);
  const task = await ok(f.owner, "POST", f.base + "/tasks", {
    title: "Revoked during execution",
    prompt: "Use my approved source.",
    role_key: "assistant",
    budget_micros: 1000000,
    dependencies: [{ ...needs[0], resource_ids: [a.version] }],
  });
  class RevokingRuntime extends CodexRuntimeAdapter {
    calls = 0;
    override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
      this.calls++;
      await s.db.control.query(
        "UPDATE assets SET state='quarantined' WHERE id=$1",
        [a.id],
      );
      await assert.rejects(
        () =>
          ctx.tools
            .find((t) => t.name === "deliver_text")!
            .run(
              {
                filename: "must-not-exist.md",
                mime_type: "text/markdown",
                content: "Must not publish after revocation.",
              },
              randomUUID(),
            ),
        /approved input is no longer available/,
      );
      return {
        text: "Must not publish this answer.",
        inputTokens: 10,
        outputTokens: 20,
        usageKnown: true,
        accepted: true,
        thread: "controlled-thread",
        turn: "controlled-turn",
        status: "completed",
      };
    }
  }
  const runtime = new RevokingRuntime(s.db.config),
    worker = new Worker(s.db, s.catalog, s.storage, runtime);
  await worker.run(f.tenant, task.id);
  await worker.run(f.tenant, task.id);
  const final = await ok(f.owner, "GET", f.base + "/tasks/" + task.id);
  assert.equal(runtime.calls, 1);
  assert.equal(final.status, "cancelled");
  assert.equal(final.output, "");
  assert.equal(final.error_code, "CONTEXT_REVOKED");
  assert.equal(Number(final.charged_micros), 30);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM assets WHERE project_id=$1 AND name='must-not-exist.md'",
        [f.project],
      )
    ).rows[0].n,
    0,
  );
});
