import { test } from "node:test";
import assert from "node:assert/strict";
import { capabilityDraft } from "../src/capability-model.js";

function form(profile: string) {
  const f = new FormData(); f.set("profile", profile); f.set("model", "synthetic-audio-v1");
  f.set("reason", "Explicit operator configuration"); f.set("locales", "en, yue-HK");
  f.set("voices", "alloy, company_voice"); f.set("audio_rate", "0.000017"); return f;
}
test("audio form preserves exact micro-HKD and explicit per-profile locale/voice choices", () => {
  const f = form("internal-speech-v1"), { document } = capabilityDraft(f);
  assert.equal(document.profile_key, "internal-speech-v1"); assert.equal(document.rates[0], 17);
  assert.deepEqual(document.profile_key === "internal-speech-v1" && document.voices, ["alloy", "company_voice"]);
  assert.equal(document.reasoning_effort, null); assert.equal(document.gateway_policy, "company_internal_only");
});
test("transcription timestamps require an explicit checkbox and exclude speech-only voice fields", () => {
  const f = form("internal-transcription-v1");
  let d = capabilityDraft(f).document; assert.equal(d.profile_key === "internal-transcription-v1" && d.timestamps, false);
  f.set("timestamps", "on"); d = capabilityDraft(f).document;
  assert.equal(d.profile_key === "internal-transcription-v1" && d.timestamps, true); assert.equal("voices" in d, false);
});
test("audio forms reject ambiguous decimals, unsupported or duplicate locale/voice choices and unsafe prices", () => {
  for (const [name, value] of [["audio_rate", "0"], ["audio_rate", "0.0000001"], ["audio_rate", "1000.000001"],
    ["locales", "en, en"], ["locales", "ja"], ["voices", "alloy,alloy"], ["voices", "unauthorized/voice"], ["voices", ""]]) {
    const f = form("internal-speech-v1"); f.set(name!, value!); assert.throws(() => capabilityDraft(f));
  }
});
