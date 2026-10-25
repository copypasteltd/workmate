import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { LocalCodexSession, type LocalCodexProfile, type LocalSessionBinding, type LocalCodexHooks } from "../../src/local-codex.js";
import type { LocalInputRequest } from "../../src/local-input.js";
import { LocalProgramController, type ProgramJournal } from "../../src/local-programs.js";

const digest = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const lock = JSON.parse(await readFile(new URL("../../contracts/local-codex-runtime.json", import.meta.url), "utf8"));
const executable = process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN;
assert.ok(executable && path.isAbsolute(executable), "Set COPYPASTE_LOCAL_CODEX_TEST_BIN to the locked absolute native Codex binary. No PATH fallback.");
const skill = "---\nname: native-fixture-method\ndescription: Verify a local fixture without fabricating results.\n---\nNATIVE_SKILL_FROM_DISK_73D6. Inspect actual tool results and preserve unrelated files.";
type Action = { command?: string; input?: { questions: any[] }; company?: { tool: string; arguments: Record<string, unknown> }; program?: { tool: string; arguments: Record<string, unknown> }; stall?: () => void; stage?: number };

function emit(res: ServerResponse, type: string, payload: Record<string, unknown>) {
  res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`);
}
function completed(res: ServerResponse, index: number, item: any) {
  const response = { id: "resp_local_" + index, object: "response", model: "copypaste-native-fixture", created_at: 1, status: "in_progress", output: [] };
  emit(res, "response.created", { response });
  emit(res, "response.output_item.added", { output_index: 0, item: item.type === "function_call" ? { ...item, arguments: "" } : item });
  if (item.type === "function_call") {
    emit(res, "response.function_call_arguments.delta", { output_index: 0, item_id: item.id, delta: item.arguments });
    emit(res, "response.function_call_arguments.done", { output_index: 0, item_id: item.id, arguments: item.arguments });
  } else {
    emit(res, "response.output_text.delta", { output_index: 0, item_id: item.id, content_index: 0, delta: item.content[0].text });
    emit(res, "response.output_text.done", { output_index: 0, item_id: item.id, content_index: 0, text: item.content[0].text });
  }
  emit(res, "response.output_item.done", { output_index: 0, item });
  emit(res, "response.completed", { response: { ...response, status: "completed", output: [item], usage: {
    input_tokens: 17, output_tokens: 5, total_tokens: 22, input_tokens_details: { cached_tokens: 0 }, output_tokens_details: { reasoning_tokens: 0 },
  } } });
  res.end();
}
function commandTool(tools: any[]): { name: string; parameters: any } | undefined {
  for (const tool of tools ?? []) {
    if (tool.type === "namespace") {
      const nested = commandTool(tool.tools ?? []);
      if (nested) return { ...nested, name: tool.name + "." + nested.name };
    }
    if (["exec_command", "shell", "shell_command"].includes(tool.name)) return { name: tool.name, parameters: tool.parameters };
  }
}
function inputTool(tools: any[]): { name: string; parameters: any } | undefined {
  for (const tool of tools ?? []) {
    if (tool.type === "namespace") { const child = inputTool(tool.tools); if (child) return { ...child, name: tool.name + "." + child.name }; }
    if (tool.name === "request_user_input") return { name: tool.name, parameters: tool.parameters };
  }
}
async function fixture() {
  const parent = path.resolve(".data/native-local-tests");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(path.join(parent, "session-"));
  const workspace = path.join(directory, "workspace"), outside = path.join(directory, "outside"), stateRoot = path.join(directory, "state");
  for (const folder of [workspace, outside, stateRoot]) await mkdir(folder);
  const token = randomBytes(32).toString("hex");
  const requests: any[] = [], actions: Action[] = [], sessions: LocalCodexSession[] = [], events: any[] = [];
  let handlerError: unknown, readyPid = 0, authority = true;
  const server = createServer(async (req, res) => {
    try {
      const chunks = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString() || "{}");
      requests.push({ url: req.url, authorized: req.headers.authorization === "Bearer " + token, body });
      await writeFile(path.join(directory, "last-request-body.json"), JSON.stringify(body));
      assert.equal(req.url, "/v1/responses");
      assert.equal(req.headers.authorization, "Bearer " + token);
      const action = actions[0];
      assert.ok(action, "Unexpected additional provider dispatch");
      res.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache" });
      if (action.stall) {
        actions.shift();
        emit(res, "response.created", { response: { id: "resp_stalled", object: "response", status: "in_progress", output: [] } });
        action.stall();
      } else if (action.input && !action.stage) {
        const tool = inputTool(body.tools);
        assert.ok(tool, "The pinned native runtime must advertise request_user_input in ordinary working mode");
        action.stage = 1;
        completed(res, requests.length, { id: "fc_input_" + requests.length, type: "function_call", name: tool.name,
          call_id: "call_input_" + requests.length, arguments: JSON.stringify(action.input) });
      } else if (action.program && !action.stage) {
        assert.ok(body.tools.some((tool: any) => tool.type === "namespace" && tool.name === "copypaste_programs"
          && tool.tools.some((child: any) => child.name === action.program!.tool)), "Native Codex must declare the exact approved-program namespace");
        action.stage = 1;
        completed(res, requests.length, { id: "fc_program_" + requests.length, type: "function_call", namespace: "copypaste_programs",
          name: action.program.tool, call_id: "call_program_" + requests.length, arguments: JSON.stringify(action.program.arguments) });
      } else if (action.company && !action.stage) {
        assert.ok(body.tools.some((tool: any) => tool.type === "namespace" && tool.name === "copypaste"
          && tool.tools.some((child: any) => child.name === action.company!.tool)), "Exact company namespace must be declared by native Codex");
        action.stage = 1;
        completed(res, requests.length, { id: "fc_company_" + requests.length, type: "function_call", namespace: "copypaste",
          name: action.company.tool, call_id: "call_company_" + requests.length, arguments: JSON.stringify(action.company.arguments) });
      } else if (action.command && !action.stage) {
        const tool = commandTool(body.tools);
        assert.ok(tool, "Codex must advertise its native terminal tool");
        const properties = tool.parameters?.properties ?? {};
        const args = "cmd" in properties
          ? { cmd: action.command, workdir: workspace, yield_time_ms: 1000, max_output_tokens: 2000 }
          : "command" in properties && properties.command.type === "array"
            ? { command: ["powershell.exe", "-NoProfile", "-Command", action.command], workdir: workspace, timeout_ms: 10000 }
            : { command: action.command, workdir: workspace, timeout_ms: 10000 };
        action.stage = 1;
        completed(res, requests.length, { id: "fc_local_" + requests.length, type: "function_call", name: tool.name,
          call_id: "call_local_" + requests.length, arguments: JSON.stringify(args) });
      } else {
        actions.shift();
        completed(res, requests.length, { id: "msg_local_" + requests.length, type: "message", role: "assistant", status: "completed",
          content: [{ type: "output_text", text: "LOCAL_CODEX_NATIVE_COMPLETE", annotations: [] }] });
      }
    } catch (error) {
      handlerError = error;
      if (!res.headersSent) res.writeHead(502);
      res.end();
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const profile: LocalCodexProfile = { executable: executable!, version: lock.runtime_version, executableSha256: lock.windows_x64_sha256,
    companyOrigin: origin, baseURL: origin + "/v1", model: "copypaste-native-fixture", effort: "medium" };
  const actor = randomUUID();
  const binding: LocalSessionBinding = { sessionId: randomUUID(), actorId: actor, tenantId: randomUUID(), projectId: randomUUID(), workspace, stateRoot,
    grant: { id: randomUUID(), actorId: actor, mode: "full-access", revision: 1, expiresAt: Date.now() + 300000 },
    skills: [{ key: "native-fixture-method", content: skill, sha256: digest(skill) }] };
  const make = (p = profile, b = binding, companyTool?: LocalCodexHooks["companyTool"], userInput?: LocalCodexHooks["userInput"], programTool?: LocalCodexHooks["programTool"]) => {
    const session = new LocalCodexSession(p, b, { authorize: async () => { if (!authority) throw new Error("Account revoked"); },
      companyTool, userInput, programTool, event: async (kind, value) => { events.push({ kind, value }); if (kind === "local.runtime.ready") readyPid = Number(value.pid); } });
    sessions.push(session); return session;
  };
  const start = (session: LocalCodexSession, expiresAt = Date.now() + 300000) => session.start({ token, expiresAt });
  const checkpoint = () => readFile(path.join(stateRoot, "local-codex", binding.sessionId, "checkpoint.json"), "utf8").then(JSON.parse);
  const clean = async () => {
    await Promise.all(sessions.map((session) => session.close()));
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    assert.equal(path.dirname(directory), parent);
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
    if (handlerError) throw handlerError;
  };
  return { profile, binding, make, start, checkpoint, clean, requests, actions, events, workspace, outside, stateRoot,
    pid: () => readyPid, revokeAuthority: () => { authority = false; }, token, directory };
}
const quoted = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const writeCommand = (file: string, content: string) => `[IO.File]::WriteAllText(${quoted(file)}, ${quoted(content)}); Write-Output ('runtime-token-present=' + [bool][Environment]::GetEnvironmentVariable('COPYPASTE_LOCAL_INFERENCE_TOKEN'))`;

const inputQuestions = [{ id: "palette", header: "Palette", question: "Which palette should the actual work use?", options: [
  { label: "Company blue", description: "Use the existing CopyPaste palette." }, { label: "Warm neutral", description: "Use the reviewed warm neutral palette." },
] }, { id: "format", header: "Format", question: "Choose the requested output format.", options: [
  { label: "HTML", description: "A locally editable HTML file." }, { label: "PDF", description: "A portable document." },
] }];

test("real native Codex lists, runs and inspects a customer-approved program with exact argv and no shell or inference credential inheritance", { timeout: 120000 }, async () => {
  const f = await fixture(); let journal: ProgramJournal | null = null, programs: LocalProgramController | undefined;
  try {
    const taskId = randomUUID(), binding = { ...f.binding, programToolsVersion: 1 as const }, owner = {
      actorId: binding.actorId, epoch: randomUUID(), tenant: binding.tenantId, project: binding.projectId, workspace: f.workspace,
      permission: "full-access", revoked: false, grantRevision: 1, expiresAt: binding.grant.expiresAt, programToolsVersion: 1 as const,
    };
    programs = new LocalProgramController({ read: async () => structuredClone(journal), write: async value => { journal = structuredClone(value); },
      owner: async () => owner, context: async () => owner, choose: async () => process.execPath, confirm: async () => true, changed: () => {},
      host: path.resolve(".data/native-program-host/local-program-host.exe") });
    const approved = await programs.approve(binding.sessionId); assert.ok(approved);
    const programSession = programs.session({ sessionId: binding.sessionId, taskId }, async () => {}), results: any[] = [];
    const native = f.make(f.profile, binding, undefined, undefined, async (call, signal) => {
      const result = await programSession.call(call, signal); results.push({ tool: call.tool, value: JSON.parse(result.contentItems[0].text) }); return result;
    });
    await f.start(native); f.actions.push({ program: { tool: "list", arguments: {} } });
    const first = await native.turn("Inspect the customer-approved native program catalog."); assert.equal(first.status, "completed");
    assert.equal(results[0].value.programs[0].id, approved.id);
    const output = path.join(f.workspace, "native-argv.json"), script = path.join(f.workspace, "approved-native.cjs");
    await writeFile(script, "require('fs').writeFileSync(process.argv[2],JSON.stringify({args:process.argv.slice(3),token:!!process.env.COPYPASTE_LOCAL_INFERENCE_TOKEN}));console.log('NATIVE_APPROVED_PROGRAM_OUTPUT');");
    const argv = [script, output, "香港設計", "literal\"quote", "trailing\\", "", "$(no-shell);&|"];
    f.actions.push({ program: { tool: "run", arguments: { program_id: approved.id, argv, timeout_ms: 10000 } } });
    const second = await native.turn("Run the selected native program with the exact structured arguments."); assert.equal(second.status, "completed"); assert.equal(second.threadId, first.threadId);
    assert.deepEqual(JSON.parse(await readFile(output, "utf8")), { args: argv.slice(2), token: false });
    const receipt = results[1].value; assert.equal(receipt.state, "succeeded"); assert.equal(receipt.exitCode, 0); assert.equal(receipt.taskId, taskId);
    assert.match(receipt.stdout, /NATIVE_APPROVED_PROGRAM_OUTPUT/); assert.deepEqual(receipt.argv, argv);
    f.actions.push({ program: { tool: "status", arguments: { receipt_id: receipt.id } } });
    const third = await native.turn("Read the original program receipt without executing it again."); assert.equal(third.threadId, first.threadId);
    assert.deepEqual(results[2].value, receipt); assert.equal(journal!.receipts.length, 1);
    assert.ok(f.requests.every(request => request.authorized));
    assert.ok(f.requests.at(-1).body.input.some((item: any) => item.type === "function_call_output" && JSON.stringify(item.output).includes(receipt.id)));
    assert.equal(f.events.filter(event => event.kind === "local.program-tool.completed").length, 3);
  } finally { await programs?.close(); await f.clean(); }
});
test("native user input resumes the original working turn with explicit answers", { timeout: 120000 }, async () => {
  const f = await fixture(), inputs: LocalInputRequest[] = [];
  try {
    const native = f.make(f.profile, f.binding, undefined, async request => {
      inputs.push(request);
      return { palette: { answers: ["Company blue"] }, format: { answers: ["NATIVE_USER_CHOSEN_HTML_74"] } };
    });
    await f.start(native); f.actions.push({ input: { questions: inputQuestions } });
    const result = await native.turn("Ask the customer about palette and output format before continuing.");
    assert.equal(result.status, "completed"); assert.equal(inputs.length, 1, JSON.stringify(f.requests.at(-1)?.body.input.slice(-2)));
    assert.equal(inputs[0].threadId, result.threadId); assert.equal(inputs[0].turnId, result.turnId);
    assert.equal(typeof inputs[0].isBlocking, "boolean"); assert.equal(inputs[0].questions.length, 2);
    assert.equal(f.requests.length, 2);
    assert.equal(inputs[0].questions[1].isOther, true);
    const output = f.requests[1].body.input.find((item: any) => item.type === "function_call_output" && item.call_id === "call_input_1");
    assert.deepEqual(JSON.parse(output.output).answers, { palette: { answers: ["Company blue"] }, format: { answers: ["NATIVE_USER_CHOSEN_HTML_74"] } });
    assert.ok(!JSON.stringify(f.events).includes("NATIVE_USER_CHOSEN_HTML_74"));
  } finally { await f.clean(); }
});
for (const withdrawal of ["interrupt", "revoke"] as const) test(`native user input does not block ${withdrawal} or terminal processing`, { timeout: 120000 }, async () => {
  const f = await fixture(); let entered!: () => void, aborted = false;
  const ready = new Promise<void>(resolve => { entered = resolve; });
  try {
    const native = f.make(f.profile, f.binding, undefined, async (_request, signal) => {
      signal.addEventListener("abort", () => { aborted = true; }, { once: true }); entered();
      return new Promise(() => {}); // Even an uncooperative UI hook cannot hold shutdown.
    });
    await f.start(native); f.actions.push({ input: { questions: inputQuestions } });
    const turn = native.turn("Ask a question and wait for the user."); void turn.catch(() => {});
    let timer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([ready, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Native question was not displayed")), 30000); })]); }
    finally { if (timer) clearTimeout(timer); }
    const started = Date.now(); await native[withdrawal]();
    await turn.catch(() => null); await native.close();
    assert.equal(aborted, true); assert.ok(Date.now() - started < 12000); assert.equal(f.requests.length, 1);
  } finally { await f.clean(); }
});

test("native company tools use their exact namespace and persist across same-thread follow-ups", { timeout: 180000 }, async () => {
  const f = await fixture();
  const calls: any[] = [], artifact = { id: randomUUID(), name: "fixture-design.svg", version: { id: randomUUID(), version: 1 } };
  const binding = { ...f.binding, companyTools: [{ name: "font_catalog", description: "Read the company font catalog.", inputSchema: { type: "object", properties: {}, additionalProperties: false } }] };
  try {
    const invoke: LocalCodexHooks["companyTool"] = async call => { calls.push(call); return { artifact, marker: "COMPANY_RESULT_FROM_REGISTERED_HANDLER" }; };
    const first = f.make(f.profile, binding, invoke); await f.start(first);
    f.actions.push({ company: { tool: "font_catalog", arguments: {} } });
    const one = await first.turn("Use the registered company font catalog."); await first.close();
    const second = f.make(f.profile, binding, invoke); await f.start(second);
    f.actions.push({ company: { tool: "font_catalog", arguments: {} } });
    const two = await second.turn("Read that same company tool in this follow-up.");
    assert.equal(one.threadId, two.threadId); assert.notEqual(one.turnId, two.turnId);
    assert.equal(calls.length, 2); assert.ok(calls.every(call => call.namespace === "copypaste" && call.tool === "font_catalog" && call.threadId === one.threadId));
    assert.notEqual(calls[0].turnId, calls[1].turnId);
    assert.ok(f.requests.some(request => JSON.stringify(request.body.input).includes("COMPANY_RESULT_FROM_REGISTERED_HANDLER")));
    assert.equal(f.events.filter(event => event.kind === "local.company-tool.completed").length, 2);
    assert.deepEqual(f.events.find(event => event.kind === "local.company-tool.completed").value.artifacts,
      [{ id: artifact.id, name: artifact.name, version: 1, asset_version_id: artifact.version.id }]);
    assert.equal(f.requests.length, 4);
  } finally { await f.clean(); }
});

test("native company writes are denied in local read-only mode before dispatch", { timeout: 120000 }, async () => {
  const f = await fixture(); let calls = 0;
  try {
    const b = { ...f.binding, grant: { ...f.binding.grant, mode: "read-only" as const },
      companyTools: [{ name: "image2_generate", description: "Generate an image through the company.", inputSchema: { type: "object", properties: {}, additionalProperties: false } }] };
    const native = f.make(f.profile, b, async () => { calls++; throw new Error("Must not dispatch"); }); await f.start(native);
    f.actions.push({ company: { tool: "image2_generate", arguments: {} } });
    await native.turn("Exercise the explicit read-only denial fixture.");
    assert.equal(calls, 0);
    assert.ok(f.events.some(event => event.kind === "local.company-tool.failed" && event.value.code === "LOCAL_COMPANY_TOOL_READ_ONLY"));
    assert.ok(!f.events.some(event => event.kind === "local.company-tool.completed"));
  } finally { await f.clean(); }
});

test("native company uncertainty stops the turn and never repeats an accepted operation", { timeout: 120000 }, async () => {
  const f = await fixture(); let calls = 0;
  try {
    const b = { ...f.binding, companyTools: [{ name: "image2_generate", description: "Company uncertain-image fixture.", inputSchema: { type: "object", properties: {}, additionalProperties: false } }] };
    const native = f.make(f.profile, b, async () => { calls++; throw new Error("Synthetic lost accepted company response"); }); await f.start(native);
    f.actions.push({ company: { tool: "image2_generate", arguments: {} } });
    await assert.rejects(native.turn("Exercise the lost accepted company response.")); await native.close();
    assert.equal(calls, 1); assert.equal(f.requests.length, 1); assert.equal((await f.checkpoint()).phase, "uncertain");
    assert.ok(!f.events.some(event => event.kind === "local.company-tool.completed"));
  } finally { await f.clean(); }
});

test("native company work is aborted when the owning local runtime closes", { timeout: 120000 }, async () => {
  const f = await fixture(); let entered!: () => void, aborted = false;
  const started = new Promise<void>(resolve => { entered = resolve; });
  try {
    const b = { ...f.binding, companyTools: [{ name: "font_catalog", description: "Company abort fixture.", inputSchema: { type: "object", properties: {}, additionalProperties: false } }] };
    const native = f.make(f.profile, b, async (_call, signal) => { entered(); return new Promise((_resolve, reject) => {
      const stop = () => { aborted = true; reject(new Error("Owned company call aborted")); };
      signal.addEventListener("abort", stop, { once: true }); if (signal.aborted) stop();
    }); });
    await f.start(native); f.actions.push({ company: { tool: "font_catalog", arguments: {} } });
    const turn = native.turn("Keep the company fixture waiting until Stop."); const rejected = assert.rejects(turn);
    let entryTimer: ReturnType<typeof setTimeout> | undefined;
    try { await Promise.race([started, new Promise((_resolve, reject) => { entryTimer = setTimeout(() => reject(new Error("Native tool did not enter")), 30000); })]); }
    finally { if (entryTimer) clearTimeout(entryTimer); }
    await native.close(); await rejected;
    assert.equal(aborted, true); assert.equal(f.requests.length, 1); assert.ok(!f.events.some(event => event.kind === "local.company-tool.completed"));
  } finally { await f.clean(); }
});

test("a clean local thread survives inference credential expiry and resumes only with a fresh credential", { timeout: 120000 }, async t => {
  const f = await fixture();
  try {
    const expiresAt = Date.now() + 30000;
    const first = f.make(); await f.start(first, expiresAt);
    f.actions.push({}); const result = await first.turn("Create the owned clean checkpoint.", t.signal);
    // Wait for this short-lived credential, never for a remote scheduled job.
    await new Promise(resolve => setTimeout(resolve, Math.max(0, expiresAt - Date.now() + 300))); await first.close();
    assert.equal((await f.checkpoint()).phase, "ready");
    const resumed = f.make(); await f.start(resumed);
    f.actions.push({}); const next = await resumed.turn("Continue with the renewed company credential.", t.signal);
    assert.equal(next.threadId, result.threadId); assert.notEqual(next.turnId, result.turnId);
  } finally { await f.clean(); }
});

test("native full access edits an existing file outside cwd, loads the real Skill and resumes the same local thread", { timeout: 120000 }, async (t) => {
  const f = await fixture();
  try {
    const target = path.join(f.outside, "existing.txt");
    await writeFile(target, "before");
    const session = f.make();
    await f.start(session);
    const pid = f.pid();
    assert.ok(pid > 0 && pid !== process.pid);
    f.actions.push({ command: writeCommand(target, "after-local-native-turn") });
    const result = await session.turn("Update the owned fixture using the local terminal and the selected Skill.", t.signal);
    assert.equal(result.status, "completed");
    assert.equal(await readFile(target, "utf8"), "after-local-native-turn");
    assert.ok(f.requests.length >= 2);
    assert.ok(f.requests.every((request) => request.authorized));
    assert.ok(f.requests.every((request) => request.body.model === f.profile.model && request.body.reasoning?.effort === f.profile.effort));
    assert.ok(JSON.stringify(f.requests[0].body.input).includes("NATIVE_SKILL_FROM_DISK_73D6"), "Skill content must be loaded by native Codex from disk");
    assert.ok(JSON.stringify(f.requests.at(-1).body.input).includes("runtime-token-present=False"), "Native shell must not inherit the inference credential");
    assert.equal(JSON.stringify(f.events).includes(f.token), false);
    assert.equal((await f.checkpoint()).phase, "ready");
    const duplicate = f.make();
    await assert.rejects(f.start(duplicate), { code: "LOCAL_SESSION_ALREADY_OWNED" });
    await session.close();
    assert.throws(() => process.kill(pid, 0));
    const continued = f.make();
    await f.start(continued);
    f.actions.push({});
    const next = await continued.turn("Continue this same local session and report the completed fixture.", t.signal);
    assert.equal(next.status, "completed");
    assert.equal(next.threadId, result.threadId);
    assert.notEqual(next.turnId, result.turnId);
    t.diagnostic(JSON.stringify({ version: lock.runtime_version, native_binary_sha256: lock.windows_x64_sha256,
      outside_cwd_file_sha256: digest(await readFile(target)), same_thread: true, credential_excluded_from_shell: true }));
  } finally { await f.clean(); }
});

test("native full-to-read-only downgrade prevents a later outside-cwd write and cannot be rolled back by an old grant", { timeout: 120000 }, async (t) => {
  const f = await fixture();
  try {
    const target = path.join(f.outside, "read-only.txt");
    await writeFile(target, "unchanged");
    const session = f.make(); await f.start(session);
    await session.updatePermission({ ...f.binding.grant, mode: "read-only", revision: 2 });
    await assert.rejects(session.updatePermission(f.binding.grant), { code: "LOCAL_PERMISSION_VERSION_CONFLICT" });
    f.actions.push({ command: writeCommand(target, "must-not-be-written") });
    const result = await session.turn("Attempt the owned write so the read-only denial can be verified.", t.signal);
    assert.equal(result.status, "completed");
    assert.equal(await readFile(target, "utf8"), "unchanged");
    assert.ok(f.events.some((event) => event.kind === "local.permission.changed" && event.value.mode === "read-only"));
    await session.close();
    await assert.rejects(f.start(f.make()), { code: "LOCAL_PERMISSION_VERSION_CONFLICT" });
  } catch (error) {
    t.diagnostic(JSON.stringify(f.events.filter((event) => event.kind === "local.runtime.rpc_rejected")));
    throw error;
  } finally { await f.clean(); }
});

test("local binary, provider, Skill and permission-owner mismatches dispatch no inference", { timeout: 120000 }, async () => {
  const f = await fixture();
  try {
    for (const [profile, binding, code] of [
      [{ ...f.profile, executableSha256: "0".repeat(64) }, f.binding, "LOCAL_CODEX_HASH_MISMATCH"],
      [{ ...f.profile, version: "0.0.0" }, f.binding, "LOCAL_CODEX_VERSION_MISMATCH"],
      [{ ...f.profile, baseURL: "https://other.example.invalid/v1" }, f.binding, "LOCAL_GATEWAY_INVALID"],
      [f.profile, { ...f.binding, grant: { ...f.binding.grant, actorId: randomUUID() } }, "LOCAL_PERMISSION_REQUIRED"],
      [f.profile, { ...f.binding, skills: [{ ...f.binding.skills[0], content: "changed" }] }, "LOCAL_SKILL_INVALID"],
    ] as const) await assert.rejects(f.start(f.make(profile, binding)), { code });
    assert.equal(f.requests.length, 0);
  } finally { await f.clean(); }
});

test("native interruption and revocation stop only this owned process and reject further local turns", { timeout: 120000 }, async (t) => {
  const f = await fixture();
  try {
    const session = f.make(); await f.start(session);
    const controller = new AbortController();
    f.actions.push({ stall: () => controller.abort() });
    const result = await session.turn("Wait for the owned interruption fixture.", AbortSignal.any([controller.signal, t.signal]));
    assert.equal(result.status, "interrupted");
    await session.revoke();
    assert.equal((await f.checkpoint()).phase, "revoked");
    assert.throws(() => process.kill(f.pid(), 0));
    await assert.rejects(session.turn("Do not run after revocation."), { code: "LOCAL_SESSION_NOT_READY" });
  } finally { await f.clean(); }
});

test("an abruptly lost native turn preserves an uncertain checkpoint and refuses blind replay", { timeout: 120000 }, async () => {
  const f = await fixture();
  try {
    const session = f.make(); await f.start(session);
    f.actions.push({ stall: () => process.kill(f.pid()) });
    await assert.rejects(session.turn("This accepted fixture loses its native process."), { code: "LOCAL_CODEX_EXITED" });
    await session.close();
    assert.equal((await f.checkpoint()).phase, "uncertain");
    const calls = f.requests.length;
    await assert.rejects(f.start(f.make()), { code: "LOCAL_CHECKPOINT_RECONCILIATION_REQUIRED" });
    assert.equal(f.requests.length, calls);
  } finally { await f.clean(); }
});

test("current account authority is checked before each native turn", { timeout: 120000 }, async () => {
  const f = await fixture();
  try {
    const session = f.make(); await f.start(session);
    f.revokeAuthority();
    await assert.rejects(session.turn("Must not dispatch after account revocation."), /Account revoked/);
    assert.equal(f.requests.length, 0);
    assert.equal((await f.checkpoint()).phase, "ready");
  } finally { await f.clean(); }
});

test("changing a materialized Skill is rejected before another provider request", { timeout: 120000 }, async () => {
  const f = await fixture();
  try {
    const session = f.make(); await f.start(session);
    const file = path.join(f.stateRoot, "local-codex", f.binding.sessionId, "home/skills/native-fixture-method/SKILL.md");
    await writeFile(file, skill + "\nChanged after authorization.");
    await assert.rejects(session.turn("Must not load a changed Skill."), { code: "LOCAL_SKILL_CHANGED" });
    assert.equal(f.requests.length, 0);
  } finally { await f.clean(); }
});

test("a previous account or project checkpoint cannot be taken over or rewritten", { timeout: 120000 }, async () => {
  const f = await fixture();
  try {
    const session = f.make(); await f.start(session); await session.close();
    const before = await f.checkpoint(), foreignActor = randomUUID();
    const materialized = path.join(f.stateRoot, "local-codex", f.binding.sessionId, "home/skills/native-fixture-method/SKILL.md");
    const skillBefore = await readFile(materialized);
    const foreignSkill = skill + "\nForeign session content must not be materialized.";
    const skills = [{ ...f.binding.skills[0], content: foreignSkill, sha256: digest(foreignSkill) }];
    for (const binding of [
      { ...f.binding, skills, actorId: foreignActor, grant: { ...f.binding.grant, actorId: foreignActor } },
      { ...f.binding, skills, projectId: randomUUID() },
    ]) {
      await assert.rejects(f.start(f.make(f.profile, binding)), { code: "LOCAL_CHECKPOINT_BINDING_MISMATCH" });
      assert.deepEqual(await f.checkpoint(), before);
      assert.deepEqual(await readFile(materialized), skillBefore, "Rejected ownership must not overwrite the original session Skill");
    }
    assert.equal(f.requests.length, 0);
  } finally { await f.clean(); }
});

test("an unused local session can reopen without replaying inference or resuming a nonexistent native rollout", { timeout: 120000 }, async () => {
  const f = await fixture();
  try {
    const first = f.make(); await f.start(first);
    const initial = await f.checkpoint(); await first.close();
    const second = f.make(); await f.start(second);
    const reopened = await f.checkpoint();
    assert.equal(reopened.hasTurns, false);
    assert.notEqual(reopened.threadId, initial.threadId);
    assert.equal(reopened.binding, initial.binding);
    assert.equal(f.requests.length, 0);
  } finally { await f.clean(); }
});
