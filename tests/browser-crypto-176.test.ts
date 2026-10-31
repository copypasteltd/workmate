import test from "node:test";
import assert from "node:assert/strict";
import { createHash, webcrypto } from "node:crypto";
import { createBrowserCrypto } from "../src/browser-crypto.ts";

const crypto = createBrowserCrypto({ getRandomValues: webcrypto.getRandomValues.bind(webcrypto) } as Pick<Crypto, "getRandomValues">);
const hex = (b: ArrayBuffer) => Buffer.from(b).toString("hex");

test("HTTP fallback matches independent SHA-256 known vectors", async () => {
  for (const text of ["", "abc", "香港工作空間", "a".repeat(1_000_000)]) {
    const data = new TextEncoder().encode(text);
    assert.equal(hex(await crypto.subtle.digest("SHA-256", data)), createHash("sha256").update(data).digest("hex"));
  }
});
test("HTTP hashing respects view offsets and does not include surrounding bytes", async () => {
  const bytes = Uint8Array.from({ length: 64 }, (_, i) => i);
  const data = new DataView(bytes.buffer, 7, 31);
  assert.equal(hex(await crypto.subtle.digest({ name: "SHA-256" }, data)), createHash("sha256").update(bytes.subarray(7, 38)).digest("hex"));
});
test("UUID fallback uses secure randomness and preserves UUIDv4 version and variant", () => {
  const values = new Set(Array.from({ length: 1000 }, () => crypto.randomUUID()));
  assert.equal(values.size, 1000);
  for (const id of values) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
});
test("unsupported algorithms and missing secure randomness fail explicitly", async () => {
  await assert.rejects(crypto.subtle.digest("SHA-1", new Uint8Array()), { name: "NotSupportedError" });
  const absent = createBrowserCrypto({} as Crypto);
  assert.throws(() => absent.randomUUID());
});
