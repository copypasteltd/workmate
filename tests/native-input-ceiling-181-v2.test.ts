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
import { seedRuntimeProfile } from "../src/runtime-profiles.js";
import { seedProviderBudgetPolicy } from "../src/provider-budgets.js";
import { recoverProviderRequests } from "../src/provider-request-control.js";
import { hash } from "../src/lib.js";
import {
  AIRequestFailure,
  internalAIRequest,
  startScopedInferenceGateway,
  finishInternalAIRequest,
  type AIRequestInfo,
  type AIRequestPermit,
  type AIRequestAuthority,
} from "../src/internal-ai-gateway.js";

let owned: Awaited<ReturnType<typeof isolatedTestEnvironment>>;
let s: Awaited<ReturnType<typeof buildApp>>;
let upstream: Server;
let env: NodeJS.ProcessEnv;
let generationCalls: number;
let countCalls: number;
let observedCounts: any[];
let countedTokens: unknown;
let outputTokens: number;
let malformed: boolean;
let emitCreated: boolean;
const fixtureKey = "provider-request-fixture-never-a-real-key";

beforeEach(async () => {
  owned = await isolatedTestEnvironment();
  generationCalls = 0;
  countCalls = 0;
  observedCounts = [];
  countedTokens = 7;
  outputTokens = 11;
  malformed = false;
  emitCreated = false;
  upstream = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const part of req) chunks.push(Buffer.from(part));
    if (req.url === "/v1/responses/input_tokens") {
      countCalls++;
      observedCounts.push(JSON.parse(Buffer.concat(chunks).toString()));
      assert.equal(req.headers.authorization, "Bearer " + fixtureKey);
      res.writeHead(200, { "content-type": "application/json" }).end(
        JSON.stringify({
          object: "response.input_tokens",
          input_tokens: countedTokens,
        }),
      );
      return;
    }
    generationCalls++;
    assert.equal(req.headers.authorization, "Bearer " + fixtureKey);
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (malformed) {
      res.end(
        'event: response.created\ndata: {"response":{"id":"resp_fixture"}}\n\nevent: response.completed\ndata: {',
      );
    } else {
      if (emitCreated)
        res.write(
          'event: response.created\ndata: {"type":"response.created","response":{"id":"resp_fixture"}}\n\n',
        );
      res.end(
        "event: response.completed\ndata: " +
          JSON.stringify({
            type: "response.completed",
            response: {
              id: "resp_fixture",
              status: "completed",
              output: [],
              usage: { input_tokens: 7, output_tokens: outputTokens },
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
    AI_INPUT_COUNT_VERIFIED: "true",
    AI_INPUT_COUNT_HKD_MICROS_PER_CALL: "3",
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
async function fixture(options: { budget?: number; role?: string } = {}) {
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
      role_key: options.role ?? "marketing-analyst",
      budget_micros: options.budget ?? 1000000,
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
    budgeted: true,
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
  const countedInfo = async () => {
    const generation = info();
    const { stream, max_output_tokens, ...countBody } = body;
    const response = await internalAIRequest(s.db.config, {
      operation: "responses.input_tokens",
      model: body.model,
      body: countBody,
      authority: {
        ...authority,
        authorize: async (request) => {
          const permit = (await authority.authorize(
            request,
          )) as AIRequestPermit;
          generation.inputCountId = permit.requestId;
          return permit;
        },
      },
      signal: new AbortController().signal,
      generationOperationId: generation.requestId,
      generationHash: generation.requestHash,
    });
    const result = await response.json();
    await finishInternalAIRequest(response, {
      state: "completed",
      countedInputTokens: result.input_tokens,
      httpStatus: response.status,
    });
    generation.maxOutputTokens = max_output_tokens;
    return generation;
  };
  return {
    client,
    task,
    tenant,
    project,
    authority,
    body,
    info,
    countedInfo,
    worker,
    imageAuthority: { ...authority, capabilityVersionId: cap.image?.id },
  };
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


import { cloudExecGrammar } from "../src/cloud-tool-contract.js";

test("native tool context is pre-funded from serialized bytes while retaining the actual count proof and measured charge", async () => {
  const f = await fixture(); countedTokens = 6;
  let admitted: AIRequestInfo | undefined;
  const body = { ...f.body, input: [{type:"additional_tools", tools:[{type:"namespace",name:"functions",tools:[{type:"custom",name:"exec",format:{type:"grammar",syntax:"lark",definition:cloudExecGrammar}}]}]}, {type:"message",role:"user",content:"Use only registered tools"}] };
  const response = await internalAIRequest(s.db.config, {operation:"responses",model:body.model,reasoningEffort:body.reasoning.effort,body,tools:[],cloudTools:[],authority:{...f.authority,authorize:async request=>{ if(request.operation==="responses")admitted=request;return f.authority.authorize(request);}},signal:new AbortController().signal});
  assert.equal(response.status,200); await response.text();
  await finishInternalAIRequest(response,{state:"completed",inputTokens:7,outputTokens:11,httpStatus:200});
  const [g]=await rows();
  const allocation=(await s.db.control.query("SELECT * FROM ai_request_budget_allocations WHERE provider_request_id=$1",[g.id])).rows[0];
  assert.equal(admitted?.inputTokensCeiling,g.request_bytes);
  assert.equal(allocation.input_bound_mode,"serialized_ceiling");
  assert.equal(allocation.input_tokens_bound,String(g.request_bytes));
  assert.equal(allocation.amount_numerator,String(g.request_bytes*1000000+32*2000000));
  assert.equal(g.input_tokens,"7"); assert.equal(g.known_charge_micros,"29");
  assert.equal((await s.db.control.query("SELECT count(*) FROM ai_request_budget_violations WHERE provider_request_id=$1",[g.id])).rows[0].count,"0");
  assert.equal((await s.db.control.query("SELECT counted_input_tokens FROM ai_input_count_requests WHERE id=$1",[allocation.input_count_id])).rows[0].counted_input_tokens,"6");
});

test("conservative input allocation is rejected before dispatch when the original task budget cannot fund it", async () => {
  const f=await fixture({budget:90}); const info=await f.countedInfo();
  info.inputTokensCeiling=info.requestBytes;
  const permit=await f.authority.authorize(info) as AIRequestPermit;
  await assert.rejects(()=>permit.dispatch(),fail("AI_REQUEST_BUDGET_EXHAUSTED"));
  assert.equal(generationCalls,0); const [g]=await rows(); assert.equal(g.state,"cancelled");assert.equal(g.known_charge_micros,"0");
});

test("actual input beyond the pre-funded byte ceiling remains a violation with real spend retained",async()=>{
 const f=await fixture();const info=await f.countedInfo();info.inputTokensCeiling=info.requestBytes;
 const permit=await f.authority.authorize(info) as AIRequestPermit;await permit.dispatch();
 await assert.rejects(()=>permit.finish({state:"completed",inputTokens:info.requestBytes+1,outputTokens:11,httpStatus:200}),fail("AI_REQUEST_BUDGET_VIOLATION",true));
 const [g]=await rows();assert.equal(g.input_tokens,String(info.requestBytes+1));assert.equal(g.usage_known,true);
 assert.equal((await s.db.control.query("SELECT code FROM ai_request_budget_violations WHERE provider_request_id=$1",[g.id])).rows[0].code,"INPUT_COUNT_MISMATCH");
});

test("conservative input mode cannot relax the independent output token ceiling",async()=>{
 const f=await fixture();const info=await f.countedInfo();info.inputTokensCeiling=info.requestBytes;
 const permit=await f.authority.authorize(info) as AIRequestPermit;await permit.dispatch();
 await assert.rejects(()=>permit.finish({state:"completed",inputTokens:7,outputTokens:33,httpStatus:200}),fail("AI_REQUEST_BUDGET_VIOLATION",true));
 assert.equal((await s.db.control.query("SELECT code FROM ai_request_budget_violations")).rows[0].code,"OUTPUT_LIMIT_EXCEEDED");
});

test("a caller cannot invent a smaller input ceiling than the complete request bytes",async()=>{
 const f=await fixture();const info=await f.countedInfo();info.inputTokensCeiling=8;
 const permit=await f.authority.authorize(info) as AIRequestPermit;
 await assert.rejects(()=>permit.dispatch(),fail("AI_REQUEST_INVALID_INPUT_BOUND"));assert.equal(generationCalls,0);
});
