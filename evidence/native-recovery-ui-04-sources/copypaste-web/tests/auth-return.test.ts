import { test } from "node:test";
import assert from "node:assert/strict";
import { authReturnPath } from "../src/auth-return.ts";
test("auth return rejects external origins, protocol-relative and backslash authority paths", () => {
  for (const value of [
    "https://outside.invalid/app",
    "//outside.invalid/app",
    "/\\outside.invalid/app",
    "\\\\outside.invalid/app",
    "/%5coutside.invalid",
    "/%2f%2foutside.invalid",
    null,
    "javascript:alert(1)",
  ])
    assert.equal(authReturnPath(value), "/app", String(value));
});
test("auth return rejects control bytes, malformed escaping and normalized API targets", () => {
  for (const value of [
    "/\n/outside.invalid",
    "/%0d%0aLocation:x",
    "/%not-an-escape",
    "/v1/auth/authorize?client_id=desktop",
    "/app/../v1/auth/authorize",
    "/v1%2fauth%2fauthorize",
  ])
    assert.equal(authReturnPath(value), "/app", value);
});
test("auth return preserves internal deep links and nested escaped PKCE callbacks", () => {
  for (const value of [
    "/app/settings",
    "/app/tasks/one?tab=files#result",
    "/app?q=summer%20sale",
    "/invite?token=one-time",
    "/authorize?client_id=desktop&redirect_uri=http%3A%2F%2F127.0.0.1%3A40555%2Fcallback&code_challenge=" +
      "a".repeat(43) +
      "&state=" +
      "b".repeat(43),
  ])
    assert.equal(authReturnPath(value), value);
});
