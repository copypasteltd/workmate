import { beforeEach, afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { spawn } from "node:child_process";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { listenLoopbackHTTP } from "../src/loopback-http.js";
import { Worker } from "../src/worker.js";
import { taskCapabilities } from "../src/capability-bindings.js";
import { hash } from "../src/lib.js";
import {
  AIRequestFailure,
  internalAIRequest,
  startScopedInferenceGateway,
  type AIRequestInfo,
  type AIRequestPermit,
  type AIRequestAuthority,
} from "../src/internal-ai-gateway.js";

let owned: Awaited<ReturnType<typeof isolatedTestEnvironment>>;
let s: Awaited<ReturnType<typeof buildApp>>;
let upstream: Server;
let env: NodeJS.ProcessEnv;
let calls: number;
let malformed: boolean;
const fixtureKey = "provider-request-fixture-never-a-real-key";

beforeEach(async () => {
  owned = await isolatedTestEnvironment();
  calls = 0;
  malformed = false;
  upstream = createServer(async (req, res) => {
    for await (const _part of req) {
      /* Consume only the owned fake request. */
    }
    calls++;
    assert.equal(req.headers.authorization, "Bearer " + fixtureKey);
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (malformed) {
      res.end(
        'event: response.created\ndata: {"response":{"id":"resp_fixture"}}\n\nevent: response.completed\ndata: {',
      );
    } else {
      res.end(
        "event: response.completed\ndata: " +
          JSON.stringify({
            type: "response.completed",
            response: {
              id: "resp_fixture",
              status: "completed",
              output: [],
              usage: { input_tokens: 7, output_tokens: 11 },
            },
          }) +
          "\n\n",
      );
    }
  });
  await listenLoopbackHTTP(upstream);
  env = {
    ...owned.env,
    NODE_ENV: "test",
    DEV_MAILBOX: "true",
    WORKER_ENABLED: "false",
    DEMO_MODE: "false",
    AI_BASE_URL: `http://127.0.0.1:${(upstream.address() as any).port}/v1`,
    AI_ALLOWED_HOSTS: "127.0.0.1",
    AI_API_KEY: fixtureKey,
    AI_MODEL: "provider-control-fixture",
    AI_REASONING_EFFORT: "high",
    AI_VERIFIED: "true",
    AI_INPUT_HKD_MICROS_PER_MILLION: "1000000",
    AI_OUTPUT_HKD_MICROS_PER_MILLION: "2000000",
    AI_IMAGE_MODEL: "provider-image-fixture",
    AI_IMAGE_VERIFIED: "true",
    AI_IMAGE_HKD_MICROS_PER_IMAGE: "200",
  };
  s = await buildApp(loadConfig(env), { worker: false });
});
afterEach(async () => {
  try {
    await s?.app.close();
  } finally {
    upstream?.closeAllConnections();
    if (upstream)
      await new Promise<void>((resolve, reject) =>
        upstream.close((e) => (e ? reject(e) : resolve())),
      );
    await owned?.cleanup();
  }
});

type Client = { id: string; cookie: string; csrf: string };
async function api(
  client: Client | undefined,
  method: string,
  url: string,
  body: unknown,
) {
  const reply = await s.app.inject({
    method: method as any,
    url,
    headers: {
      origin: s.db.config.WEB_ORIGIN,
      "content-type": "application/json",
      "idempotency-key": randomUUID(),
      ...(client ? { cookie: client.cookie, "x-csrf-token": client.csrf } : {}),
    },
    payload: JSON.stringify(body),
  });
  assert.equal(reply.statusCode, 200, reply.body);
  return { body: reply.json(), reply };
}
async function fixture() {
  const email = `provider-control-${randomUUID()}@example.invalid`;
  const challenge = await api(undefined, "POST", "/v1/auth/challenge", {
    email,
  });
  const mail = JSON.parse(
    await readFile(
      `${s.db.config.DATA_DIR}/mailbox/${challenge.body.challenge_id}.json`,
      "utf8",
    ),
  );
  const verified = await api(undefined, "POST", "/v1/auth/verify", {
    challenge_id: challenge.body.challenge_id,
    code: mail.text.match(/\b\d{6}\b/)[0],
  });
  const cookie = verified.reply.cookies.find((c) => c.name === "cp_session")!;
  const client: Client = {
    id: verified.body.user.id,
    cookie: `${cookie.name}=${cookie.value}`,
    csrf: verified.body.csrf_token,
  };
  const workspace = await api(client, "POST", "/v1/tenants", {
    name: "Provider request fixture",
    project_name: "Real authorization",
  });
  const tenant = workspace.body.tenant.id,
    project = workspace.body.project.id;
  await s.db.control.query(
    "UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1",
    [tenant],
  );
  const created = await api(
    client,
    "POST",
    `/v1/tenants/${tenant}/projects/${project}/tasks`,
    {
      title: "Provider admission fixture",
      prompt: "Only use the labelled mock provider.",
      role_key: "marketing-analyst",
      budget_micros: 1000000,
    },
  );
  const fencing = randomUUID();
  const task = (
    await s.db.control.query(
      "UPDATE tasks SET status='running',attempt=1,fencing_token=$2,lease_until=now()+interval '5 minutes' WHERE id=$1 RETURNING *",
      [created.body.id, fencing],
    )
  ).rows[0];
  const actor = (
    await s.db.control.query(
      "SELECT email,name,auth_version FROM users WHERE id=$1",
      [client.id],
    )
  ).rows[0];
  const principal = {
    id: client.id,
    email: actor.email,
    name: actor.name,
    authVersion: actor.auth_version,
    audience: "user",
    sessionId: "",
    sessionHash: "",
  };
  const cap = await s.db.tx(
    (tx) => taskCapabilities(tx, s.db.config, s.catalog, task),
    tenant,
    true,
    client.id,
  );
  const worker = new Worker(s.db, s.catalog, s.storage);
  const authority: AIRequestAuthority = {
    taskId: task.id,
    tenantId: tenant,
    projectId: project,
    actorId: client.id,
    capabilityVersionId: cap.text.id,
    attempt: 1,
    fencingToken: fencing,
    authorize: (request) =>
      (worker as any).authorizeInference(task, principal, fencing, request),
  };
  const body = {
    model: cap.text.body.model_alias,
    reasoning: { effort: cap.text.body.reasoning_effort },
    stream: true,
    input:
      "A private fixture prompt that must never appear in request metadata",
    tools: [],
    max_output_tokens: 32,
  };
  const info = (): AIRequestInfo => ({
    ...authority,
    requestId: randomUUID(),
    operation: "responses",
    model: body.model,
    requestHash: hash(JSON.stringify(body)),
    requestBytes: Buffer.byteLength(JSON.stringify(body)),
  });
  return { client, task, tenant, project, authority, body, info };
}

async function policy(overrides: Record<string, number> = {}) {
  const settings = {
    global_slots: 100,
    tenant_slots: 100,
    actor_slots: 100,
    text_slots: 100,
    image_slots: 100,
    verification_slots: 100,
    global_rpm: 100000,
    tenant_rpm: 100000,
    actor_rpm: 100000,
    text_rpm: 100000,
    image_rpm: 100000,
    verification_rpm: 100000,
    preparation_seconds: 30,
    ...overrides,
  };
  const keys = Object.keys(settings);
  return s.db.tx(
    async (tx) => {
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('ai-gateway:configured_services',0))",
      );
      const version = (
        await tx.query(
          "SELECT coalesce(max(version),0)+1 AS next FROM ai_gateway_policy_versions WHERE data_mode='configured_services'",
        )
      ).rows[0].next;
      const row = (
        await tx.query(
          `INSERT INTO ai_gateway_policy_versions(data_mode,version,reason,${keys.join(",")}) VALUES('configured_services',$1,'Isolated provider test policy',${keys.map((_, i) => "$" + (i + 2)).join(",")}) RETURNING *`,
          [version, ...Object.values(settings)],
        )
      ).rows[0];
      await tx.query(
        "UPDATE ai_gateway_policy_heads SET policy_version_id=$1 WHERE data_mode='configured_services'",
        [row.id],
      );
      return row;
    },
    undefined,
    true,
  );
}
const rows = async () =>
  (
    await s.db.control.query(
      "SELECT * FROM ai_gateway_requests ORDER BY created_at,id",
    )
  ).rows;
const fail =
  (code: string, dispatched = false) =>
  (e: any) =>
    e instanceof AIRequestFailure &&
    e.code === code &&
    e.dispatched === dispatched;
async function proxy(
  f: Awaited<ReturnType<typeof fixture>>,
  authority = f.authority,
) {
  const gateway = await startScopedInferenceGateway(s.db.config, {
    model: f.body.model,
    reasoningEffort: f.body.reasoning.effort,
    tools: [],
    authority,
    signal: new AbortController().signal,
  });
  try {
    const reply = await fetch(gateway.baseURL + "/responses", {
      method: "POST",
      headers: {
        authorization: "Bearer " + gateway.credential,
        "content-type": "application/json",
      },
      body: JSON.stringify(f.body),
    });
    let text: string | undefined;
    try {
      text = await reply.text();
    } catch {
      /* A truncated stream must close the client response. */
    }
    return {
      status: reply.status,
      retry: reply.headers.get("retry-after"),
      text,
      forwarded: gateway.forwardedRequests,
    };
  } finally {
    await gateway.close();
  }
}

test("actual worker request commits frozen attribution, dispatch and validated usage without recording private input or charging twice", async () => {
  const f = await fixture();
  const result = await proxy(f);
  assert.equal(result.status, 200);
  assert.equal(calls, 1);
  const [row] = await rows();
  assert.equal(row.state, "completed");
  assert.equal(row.task_id, f.task.id);
  assert.equal(row.actor_id, f.client.id);
  assert.equal(row.attempt, 1);
  assert.equal(row.fencing_token, f.task.fencing_token);
  assert.equal(row.input_tokens, "7");
  assert.equal(row.output_tokens, "11");
  assert.equal(row.known_charge_micros, "29");
  assert.ok(row.released_at && row.usage_known);
  assert.deepEqual(row.rate_snapshot, [1000000, 2000000]);
  assert.equal(row.policy_version_id, row.dispatch_policy_version_id);
  assert.ok(!JSON.stringify(row).includes("private fixture prompt"));
  assert.ok(!JSON.stringify(row).includes(fixtureKey));
  const events = (
    await s.db.control.query(
      "SELECT state FROM ai_gateway_request_events WHERE request_id=$1 ORDER BY created_at,id",
      [row.id],
    )
  ).rows;
  assert.deepEqual(
    events.map((r) => r.state),
    ["prepared", "dispatched", "completed"],
  );
  assert.equal(
    (
      await s.db.control.query(
        "SELECT count(*) FROM ledger WHERE task_id=$1 AND kind='charge'",
        [f.task.id],
      )
    ).rows[0].count,
    "0",
  );
});

test("prepared rate promises serialize before any HTTP dispatch and cancellation returns only unused promises", async () => {
  const f = await fixture();
  await policy({ global_rpm: 1 });
  const first = (await f.authority.authorize(f.info())) as AIRequestPermit;
  await assert.rejects(
    () => f.authority.authorize(f.info()),
    fail("AI_REQUEST_GLOBAL_RATE"),
  );
  assert.equal(calls, 0);
  await first.finish({ state: "cancelled", code: "CANCELLED_BEFORE_DISPATCH" });
  await f.authority.authorize(f.info());
  assert.deepEqual(
    (await rows()).map((r) => r.state),
    ["cancelled", "denied", "prepared"],
  );
  assert.equal((await rows())[0].known_charge_micros, "0");
});

test("new policy is enforced again at dispatch without silently applying an old permit's limits", async () => {
  const f = await fixture();
  const old = await policy();
  const first = (await f.authority.authorize(f.info())) as AIRequestPermit;
  const second = (await f.authority.authorize(f.info())) as AIRequestPermit;
  await policy({ global_slots: 1 });
  await assert.rejects(
    () => first.dispatch(),
    fail("AI_REQUEST_GLOBAL_CAPACITY"),
  );
  await second.dispatch();
  const result = await rows();
  assert.equal(result[0].state, "cancelled");
  assert.equal(result[0].policy_version_id, old.id);
  assert.equal(result[1].state, "dispatched");
  assert.notEqual(result[1].dispatch_policy_version_id, old.id);
  assert.equal(
    calls,
    0,
    "The test intentionally stops at the durable dispatch intent",
  );
});

test("revocation after admission is rechecked before fetch and retains known zero spend", async () => {
  const f = await fixture();
  const authority = {
    ...f.authority,
    authorize: async (request: AIRequestInfo) => {
      const permit = await f.authority.authorize(request);
      await s.db.control.query(
        "UPDATE users SET auth_version=auth_version+1 WHERE id=$1",
        [f.client.id],
      );
      return permit;
    },
  };
  const result = await proxy(f, authority);
  assert.equal(result.status, 403);
  assert.equal(result.forwarded, 0);
  assert.equal(calls, 0);
  const [row] = await rows();
  assert.equal(row.state, "cancelled");
  assert.equal(row.known_charge_micros, "0");
  assert.equal(row.dispatched_at, null);
});

test("cancellation after durable dispatch intent but before fetch is proven zero and releases both capacity and rate promise", async () => {
  const f = await fixture();
  await policy({ global_slots: 1, global_rpm: 1 });
  const stop = new AbortController();
  const authority = {
    ...f.authority,
    authorize: async (request: AIRequestInfo) => {
      const permit = (await f.authority.authorize(request)) as AIRequestPermit;
      return {
        ...permit,
        dispatch: async () => {
          await permit.dispatch();
          stop.abort();
        },
      };
    },
  };
  await assert.rejects(
    () =>
      internalAIRequest(s.db.config, {
        operation: "responses",
        model: f.body.model,
        reasoningEffort: f.body.reasoning.effort,
        tools: [],
        body: f.body,
        authority,
        signal: stop.signal,
      }),
    fail("AI_REQUEST_CANCELLED"),
  );
  assert.equal(calls, 0);
  const [row] = await rows();
  assert.equal(row.state, "cancelled");
  assert.ok(row.dispatched_at);
  assert.equal(row.known_charge_micros, "0");
  await f.authority.authorize(f.info());
  assert.equal((await rows())[1].state, "prepared");
});

test("unterminated response remains unknown and consumes actor capacity across a fresh runtime", async () => {
  const f = await fixture();
  await policy({ actor_slots: 1 });
  malformed = true;
  await proxy(f);
  const [row] = await rows();
  assert.equal(row.state, "unknown");
  assert.equal(row.released_at, null);
  assert.equal(row.known_charge_micros, null);
  malformed = false;
  const next = await proxy(f);
  assert.equal(next.status, 429);
  assert.equal(next.retry, "1");
  assert.match(next.text!, /AI_REQUEST_ACTOR_CAPACITY/);
  assert.equal(calls, 1);
});

test("expired prepared permits are reclaimed with immutable zero-spend events and cannot later dispatch", async () => {
  const f = await fixture();
  await policy({ global_slots: 1, preparation_seconds: 1 });
  const first = (await f.authority.authorize(f.info())) as AIRequestPermit;
  await new Promise((resolve) => setTimeout(resolve, 1150));
  await f.authority.authorize(f.info());
  await assert.rejects(() => first.dispatch());
  const result = await rows();
  assert.equal(result[0].state, "cancelled");
  assert.equal(result[0].outcome_code, "PREPARATION_EXPIRED");
  assert.equal(result[0].known_charge_micros, "0");
  assert.equal(result[1].state, "prepared");
  assert.equal(calls, 0);
});

test("a completed provider request keeps its rolling-minute rate charge after freeing concurrency", async () => {
  const f = await fixture();
  await policy({ global_slots: 1, global_rpm: 1 });
  assert.equal((await proxy(f)).status, 200);
  const denied = await proxy(f);
  assert.equal(denied.status, 429);
  assert.equal(denied.retry, "60");
  assert.match(denied.text!, /AI_REQUEST_GLOBAL_RATE/);
  assert.equal(calls, 1);
});

test("one operation can never be replayed into another provider request even after a known cancellation", async () => {
  const f = await fixture();
  const info = f.info();
  const first = (await f.authority.authorize(info)) as AIRequestPermit;
  await first.finish({ state: "cancelled", code: "CANCELLED_BEFORE_DISPATCH" });
  await assert.rejects(
    () => f.authority.authorize(info),
    fail("AI_REQUEST_OPERATION_ALREADY_USED"),
  );
  assert.equal((await rows()).length, 1);
  assert.equal(calls, 0);
});

test("request and policy history cannot be rewritten and ordinary RLS cannot expose another actor's or tenant's request", async () => {
  const first = await fixture(),
    other = await fixture();
  await first.authority.authorize(first.info());
  const [row] = await rows();
  await assert.rejects(() =>
    s.db.control.query(
      "UPDATE ai_gateway_requests SET request_hash=$2 WHERE id=$1",
      [row.id, "a".repeat(64)],
    ),
  );
  await assert.rejects(() =>
    s.db.control.query(
      "UPDATE ai_gateway_policy_versions SET actor_slots=99 WHERE id=$1",
      [row.policy_version_id],
    ),
  );
  await assert.rejects(() =>
    s.db.control.query(
      "UPDATE ai_gateway_request_events SET body='{}' WHERE request_id=$1",
      [row.id],
    ),
  );
  const own = await s.db.tx(
    (tx) => tx.query("SELECT id FROM ai_gateway_requests"),
    first.tenant,
    false,
    first.client.id,
  );
  const cross = await s.db.tx(
    (tx) => tx.query("SELECT id FROM ai_gateway_requests"),
    other.tenant,
    false,
    other.client.id,
  );
  const wrongActor = await s.db.tx(
    (tx) => tx.query("SELECT id FROM ai_gateway_requests"),
    first.tenant,
    false,
    other.client.id,
  );
  assert.equal(own.rows.length, 1);
  assert.equal(cross.rows.length, 0);
  assert.equal(wrongActor.rows.length, 0);
  await assert.rejects(() =>
    s.db.tx(
      (tx) => tx.query("UPDATE ai_gateway_requests SET state='completed'"),
      first.tenant,
      false,
      first.client.id,
    ),
  );
});

test("four actual Node workers share the database admission ceiling across two tenants", async () => {
  const a = await fixture(),
    b = await fixture();
  await policy({ global_slots: 2 });
  const children = [a, b, a, b].map((f) => {
    const child = spawn(
      process.execPath,
      ["--import", "tsx", "tests/fixtures/provider-admission-child.ts"],
      {
        windowsHide: true,
        stdio: ["ignore", "ignore", "pipe", "ipc"],
      },
    );
    let isReady = false;
    const ready = new Promise<void>((resolve, reject) => {
      child.once("error", reject);
      child.once("exit", () => {
        if (!isReady)
          reject(new Error("Owned admission child exited before readiness"));
      });
      const onMessage = (m: any) => {
        if (m.ready) {
          isReady = true;
          child.off("message", onMessage);
          resolve();
        }
      };
      child.on("message", onMessage);
    });
    const result = new Promise<any>((resolve, reject) => {
      child.once("error", reject);
      child.on("message", (m: any) => {
        if (!m.ready) resolve(m);
      });
    });
    const exited = new Promise<void>((resolve, reject) =>
      child.once("exit", (code, signal) => {
        if (code === 0 && signal === null) resolve();
        else reject(new Error("Owned admission child did not exit normally"));
      }),
    );
    void ready.catch(() => {});
    void result.catch(() => {});
    void exited.catch(() => {});
    return { child, ready, result, exited, info: f.info() };
  });
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const results = await Promise.race([
      (async () => {
        await Promise.all(children.map((c) => c.ready));
        for (const c of children) c.child.send({ env, request: c.info });
        const results = await Promise.all(children.map((c) => c.result));
        await Promise.all(children.map((c) => c.exited));
        return results;
      })(),
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error("Owned admission workers timed out")),
          15000,
        );
      }),
    ]);
    assert.equal(results.filter((r) => r.admitted).length, 2);
    assert.equal(
      results.filter((r) => r.reason === "GLOBAL_CAPACITY").length,
      2,
    );
    assert.ok(results.every((r) => !r.failed));
    assert.equal(
      (await rows()).filter((r) => r.state === "prepared").length,
      2,
    );
    assert.equal((await rows()).filter((r) => r.state === "denied").length, 2);
    assert.equal(calls, 0);
  } finally {
    if (timer) clearTimeout(timer);
    for (const c of children)
      if (c.child.exitCode === null && c.child.signalCode === null)
        c.child.kill();
    await Promise.allSettled(children.map((c) => c.exited));
  }
});
