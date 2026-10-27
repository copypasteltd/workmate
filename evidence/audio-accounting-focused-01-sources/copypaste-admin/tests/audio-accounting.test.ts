import { test } from "node:test";
import assert from "node:assert/strict";
import { audioEvidenceInput } from "../src/audio-accounting-model";
const request = { id: "original-id", channel: "audio_customer", data_mode: "configured_services", operation_id: "original-operation",
  request_hash: "original-request", model_alias: "original-model", gateway_fingerprint: "original-gateway", source_sha256: null,
  kind: "speech", pricing_unit: "unicode_scalar", dispatched_at: "2026-01-01T00:00:00Z" };
function form() { const f = new FormData(); for (const [k,v] of Object.entries({ billable_units: "13", invoice_hkd: "0.000013", terminated: "on",
  outcome: "failed", observed_at: "2026-02-01T00:00:00Z", provider_reference: "supplier-1", source_reference: "invoice-1", source_note: "Original supplier final invoice", reason: "Independent review" })) f.set(k,v); return f; }
test("audio invoice keeps micro-HKD exact and binds identity to the server observation", () => {
  const f = form(); f.set("model_alias", "forged-model"); f.set("operation_id", "forged-operation");
  const b = audioEvidenceInput(request,f); assert.equal(b.document.billed_micros,"13"); assert.equal(b.document.usage.billable_units,13);
  assert.equal(b.document.model_alias, request.model_alias); assert.equal(b.document.operation_id,request.operation_id);
});
test("fractional, negative, scientific and excessive billable units cannot enter accounting", () => {
  for (const u of ["1.5","-1","1e3","1000001"]) { const f = form(); f.set("billable_units",u); assert.throws(() => audioEvidenceInput(request,f)); }
});
test("evidence requires observed termination and zero-cost unexecuted outcomes", () => {
  const f=form(); f.delete("terminated"); assert.throws(() => audioEvidenceInput(request,f));
  f.set("terminated","on"); f.set("outcome","not_executed"); assert.throws(() => audioEvidenceInput(request,f));
  f.set("billable_units","0"); f.set("invoice_hkd","0"); assert.equal(audioEvidenceInput(request,f).document.billed_micros,"0");
  f.set("observed_at","2025-01-01T00:00:00Z"); assert.throws(() => audioEvidenceInput(request,f));
});
