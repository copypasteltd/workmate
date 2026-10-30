import test from "node:test";
import assert from "node:assert/strict";
import { cloudAgentBudget } from "../src/cloud-agent-budget.js";

test("AI budget confirmation preserves exact HKD microdollars without binary rounding or silent extra precision", () => {
  assert.equal(cloudAgentBudget("0.000001"), 1);
  assert.equal(cloudAgentBudget("1.234567"), 1234567);
  assert.equal(cloudAgentBudget("1000000.000000"), 1000000000000);
  for (const value of ["0", "0.000000", "0.0000001", "1e6", "+1", "-1", "01.00", "1,000.00", " 1", "1.", "1000000.000001", "9999999"]) assert.throws(() => cloudAgentBudget(value));
});
