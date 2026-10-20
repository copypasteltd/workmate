import assert from "node:assert/strict";
import { readFile, writeFile, access } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";

const attempt = process.argv[2], uiAttempt = process.argv[3];
assert.match(attempt ?? "", /^\d{2}$/);
assert.match(uiAttempt ?? "", /^\d{2}$/);
const root = path.resolve("../.."), platform = path.resolve("../copypaste-platform"),
  prefix = `evidence/agent-adoption-contract-${attempt}`,
  sha = (b: Buffer) => createHash("sha256").update(b).digest("hex"),
  requirePlatform = createRequire(path.join(platform, "package.json")),
  { Ajv2020 } = requirePlatform("ajv/dist/2020.js"), { z } = requirePlatform("zod"),
  ajv = new Ajv2020({ allErrors: true });
requirePlatform("ajv-formats")(ajv);
await assert.rejects(access(prefix + ".json"), (e: any) => e.code === "ENOENT");
const files = ["docs/contracts/openapi.json", "docs/contracts/agent-adoption.openapi.json", "dev/copypaste-platform/src/agent-adoption.ts", "dev/copypaste-web/src/adoption-price.ts", "dev/copypaste-desktop/renderer/src/adoption-price.ts", "dev/copypaste-desktop/renderer/src/agent-adoption.tsx", "dev/copypaste-web/src/agent-adoption.tsx", "dev/copypaste-delivery/scripts/check-agent-adoption-contract.ts"],
  snapshot = async () => Object.fromEntries(await Promise.all(files.map(async f => [f, sha(await readFile(path.join(root, f)))]))),
  before = await snapshot(), checks: string[] = [], errors: string[] = [];
await writeFile(prefix + "-verifier.ts", await readFile(import.meta.filename), { flag: "wx" });
try {
  assert.equal(before[files[0]], "51dd90f26137798dd23c4e881b7f9f0b20f99ad4b9fee0cce98686e11873aab4");
  const contract = JSON.parse(await readFile(path.join(root, files[1]), "utf8")),
    schemas = await import(pathToFileURL(path.join(platform, "src/agent-adoption.ts")).href),
    names: Record<string, string> = { AgentVersionProposal: "agentVersionProposal", ConversationAdoptionProposal: "conversationAdoptionProposal", AdoptionComparison: "adoptionComparison", AdoptionPreview: "adoptionPreview", AdoptionConfirmation: "adoptionConfirmation", AdoptionResult: "adoptionResult" },
    validate: any = {};
  assert.equal(contract["x-normative-source-sha256"], before[files[0]]);
  assert.equal(contract["x-implementation-sha256"], before[files[2]]);
  assert.equal(Object.keys(contract.paths).length, 4);
  for (const [name, key] of Object.entries(names)) {
    assert.deepEqual(contract.components.schemas[name], z.toJSONSchema(schemas[key], { target: "draft-2020-12" }));
    validate[name] = ajv.compile(contract.components.schemas[name]);
  }
  checks.push("all six strict schemas are generated from the exact current server implementation; four supplemental operations preserve normative API bytes");
  const uiPath = `evidence/agent-adoption-ui-${uiAttempt}-journey.json`, ui = JSON.parse(await readFile(uiPath, "utf8"));
  assert.equal(ui.status, "passed"); assert.deepEqual(ui.errors, []);
  assert.equal(ui.supplemental_contract_sha256, before[files[1]]);
  assert.ok(ui.samples.length >= 6);
  for (const item of ui.samples) {
    assert.ok(validate[item.schema](item.response), JSON.stringify(validate[item.schema].errors));
    assert.deepEqual(schemas[names[item.schema]].parse(item.response), item.response);
    assert.equal(validate[item.schema]({ ...item.response, unknown_field: true }), false);
    assert.equal(schemas[names[item.schema]].safeParse({ ...item.response, unknown_field: true }).success, false);
  }
  checks.push("actual built Web preview and confirmation responses agree with both strict server and supplemental schemas, rejecting unknown fields");
  const valid = { expected_version: 1, definition: { name: "Synthetic reviewed analyst", role_key: "marketing-analyst", instructions: "Brief", brand_id: null, enabled: true } };
  assert.ok(validate.AgentVersionProposal(valid)); assert.deepEqual(schemas.agentVersionProposal.parse(valid), valid);
  const conversation = { expected_version: 1, target_agent_version: 2, name: "Reviewed conversation" };
  assert.ok(validate.ConversationAdoptionProposal(conversation)); assert.deepEqual(schemas.conversationAdoptionProposal.parse(conversation), conversation);
  const confirmation = { preview_hash: "a".repeat(64), proposal: valid };
  assert.ok(validate.AdoptionConfirmation(confirmation)); assert.deepEqual(schemas.adoptionConfirmation.parse(confirmation), confirmation);
  for (const bad of [{ ...valid, kernel: "dsh" }, { ...valid, model: "uncontrolled" }, { ...valid, api_key: "synthetic-denied" }, { ...valid, endpoint: "https://example.invalid" }, { ...valid, expected_version: 0 }, { ...valid, definition: { ...valid.definition, rates: [1, 2] } }]) {
    assert.equal(validate.AgentVersionProposal(bad), false); assert.equal(schemas.agentVersionProposal.safeParse(bad).success, false);
  }
  checks.push("actual proposal and confirmation schemas accept supported versioned inputs and reject client model/rate/kernel/endpoint/credential overrides");
  const p = ui.samples.find((x: any) => x.schema === "AdoptionPreview").response;
  for (const bad of [{ ...p.comparison, kernel: "dsh" }, { ...p.comparison, gateway_policy: "external" }, { ...p.comparison, effect: "rewrite_old_tasks" }]) {
    assert.equal(validate.AdoptionComparison(bad), false); assert.equal(schemas.adoptionComparison.safeParse(bad).success, false);
  }
  assert.ok(validate.AdoptionComparison({ ...p.comparison, source: { ...p.comparison.source, capabilities: [{ id: randomUUID(), profile_key: "legacy", model_alias: null, reasoning_effort: null, state: "unrecorded", input_micros_per_million: null, output_micros_per_million: null, micros_per_image: null }] } }));
  checks.push("comparisons enforce Codex, the company gateway and future-task effects while permitting explicitly unknown historical models and rates");
  const { adoptionPrice } = await import(pathToFileURL(path.join(root, files[3])).href), { adoptionPrice: desktopPrice } = await import(pathToFileURL(path.join(root, files[4])).href);
  for (const [input, output] of [[null, null], ["0", "HK$0"], ["1", "HK$0.000001"], ["999999999999", "HK$999999.999999"], ["9007199254740993123456", "HK$9007199254740993.123456"]]) { assert.equal(adoptionPrice(input as string | null), output); assert.equal(desktopPrice(input as string | null), output); }
  assert.equal(before[files[3]], before[files[4]]); assert.equal(before[files[5]], before[files[6]]);
  checks.push("actual Web and Desktop price formatters preserve one micro and amounts beyond safe floating-point integers; review renderers are byte-identical");
} catch (e) { errors.push(e instanceof Error ? e.stack ?? e.message : String(e)); }
const stable = JSON.stringify(before) === JSON.stringify(await snapshot()), passed = errors.length === 0 && stable;
await writeFile(prefix + ".json", JSON.stringify({ at: new Date().toISOString(), status: passed ? "passed" : "failed", scope: "Strict additive customer-adoption DTOs, recorded actual Web responses and actual Web/Desktop money formatting; no production or complete original requirement acceptance", checks, errors, source_files: before, source_unchanged: stable, ui_journey: { path: `evidence/agent-adoption-ui-${uiAttempt}-journey.json`, sha256: sha(await readFile(`evidence/agent-adoption-ui-${uiAttempt}-journey.json`)) } }, null, 2) + "\n", { flag: "wx" });
console.log(JSON.stringify({ passed, checks: checks.length, errors })); assert.ok(passed);
