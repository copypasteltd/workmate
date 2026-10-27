import { test } from "node:test";
import assert from "node:assert/strict";
import { geoAnalysis, geoDigest, geoPrompt, geoSpec, compareGeo } from "../src/geo-model.js";
const brands = [{ name: "CopyPaste", aliases: ["CopyPaste", "複製貼上", "c++"] }];
test("GEO literal matching preserves UTF-16 positions, escapes regex and respects Latin word boundaries", () => {
  const text = "🙂 copypaste.hk CopyPastes 複製貼上 c++!";
  const r = geoAnalysis(text, brands);
  assert.deepEqual(r.mentions[0].matches.map(v => text.slice(v.start, v.end)), ["copypaste", "複製貼上", "c++"]);
  assert.equal(r.character_offsets, "utf16");
});
test("GEO answer links are retained unverified, not fetched or manufactured, and hashes cover exact original bytes", () => {
  const text = "See https://example.invalid/report). Fake https://x:secret@example.invalid/private";
  const r = geoAnalysis(text, brands);
  assert.deepEqual(r.links.map(v => v.url), ["https://example.invalid/report"]);
  assert.equal(r.links[0].provenance, "answer_text_unverified");
  assert.notEqual(r.answer_sha256, geoAnalysis(text + "\n", brands).answer_sha256);
  assert.equal(r.mentions[0].matched, false);
});
test("GEO comparison separates surfaces and configurations and leaves absent or failed answers unknown", () => {
  const run = { id: "a", surface: "internal_api", config_hash: geoDigest({ x: 1 }), effective_config: {}, questions: [{ key: "q1", text: "Question" }], samples: [] };
  assert.equal(compareGeo(run, { ...run, id: "b" }).classification, "repeat_observation");
  assert.equal(compareGeo(run, run).questions[0].answer_changed, null);
  assert.equal(compareGeo(run, { ...run, surface: "consumer_manual" }).mixed_surfaces, true);
  assert.equal(compareGeo(run, { ...run, config_hash: geoDigest({ x: 2 }) }).same_configuration, false);
});
test("GEO fixed questions are unique and measured aliases are absent from the observation prompt", () => {
  const base = { name: "Test", agent_id: "11111111-1111-4111-8111-111111111111", region: "Hong Kong", language: "zh-Hant", questions: [{ key: "q1", text: "Who designs brands in Hong Kong?" }], brands };
  assert.equal(geoSpec.safeParse(base).success, true);
  assert.equal(geoSpec.safeParse({ ...base, questions: [...base.questions, ...base.questions] }).success, false);
  assert.equal(geoPrompt(base, base.questions[0].text).includes("CopyPaste"), false);
});
