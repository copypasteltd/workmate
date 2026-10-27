import { test } from "node:test";
import assert from "node:assert/strict";
import { exchangeNativeCode } from "../src/native-code.js";
const body = {
  grant_type: "authorization_code",
  client_id: "desktop",
  code: "one-use-code",
  code_verifier: "private-verifier",
  redirect_uri: "http://127.0.0.1:40000/callback",
};
const result = {
  access_token: "synthetic-access",
  refresh_token: "synthetic-refresh",
  token_type: "Bearer",
  expires_in: 900,
};
test("a committed code exchange with a lost first response retries the same private key and payload once", async () => {
  const calls: RequestInit[] = [];
  const actual = await exchangeNativeCode(
    "https://internal.example.invalid/v1/auth/token",
    body,
    async (url, init) => {
      assert.equal(new URL(String(url)).search, "");
      calls.push(init!);
      if (calls.length === 1)
        throw new TypeError("Response lost after committed exchange");
      return Response.json(result, { status: 201 });
    },
  );
  assert.deepEqual(actual, result);
  assert.equal(calls.length, 2);
  const headers = calls.map((c) => new Headers(c.headers));
  assert.match(headers[0].get("Idempotency-Key")!, /^[0-9a-f-]{36}$/);
  assert.equal(
    headers[0].get("Idempotency-Key"),
    headers[1].get("Idempotency-Key"),
  );
  assert.equal(calls[0].body, calls[1].body);
  assert.equal(calls[0].body, JSON.stringify(body));
  assert.equal(calls[0].redirect, "error");
  assert.equal(headers[0].get("Authorization"), null);
});
test("definitive code-exchange rejections, including rate limits and conflicts, do not retry", async () => {
  for (const status of [400, 401, 403, 409, 429]) {
    let calls = 0;
    await assert.rejects(
      exchangeNativeCode(
        "https://internal.example.invalid/v1/auth/token",
        body,
        async () => {
          calls++;
          return Response.json({ error: { code: "rejected" } }, { status });
        },
      ),
      /Authorization expired or was rejected/,
    );
    assert.equal(calls, 1);
  }
});
test("temporary code-exchange failures are bounded and do not expose remote error content", async () => {
  let calls = 0;
  await assert.rejects(
    exchangeNativeCode(
      "https://internal.example.invalid/v1/auth/token",
      body,
      async () => {
        calls++;
        return new Response("sensitive upstream diagnostic", { status: 503 });
      },
    ),
    /Sign-in could not be completed/,
  );
  assert.equal(calls, 2);
});
test("a complete canonical response is accepted once; an unreadable first body can safely recover", async () => {
  let calls = 0;
  const send: typeof fetch = async () => {
    calls++;
    return calls === 1
      ? new Response("truncated", { status: 201 })
      : Response.json(result, { status: 201 });
  };
  assert.deepEqual(
    await exchangeNativeCode(
      "https://internal.example.invalid/v1/auth/token",
      body,
      send,
    ),
    result,
  );
  assert.equal(calls, 2);
  calls = 0;
  assert.deepEqual(
    await exchangeNativeCode(
      "https://internal.example.invalid/v1/auth/token",
      body,
      async () => {
        calls++;
        return Response.json(result, { status: 201 });
      },
    ),
    result,
  );
  assert.equal(calls, 1);
});
