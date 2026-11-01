import { test } from "node:test";
import assert from "node:assert/strict";
import { validationBlocksRetry, validationErrorMessages } from "../src/capability-validation-ui";
import type { CapabilityValidation } from "../src/capability-model";

test("text reconciliation allows a separately budgeted retry; running, unresolved audio and unresolved video do not", () => {
  const receipt = { state: "reconciling", result: { usage_known: false, known_cost_micros: "0" } } as CapabilityValidation;
  assert.equal(validationBlocksRetry(receipt), false);
  assert.equal(validationBlocksRetry(undefined, "reconciling"), false);
  assert.equal(validationBlocksRetry({ ...receipt, state: "running" }), true);
  assert.equal(validationBlocksRetry({ ...receipt, audio_suite: { accounting: { resolved: false } } } as CapabilityValidation), true);
  assert.equal(validationBlocksRetry({ ...receipt, video_suite: { usage_known: false } } as CapabilityValidation), true);
  assert.equal(validationBlocksRetry({ ...receipt, audio_suite: { accounting: { resolved: true, allocation_exceeded: false } } } as CapabilityValidation), false);
  assert.equal(receipt.result.usage_known, false);
  assert.equal(receipt.state, "reconciling");
});

test("tool and legacy generic failures have bilingual explanations and retain the real error identity", () => {
  for (const code of ["AI_TOOL_CALL_NOT_ALLOWED", "AI_TOOL_NOT_ALLOWED", "CAPABILITY_VERIFICATION_FAILED", "CAPABILITY_TOOL_RECEIPT_MISSING"])
    assert.ok(validationErrorMessages[code].every(text => text.length > 25));
  assert.match(validationErrorMessages.CAPABILITY_VERIFICATION_FAILED[1], /older receipt.*specific cause.*preserved/);
});
