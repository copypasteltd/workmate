import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer, type ServerResponse } from "node:http";
import { randomUUID, randomBytes, createHash } from "node:crypto";
import { mkdir, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { LocalCodexSession, type LocalCodexProfile, type LocalSessionBinding } from "../../src/local-codex.js";

const digest = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const lock = JSON.parse(await readFile(new URL("../../contracts/local-codex-runtime.json", import.meta.url), "utf8"));
const executable = process.env.COPYPASTE_LOCAL_CODEX_TEST_BIN;
assert.ok(executable && path.isAbsolute(executable), "Set COPYPASTE_LOCAL_CODEX_TEST_BIN to the locked absolute native Codex binary. No PATH fallback.");
const skill = "---\nname: native-fixture-method\ndescription: Verify a local fixture without fabricating results.\n---\nNATIVE_SKILL_FROM_DISK_73D6. Inspect actual tool results and preserve unrelated files.";
type Action = { command?: string; stall?: () => void; stage?: number };

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
  const make = (p = profile, b = binding) => {
    const session = new LocalCodexSession(p, b, { authorize: async () => { if (!authority) throw new Error("Account revoked"); },
      event: async (kind, value) => { events.push({ kind, value }); if (kind === "local.runtime.ready") readyPid = Number(value.pid); } });
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
    for (const binding of [
      { ...f.binding, actorId: foreignActor, grant: { ...f.binding.grant, actorId: foreignActor } },
      { ...f.binding, projectId: randomUUID() },
    ]) {
      await assert.rejects(f.start(f.make(f.profile, binding)), { code: "LOCAL_CHECKPOINT_BINDING_MISMATCH" });
      assert.deepEqual(await f.checkpoint(), before);
    }
    assert.equal(f.requests.length, 0);
  } finally { await f.clean(); }
});
