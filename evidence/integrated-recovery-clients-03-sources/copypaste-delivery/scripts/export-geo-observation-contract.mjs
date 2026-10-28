import { createRequire } from "node:module";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
const platform = path.resolve("../copypaste-platform"), require = createRequire(path.join(platform, "package.json"));
const { z } = require("zod"), model = await import(pathToFileURL(path.join(platform, "src/geo-model.ts")).href);
const input = await import(pathToFileURL(path.join(platform, "src/geo-observations.ts")).href);
const sha = b => createHash("sha256").update(b).digest("hex");
assert.equal(sha(await readFile("../../docs/contracts/openapi.json")), "51dd90f26137798dd23c4e881b7f9f0b20f99ad4b9fee0cce98686e11873aab4");
assert.equal(sha(await readFile(path.join(platform, "catalog/openapi.json"))), "7ce0b4cb170cdebc07aa4ee8f8810f24dbf996d95128519da184d7b2eb62156b");
const id = z.string().uuid(), digest = z.string().regex(/^[a-f0-9]{64}$/), stamp = z.string().datetime({ offset: true });
const count = z.number().int().nonnegative(), micros = z.string().regex(/^\d+$/), surface = z.enum(["internal_api", "consumer_manual"]);
const question = z.object({ key: z.string(), text: z.string() }).strict();
const brand = z.object({ name: z.string(), aliases: z.array(z.string()) }).strict();
// The complete immutable Agent definition is retained as JSON; its schema is
// owned by the persistent Agent contract and is not redefined by this addendum.
const effective = z.record(z.string(), z.json());
const analysis = z.object({ answer_sha256: digest, character_offsets: z.literal("utf16"),
  mentions: z.array(z.object({ brand: z.string(), matched: z.boolean(), limit: z.literal(1000), matches: z.array(z.object({ alias: z.string(), start: count, end: count }).strict()) }).strict()),
  links: z.array(z.object({ url: z.string().url(), start: count, end: count, provenance: z.literal("answer_text_unverified") }).strict()), limitations: z.array(z.string()) }).strict();
const sample = z.object({ id, question_key: z.string(), question: z.string(), task_id: id.nullable(), task_status: z.string().nullable(), state: z.string(), error_code: z.string().nullable(),
  answer_sha256: digest.nullable(), analysis: analysis.nullable(), observed_at: stamp.nullable(), captured_at: stamp.nullable(), asset_id: id.nullable(), asset_version_id: id.nullable(), asset_version: z.number().int().positive().nullable(),
  answer: z.string().optional(), budget_micros: micros.nullable(), confirmed_cost_micros: micros.nullable(), cost_state: z.enum(["no_api_request", "requires_reconciliation", "confirmed", "in_progress"]) }).strict();
const run = z.object({ id, name: z.string(), experiment_id: id, experiment_version: z.number().int().positive(), surface, config_hash: digest, effective_config: effective,
  created_at: stamp, questions: z.array(question), brands: z.array(brand), samples: z.array(sample), progress: z.object({ captured: count, total: count }).strict(), limitations: z.array(z.string()) }).strict();
const comparison = z.object({ schema: z.literal(1), left_run_id: id, right_run_id: id, same_configuration: z.boolean(), classification: z.enum(["repeat_observation", "different_configuration"]),
  mixed_surfaces: z.boolean(), aggregate: z.null(), differences: z.array(z.string()),
  questions: z.array(z.object({ text: z.string(), left: sample.nullable(), right: sample.nullable(), answer_changed: z.boolean().nullable(), reason: z.string().nullable() }).strict()), limitations: z.array(z.string()) }).strict();
const models = { ExperimentCreate: input.geoExperimentInput, RunCreate: input.geoRunInput, ManualCreate: model.geoManual,
  Empty: z.object({}).strict(), DeleteInput: z.object({ kind: z.enum(["experiment", "run"]), expected_version: z.number().int().positive() }).strict(),
  ExperimentReceipt: z.object({ id, version: z.number().int().positive(), sha256: digest }).strict(), RunReceipt: z.object({ id, experiment_id: id, surface }).strict(),
  CaptureReceipt: z.object({ id, captured: count }).strict(), CancelReceipt: z.object({ id, cancellation_requested: count, cost: z.literal("see_individual_task_receipts") }).strict(), DeleteReceipt: z.object({ id, state: z.literal("deleted") }).strict(),
  ExperimentList: z.object({ items: z.array(z.object({ id, tenant_id: id, project_id: id, name: z.string(), series_id: id, version: z.number().int().positive(), previous_id: id.nullable(), body: effective, sha256: digest,
    created_by: id, private_owner: id, content_state: z.literal("active"), moderation_version: z.number().int().positive(), created_at: stamp, retention_expires_at: stamp }).strict()), next_cursor: id.nullable(), can_write: z.boolean(),
    quota: z.object({ active: count, max_active_tasks: count, available: count, max_question_budget_micros: micros }).strict() }).strict(),
  RunList: z.object({ items: z.array(z.object({ id, name: z.string(), surface, config_hash: digest, created_at: stamp }).strict()), next_cursor: id.nullable() }).strict(),
  Run: run, Comparison: z.object({ comparison, left: run, right: run }).strict() };
const schemas = Object.fromEntries(Object.entries(models).map(([k, v]) => [k, z.toJSONSchema(v, { target: "draft-2020-12" })]));
schemas.ExperimentCreate.description = "Runtime additionally requires paired previous_id/expected_sha256, unique question keys/text/brands, an unbranded currently authorized pinned Agent, and creation from the latest immutable version.";
schemas.RunCreate.description = "Budget is an exact micros string capped at 100000000000; the server reserves all questions atomically under current wallet, capability and active-task quota checks.";
schemas.ManualCreate.description = "Runtime additionally requires unique known question keys, aggregate UTF-8 JSON <=900000 bytes, and observed_at no more than 60 seconds in the future. Attestation is explicit. No model request or model fee is created.";
const content = name => ({ "application/json": { schema: { $ref: "#/components/schemas/" + name } } });
const param = (name, where, schema, required = true) => ({ name, in: where, required, schema });
const uuid = { type: "string", format: "uuid" };
const op = (operationId, request, response, row = false, status = "200", replay = false) => ({ operationId, security: [{ customerSession: [] }],
  parameters: [...["tenant", "project", ...(row ? ["id"] : [])].map(n => param(n, "path", uuid)), ...(request ? [param("X-CSRF-Token", "header", { type: "string", minLength: 1 })] : []),
    ...(replay ? [param("Idempotency-Key", "header", { type: "string", minLength: 16, maxLength: 128, pattern: "^[\\w:-]+$" })] : [])],
  ...(request ? { requestBody: { required: true, content: content(request) } } : {}),
  responses: { [status]: { description: "Currently authorized retained private result", content: content(response) }, "400": { description: "Input/schema invalid" }, "401": { description: "Current customer session required" }, "403": { description: "Current user, membership or project write permission unavailable" }, "404": { description: "Owned retained content or a transitive source unavailable" }, "409": { description: "Version, idempotency, capability, active-task quota or budget conflict" }, "422": { description: "Unknown question or invalid observation source" } } });
const base = "/v1/tenants/{tenant}/projects/{project}/geo";
const paths = {
  [base + "/experiments"]: { get: op("listGeoExperiments", null, "ExperimentList"), post: op("createGeoExperiment", "ExperimentCreate", "ExperimentReceipt", false, "201", true) },
  [base + "/experiments/{id}/runs"]: { get: op("listGeoRuns", null, "RunList", true), post: op("createGeoApiRun", "RunCreate", "RunReceipt", true, "201", true) },
  [base + "/experiments/{id}/manual"]: { post: op("createGeoManualRun", "ManualCreate", "RunReceipt", true, "201", true) },
  [base + "/runs/{id}"]: { get: op("readGeoRun", null, "Run", true) },
  [base + "/runs/{id}/capture"]: { post: op("captureGeoAnswers", "Empty", "CaptureReceipt", true) },
  [base + "/runs/{id}/cancel"]: { post: op("cancelGeoRun", "Empty", "CancelReceipt", true) },
  [base + "/runs/{id}/export"]: { get: op("exportGeoRun", null, "Run", true) },
  [base + "/compare"]: { get: op("compareGeoRuns", null, "Comparison") },
  [base + "/content/{id}/delete"]: { post: op("deleteGeoContent", "DeleteInput", "DeleteReceipt", true, "200", true) },
};
for (const route of ["/experiments", "/experiments/{id}/runs"]) paths[base + route].get.parameters.push(param("cursor", "query", uuid, false), param("limit", "query", { type: "integer", minimum: 1, maximum: 100, default: 30 }, false));
paths[base + "/compare"].get.parameters.push(...["left", "right"].map(n => param(n, "query", uuid)), param("download", "query", { type: "string", enum: ["json"] }, false));
const contract = { openapi: "3.1.0", info: { title: "Workmate reproducible GEO observations", version: "1.0.0", description: "Additive runtime contract. Internal Codex API observations disable retrieval/business tools and preserve the harness. Consumer samples are user supplied and unverified. Literal aliases and answer links do not establish rankings, entity identity, coverage or causation. Unknown costs remain null. Reads/exports always recheck current private ownership and all retained sources. Capture/cancel are naturally idempotent actions; creates/deletion require idempotency keys. Export/download responses contain original answers and use no-store. Original design OpenAPI files are preserved." }, paths,
  components: { securitySchemes: { customerSession: { type: "apiKey", in: "cookie", name: "cp_session" } }, schemas } };
const raw = JSON.stringify(contract, null, 2) + "\n";
await writeFile(path.join(platform, "contracts/geo-observation-openapi.json"), raw);
await writeFile("../../docs/contracts/geo-observation-openapi.json", raw);
console.log(JSON.stringify({ schemas: Object.keys(schemas).length, operations: Object.values(paths).reduce((n, p) => n + Object.keys(p).length, 0), sha256: sha(raw) }));
