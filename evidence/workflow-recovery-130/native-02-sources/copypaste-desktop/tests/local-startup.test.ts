import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { LocalStartupCoordinator, LocalStartupRecoveryPending, type LocalStartupJournal } from "../src/local-startup.js";
import { LocalCodexError, LocalCodexStartupFailure } from "../src/local-codex.js";
import type { LocalAgentRuntime } from "../src/local-agent.js";

function fixture() {
  const taskId = randomUUID(), firstFence = randomUUID(), nextFence = randomUUID();
  const deadline = new Date(Date.now() + 300000).toISOString();
  const checkpoint: { startup?: LocalStartupJournal } = {}, abort = new AbortController();
  const history: string[] = [], calls: { path: string; body: any; key: string }[] = [], snapshots: any[] = [];
  let owner = true, authority = true, launched = 0, turns = 0, fail: unknown = new LocalCodexStartupFailure("LOCAL_CODEX_DISCONNECTED", "initialize");
  let secondFail: unknown, cleanupFail = false, recoveryLost = 0, gateLost = false;
  const receipt = (attempt: number) => ({ task_id: taskId, state: "running", status: "running",
    startup: { protocol: "desktop-startup-recovery-v1", state: "preparing", attempt, max_attempts: 2,
      fencing_token: attempt === 1 ? firstFence : nextFence, contract_sha256: "a".repeat(64), deadline_at: deadline },
    credential: { token: "scoped-synthetic-credential-" + attempt, expires_at: deadline } });
  const hooks = {
    checkpoint, taskId, fields: { device_id: randomUUID(), local_session_id: randomUUID() }, signal: abort.signal,
    assertOwner: async () => { if (!owner) throw new LocalCodexError("LOCAL_ACCOUNT_CHANGED"); },
    authorize: async () => { history.push("authorize"); if (!authority) throw new LocalCodexError("LOCAL_PERMISSION_REVOKED"); },
    persist: async () => { snapshots.push(structuredClone(checkpoint)); history.push("persist"); },
    stopHeartbeat: async () => { history.push("stop-heartbeat"); }, startHeartbeat: () => { history.push("start-heartbeat"); },
    event: async (value: any) => { history.push(value.status); },
    request: async (path: string, body: any, key: string) => {
      calls.push({ path, body: structuredClone(body), key }); history.push(path);
      if (path === "/start") return { status: 200, body: receipt(1) };
      if (path === "/startup-recovery") { if (recoveryLost-- > 0) throw new Error("Synthetic response lost after acceptance"); return { status: 200, body: receipt(2) }; }
      if (gateLost) throw new Error("Synthetic turn gate response lost");
      return { status: 200, body: { admitted: true, task_id: taskId, startup_fencing_token: checkpoint.startup!.fencingToken } };
    },
  };
  const factory = () => {
    launched++; const attempt = launched;
    assert.equal(checkpoint.startup?.launchAttempt, attempt, "Persist the launch before acquiring a runtime");
    assert.equal(snapshots.at(-1).startup.launchAttempt, attempt);
    const runtime: LocalAgentRuntime = {
      start: async () => { history.push("start-" + attempt); if (attempt === 1 && fail) throw fail; if (attempt === 2 && secondFail) throw secondFail; },
      turn: async () => { turns++; return { status: "completed", text: "synthetic", threadId: "native", turnId: "turn", nativeTokenUsage: null }; },
      close: async () => { history.push("close-" + attempt); if (cleanupFail) throw new LocalCodexError("LOCAL_CLEANUP_INCOMPLETE"); },
      interrupt: async () => {}, revoke: async () => {},
    };
    return { runtime, closeResources: async () => { history.push("resources-" + attempt); } };
  };
  return { taskId, checkpoint, hooks, factory, history, calls, snapshots, abort, receipt,
    coordinator: () => new LocalStartupCoordinator(hooks), launched: () => launched, turns: () => turns,
    setOwner: (v: boolean) => { owner = v; }, setAuthority: (v: boolean) => { authority = v; },
    setFailure: (v: unknown) => { fail = v; }, setSecondFailure: (v: unknown) => { secondFail = v; },
    failCleanup: () => { cleanupFail = true; }, loseRecovery: (n: number) => { recoveryLost = n; }, loseGate: () => { gateLost = true; },
  };
}

test("pre-turn recovery drains both owned resources before rotating authority and retains one deadline/task", async () => {
  const f = fixture(), coordinator = f.coordinator(), initial = await coordinator.admission(randomUUID());
  const started = await coordinator.start(initial, f.factory);
  assert.equal(f.launched(), 2); assert.equal(f.turns(), 0);
  assert.ok(f.history.indexOf("close-1") < f.history.indexOf("resources-1"));
  assert.ok(f.history.indexOf("resources-1") < f.history.indexOf("stop-heartbeat"));
  assert.ok(f.history.indexOf("stop-heartbeat") < f.history.indexOf("/startup-recovery"));
  assert.ok(f.history.indexOf("/startup-recovery") < f.history.indexOf("start-2"));
  assert.equal(started.receipt.task_id, initial.task_id);
  assert.equal(started.receipt.credential.expires_at, initial.credential.expires_at);
  assert.notEqual(started.receipt.startup.fencing_token, initial.startup.fencing_token);
  assert.equal(f.calls.filter(c => c.path === "/start").length, 1);
  assert.ok(!JSON.stringify(f.snapshots).includes("scoped-synthetic-credential"));
  await coordinator.admitTurn();
  assert.equal(f.calls.at(-1)!.body.startup_fencing_token, started.receipt.startup.fencing_token);
});

for (const error of [new Error("unknown native failure"), new LocalCodexError("LOCAL_CODEX_RPC_REJECTED"), new LocalCodexError("LOCAL_CODEX_PROFILE_INVALID")])
  test("unclassified startup error cannot obtain recovery authority: " + error.message, async () => {
    const f = fixture(); f.setFailure(error); const c = f.coordinator();
    await assert.rejects(c.start(await c.admission(randomUUID()), f.factory), e => e === error);
    assert.equal(f.launched(), 1); assert.equal(f.calls.length, 1); assert.equal(f.checkpoint.startup?.launchAttempt, 1);
  });

test("a second native transport failure is terminal and never creates a third process", async () => {
  const f = fixture(), c = f.coordinator(); f.setSecondFailure(new LocalCodexStartupFailure("LOCAL_CODEX_RPC_TIMEOUT", "thread/resume"));
  await assert.rejects(c.start(await c.admission(randomUUID()), f.factory), { code: "LOCAL_CODEX_RPC_TIMEOUT" });
  assert.equal(f.launched(), 2); assert.equal(f.calls.filter(c => c.path === "/startup-recovery").length, 1);
  await assert.rejects(f.coordinator().admission(randomUUID()), { code: "LOCAL_STARTUP_OWNER_REVIEW_REQUIRED" });
  assert.equal(f.launched(), 2);
});

test("incomplete native cleanup keeps the first launch consumed and cannot fence or restart", async () => {
  const f = fixture(), c = f.coordinator(); f.failCleanup();
  await assert.rejects(c.start(await c.admission(randomUUID()), f.factory), { code: "LOCAL_CLEANUP_INCOMPLETE" });
  assert.equal(f.calls.length, 1); assert.equal(f.checkpoint.startup?.launchAttempt, 1);
});

for (const action of ["owner", "permission", "cancel"] as const) test(action + " withdrawal after cleanup prevents recovery", async () => {
  const f = fixture(), c = f.coordinator(), original = f.factory;
  const factory = () => { const owned = original(), cleanup = owned.closeResources;
    owned.closeResources = async () => { await cleanup(); if (action === "owner") f.setOwner(false); else if (action === "permission") f.setAuthority(false); else f.abort.abort(); }; return owned; };
  await assert.rejects(c.start(await c.admission(randomUUID()), factory));
  assert.equal(f.launched(), 1); assert.equal(f.calls.length, 1);
});

test("a lost recovery response uses the exact same durable key and body without another initial admission", async () => {
  const f = fixture(), c = f.coordinator(); f.loseRecovery(1);
  await c.start(await c.admission(randomUUID()), f.factory);
  const attempts = f.calls.filter(c => c.path === "/startup-recovery");
  assert.equal(attempts.length, 2); assert.equal(attempts[0].key, attempts[1].key); assert.deepEqual(attempts[0].body, attempts[1].body);
  assert.equal(f.launched(), 2); assert.equal(f.calls.filter(c => c.path === "/start").length, 1);
});

test("pending recovery survives a controller restart and retrieves only its original intent", async () => {
  const f = fixture(), c = f.coordinator(); f.loseRecovery(2);
  await assert.rejects(c.start(await c.admission(randomUUID()), f.factory), LocalStartupRecoveryPending);
  const intent = structuredClone(f.checkpoint.startup!.recovery); assert.equal(f.launched(), 1);
  const restored = f.coordinator(), receipt = await restored.admission(randomUUID());
  await restored.start(receipt, f.factory);
  assert.equal(f.launched(), 2); assert.equal(f.calls.filter(c => c.path === "/start").length, 1);
  for (const call of f.calls.filter(c => c.path === "/startup-recovery")) { assert.equal(call.key, intent!.key); assert.deepEqual(call.body, intent!.body); }
});

test("an uncertain durable launch is never restarted even when no turn receipt exists", async () => {
  const f = fixture(), c = f.coordinator(); await c.admission(randomUUID());
  f.checkpoint.startup!.launchAttempt = 1;
  await assert.rejects(f.coordinator().admission(randomUUID()), { code: "LOCAL_STARTUP_OWNER_REVIEW_REQUIRED" });
  assert.equal(f.calls.length, 1); assert.equal(f.launched(), 0);
});

test("a lost turn-admission reply cannot open the native turn or restore startup replay", async () => {
  const f = fixture(), c = f.coordinator(); f.setFailure(undefined); f.loseGate();
  await c.start(await c.admission(randomUUID()), f.factory);
  await assert.rejects(c.admitTurn(), { code: "LOCAL_COMPANY_API_UNAVAILABLE" });
  const gateKey = f.checkpoint.startup!.turnKey; assert.ok(gateKey); assert.equal(f.turns(), 0);
  await assert.rejects(f.coordinator().admission(randomUUID()), { code: "LOCAL_STARTUP_OWNER_REVIEW_REQUIRED" });
  assert.equal(f.calls.filter(c => c.path === "/startup-recovery").length, 0);
});

for (const field of ["deadline", "contract", "epoch"] as const) test("recovery rejects a changed " + field + " receipt", async () => {
  const f = fixture(), request = f.hooks.request;
  f.hooks.request = async (path, body, key) => { const reply = await request(path, body, key); if (path === "/startup-recovery") {
    const b: any = reply.body; if (field === "deadline") b.startup.deadline_at = b.credential.expires_at = new Date(Date.now() + 600000).toISOString();
    else if (field === "contract") b.startup.contract_sha256 = "b".repeat(64); else b.startup.fencing_token = f.receipt(1).startup.fencing_token;
  } return reply; };
  const c = f.coordinator(); await assert.rejects(c.start(await c.admission(randomUUID()), f.factory), { code: "LOCAL_STARTUP_ADMISSION_INVALID" });
  assert.equal(f.launched(), 1); assert.equal(f.turns(), 0);
});
