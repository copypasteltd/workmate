import test from "node:test";
import assert from "node:assert/strict";
import { exactHKD } from "../src/financial-notice.js";

test("financial amounts retain every micro across zero, fractional, negative and unsafe Number boundaries", () => {
  assert.equal(exactHKD("0"), "HKD 0.000000");
  assert.equal(exactHKD("1"), "HKD 0.000001");
  assert.equal(exactHKD("12500001"), "HKD 12.500001");
  assert.equal(exactHKD("-12500001"), "HKD −12.500001");
  assert.equal(exactHKD("9007199254740993"), "HKD 9,007,199,254.740993");
  assert.equal(exactHKD("9223372036854775807"), "HKD 9,223,372,036,854.775807");
});

test("noncanonical values cannot silently become zero, rounded or scientific monetary text", () => {
  for (const value of [
    "",
    " 1",
    "1 ",
    "+1",
    "01",
    "1.0",
    "NaN",
    "Infinity",
    "null",
    "undefined",
    "1e6",
  ])
    assert.throws(() => exactHKD(value), /Invalid exact HKD amount/);
});
