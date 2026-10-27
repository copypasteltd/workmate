import { test } from "node:test";
import assert from "node:assert/strict";
import { completeOperation, operationKey } from "../src/operation-key.ts";

test("lost-response attempts retain their identity, completed attempts can intentionally create another invitation", async () => {
  const items = new Map<string, string>();
  Object.defineProperty(globalThis, "sessionStorage", {
    configurable: true,
    value: {
      getItem: (k: string) => items.get(k) ?? null,
      setItem: (k: string, v: string) => items.set(k, v),
      removeItem: (k: string) => items.delete(k),
    },
  });
  try {
    const payload = {
      email: "private@example.invalid",
      token: "private-invite-token",
    };
    const first = await operationKey("account-a", "invite.create", payload);
    assert.equal(
      await operationKey("account-a", "invite.create", payload),
      first,
    );
    assert.notEqual(
      await operationKey("account-b", "invite.create", payload),
      first,
    );
    assert.notEqual(
      await operationKey("account-a", "invite.accept", payload),
      first,
    );
    assert.ok(!JSON.stringify([...items]).includes(payload.email));
    assert.ok(!JSON.stringify([...items]).includes(payload.token));
    await completeOperation("account-a", "invite.create", payload);
    assert.notEqual(
      await operationKey("account-a", "invite.create", payload),
      first,
    );
  } finally {
    Reflect.deleteProperty(globalThis, "sessionStorage");
  }
});
test("disabled storage preserves a retry in memory and successful completion releases it", async () => {
  const first = await operationKey("fallback-account", "invite.create", {});
  assert.equal(
    await operationKey("fallback-account", "invite.create", {}),
    first,
  );
  await completeOperation("fallback-account", "invite.create", {});
  assert.notEqual(
    await operationKey("fallback-account", "invite.create", {}),
    first,
  );
});
