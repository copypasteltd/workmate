import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLocalInput, parseLocalAnswers } from "../src/local-input.js";
const raw = () => ({ threadId: "thread-owned", turnId: "turn-owned", itemId: "call-owned", isBlocking: false, questions: [
  { id: "palette", header: "Palette", question: "Choose a palette.", options: [{ label: "Blue", description: "Company palette" }, { label: "Neutral", description: "Warm gray" }], isOther: true },
  { id: "note", header: "Note", question: "What should the result contain?", isSecret: true },
] });
test("native input projection preserves explicit choices, free text and secret presentation without mutating caller state", () => {
  const source = raw(), parsed = parseLocalInput(source);
  source.questions[0].options![0].label = "Tampered";
  assert.equal(parsed.questions[0].options![0].label, "Blue"); assert.equal(parsed.questions[1].isSecret, true);
  assert.deepEqual(JSON.parse(JSON.stringify(parseLocalAnswers(parsed, { palette: { answers: ["Custom blue"] }, note: { answers: ["USER_SECRET_INPUT"] } }))),
    { palette: { answers: ["Custom blue"] }, note: { answers: ["USER_SECRET_INPUT"] } });
});
test("invalid question identity, duplicate options and unbounded payloads are rejected before presentation", () => {
  for (const change of [
    (value: any) => { value.questions[1].id = value.questions[0].id; },
    (value: any) => { value.questions[0].id = "__proto__"; },
    (value: any) => { value.questions[0].options[1].label = "Blue"; },
    (value: any) => { value.questions[0].question = "x".repeat(4001); },
    (value: any) => { value.isBlocking = "false"; },
    (value: any) => { value.questions.push(...value.questions); },
    (value: any) => { value.questions[0].isOther = "true"; },
  ]) { const value = raw(); change(value); assert.throws(() => parseLocalInput(value)); }
});
test("answers require every exact question once, a single explicit value and bounded content", () => {
  const request = parseLocalInput(raw());
  for (const value of [
    {}, { palette: { answers: ["Blue"] } },
    { palette: { answers: ["Blue"] }, note: { answers: ["text"] }, injected: { answers: ["extra"] } },
    { palette: { answers: [] }, note: { answers: ["text"] } },
    { palette: { answers: ["Blue", "Neutral"] }, note: { answers: ["text"] } },
    { palette: { answers: ["Blue"] }, note: { answers: [" "] } },
    { palette: { answers: ["Blue"] }, note: { answers: ["x".repeat(8001)] } },
    { palette: { answers: ["Blue"], unchecked: true }, note: { answers: ["text"] } },
  ]) assert.throws(() => parseLocalAnswers(request, value));
  request.questions[0].isOther = false;
  assert.throws(() => parseLocalAnswers(request, { palette: { answers: ["Custom"] }, note: { answers: ["text"] } }));
});
