import { before, after, test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createServer, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { listenLoopbackHTTP } from "../src/loopback-http.js";
import { isolatedTestEnvironment } from "./native-test-environment.js";
import { buildApp } from "../src/server.js";
import { loadConfig } from "../src/config.js";
import { Worker } from "../src/worker.js";
import { CodexRuntimeAdapter, type RuntimeContext, type RuntimeResult } from "../src/runtime.js";
import { inputDependencies } from "../src/task-dependencies.js";
import { paidInputRequest } from "../src/paid-task-inputs.js";
import { saveAsset } from "../src/storage.js";
import { ErasureService } from "../src/erasure.js";
import { runMigrations } from "../scripts/migration-runner.js";
import pg from "pg";
let isolated: Awaited<ReturnType<typeof isolatedTestEnvironment>>;
let system: Awaited<ReturnType<typeof buildApp>>;
let gateway: ReturnType<typeof createServer>;
const providerRequests: any[] = [];
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
const questions = [
  { kind: "question", description: "Which canvas size is required?", options: ["1080 × 1080", "1080 × 1920"] },
  { kind: "question", description: "Who is the campaign audience?" },
];
async function call(c: Client | undefined, method: string, url: string, body?: unknown, tenant?: string, requestKey = randomUUID()) {
  const raw = await system.app.inject({ method: method as any, url, headers: {
    origin: "http://localhost:4317", "idempotency-key": requestKey,
    ...(c ? { cookie: c.cookie, "x-csrf-token": c.csrf } : {}), ...(tenant ? { "x-tenant-id": tenant } : {}),
    ...(body === undefined ? {} : { "content-type": "application/json" }),
  }, payload: body === undefined ? undefined : JSON.stringify(body) });
  return { status: raw.statusCode, data: raw.json(), raw };
}
function value(r: Awaited<ReturnType<typeof call>>, status = 200) { assert.equal(r.status, status, JSON.stringify(r.data)); return r.data; }
async function user(): Promise<Client> {
  const ch = value(await call(undefined, "POST", "/v1/auth/challenge", { email: `brief-${randomUUID()}@example.invalid` }));
  const mail = JSON.parse(await readFile(`${system.db.config.DATA_DIR}/mailbox/${ch.challenge_id}.json`, "utf8"));
  const r = await call(undefined, "POST", "/v1/auth/verify", { challenge_id: ch.challenge_id, code: mail.text.match(/\b\d{6}\b/)[0] });
  const result = value(r); return { id: result.user.id, csrf: result.csrf_token, cookie: r.raw.cookies[0].name + "=" + r.raw.cookies[0].value };
}
async function fixture(dependencies?: any[]) {
  const owner = await user();
  const w = value(await call(owner, "POST", "/v1/tenants", { name: "Business brief studio", project_name: "Original campaign" }));
  const tenant = w.tenant.id, project = w.project.id, base = `/v1/tenants/${tenant}/projects/${project}`;
  await system.db.control.query("UPDATE wallets SET credit_limit_micros=100000000 WHERE tenant_id=$1", [tenant]);
  const d = value(await call(owner, "POST", base + "/delegations", {
    title: "A campaign with essential details missing", prompt: "Prepare my approved campaign brief.", mode: "execute", budget_micros: 1000000, client_message_id: randomUUID(), ...(dependencies ? { dependencies } : {}),
  }));
  return { owner, tenant, project, base, task: d.task, conversation: d.conversation };
}
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function row(f: Fixture) { return (await system.db.control.query("SELECT * FROM tasks WHERE id=$1", [f.task.id])).rows[0]; }
async function inputs(f: Fixture) { return value(await call(f.owner, "GET", f.base + `/tasks/${f.task.id}/dependencies`)).items as any[]; }
async function answer(f: Fixture, d: any, text: string, extra: any = {}) {
  return call(f.owner, "POST", `/v1/tenants/${f.tenant}/task-dependencies/${d.id}/resolutions`, { expected_version: d.version, answer: text, ...extra });
}
class BriefRuntime extends CodexRuntimeAdapter {
  calls: RuntimeContext[] = []; thread = "brief-" + randomUUID();
  constructor(private script?: (ctx: RuntimeContext, attempt: number) => Promise<void>) { super(system.db.config); }
  override async start(ctx: RuntimeContext): Promise<RuntimeResult> {
    this.calls.push(ctx); const n = this.calls.length, turn = "turn-" + n;
    if (n > 1) assert.equal(ctx.thread, this.thread);
    await ctx.onEvent("runtime.thread", { thread_id: this.thread }); await ctx.onEvent("runtime.turn", { turn_id: turn });
    if (this.script) await this.script(ctx, n);
    else if (n === 1) await ctx.tools.find(t => t.name === "request_input")!.run({ requests: questions }, "missing-brief");
    else {
      assert.ok(ctx.prompt.includes("1200 × 628")); assert.ok(ctx.prompt.includes("Hong Kong retail founders"));
      await ctx.tools.find(t => t.name === "deliver_text")!.run({ filename: "campaign-brief.txt", mime_type: "text/plain", content: "Canvas: 1200 × 628; Audience: Hong Kong retail founders." }, "deliver-brief");
    }
    return { text: n === 1 ? "Please confirm the canvas and audience." : "The campaign brief is ready.", status: "completed", inputTokens: 100, outputTokens: 50, usageKnown: true, accepted: true, thread: this.thread, turn };
  }
}
before(async () => {
  isolated = await isolatedTestEnvironment();
  gateway = createServer(async (req, res) => {
    if (req.headers.authorization !== "Bearer business-fixture") { res.writeHead(401).end("{}"); return; }
    const parts: Buffer[] = []; for await (const chunk of req) parts.push(Buffer.from(chunk));
    const b = JSON.parse(Buffer.concat(parts).toString() || "{}");
    if (req.url === "/v1/responses/input_tokens") { res.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ object: "response.input_tokens", input_tokens: 100 })); return; }
    if (req.url !== "/v1/responses") { res.writeHead(404).end("{}"); return; }
    providerRequests.push(b); const n = providerRequests.length;
    const name = n === 1 ? "request_input" : n === 3 ? "deliver_text" : null;
    if (name) {
      const tool = b.tools.find((t: any) => t.type === "function" && (t.name === name || t.name.endsWith("__" + name)));
      assert.ok(tool, name);
      nativeResponse(res, { id: "fc_" + n, type: "function_call", call_id: "business-call-" + n, name: tool.name,
        arguments: JSON.stringify(n === 1 ? { requests: questions } : { filename: "native-campaign.txt", mime_type: "text/plain", content: "1200 × 628 for Hong Kong retail founders." }) });
    } else nativeResponse(res, { id: "msg_" + n, type: "message", role: "assistant", status: "completed", content: [{ type: "output_text", text: n === 2 ? "Please confirm size and audience." : "Your brief is complete.", annotations: [] }] });
  });
  const port = await listenLoopbackHTTP(gateway);
  system = await buildApp(loadConfig({ ...isolated.env, NODE_ENV: "test", WORKER_ENABLED: "false", DEMO_MODE: "false",
    AI_BASE_URL: `http://127.0.0.1:${port}/v1`, AI_ALLOWED_HOSTS: "127.0.0.1", AI_API_KEY: "business-fixture", AI_MODEL: "business-fixture", AI_REASONING_EFFORT: "medium",
    AI_VERIFIED: "true", AI_INPUT_COUNT_VERIFIED: "true", AI_INPUT_COUNT_HKD_MICROS_PER_CALL: "0", AI_INPUT_HKD_MICROS_PER_MILLION: "1000000", AI_OUTPUT_HKD_MICROS_PER_MILLION: "1000000",
  }), { worker: false });
});
after(async () => {
  try { await system?.app.close(); } finally {
    if (gateway) await new Promise<void>((resolve, reject) => { gateway.close(e => e ? reject(e) : resolve()); gateway.closeAllConnections(); });
    await isolated?.cleanup();
  }
});

test("question contracts allow optional suggestions and free answers but reject resource IDs, model answers, duplicated options and whitespace", () => {
  assert.ok(paidInputRequest.safeParse({ requests: questions }).success);
  for (const bad of [{ ...questions[0], answer: "model-chosen" }, { ...questions[0], resource_ids: [randomUUID()] }, { ...questions[0], options: ["same", "same"] }, { ...questions[0], options: [" "] }, { ...questions[0], options: Array.from({ length: 9 }, (_, i) => "Option " + i) }])
    assert.equal(paidInputRequest.safeParse({ requests: [bad] }).success, false);
  assert.equal(inputDependencies.safeParse([{ ...questions[0], answer: " " }]).success, false);
});
test("initial business questions do not dispatch a model; an explicit prefilled answer is frozen with its task", async () => {
  const f = await fixture([questions[0]]); assert.equal((await row(f)).status, "needs_input"); assert.equal((await row(f)).attempt, 0);
  const [d] = await inputs(f); assert.deepEqual(d.question_options, questions[0].options); assert.equal(d.answer, null);
  value(await answer(f, d, "1200 × 628"), 202); assert.equal((await row(f)).status, "queued");
  const supplied = await fixture([{ ...questions[0], answer: "1200 × 628" }]); assert.equal((await row(supplied)).status, "queued"); assert.equal((await inputs(supplied))[0].answer, "1200 × 628");
});
test("paid business questions wait on one task and hold, accept a free answer outside suggestions and settle cumulative usage once", async () => {
  const f = await fixture(), runtime = new BriefRuntime(), worker = new Worker(system.db, system.catalog, system.storage, runtime);
  await worker.run(f.tenant, f.task.id); const waiting = await row(f); assert.equal(waiting.status, "needs_input"); assert.equal(Number(waiting.accrued_micros), 150);
  const [size, audience] = await inputs(f); value(await answer(f, size, "1200 × 628"), 202); assert.equal((await row(f)).status, "needs_input");
  value(await answer(f, size, "1200 × 628"), 202); // Identical retry never changes the frozen answer.
  value(await answer(f, audience, "Hong Kong retail founders"), 202);
  await Promise.all([worker.run(f.tenant, f.task.id), worker.run(f.tenant, f.task.id)]);
  const done = await row(f); assert.equal(done.status, "succeeded"); assert.equal(done.attempt, 2); assert.equal(Number(done.charged_micros), 300); assert.equal(runtime.calls.length, 2);
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM reservations WHERE task_id=$1", [f.task.id])).rows[0].n, 1);
  assert.deepEqual((await system.db.control.query("SELECT count(*)::int AS n,sum(amount_micros)::text AS total FROM ledger WHERE task_id=$1 AND kind='charge'", [f.task.id])).rows[0], { n: 1, total: "-300" });
  const messages = (await system.db.control.query("SELECT body FROM conversation_messages WHERE conversation_id=$1 AND role='user' AND intent='note' ORDER BY created_at", [f.conversation.id])).rows;
  assert.equal(messages.length, 2); assert.ok(messages.some(m => m.body.includes("1200 × 628")));
  const refs = (await system.db.control.query("SELECT task_content_source_manifest($1) AS refs,publication_input_sources(NULL,$1) AS publication", [f.task.id])).rows[0];
  assert.notEqual(refs.refs, null); assert.notEqual(refs.publication, null); assert.equal(refs.publication.connections.length, 0);
});
test("wrong answer kinds, stale versions, blank/oversized text and answer edits are rejected without queuing paid work", async () => {
  const f = await fixture(), worker = new Worker(system.db, system.catalog, system.storage, new BriefRuntime()); await worker.run(f.tenant, f.task.id);
  const [d] = await inputs(f);
  for (const body of [{ expected_version: 1, resource_ids: [randomUUID()] }, { expected_version: 1, answer: " \n" }, { expected_version: 1, answer: "x".repeat(4001) }, { expected_version: 1, answer: "valid", resource_ids: [randomUUID()] }]) {
    const r = await call(f.owner, "POST", `/v1/tenants/${f.tenant}/task-dependencies/${d.id}/resolutions`, body); assert.equal(r.status, 400);
  }
  assert.equal((await answer(f, d, "answer", { expected_version: d.version + 9 })).data.error.code, "VERSION_CONFLICT");
  value(await answer(f, d, "1200 × 628"), 202); assert.equal((await answer(f, d, "different")).status, 409);
  await assert.rejects(system.db.control.query("UPDATE task_dependencies SET answer='changed' WHERE id=$1", [d.id]), /immutable/);
  assert.equal((await row(f)).status, "needs_input");
});
test("canonical batch validation is atomic across questions and files; replay retains one user note per answer", async () => {
  const f = await fixture(), runtime = new BriefRuntime(async ctx => { await ctx.tools.find(t => t.name === "request_input")!.run({ requests: [questions[0], { kind: "file", description: "Approved brand note" }] }, "mixed"); });
  await new Worker(system.db, system.catalog, system.storage, runtime).run(f.tenant, f.task.id);
  const [question, file] = await inputs(f), current = value(await call(f.owner, "GET", `/v1/tasks/${f.task.id}`, undefined, f.tenant));
  const invalid = await call(f.owner, "POST", `/v1/tasks/${f.task.id}/inputs`, { expected_version: current.version, answers: { [question.step_key]: { answer: "1200 × 628" }, [file.step_key]: { resource_ids: [randomUUID()] } } }, f.tenant);
  assert.equal(invalid.status, 404); assert.ok((await inputs(f)).every(d => d.state === "pending"));
  const a = await system.db.tx(tx => saveAsset(tx, system.storage, { tenant: f.tenant, project: f.project, user: f.owner.id, name: "brand.txt", mime: "text/plain", kind: "file", bytes: Buffer.from("Approved brand") }), f.tenant, false, f.owner.id);
  const version = (await system.db.control.query("SELECT id FROM asset_versions WHERE asset_id=$1", [a.id])).rows[0].id;
  const body = { expected_version: current.version, answers: { [question.step_key]: { answer: "1200 × 628" }, [file.step_key]: { resource_ids: [version] } }, asset_version_ids: [version] }, key = randomUUID();
  value(await call(f.owner, "POST", `/v1/tasks/${f.task.id}/inputs`, body, f.tenant, key), 202);
  value(await call(f.owner, "POST", `/v1/tasks/${f.task.id}/inputs`, body, f.tenant, key), 202);
  assert.equal((await row(f)).status, "queued"); assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM conversation_messages WHERE client_message_id=$1", [question.id])).rows[0].n, 1);
});
test("a different tenant and a viewer cannot answer a pending question", async () => {
  const f = await fixture(), outsider = await user(); const runtime = new BriefRuntime(); await new Worker(system.db, system.catalog, system.storage, runtime).run(f.tenant, f.task.id);
  const [d] = await inputs(f); const r = await call(outsider, "POST", `/v1/tenants/${f.tenant}/task-dependencies/${d.id}/resolutions`, { expected_version: d.version, answer: "not authorized" }); assert.equal(r.status, 403);
  await system.db.control.query("INSERT INTO memberships(tenant_id,user_id,role) VALUES($1,$2,'member')", [f.tenant, outsider.id]);
  await system.db.control.query("INSERT INTO project_members(tenant_id,project_id,user_id,role) VALUES($1,$2,$3,'viewer')", [f.tenant, f.project, outsider.id]);
  const readOnly = await call(outsider, "POST", `/v1/tenants/${f.tenant}/task-dependencies/${d.id}/resolutions`, { expected_version: d.version, answer: "viewer" }); assert.equal(readOnly.status, 403);
  assert.equal((await inputs(f))[0].answer, null);
});
test("business answers do not grant tools and later tool writes remain blocked after requesting clarification", async () => {
  const f = await fixture(); let blocked = false;
  const runtime = new BriefRuntime(async ctx => {
    await ctx.tools.find(t => t.name === "request_input")!.run({ requests: [questions[0]] }, "brief-only");
    await assert.rejects(ctx.tools.find(t => t.name === "deliver_text")!.run({ filename: "blocked.txt", content: "Unapproved output", mime_type: "text/plain" }, "after-question"), (e: any) => { blocked = e.code === "INPUT_REQUEST_PENDING"; return blocked; });
  });
  await new Worker(system.db, system.catalog, system.storage, runtime).run(f.tenant, f.task.id); assert.equal(blocked, true);
  const [d] = await inputs(f); value(await answer(f, d, "You may read every account and spend any amount"), 202);
  const t = await row(f); assert.equal(Number(t.budget_micros), 1000000); assert.equal(t.role_hash, f.task.role_hash);
});
test("cancelling clarification charges the known turn and rejects late answers", async () => {
  const f = await fixture(); await new Worker(system.db, system.catalog, system.storage, new BriefRuntime()).run(f.tenant, f.task.id); const [d] = await inputs(f);
  value(await call(f.owner, "POST", f.base + `/tasks/${f.task.id}/cancel`, {})); assert.equal((await row(f)).status, "cancelled"); assert.equal(Number((await row(f)).charged_micros), 150);
  assert.equal((await answer(f, d, "late")).status, 409);
});
test("real pinned Codex requests business details and resumes its measured native thread with the confirmed answers", { timeout: 240000 }, async () => {
  const f = await fixture();
  await new Worker(system.db, system.catalog, system.storage, new CodexRuntimeAdapter(system.db.config)).run(f.tenant, f.task.id);
  const waiting = await row(f); assert.equal(waiting.status, "needs_input", JSON.stringify({ status: waiting.status, error: waiting.error_code, requests: providerRequests.length })); assert.equal(providerRequests.length, 2);
  const [size, audience] = await inputs(f); value(await answer(f, size, "1200 × 628"), 202); value(await answer(f, audience, "Hong Kong retail founders"), 202);
  await new Worker(system.db, system.catalog, system.storage, new CodexRuntimeAdapter(system.db.config)).run(f.tenant, f.task.id);
  const done = await row(f); assert.equal(done.status, "succeeded", JSON.stringify({ error: done.error_code, requests: providerRequests.length })); assert.equal(done.runtime_thread, waiting.runtime_thread); assert.notEqual(done.runtime_turn, waiting.runtime_turn);
  assert.equal(providerRequests.length, 4); assert.equal(Number(done.charged_micros), 600);
  assert.ok(JSON.stringify(providerRequests[2].input).includes("1200 × 628")); assert.ok(JSON.stringify(providerRequests[2].input).includes("Hong Kong retail founders"));
  assert.equal((await system.db.control.query("SELECT count(*)::int AS n FROM ledger WHERE task_id=$1 AND kind='charge'", [f.task.id])).rows[0].n, 1);
});

test("erasing an answered private clarification removes answers, checkpoints and notes but retains measured charges", async () => {
  const f = await fixture(); await new Worker(system.db, system.catalog, system.storage, new BriefRuntime()).run(f.tenant, f.task.id);
  const [d] = await inputs(f); value(await answer(f, d, "PRIVATE-BUSINESS-ANSWER-136"), 202);
  value(await call(f.owner, "POST", f.base + `/tasks/${f.task.id}/cancel`, {}));
  const deletion = value(await call(f.owner, "POST", "/v1/deletions", { target_type: "conversation", target_id: f.conversation.id, reason: "Erase clarified business information" }, f.tenant), 202);
  const eraser = new ErasureService(system.db, system.storage);
  for (let n = 0; n < 8; n++) { await system.db.control.query("UPDATE deletion_jobs SET next_attempt_at=now() WHERE tenant_id=$1 AND state='queued'", [f.tenant]); await eraser.advance(40); }
  assert.equal(value(await call(f.owner, "GET", `/v1/deletions/${deletion.id}`, undefined, f.tenant)).state, "completed");
  for (const table of ["task_dependencies", "task_input_checkpoints", "conversation_messages"])
    assert.equal((await system.db.control.query(`SELECT count(*)::int AS n FROM ${table} WHERE task_id=$1`, [f.task.id])).rows[0].n, 0);
  assert.equal((await system.db.control.query("SELECT sum(amount_micros)::text AS total FROM ledger WHERE task_id=$1 AND kind='charge'", [f.task.id])).rows[0].total, "-150");
});
test("upgrading SQL134 retains an existing file checkpoint while adding bounded business answers", async () => {
  const previous = await isolatedTestEnvironment({ throughVersion: 134 }); let old: Awaited<ReturnType<typeof buildApp>> | undefined;
  try {
    old = await buildApp(loadConfig({ ...previous.env, NODE_ENV: "test", WORKER_ENABLED: "false", DEMO_MODE: "true" }), { worker: false });
    const current = system; let f!: Fixture;
    try { system = old; f = await fixture(); } finally { system = current; }
    const d = (await old.db.control.query("INSERT INTO task_dependencies(tenant_id,project_id,task_id,step_key,kind,description,required_scope) VALUES($1,$2,$3,'input-1','file','Original approved material','project.asset_version.read') RETURNING *", [f.tenant, f.project, f.task.id])).rows[0];
    const owner = new pg.Client({ connectionString: previous.env.OWNER_DATABASE_URL }); await owner.connect();
    try { await runMigrations(owner, "business-input-upgrade-136"); } finally { await owner.end(); }
    const upgraded = (await old.db.control.query("SELECT * FROM task_dependencies WHERE id=$1", [d.id])).rows[0];
    const { question_options, answer, ...original } = upgraded; assert.deepEqual(original, d); assert.deepEqual(question_options, []); assert.equal(answer, null);
    await old.db.control.query("INSERT INTO task_dependencies(tenant_id,project_id,task_id,step_key,kind,description,required_scope,question_options) VALUES($1,$2,$3,'question-1','question','Which audience?','task.answer',ARRAY['Retail','Finance'])", [f.tenant, f.project, f.task.id]);
    await assert.rejects(old.db.control.query("INSERT INTO task_dependencies(tenant_id,project_id,task_id,step_key,kind,description,required_scope,question_options) VALUES($1,$2,$3,'bad-question','question','Audience','task.answer',ARRAY['same','same'])", [f.tenant, f.project, f.task.id]), /check constraint/);
  } finally { await old?.app.close(); await previous.cleanup(); }
});
