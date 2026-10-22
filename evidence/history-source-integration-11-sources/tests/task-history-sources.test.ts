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
let address: string;
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
  address = await s.app.listen({ host: "127.0.0.1", port: 0 });
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
    private read?: {
      id: string;
      text: string;
      node?: string;
      version?: string;
    },
    private afterRead?: (ctx: RuntimeContext) => Promise<void>,
  ) {
    super(s.db.config);
  }
  override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
    this.calls.push(ctx);
    let text = "Current authorized continuation.";
    if (this.read) {
      const source = (await ctx.tools
        .find(
          (t) =>
            t.name ===
            (this.read!.node ? "cloud_file_read" : "asset_text_read"),
        )!
        .run(
          this.read.node
            ? {
                workspace_node_id: this.read.node,
                asset_version_id: this.read.version,
              }
            : { asset_id: this.read.id },
          randomUUID(),
        )) as any;
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
            filename: "source-result.txt",
            mime_type: "text/plain",
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
async function fixture(declared = true, memoryContent?: string) {
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
  const memory = memoryContent
    ? ok(
        await call(owner, "POST", base + "/memories", {
          name: "Pinned private preference",
          scope: "personal",
          content: memoryContent,
        }),
      )
    : undefined;
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
  await s.db.tx(
    async (tx) => {
      try {
        const sourceManifest = (
          await tx.query("SELECT task_content_source_manifest($1) AS refs", [
            first.task.id,
          ])
        ).rows[0].refs;
        assert.ok(
          Array.isArray(sourceManifest),
          "A fresh authorized task must have a valid source manifest",
        );
      } catch (error) {
        const e = error as any;
        assert.fail(
          JSON.stringify({ message: e.message, code: e.code, where: e.where }),
        );
      }
    },
    tenant,
    false,
    owner.id,
  );
  const runtime = new ReadingRuntime({ id: asset.id, text });
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    tenant,
    first.task.id,
  );
  assert.equal(runtime.calls.length, 1);
  if (memoryContent) assert.ok(runtime.calls[0].prompt.includes(memoryContent));
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
    memory,
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

test("quarantine restoration recovers the original bodies and artifacts while an independent user note remains usable", async () => {
  const f = await fixture(false),
    before = await counts(f);
  const original = (
    await s.db.control.query(
      "SELECT body FROM conversation_messages WHERE task_id=$1 AND role='assistant'",
      [f.first.task.id],
    )
  ).rows[0].body;
  await sourceState(f, "quarantined");
  const hidden = ok(await call(f.owner, "GET", f.route));
  assert.ok(hidden.messages.some((m: any) => m.source_unavailable));
  ok(
    await call(f.owner, "POST", f.route + "/messages", {
      client_message_id: randomUUID(),
      expected_version: hidden.version,
      intent: "note",
      body: "Independent planning note.",
    }),
  );
  await sourceState(f, "active");
  const restored = ok(await call(f.owner, "GET", f.route));
  assert.ok(
    restored.messages.some(
      (m: any) =>
        m.role === "assistant" && m.body === original && !m.source_unavailable,
    ),
  );
  assert.ok(
    restored.messages.some((m: any) => m.body === "Independent planning note."),
  );
  assert.ok(
    ok(
      await call(
        f.owner,
        "GET",
        f.base + "/assets/" + f.output.asset_id + "/download",
      ),
    ).includes(f.text),
  );
  assert.deepEqual(await counts(f), before);
});

test("ordinary result sources fence detail, JSON, task lists and both real HTTP SSE routes, including an already open stream", async () => {
  const f = await fixture(false),
    taskRoute = f.base + "/tasks/" + f.first.task.id;
  assert.ok(
    JSON.stringify(ok(await call(f.owner, "GET", taskRoute))).includes(f.text),
  );
  assert.ok(
    JSON.stringify(
      ok(await call(f.owner, "GET", taskRoute + "/events")),
    ).includes(f.text),
  );
  const cancel = new AbortController(),
    response = await fetch(address + `/v1/tasks/${f.first.task.id}/events`, {
      headers: { cookie: f.owner.cookie, "X-Tenant-ID": f.tenant },
      signal: AbortSignal.any([cancel.signal, AbortSignal.timeout(10000)]),
    });
  assert.equal(response.status, 200);
  const reader = response.body!.getReader(),
    decoder = new TextDecoder();
  let stream = "";
  try {
    while (!stream.includes(f.text)) {
      const r = await reader.read();
      assert.equal(r.done, false);
      stream += decoder.decode(r.value);
    }
    await sourceState(f, "quarantined");
    const late = "LATE_REVOKED_" + randomUUID();
    await s.db.control.query(
      "INSERT INTO task_events(tenant_id,task_id,kind,body) VALUES($1,$2,'message.delta',$3)",
      [f.tenant, f.first.task.id, { text: late }],
    );
    for (;;) {
      const r = await reader.read();
      if (r.done) break;
      stream += decoder.decode(r.value);
    }
    assert.ok(stream.includes("stream.reset"));
    assert.ok(!stream.includes(late));
    for (const url of [taskRoute + "/events"]) {
      const r = await call(f.owner, "GET", url);
      assert.ok([403, 404, 409, 410].includes(r.status));
      assert.ok(!JSON.stringify(r.data).includes(f.text));
    }
    const metadata = ok(await call(f.owner, "GET", taskRoute));
    assert.equal(metadata.source_unavailable, true);
    assert.equal(metadata.output, "");
    assert.ok(!JSON.stringify(metadata).includes(f.text));
    assert.ok(
      !ok(await call(f.owner, "GET", f.base + "/tasks")).items.some(
        (t: any) => t.id === f.first.task.id,
      ),
    );
    for (const url of [
      `/v1/tasks/${f.first.task.id}/events`,
      taskRoute + "/events/stream",
    ]) {
      const r = await fetch(address + url, {
        headers: { cookie: f.owner.cookie, "X-Tenant-ID": f.tenant },
        signal: AbortSignal.timeout(8000),
      });
      try {
        assert.ok([403, 404, 409, 410].includes(r.status));
        assert.ok(!(await r.text()).includes(f.text));
      } finally {
        await r.body?.cancel().catch(() => {});
      }
    }
  } finally {
    cancel.abort();
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
});

test("explicit publication, public shares and a second actual model read retain the original source ancestry", async () => {
  const f = await fixture(false);
  const published = ok(
    await call(
      f.owner,
      "POST",
      f.base + "/assets/" + f.output.asset_id + "/publish",
      { expected_version: 1, name: "Approved shared findings.txt" },
    ),
  );
  const shared = ok(
    await call(
      f.owner,
      "POST",
      f.base + "/assets/" + published.id + "/shares",
      { expires_in_hours: 1 },
    ),
  );
  const sharePath = new URL(shared.url).pathname;
  assert.ok(ok(await call(undefined, "GET", sharePath)).includes(f.text));
  const next = ok(
    await call(f.owner, "POST", f.base + "/delegations", {
      title: "Independent derivative",
      prompt: "Read the published findings and prepare a new file.",
      mode: "execute",
      budget_micros: 1000000,
      client_message_id: randomUUID(),
    }),
  );
  const runtime = new ReadingRuntime({
    id: published.id,
    text: "Read result: " + f.text,
  });
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    next.task.id,
  );
  assert.equal(runtime.calls.length, 1);
  assert.equal(
    (
      await s.db.control.query("SELECT status FROM tasks WHERE id=$1", [
        next.task.id,
      ])
    ).rows[0].status,
    "succeeded",
  );
  const nextRoute = f.base + "/conversations/" + next.conversation.id;
  assert.ok(
    JSON.stringify(ok(await call(f.owner, "GET", nextRoute))).includes(f.text),
  );
  await sourceState(f, "quarantined");
  assert.equal((await call(undefined, "GET", sharePath)).status, 404);
  assert.equal(
    (
      await call(
        f.owner,
        "GET",
        f.base + "/assets/" + published.id + "/download",
      )
    ).status,
    404,
  );
  assert.ok(
    !JSON.stringify(ok(await call(f.owner, "GET", nextRoute))).includes(f.text),
  );
  await sourceState(f, "active");
  assert.ok(ok(await call(undefined, "GET", sharePath)).includes(f.text));
  assert.ok(
    JSON.stringify(ok(await call(f.owner, "GET", nextRoute))).includes(f.text),
  );
});

test("a newer available file version does not substitute or invalidate the immutable version actually consumed by earlier history", async () => {
  const f = await fixture(false),
    replacement = "NEW_UNSELECTED_VERSION_" + randomUUID();
  await s.db.tx(
    (tx) =>
      saveAsset(tx, s.storage, {
        tenant: f.tenant,
        project: f.project,
        user: f.owner.id,
        name: "retained-source.txt",
        mime: "text/plain",
        bytes: Buffer.from(replacement),
        asset: f.asset.id,
        expectedVersion: 1,
      }),
    f.tenant,
    false,
    f.owner.id,
  );
  const next = ok(await follow(f)),
    runtime = new ReadingRuntime();
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    next.task.id,
  );
  assert.equal(runtime.calls.length, 1);
  assert.ok(runtime.calls[0].prompt.includes(f.text));
  assert.ok(!runtime.calls[0].prompt.includes(replacement));
  const reads = (
    await s.db.control.query(
      "SELECT asset_version_id FROM task_source_reads WHERE task_id=$1",
      [f.first.task.id],
    )
  ).rows;
  assert.deepEqual(
    reads.map((r: any) => r.asset_version_id),
    [f.version],
  );
});

test("a pinned personal memory expiry invalidates prior result bodies and rejects paid history reuse even after it ceases to be a current memory", async () => {
  const memoryText = "PRIVATE_MEMORY_CANARY_" + randomUUID(),
    f = await fixture(false, memoryText);
  await s.db.control.query(
    "UPDATE memories SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
    [f.memory.id],
  );
  assert.ok(
    !JSON.stringify(ok(await call(f.owner, "GET", f.route))).includes(f.text),
  );
  const before = await counts(f),
    r = await follow(f);
  assert.equal(r.status, 409);
  assert.deepEqual(await counts(f), before);
  await s.db.control.query("UPDATE memories SET expires_at=NULL WHERE id=$1", [
    f.memory.id,
  ]);
  assert.ok(
    JSON.stringify(ok(await call(f.owner, "GET", f.route))).includes(f.text),
  );
});

test("an actual cloud reference read is revoked when that exact file reference is quarantined", async () => {
  const f = await fixture(false),
    next = ok(await follow(f));
  const node = (
    await s.db.control.query(
      "SELECT id FROM workspace_nodes WHERE asset_version_id=$1 AND private_owner IS NULL",
      [f.version],
    )
  ).rows[0];
  assert.ok(node);
  const runtime = new ReadingRuntime(
    { id: f.asset.id, text: f.text, node: node.id, version: f.version },
    async () => {
      await s.db.control.query(
        "UPDATE workspace_nodes SET content_state='quarantined' WHERE id=$1",
        [node.id],
      );
    },
  );
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    next.task.id,
  );
  assert.notEqual(
    (
      await s.db.control.query("SELECT status FROM tasks WHERE id=$1", [
        next.task.id,
      ])
    ).rows[0].status,
    "succeeded",
  );
  const read = (
    await s.db.control.query(
      "SELECT kind,resource_id,asset_version_id FROM task_source_reads WHERE task_id=$1",
      [next.task.id],
    )
  ).rows;
  assert.deepEqual(read, [
    {
      kind: "cloud_reference",
      resource_id: node.id,
      asset_version_id: f.version,
    },
  ]);
});

test("a plan-approved queued execution retains the plan's own actual reads when the source is revoked after approval", async () => {
  const f = await fixture(false),
    planned = ok(await follow(f, "plan"));
  const runtime = new ReadingRuntime({ id: f.asset.id, text: f.text });
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    planned.task.id,
  );
  const planRoute = f.base + "/tasks/" + planned.task.id + "/plan",
    plan = ok(await call(f.owner, "GET", planRoute));
  const version = (
    await s.db.control.query("SELECT version FROM tasks WHERE id=$1", [
      planned.task.id,
    ])
  ).rows[0].version;
  const approved = ok(
    await call(f.owner, "POST", planRoute + "/approve", {
      expected_task_version: version,
      plan_version: plan.version,
      input_hash: plan.input_hash,
      budget_micros: 1000000,
    }),
  );
  assert.equal(approved.input_context.plan_source_task_id, planned.task.id);
  await sourceState(f, "quarantined");
  const execution = new ReadingRuntime();
  await new Worker(s.db, s.catalog, s.storage, execution).run(
    f.tenant,
    approved.id,
  );
  assert.equal(execution.calls.length, 0);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT status FROM reservations WHERE task_id=$1",
        [approved.id],
      )
    ).rows[0].status,
    "released",
  );
});

test("a cached tool response cannot replay an earlier actual file read after its source is revoked", async () => {
  const f = await fixture(false),
    next = ok(await follow(f));
  let denied = false;
  const runtime = new ReadingRuntime(undefined, async (ctx) => {
    const tool = ctx.tools.find((t) => t.name === "asset_text_read")!,
      key = randomUUID();
    const first = (await tool.run({ asset_id: f.asset.id }, key)) as any;
    assert.equal(first.text, f.text);
    await sourceState(f, "quarantined");
    await assert.rejects(tool.run({ asset_id: f.asset.id }, key), (e) => {
      denied = true;
      return (e as any).code === "TASK_SOURCE_REVOKED";
    });
  });
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    next.task.id,
  );
  assert.equal(denied, true);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM task_source_reads WHERE task_id=$1",
        [next.task.id],
      )
    ).rows[0].n,
    1,
  );
  await assert.rejects(
    s.db.control.query(
      "UPDATE task_source_reads SET sha256=repeat('0',64) WHERE task_id=$1",
      [next.task.id],
    ),
    { code: "42501" },
  );
  await assert.rejects(s.db.queue.query("SELECT * FROM task_source_reads"), {
    code: "42501",
  });
  await assert.rejects(
    s.db.app.query(
      "SELECT content_source_manifest($1,$2,ARRAY[$3::uuid],'{}')",
      [f.tenant, f.project, next.task.id],
    ),
    { code: "42501" },
  );
});

test("a dynamically queried marketing dataset expiry prevents the next result event without waiting for cleanup", async () => {
  const f = await fixture(false),
    next = ok(
      await call(f.owner, "POST", f.base + "/tasks", {
        title: "Query current facts",
        prompt: "Analyze the selected marketing dataset.",
        role_key: "marketing-analyst",
        mode: "ask",
        budget_micros: 1000000,
      }),
    );
  const dataset = ok(
    await call(f.owner, "POST", f.base + "/analytics/import", {
      name: "Read-only metrics source",
      currency: "HKD",
      csv: "date,channel,spend,impressions,clicks,conversions,revenue\n2026-10-21,Search,12.50,1000,50,5,80.00\n",
    }),
  );
  let read = false;
  const runtime = new ReadingRuntime(undefined, async (ctx) => {
    const facts = (await ctx.tools
      .find((t) => t.name === "marketing_metrics")!
      .run({ dataset_id: dataset.id }, randomUUID())) as any;
    assert.ok(JSON.stringify(facts).includes(dataset.id));
    read = true;
    await s.db.control.query(
      "UPDATE analytics_datasets SET retention_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [dataset.id],
    );
  });
  await new Worker(s.db, s.catalog, s.storage, runtime).run(f.tenant, next.id);
  assert.equal(read, true);
  assert.notEqual(
    (
      await s.db.control.query("SELECT status FROM tasks WHERE id=$1", [
        next.id,
      ])
    ).rows[0].status,
    "succeeded",
  );
  assert.deepEqual(
    (
      await s.db.control.query(
        "SELECT kind,resource_id FROM task_source_reads WHERE task_id=$1",
        [next.id],
      )
    ).rows,
    [{ kind: "dataset", resource_id: dataset.id }],
  );
});

test("publishing a derivative flattens known inputs and survives removal of the original private conversation while still fencing the original file", async () => {
  const f = await fixture(false);
  const publish = (id: string) =>
    call(f.owner, "POST", f.base + "/assets/" + id + "/publish", {
      name: "Explicit shared independent copy.txt",
      expected_version: 1,
    });
  const first = ok(await publish(f.output.asset_id));
  const next = ok(
    await call(f.owner, "POST", f.base + "/delegations", {
      title: "Derivative for independent publication",
      prompt: "Read the published content and prepare its follow-up.",
      mode: "execute",
      budget_micros: 1000000,
      client_message_id: randomUUID(),
    }),
  );
  const runtime = new ReadingRuntime({
    id: first.id,
    text: "Read result: " + f.text,
  });
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    next.task.id,
  );
  const output = (
    await s.db.control.query(
      "SELECT asset_id FROM asset_versions WHERE metadata->>'task_id'=$1",
      [next.task.id],
    )
  ).rows[0];
  assert.ok(output);
  const second = ok(await publish(output.asset_id));
  assert.ok(
    second.version.metadata.publication_sources.versions.includes(f.version),
  );
  const shared = ok(
      await call(f.owner, "POST", f.base + "/assets/" + second.id + "/shares", {
        expires_in_hours: 1,
      }),
    ),
    sharePath = new URL(shared.url).pathname;
  assert.ok(ok(await call(undefined, "GET", sharePath)).includes(f.text));
  const version = ok(await call(f.owner, "GET", f.route)).version;
  ok(await call(f.owner, "DELETE", f.route, { expected_version: version }));
  assert.ok(ok(await call(undefined, "GET", sharePath)).includes(f.text));
  assert.ok(
    ok(
      await call(f.owner, "GET", f.base + "/assets/" + first.id + "/download"),
    ).includes(f.text),
  );
  await sourceState(f, "quarantined");
  assert.equal((await call(undefined, "GET", sharePath)).status, 404);
  await sourceState(f, "active");
  assert.ok(ok(await call(undefined, "GET", sharePath)).includes(f.text));
});

test("revoked current memory keeps its context error and blocks the next actual tool call, with cancellation metadata still readable", async () => {
  const f = await fixture(false, "Pinned live memory " + randomUUID()),
    next = ok(await follow(f));
  let checked = false;
  const runtime = new ReadingRuntime(
    { id: f.asset.id, text: f.text },
    async (ctx) => {
      await s.db.control.query(
        "UPDATE memories SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [f.memory.id],
      );
      await assert.rejects(
        ctx.tools
          .find((t) => t.name === "project_assets")!
          .run({}, randomUUID()),
        (e) => (e as any).code === "CONTEXT_REVOKED",
      );
      checked = true;
    },
  );
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    next.task.id,
  );
  assert.equal(checked, true);
  const task = ok(
    await call(f.owner, "GET", f.base + "/tasks/" + next.task.id),
  );
  assert.equal(task.status, "cancelled");
  assert.equal(task.output, "");
  assert.equal(task.source_unavailable, true);
  assert.equal(task.error_code, "CONTEXT_REVOKED");
});
