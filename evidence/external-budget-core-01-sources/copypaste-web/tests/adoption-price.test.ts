import { test } from "node:test";
import assert from "node:assert/strict";
import { adoptionPrice } from "../src/adoption-price.js";

test("model comparison prices preserve micro units, free pricing and large exact integer amounts", () => {
  assert.equal(adoptionPrice("1"), "HK$0.000001");
  assert.equal(adoptionPrice("1000001"), "HK$1.000001");
  assert.equal(adoptionPrice("250000"), "HK$0.25");
  assert.equal(adoptionPrice("0"), "HK$0");
  assert.equal(adoptionPrice("9007199254740991"), "HK$9007199254.740991");
  assert.equal(adoptionPrice(null), null);
});
