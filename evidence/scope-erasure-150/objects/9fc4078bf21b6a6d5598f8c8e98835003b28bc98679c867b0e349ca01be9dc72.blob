import test from "node:test";
import assert from "node:assert/strict";
import { parseBrandAmount, formatBrandAmount } from "../src/brand-amount";
test("brand prices preserve exact HKD, JPY and three-decimal currency amounts", () => {
  assert.equal(parseBrandAmount("12.35", "HKD"), 1235);
  assert.equal(parseBrandAmount("0.01", "HKD"), 1);
  assert.equal(parseBrandAmount("123", "JPY"), 123);
  assert.equal(parseBrandAmount("1.234", "KWD"), 1234);
  assert.equal(parseBrandAmount("10000000000.00", "HKD"), 1_000_000_000_000);
  assert.equal(formatBrandAmount(1235, "HKD"), "12.35");
  assert.equal(formatBrandAmount(123, "JPY"), "123");
  assert.equal(formatBrandAmount(1, "KWD"), "0.001");
});
test("brand prices reject rounding, signs, exponent notation and values beyond the supported limit", () => {
  for (const [value, currency] of [
    ["1.005", "HKD"],
    ["1.1", "JPY"],
    ["-1", "HKD"],
    ["1e3", "HKD"],
    ["10000000000.01", "HKD"],
  ])
    assert.throws(() => parseBrandAmount(value, currency));
  assert.equal(parseBrandAmount("", "HKD"), null);
  assert.equal(parseBrandAmount("0", "HKD"), 0);
});
