import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { CodexRuntimeAdapter, RuntimeFailure } from "../src/runtime.js";
import { binary, fixture } from "./runtime-pre-turn-fixture.js";
import { injectNativeFrame, interceptNativeRPC, suspendOwnedNative, withOwnedNativeProcesses,
  type OwnedNativeProcess } from "./native-runtime-faults.js";

for (const method of ["thread/start", "thread/resume"] as const)
  for (const fault of ["connection", "timeout"] as const)
    test(`${method} ${fault}: pre-turn recovery closes the old native process and submits one original turn`,
      { timeout: fault === "timeout" ? 150000 : 90000 }, async t => {
        const f = await fixture(t), seen: OwnedNativeProcess[] = [];
        const emit = f.context.onEvent;
        let baseline = 0, originalThread: string | undefined;
        f.context.onEvent = async (kind, body) => {
          await emit(kind, body);
          if (kind === "runtime.startup.retry") {
            assert.equal(seen.length, baseline + 1);
            assert.ok(seen.every(row => row.closed));
            assert.equal(f.calls.length, baseline, "No new provider work may precede startup recovery");
            assert.equal(f.toolCalls(), 0);
          }
        };
        try {
          await withOwnedNativeProcesses(binary, f.root, (row, index) => {
            seen.push(row);
            const faulty = method === "thread/resume" ? 2 : 1;
            if (index === faulty) interceptNativeRPC(row, method, (_request, complete) => {
              complete();
              if (fault === "timeout") suspendOwnedNative(row, binary);
              else row.child.kill("SIGKILL");
            });
          }, async owned => {
            const runtime = new CodexRuntimeAdapter(f.config);
            if (method === "thread/resume") {
              const first = await runtime.start(f.context);
              assert.equal(first.status, "completed");
              assert.equal(first.inputTokens, 17); assert.equal(first.outputTokens, 5);
              originalThread = first.thread; f.context.thread = first.thread; baseline = 1;
            }
            let result;
            try { result = await runtime.start(f.context); }
            catch (error) {
              t.diagnostic(JSON.stringify({ code: error instanceof RuntimeFailure ? error.code : "UNEXPECTED",
                method, fault, provider_calls: f.calls.length, events: f.events }));
              throw error;
            }
            assert.equal(result.status, "completed");
            assert.equal(result.text, "Startup fixture delivered.");
            assert.equal(result.usageKnown, true); assert.equal(result.accepted, true);
            assert.equal(result.inputTokens, 17); assert.equal(result.outputTokens, 5);
            if (originalThread) assert.equal(result.thread, originalThread);
            assert.equal(owned.length, baseline + 2); assert.ok(owned.every(row => row.closed));
            assert.equal(f.calls.length, baseline + 1); assert.ok(f.calls.every(row => row.authorized));
            assert.equal(f.events.filter(row => row.kind === "runtime.turn").length, baseline + 1);
            const retries = f.events.filter(row => row.kind === "runtime.startup.retry");
            assert.equal(retries.length, 1); assert.equal(retries[0].body.method, method);
            const diagnostic = f.events.find(row => row.kind === "runtime.rpc.failed")!.body;
            assert.equal(diagnostic.method, method); assert.equal(diagnostic.provider_requests, 0);
            assert.equal(diagnostic.code, fault === "timeout" ? "CODEX_RPC_TIMEOUT" : "CODEX_CONNECTION_LOST");
            if (fault === "timeout") assert.ok(diagnostic.elapsed_ms >= 59000,
              "The unchanged production 60-second RPC deadline must really expire");
          });
        } finally { await f.close(); }
      });

for (const method of ["thread/start", "thread/resume"] as const)
  test(`${method}: an explicit rejection never restarts or leaks native error text`, { timeout: 90000 }, async t => {
    const f = await fixture(t);
    let originalReceipt: Buffer | undefined;
    try {
      await withOwnedNativeProcesses(binary, f.root, (row, index) => {
        if (index === (method === "thread/resume" ? 2 : 1)) interceptNativeRPC(row, method, (request, complete) => {
          complete(); queueMicrotask(() => injectNativeFrame(row,
            { id: request.id, error: { code: -32600, message: "PRIVATE_THREAD_REJECTION_MUST_NOT_ESCAPE" } }));
        });
      }, async owned => {
        const runtime = new CodexRuntimeAdapter(f.config), baseline = method === "thread/resume" ? 1 : 0;
        if (baseline) {
          const first = await runtime.start(f.context); f.context.thread = first.thread;
          originalReceipt = await readFile(path.join(f.root, ".codex/copypaste-continuation.json"));
        }
        await assert.rejects(runtime.start(f.context), error => error instanceof RuntimeFailure
          && error.code === "CODEX_RPC_REJECTED" && !error.accepted && error.usageKnown);
        assert.equal(owned.length, baseline + 1); assert.ok(owned.every(row => row.closed));
        assert.equal(f.calls.length, baseline);
        assert.equal(f.events.filter(row => row.kind === "runtime.startup.retry").length, 0);
        assert.equal(JSON.stringify(f.events).includes("PRIVATE_THREAD_REJECTION"), false);
        if (originalReceipt) assert.deepEqual(await readFile(path.join(f.root, ".codex/copypaste-continuation.json")), originalReceipt);
      });
    } finally { await f.close(); }
  });

test("pre-turn failures across initialize and thread/start share the same two-process recovery limit", { timeout: 90000 }, async t => {
  const f = await fixture(t);
  try {
    await withOwnedNativeProcesses(binary, f.root, (row, index) => {
      if (index === 1) row.child.kill("SIGKILL");
      else {
        assert.equal(index, 2);
        interceptNativeRPC(row, "thread/start", (_request, complete) => { complete(); row.child.kill("SIGKILL"); });
      }
    }, async owned => {
      await assert.rejects(new CodexRuntimeAdapter(f.config).start(f.context), error => error instanceof RuntimeFailure
        && error.code === "CODEX_CONNECTION_LOST" && !error.accepted && error.usageKnown);
      assert.equal(owned.length, 2); assert.ok(owned.every(row => row.closed));
      assert.equal(f.calls.length, 0); assert.equal(f.toolCalls(), 0);
      assert.equal(f.events.filter(row => row.kind === "runtime.startup.retry").length, 1);
    });
  } finally { await f.close(); }
});

test("cancellation after failed thread startup cleanup prevents another native process", { timeout: 90000 }, async t => {
  const f = await fixture(t), emit = f.context.onEvent;
  f.context.onEvent = async (kind, body) => {
    await emit(kind, body);
    if (kind === "runtime.phase" && body.phase === "closed") f.controller.abort();
  };
  try {
    await withOwnedNativeProcesses(binary, f.root, row => {
      interceptNativeRPC(row, "thread/start", (_request, complete) => { complete(); row.child.kill("SIGKILL"); });
    }, async owned => {
      await assert.rejects(new CodexRuntimeAdapter(f.config).start(f.context), error => error instanceof RuntimeFailure
        && error.code === "CODEX_CANCELLED" && !error.accepted);
      assert.equal(owned.length, 1); assert.ok(owned[0].closed); assert.equal(f.calls.length, 0);
      assert.equal(f.events.filter(row => row.kind === "runtime.startup.retry").length, 0);
    });
  } finally { await f.close(); }
});
