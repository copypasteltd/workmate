import { after, before, test } from "node:test";
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
import { isolatedTestEnvironment } from "./native-test-environment.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>,
  s: Awaited<ReturnType<typeof buildApp>>;
type Client = { id: string; cookie: string; csrf: string };
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
      origin: s.db.config.WEB_ORIGIN,
      "idempotency-key": key,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
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
function ok(r: Awaited<ReturnType<typeof call>>, status = 200) {
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
}
async function user(): Promise<Client> {
  const challenge = ok(
    await call(undefined, "POST", "/v1/auth/challenge", {
      email: `history-source-${randomUUID()}@example.invalid`,
    }),
  );
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${challenge.challenge_id}.json`,
      "utf8",
    ),
  );
  const r = await call(undefined, "POST", "/v1/auth/verify", {
    challenge_id: challenge.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
  });
  const b = ok(r);
  return {
    id: b.user.id,
    cookie: r.raw.cookies[0].name + "=" + r.raw.cookies[0].value,
    csrf: b.csrf_token,
  };
}
class ReadingRuntime extends CodexRuntimeAdapter {
  calls: RuntimeContext[] = [];
  constructor(
    private read?: { id: string; text: string },
    private afterRead?: (ctx: RuntimeContext) => Promise<void>,
  ) {
    super(s.db.config);
  }
  override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
    this.calls.push(ctx);
    let text = "Current authorized continuation.";
    if (this.read) {
      const source = (await ctx.tools
        .find((t) => t.name === "asset_text_read")!
        .run({ asset_id: this.read.id }, randomUUID())) as any;
      assert.equal(source.text, this.read.text);
      text = "Read result: " + source.text;
    }
    await this.afterRead?.(ctx);
    await ctx.onEvent("message.delta", { text });
    if (ctx.prompt.includes("Work mode: execute"))
      await ctx.tools
        .find((t) => t.name === "deliver_text")!
        .run(
          {
            filename: "source-result.md",
            mime_type: "text/markdown",
            content: text,
          },
          randomUUID(),
        );
    return {
      text,
      status: "completed",
      inputTokens: 100,
      outputTokens: 100,
      usageKnown: true,
      accepted: true,
      thread: "synthetic-history-thread",
      turn: "synthetic-history-turn",
    };
  }
}
async function fixture(declared = true) {
  const owner = await user();
  const w = ok(
    await call(owner, "POST", "/v1/tenants", {
      name: "Historical source studio",
      project_name: "Private continuity",
    }),
  );
  const tenant = w.tenant.id,
    project = w.project.id,
    base = `/v1/tenants/${tenant}/projects/${project}`;
  ok(await call(owner, "POST", `/v1/tenants/${tenant}/demo-credit`, {}));
  const text = "PRIVATE_SOURCE_CANARY_" + randomUUID();
  const asset = await s.db.tx(
    (tx) =>
      saveAsset(tx, s.storage, {
        tenant,
        project,
        user: owner.id,
        name: "retained-source.txt",
        mime: "text/plain",
        kind: "file",
        bytes: Buffer.from(text),
      }),
    tenant,
    false,
    owner.id,
  );
  const version = (
    await s.db.control.query(
      "SELECT id FROM asset_versions WHERE asset_id=$1 AND version=1",
      [asset.id],
    )
  ).rows[0].id;
  const first = ok(
    await call(owner, "POST", base + "/delegations", {
      title: "Read the retained source",
      prompt: "Read the authorized source and write its findings.",
      mode: "execute",
      budget_micros: 1000000,
      client_message_id: randomUUID(),
      ...(declared
        ? {
            dependencies: [
              {
                kind: "file",
                description: "Explicitly selected source",
                resource_ids: [version],
              },
            ],
          }
        : {}),
    }),
  );
  const runtime = new ReadingRuntime({ id: asset.id, text });
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    tenant,
    first.task.id,
  );
  assert.equal(runtime.calls.length, 1);
  assert.equal(
    (
      await s.db.control.query("SELECT status FROM tasks WHERE id=$1", [
        first.task.id,
      ])
    ).rows[0].status,
    "succeeded",
  );
  const route = base + "/conversations/" + first.conversation.id;
  const conversation = ok(await call(owner, "GET", route));
  assert.ok(
    conversation.messages.some(
      (m: any) => m.role === "assistant" && m.body.includes(text),
    ),
  );
  const output = (
    await s.db.control.query(
      "SELECT v.asset_id,v.id FROM asset_versions v WHERE v.metadata->>'task_id'=$1 ORDER BY v.created_at LIMIT 1",
      [first.task.id],
    )
  ).rows[0];
  assert.ok(output);
  const initialDownload = await call(
    owner,
    "GET",
    base + "/assets/" + output.asset_id + "/download",
  );
  assert.equal(initialDownload.status, 200);
  assert.ok(initialDownload.data.includes(text));
  return {
    owner,
    tenant,
    project,
    base,
    text,
    asset,
    version,
    first,
    route,
    output,
  };
}
async function sourceState(
  f: Awaited<ReturnType<typeof fixture>>,
  state: "quarantined" | "expired" | "active",
) {
  await s.db.control.query(
    "UPDATE assets SET state=$2,retention_expires_at=CASE WHEN $3 THEN clock_timestamp()-interval '1 second' ELSE clock_timestamp()+interval '90 days' END WHERE id=$1",
    [
      f.asset.id,
      state === "quarantined" ? state : "active",
      state === "expired",
    ],
  );
}
async function counts(f: Awaited<ReturnType<typeof fixture>>) {
  return (
    await s.db.control.query(
      "SELECT (SELECT count(*)::int FROM tasks WHERE project_id=$1) AS tasks,(SELECT count(*)::int FROM reservations r JOIN tasks t ON t.id=r.task_id WHERE t.project_id=$1) AS reservations,(SELECT reserved_micros::text FROM wallets WHERE tenant_id=$2 AND user_id IS NULL) AS reserved",
      [f.project, f.tenant],
    )
  ).rows[0];
}
async function follow(
  f: Awaited<ReturnType<typeof fixture>>,
  mode: "execute" | "plan" = "execute",
) {
  const conversation = ok(await call(f.owner, "GET", f.route));
  return call(f.owner, "POST", f.route + "/messages", {
    client_message_id: randomUUID(),
    expected_version: conversation.version,
    intent: "delegate",
    body: "Continue using the findings already in this conversation.",
    mode,
    budget_micros: 1000000,
  });
}

for (const declared of [true, false])
  test(`${declared ? "selected" : "dynamically read"} source quarantine hides retained assistant text and its generated artifact without rewriting the stored result`, async () => {
    const f = await fixture(declared);
    await sourceState(f, "quarantined");
    const conversation = ok(await call(f.owner, "GET", f.route));
    const download = await call(
      f.owner,
      "GET",
      f.base + "/assets/" + f.output.asset_id + "/download",
    );
    console.log(
      JSON.stringify({
        case: declared ? "selected_source" : "actual_read_source",
        conversation_canary: JSON.stringify(conversation).includes(f.text),
        download_status: download.status,
      }),
    );
    assert.ok(
      !JSON.stringify(conversation).includes(f.text),
      "Quarantined source text remains in the user-visible conversation",
    );
    assert.ok(
      [403, 404, 410].includes(download.status),
      "Source-derived artifact is still downloadable",
    );
    const retained = (
      await s.db.control.query(
        "SELECT body FROM conversation_messages WHERE task_id=$1 AND role='assistant'",
        [f.first.task.id],
      )
    ).rows[0].body;
    assert.ok(
      retained.includes(f.text),
      "The original immutable result must remain intact under quarantine",
    );
  });

test("expired historical source rejects a new paid conversation delegation before creating a task or reservation", async () => {
  const f = await fixture();
  await sourceState(f, "expired");
  const before = await counts(f),
    r = await follow(f);
  console.log(
    JSON.stringify({
      case: "expired_history_delegation",
      response: r.status,
      before,
      after: await counts(f),
    }),
  );
  assert.ok(
    [403, 404, 409, 410].includes(r.status),
    "Expired retained source entered a new paid task",
  );
  assert.deepEqual(await counts(f), before);
});

test("a queued continuation cannot send an earlier result to its model after the original source is quarantined", async () => {
  const f = await fixture(),
    queued = ok(await follow(f));
  await sourceState(f, "quarantined");
  const runtime = new ReadingRuntime();
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    queued.task.id,
  );
  console.log(
    JSON.stringify({
      case: "queued_history",
      calls: runtime.calls.length,
      leaked_to_model: runtime.calls.some((c) => c.prompt.includes(f.text)),
    }),
  );
  assert.equal(
    runtime.calls.length,
    0,
    "Revoked source history was supplied to a new model turn",
  );
  const reservation = (
    await s.db.control.query(
      "SELECT status FROM reservations WHERE task_id=$1",
      [queued.task.id],
    )
  ).rows[0];
  assert.ok(["released", "settled"].includes(reservation.status));
});

test("a plan produced from conversation history becomes unavailable and cannot be approved after its original source is quarantined", async () => {
  const f = await fixture(),
    planned = ok(await follow(f, "plan"));
  const runtime = new ReadingRuntime();
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    planned.task.id,
  );
  assert.ok(runtime.calls[0].prompt.includes(f.text));
  const task = (
    await s.db.control.query("SELECT version FROM tasks WHERE id=$1", [
      planned.task.id,
    ])
  ).rows[0];
  const planRoute = f.base + "/tasks/" + planned.task.id + "/plan";
  const plan = ok(await call(f.owner, "GET", planRoute));
  await sourceState(f, "quarantined");
  const before = await counts(f),
    read = await call(f.owner, "GET", planRoute);
  const approval = await call(f.owner, "POST", planRoute + "/approve", {
    expected_task_version: task.version,
    plan_version: plan.version,
    input_hash: plan.input_hash,
    budget_micros: 1000000,
  });
  console.log(
    JSON.stringify({
      case: "historical_plan",
      plan_read: read.status,
      approval: approval.status,
    }),
  );
  assert.ok(
    [403, 404, 409, 410].includes(read.status),
    "A source-revoked plan body remains readable",
  );
  assert.ok(
    [403, 404, 409, 410].includes(approval.status),
    "A source-revoked plan was approved",
  );
  assert.deepEqual(await counts(f), before);
});

test("an actual unselected read revocation blocks the next model event and tool before publishing a copied result", async () => {
  const f = await fixture(false);
  const next = ok(await follow(f));
  const runtime = new ReadingRuntime(
    { id: f.asset.id, text: f.text },
    async () => {
      await sourceState(f, "quarantined");
    },
  );
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    next.task.id,
  );
  const task = (
    await s.db.control.query("SELECT status FROM tasks WHERE id=$1", [
      next.task.id,
    ])
  ).rows[0];
  const events = (
    await s.db.control.query(
      "SELECT body FROM task_events WHERE task_id=$1 AND kind='message.delta'",
      [next.task.id],
    )
  ).rows;
  console.log(
    JSON.stringify({
      case: "mid_turn_read_revocation",
      status: task.status,
      persisted_canary: JSON.stringify(events).includes(f.text),
    }),
  );
  assert.notEqual(
    task.status,
    "succeeded",
    "Source revocation was ignored after an actual model file read",
  );
  assert.ok(
    !JSON.stringify(events).includes(f.text),
    "A revoked source was copied to retained model events",
  );
});
