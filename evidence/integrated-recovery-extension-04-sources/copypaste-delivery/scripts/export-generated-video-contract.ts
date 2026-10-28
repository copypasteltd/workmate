import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const platform = path.resolve("../copypaste-platform"), root = path.resolve("../.."), requirePlatform = createRequire(path.join(platform, "package.json")), { z } = requirePlatform("zod");
const model = await import(pathToFileURL(path.join(platform, "src/video-job-model.ts")).href), protocol = await import(pathToFileURL(path.join(platform, "src/video-job-protocol.ts")).href);
const sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
const originals = { "docs/contracts/openapi.json": "51dd90f26137798dd23c4e881b7f9f0b20f99ad4b9fee0cce98686e11873aab4", "dev/copypaste-platform/catalog/openapi.json": "7ce0b4cb170cdebc07aa4ee8f8810f24dbf996d95128519da184d7b2eb62156b" };
for (const [file, expected] of Object.entries(originals)) assert.equal(sha(await readFile(path.join(root, file))), expected);
const entries = { GeneratedVideoMetadata: "generatedVideoMetadata", GeneratedVideoList: "generatedVideoList", GeneratedVideoPreview: "generatedVideoPreview", GeneratedVideoCancelRequest: "generatedVideoCancelRequest",
  GeneratedVideoRecheckRequest: "generatedVideoRecheckRequest", GeneratedVideoRecheckReceipt: "generatedVideoRecheckReceipt", GeneratedVideoAdminList: "generatedVideoAdminList", GeneratedVideoObservationReceipt: "generatedVideoObservationReceipt" };
const schemas: Record<string, any> = Object.fromEntries(Object.entries(entries).map(([name, key]) => [name, z.toJSONSchema(model[key], { target: "draft-2020-12" })]));
schemas.CompanyVideoSpecification = z.toJSONSchema(protocol.videoJobSpecification, { target: "draft-2020-12" });
schemas.CompanyVideoObservation = z.toJSONSchema(protocol.videoJobObservation, { target: "draft-2020-12" });
schemas.CompanyVideoObservation.description = "Additionally requires the frozen operation/model/specification/provider identity, monotonic state and progress, immutable terminal usage/content; only terminal usage is final, only completed observations include content, and successful states cannot include an error. Authentication never grants access to customer sources.";
const content = (name: string) => ({ "application/json": { schema: { $ref: "#/components/schemas/" + name } } });
function operation(operationId: string, params: string[], input: string | null, output: string, admin = false): any {
  return { operationId, security: admin ? [{ adminSession: [] }] : [{ customerSession: [] }, { nativeAccess: [] }],
    parameters: [...params.map(name => ({ name, in: "path", required: true, schema: { type: "string", format: "uuid" } })), ...(input ? [
      { name: "Idempotency-Key", in: "header", required: true, schema: { type: "string", minLength: 16, maxLength: 128, pattern: "^[\\w:-]+$" } },
      { name: "X-CSRF-Token", in: "header", required: false, description: "Required with cookie authentication; native access uses bearer authentication.", schema: { type: "string", minLength: 1 } },
    ] : [])], ...(input ? { requestBody: { required: true, content: content(input) } } : {}),
    responses: { "200": { description: "Current authorized result, Cache-Control no-store for reads", content: content(output) } } };
}
function listing(op: any, admin = false) {
  for (const name of ["cursor", "task_id", ...(admin ? ["tenant_id", "project_id"] : [])]) op.parameters.push({ name, in: "query", required: false, schema: { type: "string", format: "uuid" } });
  op.parameters.push({ name: "limit", in: "query", required: false, schema: { type: "integer", minimum: 1, maximum: 100, default: 30 } }); return op;
}
const base = "/v1/tenants/{tenant}/projects/{project}/generated-video-jobs", parents = ["tenant", "project"], job = [...parents, "job"];
const callback = { operationId: "observeGeneratedVideoOperation", security: [{ companyVideoHmac: [] }], parameters: [
  { name: "operation", in: "path", required: true, schema: { type: "string", format: "uuid" } },
  { name: "X-CopyPaste-Video-Timestamp", in: "header", required: true, schema: { type: "string", pattern: "^\\d{13}$" } },
], requestBody: { required: true, content: content("CompanyVideoObservation") }, responses: { "200": { description: "Authenticated immutable observation receipt", content: content("GeneratedVideoObservationReceipt") } },
  description: "Company server only; body <=16 KiB, timestamp within five minutes, no browser Origin or Cookie. Signature v1=HMAC-SHA256(secret, 'POST\\n'+path+'\\n'+timestamp+'\\n'+canonicalJSON(body)). Duplicate event/sequence conflicts return 409. Missing final usage retains the original budget hold." };
const document = { openapi: "3.1.0", info: { title: "CopyPaste generated video operations", version: "0.1.0", description: "Additive company-video-jobs-v1 job review and reconciliation contract. Creation is restricted to the original Codex task business tool; no browser or Admin generation endpoint. Synthetic provider verification does not qualify a live video provider or the complete product." },
  "x-original-contracts-sha256": originals, "x-source-sha256": Object.fromEntries(await Promise.all(["src/video-job-model.ts", "src/video-job-protocol.ts", "src/video-job-routes.ts"].map(async file => [file, sha(await readFile(path.join(platform, file)))]))),
  paths: { [base]: { get: listing(operation("listGeneratedVideoJobs", parents, null, "GeneratedVideoList")) },
    [base + "/{job}"]: { get: operation("readGeneratedVideoJob", job, null, "GeneratedVideoMetadata") },
    [base + "/{job}/cancel"]: { post: operation("cancelGeneratedVideoJob", job, "GeneratedVideoCancelRequest", "GeneratedVideoMetadata") },
    [base + "/{job}/preview"]: { get: operation("previewGeneratedVideoJob", job, null, "GeneratedVideoPreview") },
    "/v1/internal/video-operations/{operation}/observations": { post: callback },
    "/v1/admin/ai/video-jobs": { get: { ...listing(operation("adminListGeneratedVideoJobs", [], null, "GeneratedVideoAdminList", true), true), description: "Requires scoped admin.ai.requests.read. Cost is null without separately scoped admin.ai.cost.read. Never returns prompts, references or media." } },
    "/v1/admin/ai/video-jobs/{job}/recheck": { post: { ...operation("adminRecheckGeneratedVideoJob", ["job"], "GeneratedVideoRecheckRequest", "GeneratedVideoRecheckReceipt", true), description: "Requires scoped admin.ai.cost.reconcile and recent MFA; audited CAS/idempotency requests an observation of the existing operation. It cannot generate or override confirmed costs. Task settlement remains the separate existing independent-approval flow." } },
  }, components: { securitySchemes: { customerSession: { type: "apiKey", in: "cookie", name: "cp_session" }, nativeAccess: { type: "http", scheme: "bearer" }, adminSession: { type: "apiKey", in: "cookie", name: "cp_admin_session" }, companyVideoHmac: { type: "apiKey", in: "header", name: "X-CopyPaste-Video-Signature" } }, schemas } };
const bytes = JSON.stringify(document, null, 2) + "\n";
for (const file of [path.join(root, "docs/contracts/generated-video-openapi.json"), path.join(platform, "contracts/generated-video-openapi.json")]) await writeFile(file, bytes);
console.log(JSON.stringify({ operations: 7, schemas: Object.keys(schemas).length, sha256: sha(Buffer.from(bytes)), original_contracts_unchanged: true }));
