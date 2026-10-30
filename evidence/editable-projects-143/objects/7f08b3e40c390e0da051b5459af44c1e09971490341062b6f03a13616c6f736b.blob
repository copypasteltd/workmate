import { test } from "node:test";
import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { CodexRuntimeAdapter, RuntimeFailure } from "../src/runtime.js";
import { binary, fixture } from "./runtime-pre-turn-fixture.js";
import { suspendOwnedNative, withOwnedNativeProcesses, type OwnedNativeProcess } from "./native-runtime-faults.js";

test("a delayed native fault retains exact spawn ownership and rejects a different process-creation window", { timeout: 60000 }, async t => {
  const f = await fixture(t), emit = f.context.onEvent;
  let native!: OwnedNativeProcess, paused = false;
  f.context.onEvent = async (kind, body) => {
    await emit(kind, body);
    if (kind !== "runtime.thread") return;
    await delay(1800, undefined, { signal: t.signal });
    assert.ok(Date.now() - native.spawnedAt >= 1800);
    const original = native.spawnedAt;
    try {
      native.spawnedAt -= 60000;
      assert.throws(() => suspendOwnedNative(native, binary), error => {
        const stderr = String((error as { stderr?: unknown }).stderr ?? "");
        assert.ok(stderr.includes("Owned native creation time mismatch"));
        return true;
      });
    } finally { native.spawnedAt = original; }
    suspendOwnedNative(native, binary); paused = true;
    f.controller.abort();
  };
  try {
    await withOwnedNativeProcesses(binary, f.root, row => { native = row; }, async owned => {
      await assert.rejects(new CodexRuntimeAdapter(f.config).start(f.context), error => error instanceof RuntimeFailure
        && error.code === "CODEX_CANCELLED" && !error.accepted && error.usageKnown);
      assert.equal(paused, true); assert.equal(owned.length, 1); assert.ok(owned[0].closed);
      assert.equal(f.calls.length, 0); assert.equal(f.toolCalls(), 0);
    });
  } finally { await f.close(); }
});
