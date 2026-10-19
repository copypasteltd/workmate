import { test } from "node:test";
import assert from "node:assert/strict";
import {
  NativeSession,
  NativeSessionError,
  type NativeTokens,
} from "../src/native-session.js";
const credential = (letter: string) => letter.repeat(43);
const response = (letter: string) => ({
  access_token: credential(letter),
  refresh_token: credential(letter.toUpperCase()),
  expires_in: 900,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function fixture() {
  let current: NativeTokens | null = { ...response("a"), expires_at: 1000 },
    calls = 0,
    changes = 0;
  const revoked: string[] = [];
  let renew: (token: string) => Promise<unknown> = async () => response("b");
  let revoke: (token: string) => Promise<void> = async (token) => {
    revoked.push(token);
  };
  const store = {
    read: async () => current,
    write: async (value: NativeTokens | null) => {
      current = value;
    },
    renew: async (token: string) => {
      ++calls;
      return renew(token);
    },
    revoke: (token: string) => revoke(token),
    changed: () => {
      ++changes;
    },
    now: () => 1000,
  };
  return {
    session: new NativeSession(store),
    store,
    current: () => current,
    calls: () => calls,
    changes: () => changes,
    revoked,
    renew: (fn: typeof renew) => {
      renew = fn;
    },
    revoke: (fn: typeof revoke) => {
      revoke = fn;
    },
  };
}
test("concurrent expired-token readers rotate once and use the same new credential", async () => {
  const f = fixture(),
    started = deferred<void>(),
    finish = deferred<unknown>();
  f.renew(async () => {
    started.resolve();
    return finish.promise;
  });
  const all = Promise.all(Array.from({ length: 20 }, () => f.session.get()));
  await started.promise;
  finish.resolve(response("b"));
  const values = await all;
  assert.equal(f.calls(), 1);
  assert.ok(values.every((v) => v.access_token === credential("b")));
  assert.equal(f.current()?.refresh_token, credential("B"));
});
test("sign-out fences a refresh already accepted remotely and revokes its late result", async () => {
  const f = fixture(),
    started = deferred<void>(),
    finish = deferred<unknown>();
  f.renew(async () => {
    started.resolve();
    return finish.promise;
  });
  const pending = assert.rejects(f.session.get(), /AUTH_CHANGED/);
  await started.promise;
  assert.deepEqual(await f.session.signOut(), { remote_revoked: true });
  finish.resolve(response("b"));
  await pending;
  assert.equal(f.current(), null);
  assert.deepEqual(f.revoked.sort(), [credential("A"), credential("B")].sort());
});
test("late login after sign-out cannot replace a later account", async () => {
  const f = fixture(),
    old = f.session.beginLogin();
  await f.session.signOut();
  await f.session.acceptLogin(response("c"), f.session.beginLogin());
  await assert.rejects(
    f.session.acceptLogin(response("b"), old),
    /AUTH_CHANGED/,
  );
  assert.equal(f.current()?.access_token, credential("c"));
  assert.ok(f.revoked.includes(credential("B")));
  assert.ok(!f.revoked.includes(credential("C")));
});
test("a stale request's unauthorized response cannot clear a replacement account", async () => {
  const f = fixture();
  await f.session.acceptLogin(response("c"), f.session.beginLogin());
  const changes = f.changes();
  const revoked = f.revoked.length;
  await f.session.invalidate(credential("a"));
  assert.equal(f.current()?.access_token, credential("c"));
  assert.equal(f.changes(), changes);
  assert.equal(f.revoked.length, revoked);
});
test("transport/temporary failures preserve credentials; definitive rejection clears and revokes", async () => {
  const f = fixture();
  f.renew(async () => {
    throw new NativeSessionError("AUTH_UNAVAILABLE");
  });
  await assert.rejects(f.session.get(), /AUTH_UNAVAILABLE/);
  assert.equal(f.current()?.refresh_token, credential("A"));
  assert.equal(f.changes(), 0);
  f.renew(async () => {
    throw new NativeSessionError("AUTH_REQUIRED");
  });
  await assert.rejects(f.session.get(), /AUTH_REQUIRED/);
  assert.equal(f.current(), null);
  assert.deepEqual(f.revoked, [credential("A")]);
});
test("logout during asynchronous credential persistence is serialized after the write", async () => {
  const f = fixture(),
    entered = deferred<void>(),
    release = deferred<void>();
  const original = f.store.write;
  f.store.write = async (value) => {
    if (value) {
      entered.resolve();
      await release.promise;
    }
    await original(value);
  };
  const pending = assert.rejects(
    f.session.acceptLogin(response("b"), f.session.beginLogin()),
    /AUTH_CHANGED/,
  );
  await entered.promise;
  const logout = f.session.signOut();
  release.resolve();
  await pending;
  await logout;
  assert.equal(f.current(), null);
  assert.ok(f.revoked.includes(credential("B")));
});
test("malformed gateway credentials are rejected before persistence", async () => {
  const f = fixture();
  for (const data of [
    null,
    {},
    { ...response("b"), expires_in: -1 },
    { ...response("b"), access_token: "short" },
  ])
    await assert.rejects(
      f.session.acceptLogin(data, f.session.beginLogin()),
      /AUTH_UNAVAILABLE/,
    );
  assert.equal(f.current()?.access_token, credential("a"));
});
test("offline sign-out removes local credentials and reports unconfirmed remote revocation", async () => {
  const f = fixture();
  f.revoke(async () => {
    throw new Error("offline");
  });
  assert.deepEqual(await f.session.signOut(), { remote_revoked: false });
  assert.equal(f.current(), null);
  await assert.rejects(f.session.get(), /AUTH_REQUIRED/);
});
test("credential persistence failure revokes the newly issued credential", async () => {
  for (const flow of ["login", "refresh"]) {
    const f = fixture();
    f.store.write = async () => {
      throw new Error("disk unavailable");
    };
    await assert.rejects(
      flow === "login"
        ? f.session.acceptLogin(response("b"), f.session.beginLogin())
        : f.session.get(),
      /AUTH_UNAVAILABLE/,
    );
    assert.ok(f.revoked.includes(credential("B")));
    assert.equal(f.current()?.access_token, credential("a"));
  }
});
test("a rejected obsolete refresh cannot sign out a later account", async () => {
  const f = fixture(),
    entered = deferred<void>();
  let reject!: (reason: Error) => void;
  f.renew(() => {
    entered.resolve();
    return new Promise((_r, fail) => {
      reject = fail;
    });
  });
  const pending = assert.rejects(f.session.get(), /AUTH_CHANGED/);
  await entered.promise;
  await f.session.acceptLogin(response("c"), f.session.beginLogin());
  reject(new NativeSessionError("AUTH_REQUIRED"));
  await pending;
  assert.equal(f.current()?.access_token, credential("c"));
});
