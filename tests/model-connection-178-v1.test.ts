import { test } from "node:test";
import assert from "node:assert/strict";
import { capabilityDraft } from "../src/capability-model.js";

function form() {
  const f = new FormData();
  for (const [key,value] of Object.entries({ profile: "internal-text-v1", model: "gpt-6-luna", reason: "Configure this model upstream",
    effort: "max", input_rate: "1.25", output_rate: "3.75", upstream_base_url: "https://models.example/v1", upstream_api_key: "fixture-model-key" })) f.set(key,value);
  return f;
}
test("model configuration sends the upstream and key alongside its exact model and rates", () => {
  const body = capabilityDraft(form());
  assert.equal(body.document.model_alias,"gpt-6-luna");
  assert.deepEqual(body.document.rates,[1250000,3750000]);
  assert.deepEqual(body.connection,{base_url:"https://models.example/v1",api_key:"fixture-model-key",allow_private_network:false});
});
test("a new model requires its own key and rejects credentials hidden in the URL", () => {
  const f=form(); f.delete("upstream_api_key"); assert.throws(()=>capabilityDraft(f),/API Key/);
  f.set("upstream_api_key","fixture"); f.set("upstream_base_url","https://user:password@models.example/v1");
  assert.throws(()=>capabilityDraft(f),/帳密|credentials/);
});
test("retaining an existing version key is explicit and never sends a displayed saved secret", () => {
  const f=form();f.delete("upstream_api_key");f.set("upstream_reuse_from","b94b534e-5532-4d7c-a0bc-172540398eef");f.set("upstream_private","on");
  const c=capabilityDraft(f).connection!;
  assert.equal(c.reuse_from_release_id,"b94b534e-5532-4d7c-a0bc-172540398eef"); assert.equal(c.allow_private_network,true); assert.equal("api_key" in c,false);
});
