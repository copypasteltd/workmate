import { test } from "node:test";
import assert from "node:assert/strict";
import { parseHKD, formatHKD } from "../src/financial-money";

test("HKD input retains a single micro and values beyond Number precision", () => {
  assert.equal(parseHKD("0.000001"), "1");
  assert.equal(parseHKD("9007199254.740993"), "9007199254740993");
  assert.equal(parseHKD("9223372036854.775807"), "9223372036854775807");
  assert.equal(parseHKD(" 12.30 "), "12300000");
});
test("invalid, negative, overflowing and overprecise amounts cannot become fee requests", () => {
  for (const s of [
    "",
    "0",
    "-1",
    "1e3",
    "+1",
    "01.2",
    ".1",
    "1.",
    "0.0000001",
    "1,000.00",
    "9223372036854.775808",
    "NaN",
    "Infinity",
  ])
    assert.throws(() => parseHKD(s), Error, s);
  assert.equal(parseHKD("0", true), "0");
});
test("the complete micro amount remains visible in financial reviews", () => {
  assert.equal(formatHKD("1"), "HK$0.000001");
  assert.equal(formatHKD("12300000"), "HK$12.30");
  assert.equal(formatHKD("9007199254740993"), "HK$9,007,199,254.740993");
  assert.equal(formatHKD("9223372036854775807"), "HK$9,223,372,036,854.775807");
  assert.equal(formatHKD("0"), "HK$0.00");
});
