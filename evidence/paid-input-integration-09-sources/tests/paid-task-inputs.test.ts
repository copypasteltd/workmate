import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { listenLoopbackHTTP } from "../src/loopback-http.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { Worker } from "../src/worker.js";
import { defaults } from "../src/plans.js";
import { hash } from "../src/lib.js";
import { unzipSync } from "fflate";
import { PNG } from "pngjs";
import { saveAsset } from "../src/storage.js";
import { ErasureService } from "../src/erasure.js";
import { recoverQueuedClaims } from "../src/task-recovery.js";
import {
  CodexRuntimeAdapter,
  type RuntimeContext,
  type RuntimeResult,
} from "../src/runtime.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>;
let s: Awaited<ReturnType<typeof buildApp>>;
let gateway: ReturnType<typeof createServer>;
const nativeRequests: any[] = [];
let imageRequests = 0;
let nativeSelectedAssetId = "";
const retainedWrite = {
  filename: "retained-native.txt",
  content: "Completed before the input gap.",
  mime_type: "text/plain",
};
function nativeResponse(res: ServerResponse, item: any) {
  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
  });
  let sequence = 0;
  const event = (type: string, data: any) =>
    res.write(
      `event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...data })}\n\n`,
    );
  const response = {
    id: "resp_" + randomUUID(),
    object: "response",
    model: "controlled-fixture",
    created_at: Math.floor(Date.now() / 1000),
    status: "in_progress",
    output: [],
  };
  event("response.created", { response });
  event("response.output_item.added", {
    output_index: 0,
    item: {
      ...item,
      ...(item.type === "function_call"
        ? { arguments: "" }
        : { content: [], status: "in_progress" }),
    },
  });
  if (item.type === "function_call") {
    event("response.function_call_arguments.delta", {
      output_index: 0,
      item_id: item.id,
      delta: item.arguments,
    });
    event("response.function_call_arguments.done", {
      output_index: 0,
      item_id: item.id,
      arguments: item.arguments,
    });
  } else {
    event("response.content_part.added", {
      output_index: 0,
      item_id: item.id,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    });
    event("response.output_text.delta", {
      output_index: 0,
      item_id: item.id,
      content_index: 0,
      delta: item.content[0].text,
    });
    event("response.output_text.done", {
      output_index: 0,
      item_id: item.id,
      content_index: 0,
      text: item.content[0].text,
    });
  }
  event("response.output_item.done", { output_index: 0, item });
  event("response.completed", {
    response: {
      ...response,
      status: "completed",
      output: [item],
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        total_tokens: 150,
        input_tokens_details: { cached_tokens: 0 },
        output_tokens_details: { reasoning_tokens: 0 },
      },
    },
  });
  res.end();
}
type Client = { id: string; cookie: string; csrf: string };
async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  tenant?: string,
  requestKey = randomUUID(),
) {
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: "http://localhost:4317",
      "idempotency-key": requestKey,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      ...(tenant ? { "x-tenant-id": tenant } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: raw.statusCode, data: raw.json(), raw };
}
function value(r: Awaited<ReturnType<typeof call>>, status = 200) {
  assert.equal(r.status, status, JSON.stringify(r.data));
  return r.data;
}
async function user(): Promise<Client> {
  const c = value(
    await call(undefined, "POST", "/v1/auth/challenge", {
      email: `paid-input-${randomUUID()}@example.invalid`,
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
  const d = value(r);
  return {
    id: d.user.id,
    cookie: r.raw.cookies[0].name + "=" + r.raw.cookies[0].value,
    csrf: d.csrf_token,
  };
}
async function fixture() {
  const owner = await user();
  const w = value(
    await call(owner, "POST", "/v1/tenants", {
      name: "Paid input continuity",
      project_name: "Retained work",
    }),
  );
  const tenant = w.tenant.id,
    project = w.project.id;
  await s.db.control.query(
    "UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1",
    [tenant],
  );
  const base = `/v1/tenants/${tenant}/projects/${project}`;
  const d = value(
    await call(owner, "POST", base + "/delegations", {
      title: "Continue the original paid task",
      prompt: "Prepare the deliverable after reading my approved material.",
      mode: "execute",
      budget_micros: 1000000,
      client_message_id: randomUUID(),
    }),
  );
  return {
    owner,
    tenant,
    project,
    base,
    task: d.task,
    conversation: d.conversation,
  };
}
async function selectedAsset(f: Awaited<ReturnType<typeof fixture>>) {
  const a = await s.db.tx(
    (tx) =>
      saveAsset(tx, s.storage, {
        tenant: f.tenant,
        project: f.project,
        user: f.owner.id,
        name: "approved.txt",
        mime: "text/plain",
        bytes: Buffer.from("APPROVED_PAID_INPUT"),
        kind: "file",
      }),
    f.tenant,
    false,
    f.owner.id,
  );
  const v = (
    await s.db.control.query(
      "SELECT id FROM asset_versions WHERE asset_id=$1",
      [a.id],
    )
  ).rows[0].id;
  return { id: a.id, version: v };
}
async function task(f: Awaited<ReturnType<typeof fixture>>) {
  return (
    await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [f.task.id])
  ).rows[0];
}
class InputRuntime extends CodexRuntimeAdapter {
  calls: RuntimeContext[] = [];
  thread = "paid-input-thread-" + randomUUID();
  constructor(
    private failSecond = false,
    private readFirst?: string,
  ) {
    super(s.db.config);
  }
  override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
    this.calls.push(ctx);
    const turn = "turn-" + this.calls.length;
    await ctx.onEvent("runtime.thread", { thread_id: this.thread });
    await ctx.onEvent("runtime.turn", { turn_id: turn });
    if (this.calls.length === 1) {
      if (this.readFirst)
        await ctx.tools
          .find((t) => t.name === "asset_text_read")!
          .run({ asset_id: this.readFirst }, "earlier-read");
      const input = ctx.tools.find((t) => t.name === "request_input");
      assert.ok(
        input,
        "A model must be able to report an essential input gap after paid work started",
      );
      await input.run(
        {
          requests: [
            {
              kind: "file",
              description: "Approved material required for the remaining work",
            },
          ],
        },
        "input-call-1",
      );
    } else {
      assert.equal(
        ctx.thread,
        this.thread,
        "Resume the actual paid thread on the same task",
      );
      assert.ok(ctx.prompt.includes("approved.txt"));
      if (this.failSecond)
        throw new Error("Controlled failure before another provider dispatch");
      await ctx.tools
        .find((t) => t.name === "deliver_text")!
        .run(
          {
            filename: "complete.txt",
            content: "Completed with the selected input",
            mime_type: "text/plain",
          },
          "final-write",
        );
    }
    return {
      text:
        this.calls.length === 1
          ? "Please select the approved source."
          : "The original work is complete.",
      status: "completed",
      inputTokens: 100,
      outputTokens: 50,
      usageKnown: true,
      accepted: true,
      thread: this.thread,
      turn,
    };
  }
}
class ScriptedRuntime extends CodexRuntimeAdapter {
  calls = 0;
  thread = "scripted-paid-" + randomUUID();
  constructor(
    private script: (ctx: RuntimeContext, attempt: number) => Promise<void>,
  ) {
    super(s.db.config);
  }
  override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
    const attempt = ++this.calls,
      turn = "turn-" + attempt;
    if (attempt > 1) assert.equal(ctx.thread, this.thread);
    await ctx.onEvent("runtime.thread", { thread_id: this.thread });
    await ctx.onEvent("runtime.turn", { turn_id: turn });
    await this.script(ctx, attempt);
    return {
      text: "Controlled paid turn " + attempt,
      status: "completed",
      thread: this.thread,
      turn,
      inputTokens: 100,
      outputTokens: 50,
      usageKnown: true,
      accepted: true,
    };
  }
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  gateway = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer controlled-fixture") {
      res.writeHead(401).end("{}");
      return;
    }
    const parts: Buffer[] = [];
    for await (const chunk of req) parts.push(Buffer.from(chunk));
    const b = JSON.parse(Buffer.concat(parts).toString() || "{}");
    if (req.url === "/v1/images/generations") {
      imageRequests++;
      assert.equal(b.model, "controlled-image-fixture");
      const png = new PNG({ width: 1024, height: 1024 });
      png.data.fill(255);
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          created: Math.floor(Date.now() / 1000),
          data: [{ b64_json: PNG.sync.write(png).toString("base64") }],
        }),
      );
      return;
    }
    if (req.url === "/v1/responses/input_tokens") {
      res.writeHead(200, { "Content-Type": "application/json" }).end(
        JSON.stringify({
          object: "response.input_tokens",
          input_tokens: 100,
        }),
      );
      return;
    }
    if (req.url !== "/v1/responses") {
      res.writeHead(404).end("{}");
      return;
    }
    nativeRequests.push(b);
    const n = nativeRequests.length;
    const wanted =
      n === 1 || n === 4
        ? "deliver_text"
        : n === 2
          ? "request_input"
          : n === 5
            ? "asset_text_read"
            : null;
    if (wanted) {
      const tool = b.tools.find(
        (t: any) =>
          t.type === "function" &&
          (t.name === wanted || t.name.endsWith("__" + wanted)),
      );
      assert.ok(tool, wanted + " must be restored on the real native thread");
      const args =
        wanted === "deliver_text"
          ? retainedWrite
          : wanted === "request_input"
            ? {
                requests: [
                  {
                    kind: "file",
                    description: "Select the approved continuation source",
                  },
                ],
              }
            : { asset_id: nativeSelectedAssetId };
      nativeResponse(res, {
        id: "fc_" + n,
        type: "function_call",
        name: tool.name,
        call_id: "native_call_" + n,
        arguments: JSON.stringify(args),
      });
    } else
      nativeResponse(res, {
        id: "msg_" + n,
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text:
              n === 3
                ? "Please supply the approved source."
                : "The original task has completed using its retained work and newly approved source.",
            annotations: [],
          },
        ],
      });
  });
  const port = await listenLoopbackHTTP(gateway);
  s = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      WORKER_ENABLED: "false",
      DEMO_MODE: "false",
      AI_BASE_URL: `http://127.0.0.1:${port}/v1`,
      AI_ALLOWED_HOSTS: "127.0.0.1",
      AI_API_KEY: "controlled-fixture",
      AI_MODEL: "controlled-fixture",
      AI_REASONING_EFFORT: "medium",
      AI_VERIFIED: "true",
      AI_INPUT_COUNT_VERIFIED: "true",
      AI_INPUT_COUNT_HKD_MICROS_PER_CALL: "0",
      AI_INPUT_HKD_MICROS_PER_MILLION: "1000000",
      AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000",
      AI_IMAGE_MODEL: "controlled-image-fixture",
      AI_IMAGE_VERIFIED: "true",
      AI_IMAGE_HKD_MICROS_PER_IMAGE: "1000",
    }),
    { worker: false },
  );
});
after(async () => {
  try {
    if (s) await s.app.close();
  } finally {
    if (gateway)
      await new Promise<void>((resolve, reject) => {
        gateway.close((e) => (e ? reject(e) : resolve()));
        gateway.closeAllConnections();
      });
    await isolated?.cleanup();
  }
});

test("a paid model input gap waits on the original task, resumes the same thread and settles one cumulative charge", async () => {
  const f = await fixture(),
    runtime = new InputRuntime(),
    worker = new Worker(s.db, s.catalog, s.storage, runtime);
  await worker.run(f.tenant, f.task.id);
  const waiting = await task(f);
  assert.equal(
    waiting.status,
    "needs_input",
    "A completed paid input-request turn must become a resumable input checkpoint",
  );
  assert.equal(waiting.attempt, 1);
  assert.equal(Number(waiting.accrued_micros), 150);
  assert.equal(Number(waiting.charged_micros), 0);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT status FROM reservations WHERE task_id=$1",
        [f.task.id],
      )
    ).rows[0].status,
    "reserved",
  );
  const dependencies = value(
    await call(f.owner, "GET", f.base + `/tasks/${f.task.id}/dependencies`),
  ).items;
  assert.equal(dependencies.length, 1);
  const a = await selectedAsset(f),
    d = dependencies[0],
    requestKey = randomUUID();
  const r = await call(
    f.owner,
    "POST",
    `/v1/task-dependencies/${d.id}/resolutions`,
    { expected_version: d.version, resource_ids: [a.version] },
    f.tenant,
    requestKey,
  );
  assert.equal(value(r, 202).id, f.task.id);
  value(
    await call(
      f.owner,
      "POST",
      `/v1/task-dependencies/${d.id}/resolutions`,
      { expected_version: d.version, resource_ids: [a.version] },
      f.tenant,
      requestKey,
    ),
    202,
  );
  await Promise.all([
    worker.run(f.tenant, f.task.id),
    worker.run(f.tenant, f.task.id),
  ]);
  const done = await task(f);
  assert.equal(done.status, "succeeded");
  assert.equal(done.attempt, 2);
  assert.equal(runtime.calls.length, 2);
  assert.equal(Number(done.charged_micros), 300);
  assert.equal(Number(done.input_tokens), 200);
  assert.equal(Number(done.output_tokens), 100);
  const financial = await s.db.control.query(
    "SELECT count(*)::int AS n,sum(amount_micros)::text AS total FROM ledger WHERE task_id=$1 AND kind='charge'",
    [f.task.id],
  );
  assert.deepEqual(financial.rows[0], { n: 1, total: "-300" });
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM reservations WHERE task_id=$1",
        [f.task.id],
      )
    ).rows[0].n,
    1,
  );
});

test("cancelling a paid input checkpoint settles its already measured work once", async () => {
  const f = await fixture(),
    runtime = new InputRuntime();
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    f.task.id,
  );
  assert.equal((await task(f)).status, "needs_input");
  value(await call(f.owner, "POST", f.base + `/tasks/${f.task.id}/cancel`, {}));
  const stopped = await task(f);
  assert.equal(stopped.status, "cancelled");
  assert.equal(Number(stopped.charged_micros), 150);
  assert.equal(runtime.calls.length, 1);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT status FROM reservations WHERE task_id=$1",
        [f.task.id],
      )
    ).rows[0].status,
    "settled",
  );
});

async function resolveFirst(f: Awaited<ReturnType<typeof fixture>>) {
  const d = value(
    await call(f.owner, "GET", f.base + `/tasks/${f.task.id}/dependencies`),
  ).items.find((d: any) => d.state === "pending");
  const a = await selectedAsset(f);
  value(
    await call(
      f.owner,
      "POST",
      `/v1/task-dependencies/${d.id}/resolutions`,
      { expected_version: d.version, resource_ids: [a.version] },
      f.tenant,
    ),
    202,
  );
  return { d, a };
}

test("a failure before another provider dispatch retains the prior paid turn's cumulative usage", async () => {
  const f = await fixture(),
    runtime = new InputRuntime(true),
    worker = new Worker(s.db, s.catalog, s.storage, runtime);
  await worker.run(f.tenant, f.task.id);
  await resolveFirst(f);
  await worker.run(f.tenant, f.task.id);
  const done = await task(f);
  assert.equal(done.status, "failed");
  assert.equal(Number(done.charged_micros), 150);
  assert.equal(Number(done.input_tokens), 100);
  assert.equal(Number(done.output_tokens), 50);
  assert.equal(runtime.calls.length, 2);
});

test("an accepted turn without complete usage never becomes an automatically resumable input checkpoint", async () => {
  const f = await fixture();
  class UnknownRuntime extends InputRuntime {
    override async start(ctx: RuntimeContext) {
      return { ...(await super.start(ctx)), usageKnown: false };
    }
  }
  await new Worker(s.db, s.catalog, s.storage, new UnknownRuntime()).run(
    f.tenant,
    f.task.id,
  );
  const stopped = await task(f);
  assert.equal(stopped.status, "reconciling");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT state FROM task_input_checkpoints WHERE task_id=$1",
        [f.task.id],
      )
    ).rows[0].state,
    "invalid",
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM task_dependencies WHERE task_id=$1",
        [f.task.id],
      )
    ).rows[0].n,
    0,
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT status FROM reservations WHERE task_id=$1",
        [f.task.id],
      )
    ).rows[0].status,
    "reconciling",
  );
});

test("models cannot select inputs themselves or perform more tool writes after requesting human input", async () => {
  const f = await fixture();
  class RestrictedRuntime extends InputRuntime {
    override async start(ctx: RuntimeContext) {
      const result = await super.start(ctx);
      await assert.rejects(
        ctx.tools
          .find((t) => t.name === "request_input")!
          .run(
            {
              requests: [
                {
                  kind: "file",
                  description: "Forged selection",
                  resource_ids: [randomUUID()],
                },
              ],
            },
            "forged-selection",
          ),
      );
      await assert.rejects(
        ctx.tools
          .find((t) => t.name === "request_input")!
          .run(
            {
              requests: [
                {
                  kind: "connection",
                  provider: "meta",
                  description: "Unbound connection capability",
                },
              ],
            },
            "forged-scope",
          ),
        /cannot use/,
      );
      await assert.rejects(
        ctx.tools
          .find((t) => t.name === "deliver_text")!
          .run(
            {
              filename: "guessed.txt",
              mime_type: "text/plain",
              content: "Invented missing content",
            },
            "write-after-request",
          ),
        /Finish the current turn/,
      );
      return result;
    }
  }
  await new Worker(s.db, s.catalog, s.storage, new RestrictedRuntime()).run(
    f.tenant,
    f.task.id,
  );
  assert.equal((await task(f)).status, "needs_input");
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM asset_versions WHERE metadata->>'task_id'=$1",
        [f.task.id],
      )
    ).rows[0].n,
    0,
  );
});

test("revoking an actually consumed source prevents paid continuation while preserving measured cancellation cost", async () => {
  const f = await fixture(),
    source = await selectedAsset(f),
    runtime = new InputRuntime(false, source.id);
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    f.task.id,
  );
  assert.equal((await task(f)).status, "needs_input");
  const d = value(
      await call(f.owner, "GET", f.base + `/tasks/${f.task.id}/dependencies`),
    ).items[0],
    a = await selectedAsset(f);
  await s.db.control.query(
    "UPDATE assets SET state='quarantined' WHERE id=$1",
    [source.id],
  );
  const denied = await call(
    f.owner,
    "POST",
    `/v1/task-dependencies/${d.id}/resolutions`,
    { expected_version: d.version, resource_ids: [a.version] },
    f.tenant,
  );
  assert.equal(denied.status, 409);
  assert.equal(denied.data.error.code, "TASK_SOURCE_REVOKED");
  value(await call(f.owner, "POST", f.base + `/tasks/${f.task.id}/cancel`, {}));
  assert.equal(Number((await task(f)).charged_micros), 150);
  assert.equal(runtime.calls.length, 1);
});

test("private and tenant boundaries still govern a paid input request and its immutable checkpoint facts", async () => {
  const f = await fixture(),
    foreign = await fixture();
  await new Worker(s.db, s.catalog, s.storage, new InputRuntime()).run(
    f.tenant,
    f.task.id,
  );
  const d = value(
      await call(f.owner, "GET", f.base + `/tasks/${f.task.id}/dependencies`),
    ).items[0],
    a = await selectedAsset(foreign);
  const foreignRead = await call(
    foreign.owner,
    "GET",
    `/v1/tasks/${f.task.id}/dependencies`,
    undefined,
    f.tenant,
  );
  assert.equal(foreignRead.status, 404);
  const foreignAsset = await call(
    f.owner,
    "POST",
    `/v1/task-dependencies/${d.id}/resolutions`,
    { expected_version: d.version, resource_ids: [a.version] },
    f.tenant,
  );
  assert.equal(foreignAsset.status, 404);
  const row = (
    await s.db.control.query(
      "SELECT * FROM task_input_checkpoints WHERE task_id=$1",
      [f.task.id],
    )
  ).rows[0];
  await assert.rejects(
    s.db.control.query(
      "UPDATE task_input_checkpoints SET accrued_micros=0 WHERE id=$1",
      [row.id],
    ),
    /immutable/,
  );
  await assert.rejects(
    s.db.control.query("DELETE FROM task_input_checkpoints WHERE id=$1", [
      row.id,
    ]),
    /immutable/,
  );
  await assert.rejects(
    s.db.queue.query("SELECT * FROM task_input_checkpoints LIMIT 1"),
    /permission denied/,
  );
  assert.equal((await task(f)).status, "needs_input");
  value(await call(f.owner, "POST", f.base + `/tasks/${f.task.id}/cancel`, {}));
});

test("a paid continuation waits for the same capacity limits without consuming another attempt or reservation", async () => {
  const f = await fixture(),
    runtime = new InputRuntime(),
    worker = new Worker(s.db, s.catalog, s.storage, runtime);
  await worker.run(f.tenant, f.task.id);
  await resolveFirst(f);
  await s.db.control.query(
    "INSERT INTO entitlements(tenant_id,plan,starts_at,ends_at,reason,plan_body) VALUES($1,'business',now()-interval '1 minute',now()+interval '1 day','Controlled paid continuation capacity fixture',$2)",
    [f.tenant, defaults.business],
  );
  const blocker = value(
    await call(f.owner, "POST", f.base + "/tasks", {
      title: "Owned capacity fixture",
      prompt: "Only occupies a fixture slot; no model was called.",
      role_key: "assistant",
      budget_micros: 1000,
    }),
  );
  await s.db.control.query(
    "UPDATE tasks SET status='running',attempt=1,fencing_token=$2,lease_until=now()+interval '1 minute' WHERE id=$1",
    [blocker.id, randomUUID()],
  );
  const prior = (
    await s.db.control.query(
      "SELECT * FROM execution_capacity_policy WHERE data_mode='configured_services'",
    )
  ).rows[0];
  try {
    await s.db.control.query(
      "UPDATE execution_capacity_policy SET tenant_slots=1,tenant_media_slots=1 WHERE data_mode='configured_services'",
    );
    await worker.run(f.tenant, f.task.id);
    const held = await task(f);
    assert.equal(held.status, "queued");
    assert.equal(held.attempt, 1);
    assert.equal(held.capacity_wait_reason, "tenant");
    assert.equal(runtime.calls.length, 1);
    await s.db.control.query(
      "UPDATE tasks SET status='queued',attempt=0,lease_until=NULL WHERE id=$1",
      [blocker.id],
    );
    value(
      await call(f.owner, "POST", f.base + `/tasks/${blocker.id}/cancel`, {}),
    );
    await worker.run(f.tenant, f.task.id);
    assert.equal((await task(f)).status, "succeeded");
    assert.equal(runtime.calls.length, 2);
  } finally {
    await s.db.control.query(
      "UPDATE tasks SET status='queued',attempt=0,lease_until=NULL WHERE id=$1 AND status='running'",
      [blocker.id],
    );
    await s.db.control.query(
      "UPDATE execution_capacity_policy SET tenant_slots=$1,tenant_media_slots=$2 WHERE data_mode='configured_services'",
      [prior.tenant_slots, prior.tenant_media_slots],
    );
    value(
      await call(f.owner, "POST", f.base + `/tasks/${blocker.id}/cancel`, {}),
    );
  }
});

test("paid native checkpoints are bounded to eight rounds and retain one cumulative charge across them", async () => {
  const f = await fixture();
  const runtime = new ScriptedRuntime(async (ctx, n) => {
    const request = ctx.tools.find((t) => t.name === "request_input")!;
    if (n <= 8)
      await request.run(
        {
          requests: [
            { kind: "file", description: "Approved input round " + n },
          ],
        },
        "round-input-" + n,
      );
    else
      await assert.rejects(
        request.run(
          {
            requests: [
              { kind: "file", description: "Beyond the bounded input rounds" },
            ],
          },
          "overflow-input",
        ),
        /bounded input-request limit/,
      );
  });
  const worker = new Worker(s.db, s.catalog, s.storage, runtime);
  for (let n = 1; n <= 8; n++) {
    await worker.run(f.tenant, f.task.id);
    const waiting = await task(f);
    assert.equal(waiting.status, "needs_input");
    assert.equal(Number(waiting.accrued_micros), n * 150);
    const dependencies = value(
      await call(f.owner, "GET", f.base + `/tasks/${f.task.id}/dependencies`),
    ).items;
    const d = dependencies.find((d: any) => d.state === "pending"),
      a = await selectedAsset(f);
    assert.ok(d);
    value(
      await call(
        f.owner,
        "POST",
        `/v1/task-dependencies/${d.id}/resolutions`,
        { expected_version: d.version, resource_ids: [a.version] },
        f.tenant,
      ),
      202,
    );
  }
  await worker.run(f.tenant, f.task.id);
  const done = await task(f);
  assert.equal(done.status, "succeeded");
  assert.equal(done.attempt, 9);
  assert.equal(Number(done.charged_micros), 1350);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM task_input_checkpoints WHERE task_id=$1",
        [f.task.id],
      )
    ).rows[0].n,
    8,
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'",
        [f.task.id],
      )
    ).rows[0].n,
    1,
  );
});

test("the database rejects an input checkpoint without a live lease even with the correct native scope", async () => {
  const f = await fixture();
  const runtime = new ScriptedRuntime(async (ctx) => {
    const live = await task(f);
    await s.db.control.query("UPDATE tasks SET lease_until=NULL WHERE id=$1", [
      f.task.id,
    ]);
    try {
      await assert.rejects(
        s.db.tx(
          async (tx) => {
            await tx.query("SELECT set_config('app.task_id',$1,true)", [
              f.task.id,
            ]);
            await tx.query(
              "INSERT INTO task_input_checkpoints(tenant_id,project_id,task_id,attempt,fencing_token,call_id,requests,runtime_thread,runtime_turn) VALUES($1,$2,$3,$4,$5,'forged-without-lease',$6,$7,$8)",
              [
                f.tenant,
                f.project,
                f.task.id,
                live.attempt,
                live.fencing_token,
                JSON.stringify([
                  { kind: "file", description: "Missing lease" },
                ]),
                live.runtime_thread,
                live.runtime_turn,
              ],
            );
          },
          f.tenant,
          false,
          f.owner.id,
        ),
        /active model turn must own/,
      );
    } finally {
      await s.db.control.query(
        "UPDATE tasks SET lease_until=now()+interval '45 seconds' WHERE id=$1",
        [f.task.id],
      );
    }
    await ctx.tools
      .find((t) => t.name === "request_input")!
      .run(
        {
          requests: [
            { kind: "file", description: "Valid after lease restoration" },
          ],
        },
        "valid-lease-input",
      );
  });
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    f.task.id,
  );
  assert.equal((await task(f)).status, "needs_input");
});

test("a completed output revoked during an input wait is not recreated from its old tool receipt", async () => {
  const f = await fixture();
  let artifact: any;
  const input = {
    filename: "once-only.txt",
    mime_type: "text/plain",
    content: "A completed artifact",
  };
  const runtime = new ScriptedRuntime(async (ctx, n) => {
    const written = await ctx.tools
      .find((t) => t.name === "deliver_text")!
      .run(input, "once-" + n);
    if (n === 1) {
      artifact = written;
      await ctx.tools
        .find((t) => t.name === "request_input")!
        .run(
          {
            requests: [
              { kind: "file", description: "Approved continuation input" },
            ],
          },
          "once-input",
        );
    }
  });
  const worker = new Worker(s.db, s.catalog, s.storage, runtime);
  await worker.run(f.tenant, f.task.id);
  await resolveFirst(f);
  await s.db.control.query(
    "UPDATE assets SET state='quarantined' WHERE id=$1",
    [artifact.id],
  );
  await worker.run(f.tenant, f.task.id);
  assert.equal((await task(f)).status, "failed");
  assert.equal(runtime.calls, 2);
  assert.equal(Number((await task(f)).charged_micros), 150);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM asset_versions WHERE metadata->>'task_id'=$1",
        [f.task.id],
      )
    ).rows[0].n,
    1,
  );
});

test("source packages reuse unchanged work but include a source edit made in the resumed turn", async () => {
  const initial = await fixture();
  value(
    await call(
      initial.owner,
      "POST",
      initial.base + `/tasks/${initial.task.id}/cancel`,
      {},
    ),
  );
  const f = {
    ...initial,
    task: value(
      await call(initial.owner, "POST", initial.base + "/tasks", {
        title: "Source package continuation",
        prompt: "Write and package authorized sources across an input gap.",
        role_key: "fullstack",
        budget_micros: 1000000,
      }),
    ),
  };
  let oldPackage: any, reused: any, newPackage: any;
  const runtime = new ScriptedRuntime(async (ctx, n) => {
    const write = ctx.tools.find((t) => t.name === "code_write")!,
      pack = ctx.tools.find((t) => t.name === "code_package")!;
    if (n === 1) {
      await write.run(
        { path: "main.ts", content: "export const version = 1;" },
        "source-initial",
      );
      oldPackage = await pack.run(
        { filename: "sources.zip" },
        "package-initial",
      );
      await ctx.tools
        .find((t) => t.name === "request_input")!
        .run(
          {
            requests: [
              { kind: "file", description: "Approve the source revision" },
            ],
          },
          "source-input",
        );
    } else {
      reused = await pack.run({ filename: "sources.zip" }, "package-repeat");
      await write.run(
        {
          path: "main.ts",
          content: "export const version = 2;",
          expected_sha256: hash("export const version = 1;"),
        },
        "source-edit",
      );
      newPackage = await pack.run(
        { filename: "sources.zip" },
        "package-revision",
      );
    }
  });
  const worker = new Worker(s.db, s.catalog, s.storage, runtime);
  await worker.run(f.tenant, f.task.id);
  assert.equal((await task(f)).status, "needs_input");
  await resolveFirst(f);
  await worker.run(f.tenant, f.task.id);
  assert.equal((await task(f)).status, "succeeded");
  assert.equal(reused.id, oldPackage.id);
  assert.notEqual(newPackage.id, oldPackage.id);
  const versions = (
    await s.db.control.query(
      "SELECT v.storage_key FROM asset_versions v WHERE v.asset_id=$1",
      [newPackage.id],
    )
  ).rows;
  const entries = unzipSync(await s.storage.get(versions[0].storage_key));
  assert.equal(
    Buffer.from(entries["main.ts"]).toString(),
    "export const version = 2;",
  );
});

test("an invalid paid checkpoint retains reconciliation in Worker and queued-recovery events", async () => {
  for (const recovery of [false, true]) {
    const f = await fixture(),
      runtime = new InputRuntime();
    const worker = new Worker(s.db, s.catalog, s.storage, runtime);
    await worker.run(f.tenant, f.task.id);
    await resolveFirst(f);
    // Controlled corruption of the mutable aggregate must not be mistaken for
    // an immutable measured checkpoint or a completed cancellation.
    await s.db.control.query(
      "UPDATE tasks SET accrued_micros=accrued_micros+1,cancel_requested=$2 WHERE id=$1",
      [f.task.id, recovery],
    );
    if (recovery) await recoverQueuedClaims(s.db);
    else await worker.run(f.tenant, f.task.id);
    const stopped = await task(f);
    assert.equal(stopped.status, "reconciling");
    assert.equal(stopped.attempt, 1);
    assert.equal(Number(stopped.charged_micros), 0);
    assert.equal(runtime.calls.length, 1);
    assert.equal(
      (
        await s.db.control.query(
          "SELECT status FROM reservations WHERE task_id=$1",
          [f.task.id],
        )
      ).rows[0].status,
      "reconciling",
    );
    const events = (
      await s.db.control.query(
        "SELECT kind,body FROM task_events WHERE task_id=$1 AND kind IN('task.finished','task.cancelled') ORDER BY seq",
        [f.task.id],
      )
    ).rows;
    assert.equal(events.length, 1);
    assert.equal(events[0].kind, "task.finished");
    assert.equal(events[0].body.status, "reconciling");
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'",
          [f.task.id],
        )
      ).rows[0].n,
      0,
    );
  }
});

test("revoking an approved input cancels paid continuation before dispatch and preserves measured spend", async () => {
  const f = await fixture(),
    runtime = new InputRuntime();
  const worker = new Worker(s.db, s.catalog, s.storage, runtime);
  await worker.run(f.tenant, f.task.id);
  const { a } = await resolveFirst(f);
  await s.db.control.query(
    "UPDATE assets SET state='quarantined' WHERE id=$1",
    [a.id],
  );
  await worker.run(f.tenant, f.task.id);
  const stopped = await task(f);
  assert.equal(stopped.status, "cancelled");
  assert.equal(stopped.attempt, 1);
  assert.equal(Number(stopped.charged_micros), 150);
  assert.equal(runtime.calls.length, 1);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT status FROM reservations WHERE task_id=$1",
        [f.task.id],
      )
    ).rows[0].status,
    "settled",
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM task_events WHERE task_id=$1 AND kind='task.cancelled'",
        [f.task.id],
      )
    ).rows[0].n,
    1,
  );
});

test("completed paid images are reused across an input gap without another provider call or duplicate charge", async () => {
  const initial = await fixture();
  value(
    await call(
      initial.owner,
      "POST",
      initial.base + `/tasks/${initial.task.id}/cancel`,
      {},
    ),
  );
  const f = {
    ...initial,
    task: value(
      await call(initial.owner, "POST", initial.base + "/tasks", {
        title: "Image continuity",
        prompt:
          "Retain the completed image while requesting approved material.",
        role_key: "designer",
        budget_micros: 1000000,
      }),
    ),
  };
  const beforeRequests = imageRequests;
  let original: any, resumed: any;
  const input = {
    prompt: "A controlled plain white square image fixture.",
    filename: "retained-image.png",
  };
  const runtime = new ScriptedRuntime(async (ctx, attempt) => {
    const generated = await ctx.tools
      .find((t) => t.name === "image2_generate")!
      .run(input, "image-call-" + attempt);
    if (attempt === 1) {
      original = generated;
      await ctx.tools
        .find((t) => t.name === "request_input")!
        .run(
          {
            requests: [
              {
                kind: "file",
                description:
                  "Select approved material after the completed image",
              },
            ],
          },
          "image-input",
        );
    } else resumed = generated;
  });
  const worker = new Worker(s.db, s.catalog, s.storage, runtime);
  await worker.run(f.tenant, f.task.id);
  const waiting = await task(f);
  assert.equal(waiting.status, "needs_input");
  assert.equal(Number(waiting.accrued_micros), 1000);
  assert.equal(Number(waiting.charged_micros), 0);
  await resolveFirst(f);
  await worker.run(f.tenant, f.task.id);
  const done = await task(f);
  assert.equal(done.status, "succeeded");
  assert.equal(done.attempt, 2);
  assert.equal(resumed.id, original.id);
  assert.equal(imageRequests - beforeRequests, 1);
  assert.equal(
    Number(done.charged_micros),
    1000,
    "Only the actual controlled provider receipt is charged",
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM tool_operations WHERE task_id=$1 AND action='image2.generate' AND state='succeeded'",
        [f.task.id],
      )
    ).rows[0].n,
    1,
  );
  assert.deepEqual(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n,sum(amount_micros)::text AS total FROM ledger WHERE task_id=$1 AND kind='charge'",
        [f.task.id],
      )
    ).rows[0],
    { n: 1, total: "-1000" },
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM asset_versions WHERE metadata->>'task_id'=$1",
        [f.task.id],
      )
    ).rows[0].n,
    1,
  );
});

test("erasing a private paid input task removes checkpoint content and tool receipts while retaining its measured ledger", async () => {
  const f = await fixture();
  const runtime = new ScriptedRuntime(async (ctx) => {
    await ctx.tools
      .find((t) => t.name === "deliver_text")!
      .run(
        {
          filename: "private-paid.txt",
          mime_type: "text/plain",
          content: "Private paid work before an input gap",
        },
        "private-write",
      );
    await ctx.tools
      .find((t) => t.name === "request_input")!
      .run(
        {
          requests: [
            { kind: "file", description: "Private additional material" },
          ],
        },
        "private-input",
      );
  });
  await new Worker(s.db, s.catalog, s.storage, runtime).run(
    f.tenant,
    f.task.id,
  );
  assert.equal((await task(f)).status, "needs_input");
  const artifact = (
    await s.db.control.query(
      "SELECT v.storage_key FROM asset_versions v WHERE v.metadata->>'task_id'=$1",
      [f.task.id],
    )
  ).rows[0];
  assert.ok(artifact);
  assert.ok((await s.storage.get(artifact.storage_key)).length > 0);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM task_tool_receipts WHERE task_id=$1",
        [f.task.id],
      )
    ).rows[0].n,
    1,
  );
  const deletion = value(
    await call(
      f.owner,
      "POST",
      "/v1/deletions",
      {
        target_type: "conversation",
        target_id: f.conversation.id,
        reason: "Erase private paid input content",
      },
      f.tenant,
    ),
    202,
  );
  const eraser = new ErasureService(s.db, s.storage);
  for (let i = 0; i < 8; i++) {
    await s.db.control.query(
      "UPDATE deletion_jobs SET next_attempt_at=now() WHERE tenant_id=$1 AND state='queued'",
      [f.tenant],
    );
    await eraser.advance(40);
  }
  assert.equal(
    value(
      await call(
        f.owner,
        "GET",
        `/v1/deletions/${deletion.id}`,
        undefined,
        f.tenant,
      ),
    ).state,
    "completed",
  );
  for (const table of [
    "task_input_checkpoints",
    "task_tool_receipts",
    "task_dependencies",
    "task_events",
  ])
    assert.equal(
      (
        await s.db.control.query(
          `SELECT count(*)::int AS n FROM ${table} WHERE task_id=$1`,
          [f.task.id],
        )
      ).rows[0].n,
      0,
    );
  const erased = await task(f);
  assert.equal(erased.content_state, "deleted");
  assert.equal(erased.prompt, "[deleted]");
  assert.equal(erased.output, null);
  assert.equal(erased.runtime_thread, null);
  assert.equal(Number(erased.charged_micros), 150);
  await assert.rejects(
    s.storage.get(artifact.storage_key),
    (e: any) => e.code === "ENOENT",
  );
  assert.deepEqual(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n,sum(amount_micros)::text AS total FROM ledger WHERE task_id=$1 AND kind='charge'",
        [f.task.id],
      )
    ).rows[0],
    { n: 1, total: "-150" },
  );
});

test(
  "real Codex resumes a paid Worker task, restores tools and reuses its completed artifact across native processes",
  { timeout: 240000 },
  async () => {
    const f = await fixture();
    const nativeEvents: { kind: string; body: unknown }[] = [];
    const observedRuntime = () =>
      new (class extends CodexRuntimeAdapter {
        override start(ctx: RuntimeContext) {
          return super.start({
            ...ctx,
            onEvent: async (kind, body) => {
              if (kind !== "message.delta") nativeEvents.push({ kind, body });
              await ctx.onEvent(kind, body);
            },
          });
        }
      })(s.db.config);
    const worker = new Worker(s.db, s.catalog, s.storage, observedRuntime());
    await worker.run(f.tenant, f.task.id);
    const first = await task(f);
    assert.equal(
      first.status,
      "needs_input",
      JSON.stringify({
        status: first.status,
        error: first.error_code,
        requests: nativeRequests.length,
        events: nativeEvents,
      }),
    );
    assert.equal(nativeRequests.length, 3);
    assert.equal(Number(first.accrued_micros), 450);
    const receiptPath = path.resolve(
      s.db.config.DATA_DIR,
      "runs",
      f.tenant,
      f.task.id,
      ".codex/copypaste-continuation.json",
    );
    const ready = JSON.parse(await readFile(receiptPath, "utf8"));
    assert.equal(ready.state, "ready");
    assert.equal(ready.thread, first.runtime_thread);
    const { a } = await resolveFirst(f);
    nativeSelectedAssetId = a.id;
    await new Worker(s.db, s.catalog, s.storage, observedRuntime()).run(
      f.tenant,
      f.task.id,
    );
    const done = await task(f);
    assert.equal(
      done.status,
      "succeeded",
      JSON.stringify({
        status: done.status,
        error: done.error_code,
        requests: nativeRequests.length,
      }),
    );
    assert.equal(done.runtime_thread, first.runtime_thread);
    assert.notEqual(done.runtime_turn, first.runtime_turn);
    assert.equal(done.attempt, 2);
    assert.equal(nativeRequests.length, 6);
    assert.equal(Number(done.charged_micros), 900);
    assert.equal(Number(done.input_tokens), 600);
    assert.equal(Number(done.output_tokens), 300);
    const artifacts = (
      await s.db.control.query(
        "SELECT v.id FROM asset_versions v JOIN assets a ON a.id=v.asset_id WHERE v.metadata->>'task_id'=$1 AND a.name='retained-native.txt'",
        [f.task.id],
      )
    ).rows;
    assert.equal(
      artifacts.length,
      1,
      "Repeated completed tool arguments on the resumed thread must reuse the first artifact",
    );
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*)::int AS n FROM task_tool_receipts WHERE task_id=$1 AND tool_name='deliver_text'",
          [f.task.id],
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await s.db.control.query(
          "SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'",
          [f.task.id],
        )
      ).rows[0].n,
      1,
    );
    assert.ok(
      JSON.stringify(nativeRequests[3].input).includes(
        "Completed before the input gap.",
      ),
      "The real resumed provider request retains the earlier tool result",
    );
    assert.ok(
      JSON.stringify(nativeRequests[5].input).includes("APPROVED_PAID_INPUT"),
      "The resumed native model receives only the human-selected authorized source",
    );
  },
);
