import { before, after, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import pg from "pg";
import * as OTPAuth from "otpauth";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig, type Config } from "../src/config.js";
import {
  CodexRuntimeAdapter,
  RuntimeFailure,
  type RuntimeContext,
  type RuntimeResult,
} from "../src/runtime.js";
import { seedRuntimeProfile } from "../src/runtime-profiles.js";
import { installIsolatedProviderPolicy } from "./provider-policy-fixture.js";
import { taskCapabilities } from "../src/capability-bindings.js";
import { Worker } from "../src/worker.js";
import { hash, canonical, seal } from "../src/lib.js";
import { tokenCharge, reserve } from "../src/billing.js";
import { freezeTaskSkills } from "../src/skill-lifecycle.js";
import { runMigrations } from "../scripts/migration-runner.js";
import { pngFromSVG } from "../src/render.js";
import { listenLoopbackHTTP } from "../src/loopback-http.js";
import {
  AIRequestFailure,
  internalAIRequest,
} from "../src/internal-ai-gateway.js";

let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>;
let s: Awaited<ReturnType<typeof buildApp>>;
let initial: Config;
let gateway: Server;
let rejectImage = false;
let nextTextTool: string | undefined;
let imageResponse: unknown | undefined;
const requests: { path: string; body: any }[] = [];
type Client = { id: string; cookie: string; csrf: string; admin?: boolean };
const fixtureKey = "controlled-capability-fixture-not-a-provider-key";

async function call(
  c: Client | undefined,
  method: string,
  url: string,
  body?: unknown,
  requestId = randomUUID(),
) {
  const raw = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: c?.admin ? s.db.config.ADMIN_ORIGIN : s.db.config.WEB_ORIGIN,
      ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}),
      "idempotency-key": requestId,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    payload: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: raw.statusCode, data: raw.json(), raw };
}
async function user(admin = false): Promise<Client> {
  const email = `capability-${randomUUID()}@example.invalid`;
  const secret = admin ? new OTPAuth.Secret({ size: 20 }) : undefined;
  let adminId: string | undefined;
  if (secret) {
    adminId = (
      await s.db.control.query(
        "INSERT INTO admin_principals(email,name,totp_secret) VALUES($1,'Capability administrator',$2) RETURNING id",
        [email, seal(s.db.config.MASTER_KEY!, secret.base32)],
      )
    ).rows[0].id;
    await s.db.control.query(
      "INSERT INTO admin_bindings(principal_id,role_key,scope_kind) VALUES($1,'super_admin','global')",
      [adminId],
    );
  }
  const prefix = admin ? "/v1/admin/auth" : "/v1/auth";
  const challenge = await call(undefined, "POST", prefix + "/challenge", {
    email,
  });
  assert.equal(challenge.status, 200, JSON.stringify(challenge.data));
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${challenge.data.challenge_id}.json`,
      "utf8",
    ),
  );
  const result = await call(undefined, "POST", prefix + "/verify", {
    challenge_id: challenge.data.challenge_id,
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
  assert.equal(result.status, 200, JSON.stringify(result.data));
  const cookie = result.raw.cookies.find(
    (v) => v.name === (admin ? "cp_admin_session" : "cp_session"),
  )!;
  return {
    id: adminId ?? result.data.user.id,
    cookie: `${cookie.name}=${cookie.value}`,
    csrf: result.data.csrf_token,
    admin,
  };
}
async function fixture() {
  const owner = await user();
  const workspace = await call(owner, "POST", "/v1/tenants", {
    name: "Capability test company",
    project_name: "Confirmed model versions",
  });
  assert.equal(workspace.status, 200, JSON.stringify(workspace.data));
  const tenant = workspace.data.tenant.id,
    project = workspace.data.project.id;
  // Explicit isolated test credit, never a claimed customer payment.
  await s.db.control.query(
    "UPDATE wallets SET credit_limit_micros=1000000000 WHERE tenant_id=$1",
    [tenant],
  );
  return {
    owner,
    tenant,
    project,
    base: `/v1/tenants/${tenant}/projects/${project}`,
  };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function createTask(
  f: Fixture,
  role = "marketing-analyst",
  extra: Record<string, unknown> = {},
) {
  const result = await call(f.owner, "POST", f.base + "/tasks", {
    title: "Frozen internal model and price",
    prompt: "Return the controlled capability fixture answer.",
    role_key: role,
    budget_micros: 1000000,
    ...extra,
  });
  assert.equal(result.status, 200, JSON.stringify(result.data));
  return result.data;
}
const task = async (id: string) =>
  (await s.db.control.query("SELECT * FROM tasks WHERE id=$1", [id])).rows[0];
const binding = async (id: string, usable = true) =>
  s.db.tx(
    async (tx) =>
      taskCapabilities(tx, s.db.config, s.catalog, await task(id), usable),
    undefined,
    true,
  );
class ControlledRuntime extends CodexRuntimeAdapter {
  calls: RuntimeContext[] = [];
  constructor(private act?: (ctx: RuntimeContext) => Promise<void>) {
    super(s.db.config);
  }
  override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
    this.calls.push(ctx);
    await this.act?.(ctx);
    return {
      text: "Controlled capability answer.",
      inputTokens: 7,
      outputTokens: 11,
      usageKnown: true,
      accepted: true,
      thread: randomUUID(),
      turn: randomUUID(),
      status: "completed",
    };
  }
}
const worker = (runtime: CodexRuntimeAdapter) =>
  new Worker(s.db, s.catalog, s.storage, runtime);
async function change(values: Partial<Config>) {
  Object.assign(s.db.config, values);
  await seedRuntimeProfile(s.db, s.catalog);
}

before(async () => {
  isolated = await isolatedTestEnvironment();
  const png = pngFromSVG(
    '<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024"><rect width="1024" height="1024" fill="#1f5eff"/></svg>',
  );
  gateway = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer " + fixtureKey) {
      res.writeHead(401).end();
      return;
    }
    const chunks: Buffer[] = [];
    for await (const bytes of req) chunks.push(Buffer.from(bytes));
    const raw = Buffer.concat(chunks).toString();
    const body = req.url === "/v1/images/edits" ? raw : JSON.parse(raw || "{}");
    requests.push({ path: req.url!, body });
    if (req.url === "/v1/responses/input_tokens") {
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(
          JSON.stringify({ object: "response.input_tokens", input_tokens: 7 }),
        );
      return;
    }
    if (req.url?.startsWith("/v1/images/")) {
      if (rejectImage) {
        res.destroy();
        return;
      }
      res
        .writeHead(200, { "Content-Type": "application/json" })
        .end(
          JSON.stringify(
            imageResponse ?? { data: [{ b64_json: png.toString("base64") }] },
          ),
        );
      return;
    }
    if (req.url !== "/v1/responses") {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
    });
    const response = {
      id: "resp_" + randomUUID(),
      object: "response",
      model: body.model,
      created_at: Math.floor(Date.now() / 1000),
      status: "in_progress",
      output: [],
    };
    const item = {
      id: "msg_" + randomUUID(),
      type: "message",
      role: "assistant",
      status: "completed",
      content: [
        {
          type: "output_text",
          text: "Controlled capability answer.",
          annotations: [],
        },
      ],
    };
    const emit = (type: string, data: any) =>
      res.write(
        `event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`,
      );
    emit("response.created", { response });
    if (nextTextTool) {
      const tool = {
        id: "fc_" + randomUUID(),
        type: "function_call",
        name: nextTextTool,
        call_id: "call_" + randomUUID(),
        arguments: "{}",
        status: "completed",
      };
      nextTextTool = undefined;
      emit("response.output_item.added", {
        output_index: 0,
        item: { ...tool, arguments: "", status: "in_progress" },
      });
      emit("response.function_call_arguments.delta", {
        item_id: tool.id,
        output_index: 0,
        delta: "{}",
      });
      emit("response.function_call_arguments.done", {
        item_id: tool.id,
        output_index: 0,
        arguments: "{}",
      });
      emit("response.output_item.done", { output_index: 0, item: tool });
      emit("response.completed", {
        response: {
          ...response,
          status: "completed",
          output: [tool],
          usage: {
            input_tokens: 7,
            output_tokens: 11,
            total_tokens: 18,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens_details: { reasoning_tokens: 0 },
          },
        },
      });
      res.end();
      return;
    }
    emit("response.output_item.added", {
      output_index: 0,
      item: { ...item, status: "in_progress", content: [] },
    });
    emit("response.content_part.added", {
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      part: { type: "output_text", text: "", annotations: [] },
    });
    emit("response.output_text.delta", {
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      delta: item.content[0].text,
    });
    emit("response.output_text.done", {
      item_id: item.id,
      output_index: 0,
      content_index: 0,
      text: item.content[0].text,
    });
    emit("response.output_item.done", { output_index: 0, item });
    emit("response.completed", {
      response: {
        ...response,
        status: "completed",
        output: [item],
        usage: {
          input_tokens: 7,
          output_tokens: 11,
          total_tokens: 18,
          input_tokens_details: { cached_tokens: 0 },
          output_tokens_details: { reasoning_tokens: 0 },
        },
      },
    });
    res.end();
  });
  await listenLoopbackHTTP(gateway);
  s = await buildApp(
    loadConfig({
      ...isolated.env,
      NODE_ENV: "test",
      WORKER_ENABLED: "false",
      DEMO_MODE: "false",
      AI_BASE_URL: `http://127.0.0.1:${(gateway.address() as any).port}/v1`,
      AI_ALLOWED_HOSTS: "127.0.0.1",
      AI_API_KEY: fixtureKey,
      AI_MODEL: "copypaste-contract-fixture",
      AI_REASONING_EFFORT: "high",
      AI_VERIFIED: "true",
      AI_INPUT_COUNT_VERIFIED: "true",
      AI_INPUT_COUNT_HKD_MICROS_PER_CALL: "0",
      AI_INPUT_HKD_MICROS_PER_MILLION: "1000000",
      AI_OUTPUT_HKD_MICROS_PER_MILLION: "2000000",
      AI_IMAGE_MODEL: "image-original-fixture",
      AI_IMAGE_VERIFIED: "true",
      AI_IMAGE_HKD_MICROS_PER_IMAGE: "200",
    }),
    { worker: false },
  );
  initial = { ...s.db.config };
  await installIsolatedProviderPolicy(s.db);
  // This isolated suite deliberately keeps five unknown image operations.
  // Give its fixture eight image slots so each counterexample executes; retain
  // every reconciliation fact and leave the production policy unchanged.
  await s.db.control.query(
    "UPDATE execution_capacity_policy SET image_slots=8 WHERE data_mode='configured_services'",
  );
});
afterEach(async () => {
  rejectImage = false;
  nextTextTool = undefined;
  imageResponse = undefined;
  if (s && initial) {
    Object.assign(s.db.config, initial);
    await seedRuntimeProfile(s.db, s.catalog);
  }
});
after(async () => {
  try {
    if (s) await s.app.close();
  } finally {
    gateway?.closeAllConnections();
    if (gateway)
      await new Promise<void>((resolve, reject) =>
        gateway.close((e) => (e ? reject(e) : resolve())),
      );
    await isolated?.cleanup();
  }
});

test(
  "real pinned Codex sends the queued task's original model and effort and settlement uses its original prices after a configuration change",
  { timeout: 120000 },
  async () => {
    const f = await fixture(),
      queued = await createTask(f),
      old = await binding(queued.id);
    await change({
      AI_MODEL: "replacement-model-fixture",
      AI_REASONING_EFFORT: "low",
      AI_INPUT_HKD_MICROS_PER_MILLION: 5000000,
      AI_OUTPUT_HKD_MICROS_PER_MILLION: 6000000,
    });
    const start = requests.length;
    await worker(new CodexRuntimeAdapter(s.db.config)).run(f.tenant, queued.id);
    const completed = await task(queued.id);
    assert.equal(completed.status, "succeeded", completed.error_code);
    assert.equal(completed.charged_micros, "29");
    const sent = requests
      .slice(start)
      .filter((r) => r.path === "/v1/responses");
    assert.ok(sent.length > 0);
    assert.ok(
      sent.every(
        (r) =>
          r.body.model === old.text.body.model_alias &&
          r.body.reasoning?.effort === "high",
      ),
    );
    assert.equal((await binding(queued.id)).text.id, old.text.id);
    assert.equal(
      s.db.config.AI_MODEL,
      "replacement-model-fixture",
      "shared adapter configuration was not mutated",
    );
  },
);

test(
  "real pinned Codex cannot dispatch its next response after the original user's authority is revoked; the first measured response is still charged",
  { timeout: 120000 },
  async () => {
    const f = await fixture(),
      queued = await createTask(f);
    let toolFinished = false;
    class RevokingRuntime extends CodexRuntimeAdapter {
      override start(ctx: RuntimeContext) {
        return super.start({
          ...ctx,
          tools: ctx.tools.map((tool) =>
            tool.name !== "project_assets"
              ? tool
              : {
                  ...tool,
                  run: async (args: unknown, callId: string) => {
                    const result = await tool.run(args, callId);
                    await s.db.control.query(
                      "UPDATE users SET auth_version=auth_version+1 WHERE id=$1",
                      [f.owner.id],
                    );
                    toolFinished = true;
                    return result;
                  },
                },
          ),
        });
      }
    }
    nextTextTool = "project_assets";
    const start = requests.length;
    await worker(new RevokingRuntime(s.db.config)).run(f.tenant, queued.id);
    assert.equal(toolFinished, true);
    assert.equal(
      requests.slice(start).filter((r) => r.path === "/v1/responses").length,
      1,
    );
    const completed = await task(queued.id);
    assert.equal(completed.status, "cancelled", completed.error_code);
    assert.equal(completed.charged_micros, "29");
    const events = (
      await s.db.control.query(
        "SELECT kind,body FROM task_events WHERE task_id=$1 AND kind LIKE 'gateway.%' ORDER BY created_at",
        [queued.id],
      )
    ).rows;
    assert.equal(
      events.filter((e) => e.kind === "gateway.request_authorized").length,
      1,
    );
    assert.ok(
      events.some(
        (e) =>
          e.kind === "gateway.request_rejected" &&
          e.body.code === "AI_REQUEST_AUTHORIZATION_CHANGED" &&
          e.body.dispatched === false,
      ),
    );
    assert.notEqual(
      (
        await s.db.control.query(
          "SELECT status FROM reservations WHERE task_id=$1",
          [queued.id],
        )
      ).rows[0].status,
      "reconciling",
    );
  },
);

test(
  "cancelling after real Codex thread creation but before any provider dispatch releases the original reservation as known zero spend",
  { timeout: 120000 },
  async () => {
    const f = await fixture(),
      queued = await createTask(f),
      controller = new AbortController();
    let started = false,
      failure: Record<string, unknown> | undefined;
    class CancellingRuntime extends CodexRuntimeAdapter {
      override async start(ctx: RuntimeContext) {
        try {
          return await super.start({
            ...ctx,
            signal: AbortSignal.any([ctx.signal, controller.signal]),
            onEvent: async (kind, body) => {
              await ctx.onEvent(kind, body);
              if (kind === "runtime.thread") {
                started = true;
                const cancelled = await call(
                  f.owner,
                  "POST",
                  f.base + "/tasks/" + queued.id + "/cancel",
                );
                assert.equal(
                  cancelled.status,
                  200,
                  JSON.stringify(cancelled.data),
                );
                controller.abort();
              }
            },
          });
        } catch (error) {
          if (error instanceof RuntimeFailure)
            failure = {
              code: error.code,
              accepted: error.accepted,
              usageKnown: error.usageKnown,
              input: error.inputTokens,
              output: error.outputTokens,
            };
          throw error;
        }
      }
    }
    const first = requests.length;
    await worker(new CancellingRuntime(s.db.config)).run(f.tenant, queued.id);
    assert.equal(started, true);
    assert.equal(requests.length, first);
    assert.deepEqual(failure, {
      code: "CODEX_CANCELLED",
      accepted: false,
      usageKnown: true,
      input: 0,
      output: 0,
    });
    const completed = await task(queued.id);
    assert.equal(completed.attempt, 1);
    assert.equal(completed.status, "cancelled", completed.error_code);
    assert.equal(completed.charged_micros, "0");
    assert.equal(
      (
        await s.db.control.query(
          "SELECT status FROM reservations WHERE task_id=$1",
          [queued.id],
        )
      ).rows[0].status,
      "released",
    );
  },
);

test("each real worker inference request rechecks the current identity, membership, task lease, fencing, cancellation and budget scope", async (t) => {
  const mutations = [
    [
      "user authentication version",
      "UPDATE users SET auth_version=auth_version+1 WHERE id=$1",
      "UPDATE users SET auth_version=auth_version-1 WHERE id=$1",
      "user",
    ],
    [
      "user suspension",
      "UPDATE users SET status='suspended' WHERE id=$1",
      "UPDATE users SET status='active' WHERE id=$1",
      "user",
    ],
    [
      "removed membership",
      "UPDATE memberships SET status='removed' WHERE tenant_id=$1",
      "UPDATE memberships SET status='active' WHERE tenant_id=$1",
      "tenant",
    ],
    [
      "workspace suspension",
      "UPDATE tenants SET status='suspended' WHERE id=$1",
      "UPDATE tenants SET status='active' WHERE id=$1",
      "tenant",
    ],
    [
      "archived project",
      "UPDATE projects SET archived=true WHERE id=$1",
      "UPDATE projects SET archived=false WHERE id=$1",
      "project",
    ],
    [
      "task cancellation",
      "UPDATE tasks SET cancel_requested=true WHERE id=$1",
      "UPDATE tasks SET cancel_requested=false WHERE id=$1",
      "task",
    ],
    [
      "expired task lease",
      "UPDATE tasks SET lease_until=now()-interval '1 minute' WHERE id=$1",
      "UPDATE tasks SET lease_until=now()+interval '45 seconds' WHERE id=$1",
      "task",
    ],
    [
      "stale fencing",
      "UPDATE tasks SET fencing_token=gen_random_uuid() WHERE id=$1",
      "UPDATE tasks SET fencing_token=$2 WHERE id=$1",
      "task",
    ],
    [
      "non-reserved budget",
      "UPDATE reservations SET status='reconciling' WHERE task_id=$1",
      "UPDATE reservations SET status='reserved' WHERE task_id=$1",
      "task",
    ],
  ] as const;
  for (const [name, apply, undo, target] of mutations)
    await t.test(name, async () => {
      const f = await fixture(),
        queued = await createTask(f);
      let checked = false;
      const runtime = new ControlledRuntime(async (ctx) => {
        const identity = ctx.requestAuthority!;
        assert.ok(identity);
        const id =
          target === "user"
            ? f.owner.id
            : target === "tenant"
              ? f.tenant
              : target === "project"
                ? f.project
                : queued.id;
        const start = requests.length;
        await s.db.control.query(apply, [id]);
        try {
          await assert.rejects(
            internalAIRequest(s.db.config, {
              operation: "responses",
              model: ctx.selection!.model,
              reasoningEffort: ctx.selection!.reasoningEffort,
              tools: [],
              authority: identity,
              signal: ctx.signal,
              body: {
                model: ctx.selection!.model,
                reasoning: { effort: ctx.selection!.reasoningEffort },
                stream: true,
                input: "Must be rejected before any provider dispatch",
                tools: [],
              },
            }),
            (error: unknown) =>
              error instanceof AIRequestFailure &&
              error.code === "AI_REQUEST_AUTHORIZATION_CHANGED" &&
              !error.dispatched,
          );
          assert.equal(requests.length, start);
          checked = true;
        } finally {
          await s.db.control.query(
            undo,
            target === "task" && name === "stale fencing"
              ? [id, identity.fencingToken]
              : [id],
          );
        }
      });
      await worker(runtime).run(f.tenant, queued.id);
      assert.equal(checked, true);
      assert.equal((await task(queued.id)).status, "succeeded");
    });
});

test("new tasks use a different immutable identity when only effort or rates change; retries retain the original binding", async () => {
  const f = await fixture(),
    first = await createTask(f),
    a = await binding(first.id);
  const runtime = new ControlledRuntime();
  await worker(runtime).run(f.tenant, first.id);
  assert.equal((await task(first.id)).charged_micros, "29");
  await change({ AI_REASONING_EFFORT: "low" });
  const second = await createTask(f),
    b = await binding(second.id);
  assert.notEqual(a.text.id, b.text.id);
  assert.equal(a.text.body.model_alias, b.text.body.model_alias);
  await worker(runtime).run(f.tenant, second.id);
  assert.equal((await task(second.id)).charged_micros, "29");
  await change({
    AI_INPUT_HKD_MICROS_PER_MILLION: 3000000,
    AI_OUTPUT_HKD_MICROS_PER_MILLION: 4000000,
  });
  const third = await createTask(f),
    c = await binding(third.id);
  assert.notEqual(b.text.id, c.text.id);
  await worker(runtime).run(f.tenant, third.id);
  assert.equal((await task(third.id)).charged_micros, "65");
  assert.equal(runtime.calls.at(-1)?.selection?.reasoningEffort, "low");
  const retry = await createTask(f, "marketing-analyst", {
    parent_id: first.id,
  });
  assert.deepEqual((await binding(retry.id)).versionIds, a.versionIds);
  await worker(runtime).run(f.tenant, retry.id);
  assert.equal((await task(retry.id)).charged_micros, "29");
});

test("actual image generation and edit keep the original internal image alias, operation rate and artifact provenance", async () => {
  const f = await fixture(),
    queued = await createTask(f, "designer"),
    old = await binding(queued.id);
  await change({
    AI_IMAGE_MODEL: "replacement-image-fixture",
    AI_IMAGE_HKD_MICROS_PER_IMAGE: 9000,
  });
  let generatedId = "";
  const runtime = new ControlledRuntime(async (ctx) => {
    const result: any = await ctx.tools
      .find((t) => t.name === "image2_generate")!
      .run(
        {
          prompt: "Generate the original image pricing fixture.",
          filename: "original.png",
        },
        "generate-fixture",
      );
    generatedId = result.id;
    await ctx.tools
      .find((t) => t.name === "image2_edit")!
      .run(
        {
          asset_id: result.id,
          prompt: "Edit the original image pricing fixture.",
          filename: "edited.png",
        },
        "edit-fixture",
      );
  });
  const start = requests.length;
  await worker(runtime).run(f.tenant, queued.id);
  const completed = await task(queued.id);
  assert.equal(completed.status, "succeeded", completed.error_code);
  assert.equal(completed.charged_micros, "429");
  const images = requests
    .slice(start)
    .filter((r) => r.path.startsWith("/v1/images/"));
  assert.equal(images.length, 2);
  assert.equal(images[0].body.model, "image-original-fixture");
  assert.equal(images[0].body.size, "1024x1024");
  assert.equal(images[0].body.quality, "high");
  assert.equal(images[0].body.n, 1);
  assert.equal(images[0].body.output_format, "png");
  assert.match(
    images[1].body,
    /name="model"\r\n\r\nimage-original-fixture\r\n/,
  );
  for (const [key, value] of Object.entries({
    size: "1024x1024",
    quality: "high",
    n: "1",
    output_format: "png",
  }))
    assert.ok(images[1].body.includes(`name="${key}"\r\n\r\n${value}\r\n`));
  const saved = (
    await s.db.control.query(
      "SELECT metadata FROM asset_versions WHERE asset_id=$1",
      [generatedId],
    )
  ).rows[0].metadata;
  assert.equal(saved.capability_version_id, old.image!.id);
  assert.equal(saved.model, "image-original-fixture");
  assert.deepEqual(
    (
      await s.db.control.query(
        "SELECT charge_micros FROM tool_operations WHERE task_id=$1 ORDER BY created_at",
        [queued.id],
      )
    ).rows.map((r) => r.charge_micros),
    ["200", "200"],
  );
});

test("accepted malformed, non-canonical, wrong-size and multiple images retain an uncertain charge and never create an asset", async (t) => {
  const tiny = pngFromSVG(
    '<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="red"/></svg>',
  );
  const encoded = tiny.toString("base64");
  const payloads = [
    { data: [{ b64_json: encoded }] },
    { data: [{ b64_json: encoded + "\n" }] },
    { data: [{ b64_json: tiny.subarray(0, 8).toString("base64") }] },
    { data: [{ b64_json: encoded }, { b64_json: encoded }] },
  ];
  for (let i = 0; i < payloads.length; i++)
    await t.test(`invalid image ${i + 1}`, async () => {
      const f = await fixture(),
        queued = await createTask(f, "designer");
      imageResponse = payloads[i];
      const runtime = new ControlledRuntime(async (ctx) => {
        const tool = ctx.tools.find((tool) => tool.name === "image2_generate")!;
        await assert.rejects(
          tool.run(
            {
              prompt: "Controlled invalid image result",
              filename: "invalid.png",
            },
            "invalid-image-fixture",
          ),
        );
      });
      const start = requests.length;
      await worker(runtime).run(f.tenant, queued.id);
      assert.equal((await task(queued.id)).status, "reconciling");
      assert.equal(
        requests.slice(start).filter((r) => r.path.startsWith("/v1/images/"))
          .length,
        1,
      );
      assert.deepEqual(
        (
          await s.db.control.query(
            "SELECT state,charge_micros FROM tool_operations WHERE task_id=$1",
            [queued.id],
          )
        ).rows,
        [{ state: "reconciling", charge_micros: "200" }],
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
    });
});

test("an accepted image with a lost result keeps reconciliation and its original reserved operation price", async () => {
  const f = await fixture(),
    queued = await createTask(f, "designer");
  await change({ AI_IMAGE_HKD_MICROS_PER_IMAGE: 9000 });
  rejectImage = true;
  const runtime = new ControlledRuntime(async (ctx) => {
    await ctx.tools
      .find((t) => t.name === "image2_generate")!
      .run(
        {
          prompt: "Create the uncertain image result fixture.",
          filename: "uncertain.png",
        },
        "uncertain-fixture",
      );
  });
  await worker(runtime).run(f.tenant, queued.id);
  assert.equal((await task(queued.id)).status, "reconciling");
  const op = (
    await s.db.control.query(
      "SELECT state,charge_micros FROM tool_operations WHERE task_id=$1",
      [queued.id],
    )
  ).rows[0];
  assert.deepEqual(op, { state: "reconciling", charge_micros: "200" });
  assert.equal(
    (
      await s.db.control.query(
        "SELECT status FROM reservations WHERE task_id=$1",
        [queued.id],
      )
    ).rows[0].status,
    "reconciling",
  );
});

test("revocation blocks execution while preserving original settlement for already accepted usage", async () => {
  await change({ AI_MODEL: "revocation-fixture-" + randomUUID() });
  const f = await fixture(),
    queued = await createTask(f),
    old = await binding(queued.id);
  const runtime = new ControlledRuntime(async () => {
    await s.db.control.query(
      "UPDATE internal_capability_versions SET revoked=true WHERE id=$1",
      [old.text.id],
    );
    await change({
      AI_MODEL: "post-revocation-fixture-" + randomUUID(),
      AI_INPUT_HKD_MICROS_PER_MILLION: 9000000,
    });
  });
  await worker(runtime).run(f.tenant, queued.id);
  const completed = await task(queued.id);
  assert.equal(completed.status, "cancelled");
  assert.equal(completed.charged_micros, "29");
  await assert.rejects(
    binding(queued.id),
    (e: any) => e.code === "TASK_CAPABILITY_BINDING_UNAVAILABLE",
  );
  assert.equal((await binding(queued.id, false)).text.id, old.text.id);
  const before = (
    await s.db.control.query(
      "SELECT count(*)::int AS n FROM tasks WHERE tenant_id=$1",
      [f.tenant],
    )
  ).rows[0].n;
  const retry = await call(f.owner, "POST", f.base + "/tasks", {
    title: "Blocked old capability",
    prompt: "Do not silently change the revoked model.",
    role_key: "marketing-analyst",
    budget_micros: 1000000,
    parent_id: queued.id,
  });
  assert.equal(retry.status, 409);
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*)::int AS n FROM tasks WHERE tenant_id=$1",
        [f.tenant],
      )
    ).rows[0].n,
    before,
    "binding and task insertion roll back together",
  );
});

test("an actual admin retry and idempotent replay preserve the original capability after configuration changes", async () => {
  const f = await fixture(),
    queued = await createTask(f),
    old = await binding(queued.id),
    admin = await user(true);
  const runtime = new ControlledRuntime(async () => {
    throw new RuntimeFailure("CONTROLLED_PRE_ACCEPT_FAILURE", false, true);
  });
  await worker(runtime).run(f.tenant, queued.id);
  const failed = await task(queued.id);
  assert.equal(failed.status, "failed");
  await change({
    AI_MODEL: "new-admin-default-fixture",
    AI_REASONING_EFFORT: "low",
    AI_OUTPUT_HKD_MICROS_PER_MILLION: 9000000,
  });
  const requestId = randomUUID(),
    input = {
      action: "retry",
      version: failed.version,
      reason: "Retry with original confirmed version",
    };
  const result = await call(
    admin,
    "POST",
    "/v1/admin/execution/" + queued.id + "/action",
    input,
    requestId,
  );
  assert.equal(result.status, 200, JSON.stringify(result.data));
  assert.deepEqual((await binding(result.data.id)).versionIds, old.versionIds);
  const replay = await call(
    admin,
    "POST",
    "/v1/admin/execution/" + queued.id + "/action",
    input,
    requestId,
  );
  assert.equal(replay.status, 200, JSON.stringify(replay.data));
  assert.deepEqual(replay.data, result.data);
});

test("bindings enforce database immutability, private-task RLS and gateway identity without exposing server credentials", async () => {
  const f = await fixture(),
    other = await user();
  const agent = await call(f.owner, "POST", f.base + "/agents", {
    name: "Private capability fixture",
    role_key: "marketing-analyst",
  });
  assert.equal(agent.status, 200, JSON.stringify(agent.data));
  const conversation = await call(f.owner, "POST", f.base + "/conversations", {
    name: "Private version fixture",
    agent_id: agent.data.id,
  });
  assert.equal(conversation.status, 200, JSON.stringify(conversation.data));
  const sent = await call(
    f.owner,
    "POST",
    f.base + "/conversations/" + conversation.data.id + "/messages",
    {
      client_message_id: randomUUID(),
      expected_version: 1,
      intent: "delegate",
      mode: "execute",
      body: "Keep this capability selection private.",
      budget_micros: 1000000,
    },
  );
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  const id = sent.data.task.id;
  await s.db.tx(
    async (tx) =>
      assert.equal(
        (
          await tx.query(
            "SELECT * FROM task_runtime_bindings WHERE task_id=$1",
            [id],
          )
        ).rowCount,
        0,
      ),
    f.tenant,
    false,
    other.id,
  );
  await s.db.tx(
    async (tx) =>
      assert.equal(
        (
          await tx.query(
            "SELECT * FROM task_runtime_bindings WHERE task_id=$1",
            [id],
          )
        ).rowCount,
        1,
      ),
    f.tenant,
    false,
    f.owner.id,
  );
  await s.db.tx(
    async (tx) =>
      assert.equal(
        (
          await tx.query(
            "SELECT * FROM task_runtime_bindings WHERE task_id=$1",
            [id],
          )
        ).rowCount,
        0,
      ),
    randomUUID(),
    false,
    f.owner.id,
  );
  const owner = new pg.Client({
    connectionString: isolated.env.OWNER_DATABASE_URL,
  });
  await owner.connect();
  try {
    await assert.rejects(
      owner.query(
        "UPDATE task_runtime_bindings SET capability_version_ids='{}' WHERE task_id=$1",
        [id],
      ),
      (e: any) => e.code === "23514",
    );
    await assert.rejects(
      owner.query("DELETE FROM task_runtime_bindings WHERE task_id=$1", [id]),
      (e: any) => e.code === "23514",
    );
  } finally {
    await owner.end();
  }
  const frozen = await binding(id);
  assert.ok(!canonical(frozen).includes(fixtureKey));
  assert.ok(!canonical(frozen).includes(s.db.config.AI_BASE_URL!));
  s.db.config.AI_BASE_URL = "http://127.0.0.1:9/v1";
  await assert.rejects(
    binding(id),
    (e: any) => e.code === "TASK_GATEWAY_CHANGED",
  );
  assert.equal((await binding(id, false)).text.id, frozen.text.id);
});

test("legacy queued tasks without historical bindings fail before any runtime call and release only unused reservation", async () => {
  const f = await fixture();
  const legacy = await s.db.tx(
    async (tx) => {
      const row = (
        await tx.query(
          "INSERT INTO tasks(tenant_id,project_id,created_by,title,prompt,role_key,role_hash,budget_micros,idempotency_key) VALUES($1,$2,$3,'Historical queued task','Do not invent old model prices','marketing-analyst',$4,1000000,$5) RETURNING *",
          [
            f.tenant,
            f.project,
            f.owner.id,
            s.catalog.digest(s.catalog.role("marketing-analyst")),
            randomUUID(),
          ],
        )
      ).rows[0];
      await freezeTaskSkills(tx, s.catalog, row);
      await reserve(tx, f.tenant, row.id, 1000000);
      return row;
    },
    f.tenant,
    true,
    f.owner.id,
  );
  const runtime = new ControlledRuntime();
  await worker(runtime).run(f.tenant, legacy.id);
  assert.equal(runtime.calls.length, 0);
  assert.equal(
    (await task(legacy.id)).error_code,
    "TASK_CAPABILITY_BINDING_REQUIRED",
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT status FROM reservations WHERE task_id=$1",
        [legacy.id],
      )
    ).rows[0].status,
    "released",
  );
});

test("a populated 062 upgrade preserves every old public table and does not fabricate bindings for historical tasks", async () => {
  const previous = await isolatedTestEnvironment({ throughVersion: 62 });
  const owner = new pg.Client({
    connectionString: previous.env.OWNER_DATABASE_URL,
  });
  await owner.connect();
  try {
    const person = (
      await owner.query("INSERT INTO users(email) VALUES($1) RETURNING id", [
        randomUUID() + "@example.invalid",
      ])
    ).rows[0].id;
    const tenant = (
      await owner.query(
        "INSERT INTO tenants(name,data_mode) VALUES('Original 062 company','configured_services') RETURNING id",
      )
    ).rows[0].id;
    const project = (
      await owner.query(
        "INSERT INTO projects(tenant_id,name) VALUES($1,'Original project') RETURNING id",
        [tenant],
      )
    ).rows[0].id;
    await owner.query("INSERT INTO wallets(tenant_id) VALUES($1)", [tenant]);
    await owner.query(
      "INSERT INTO tasks(tenant_id,project_id,created_by,title,prompt,role_key,role_hash,budget_micros,idempotency_key) VALUES($1,$2,$3,'Original task','Original unchanged prompt','assistant','original',100,$4)",
      [tenant, project, person, randomUUID()],
    );
    const tables = (
      await owner.query(
        "SELECT tablename FROM pg_tables WHERE schemaname='public' AND tablename<>'schema_migrations' ORDER BY tablename",
      )
    ).rows.map((r) => r.tablename as string);
    const snapshot = async () => {
      const values: Record<string, string> = {};
      for (const name of tables) {
        assert.match(name, /^[a-z_]+$/);
        values[name] = hash(
          canonical(
            (
              await owner.query(
                `SELECT to_jsonb(t) AS row FROM public.${name} t ORDER BY to_jsonb(t)::text`,
              )
            ).rows,
          ),
        );
      }
      return values;
    };
    const before = await snapshot();
    await runMigrations(owner, "populated capability-binding upgrade", {
      throughVersion: 63,
    });
    assert.deepEqual(await snapshot(), before);
    assert.ok(tables.length >= 124);
    assert.equal(
      (
        await owner.query(
          "SELECT count(*)::int AS n FROM task_runtime_bindings",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (await owner.query("SELECT max(version) AS v FROM schema_migrations"))
        .rows[0].v,
      63,
    );
    await runMigrations(owner, "unchanged 063 replay", { throughVersion: 63 });
    assert.deepEqual(await snapshot(), before);
  } finally {
    await owner.end();
    await previous.cleanup();
  }
});

test("bounded version locks serialize revocation without granting application update privileges", async () => {
  await change({ AI_MODEL: "lock-fixture-" + randomUUID() });
  const f = await fixture(),
    queued = await createTask(f),
    frozen = await binding(queued.id);
  const reader = await s.db.app.connect(),
    revoker = await s.db.control.connect();
  let mutation: Promise<unknown> | undefined;
  try {
    const privilege = (
      await reader.query(
        "SELECT has_table_privilege(current_user,'internal_capability_versions','UPDATE') AS capability_update,has_table_privilege(current_user,'codex_runtime_profiles','UPDATE') AS runtime_update",
      )
    ).rows[0];
    assert.deepEqual(privilege, {
      capability_update: false,
      runtime_update: false,
    });
    await reader.query("BEGIN");
    await reader.query("SELECT lock_task_capability_versions($1,$2::uuid[])", [
      frozen.runtimeProfileId,
      frozen.versionIds,
    ]);
    const readerPid = (await reader.query("SELECT pg_backend_pid() AS pid"))
      .rows[0].pid;
    const revokerPid = (await revoker.query("SELECT pg_backend_pid() AS pid"))
      .rows[0].pid;
    mutation = revoker.query(
      "UPDATE internal_capability_versions SET revoked=true WHERE id=$1",
      [frozen.text.id],
    );
    const completedEarly = await Promise.race([
      mutation.then(() => true),
      new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 100)),
    ]);
    assert.equal(completedEarly, false);
    const blockedBy = (
      await s.db.app.query("SELECT pg_blocking_pids($1) AS blockers", [
        revokerPid,
      ])
    ).rows[0].blockers;
    assert.ok(
      blockedBy.includes(readerPid),
      "PostgreSQL confirms the original reader actually blocks revocation",
    );
    await reader.query("COMMIT");
    await mutation;
    await assert.rejects(
      binding(queued.id),
      (e: any) => e.code === "TASK_CAPABILITY_BINDING_UNAVAILABLE",
    );
    assert.equal((await binding(queued.id, false)).text.id, frozen.text.id);
  } finally {
    await reader.query("ROLLBACK");
    await mutation;
    reader.release();
    revoker.release();
  }
});

test("token metering retains exact integer ceiling and rejects settlement overflow", () => {
  assert.equal(tokenCharge(1, 1, 1, 1), 1);
  assert.equal(tokenCharge(7, 11, 1000000, 2000000), 29);
  assert.throws(
    () => tokenCharge(Number.MAX_SAFE_INTEGER, 1, Number.MAX_SAFE_INTEGER, 1),
    /safe settlement range/,
  );
});
