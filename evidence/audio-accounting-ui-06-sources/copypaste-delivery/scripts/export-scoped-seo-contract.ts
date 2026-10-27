import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";

const platform = path.resolve("../copypaste-platform"),
  root = path.resolve("../.."),
  requirePlatform = createRequire(path.join(platform, "package.json")),
  { z } = requirePlatform("zod"),
  model = await import(
    pathToFileURL(path.join(platform, "src/seo-model.ts")).href
  ),
  sha = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex"),
  normative = await readFile(path.join(root, "docs/contracts/openapi.json"));
assert.equal(
  sha(normative),
  "51dd90f26137798dd23c4e881b7f9f0b20f99ad4b9fee0cce98686e11873aab4",
);
const uuid = z.uuid(),
  time = z.iso.datetime(),
  count = z.number().int().nonnegative(),
  digest = z.string().regex(/^[a-f0-9]{64}$/),
  mode = z.enum(["simulated", "configured_services"]),
  state = z.enum(["queued", "running", "complete", "partial", "cancelled"]),
  strings = z.array(z.string()),
  location = z
    .object({
      start: count,
      end: count,
      unit: z.literal("utf16_code_units"),
      quote: z.string().max(400),
    })
    .strict(),
  budget = z
    .object({
      currency: z.literal("HKD"),
      amount_micros: z.string().regex(/^[1-9]\d{0,12}$/),
    })
    .strict(),
  money = z
    .object({
      currency: z.literal("HKD"),
      amount_micros: z.string().regex(/^\d+$/),
    })
    .strict(),
  spec = z
    .object({
      prompt: z.string().min(1).max(30000),
      start_urls: strings.min(1).max(20),
      allowed_hosts: strings.min(1).max(20),
      allowed_path_prefixes: strings.max(20),
      max_pages: z.number().int().min(1).max(1000),
      concurrency: z.number().int().min(1).max(10),
      cache_policy: z.enum(["refresh", "reuse_valid"]),
      connection_id: uuid.optional(),
    })
    .strict(),
  audit = z
    .object({
      id: uuid,
      project_id: uuid,
      task_id: uuid,
      state,
      revision: count,
      spec_hash: digest,
      input: spec,
      data_mode: mode,
      created_at: time,
      finished_at: time.nullable(),
      previous_run_id: uuid.nullable(),
      task_status: z.enum([
        "queued",
        "running",
        "paused",
        "needs_input",
        "succeeded",
        "failed",
        "cancelled",
        "reconciling",
      ]),
      result_asset_version_id: uuid.nullable(),
      report_asset_version_id: uuid.nullable(),
      budget: money,
      confirmed_cost: money,
      progress: z
        .object({
          page_requests: count,
          robots_requests: count,
          max_pages: count,
          byte_budget_used: count,
          remaining_urls: count,
          next_attempt_at: time,
          limitations: strings,
          error_code: z.string().nullable(),
        })
        .strict(),
    })
    .strict(),
  finding = z
    .object({
      id: uuid,
      key: digest,
      code: z.string(),
      severity: z.enum(["error", "warning", "info"]),
      url: z.string(),
      target_url: z.string().optional(),
      source_id: uuid,
      related_source_ids: z.array(uuid),
      location: location.nullable(),
      detail: z.string(),
    })
    .strict(),
  coverage = z
    .object({
      id: uuid,
      state,
      page_requests: count,
      robots_requests: count,
      max_pages: count,
      byte_budget_used: count,
      states: z.record(z.string(), count),
      limitations: strings,
      data_mode: mode,
    })
    .strict(),
  comparison = z
    .object({
      previous_spec_hash: digest,
      current_spec_hash: digest,
      changes: z.array(
        z
          .object({
            key: digest,
            code: z.string(),
            url: z.string(),
            target_url: z.string().optional(),
            previous_finding_id: uuid,
            current_finding_id: uuid.nullable(),
            state: z.enum(["persistent", "resolved", "not_rechecked"]),
          })
          .strict(),
      ),
      new_finding_ids: z.array(uuid),
    })
    .strict(),
  page = z
    .object({
      url: z.string(),
      state: z.enum([
        "queued",
        "success",
        "redirect",
        "http_error",
        "blocked",
        "failed",
        "unvisited",
      ]),
      attempts: count,
      redirects: count,
      chain: strings,
      source_id: uuid.optional(),
      status: count.optional(),
      target: z.string().optional(),
      reason: z.string().optional(),
      robots_source_id: uuid.optional(),
      robots_line: count.nullable().optional(),
    })
    .strict(),
  result = z
    .object({
      run_id: uuid,
      spec_hash: digest,
      checkpoint_sha256: digest,
      created_at: time,
      coverage,
      findings: z.array(finding),
      comparison: comparison.nullable(),
    })
    .strict();
const inputJSON = z.toJSONSchema(model.seoInput, {
  target: "draft-2020-12",
  io: "input",
});
inputJSON.description =
  "Runtime normalizes URL/IDN/path values, sorts entries, rejects duplicates, ambiguous encodings, private destinations and seeds outside the confirmed scope. connection_id is currently rejected with SEO_CONNECTION_REFERENCE_UNSUPPORTED; connected Search Console metrics use the separate connector workflow.";
const entries = {
  SeoAudit: audit,
  SeoAuditList: z.object({ items: z.array(audit).max(50) }).strict(),
  SeoFrozenSpec: spec,
  SeoBudget: budget,
  SeoFinding: finding,
  SeoCoverage: coverage,
  SeoComparison: comparison,
  SeoFindingsPage: z
    .object({
      run_id: uuid,
      spec_hash: digest,
      coverage,
      items: z.array(finding).max(25),
      comparison: comparison.nullable(),
      next_offset: count.nullable(),
      total: count,
    })
    .strict(),
  SeoPages: z
    .object({
      run_id: uuid,
      items: z.array(page).max(25),
      total: count,
      next_offset: count.nullable(),
    })
    .strict(),
  SeoDocument: z
    .object({
      id: uuid,
      run_id: uuid,
      kind: z.enum(["page", "robots"]),
      url: z.string(),
      http_status: count,
      effective_status: count,
      captured_at: time,
      content_captured_at: time,
      data_mode: mode,
      response_sha256: digest,
      raw_sha256: digest,
      source_sha256: digest.nullable(),
      charset: z.string().nullable(),
      cache_source_id: uuid.nullable(),
      asset_id: uuid,
      asset_version: count,
      title: z.string().max(1000).nullable(),
      limitations: strings,
      error_code: z.string().nullable(),
    })
    .strict(),
  SeoRecheck: z
    .object({ agent_id: uuid, expected_revision: count, budget })
    .strict(),
  SeoResult: result,
};
const schemas: Record<string, any> = Object.fromEntries(
  Object.entries(entries).map(([key, value]) => [
    key,
    z.toJSONSchema(value, { target: "draft-2020-12" }),
  ]),
);
schemas.SeoInput = inputJSON;
schemas.SeoCreate = {
  type: "object",
  additionalProperties: false,
  required: ["project_id", "agent_id", "input", "budget"],
  properties: {
    project_id: { type: "string", format: "uuid" },
    agent_id: { type: "string", format: "uuid" },
    input: { $ref: "#/components/schemas/SeoInput" },
    budget: { $ref: "#/components/schemas/SeoBudget" },
  },
};
schemas.SeoBudget.description =
  "Positive HKD micros; runtime additionally enforces amount_micros <= 1000000000000 and the current plan and available balance.";
const content = (name: string) => ({
  "application/json": { schema: { $ref: "#/components/schemas/" + name } },
});
const operation = (
  name: string,
  params: string[],
  output: string,
  input?: string,
  status = 200,
) => ({
  operationId: name,
  security: [{ customerSession: [] }, { nativeBearer: [] }],
  parameters: [
    ...params.map((name) => ({
      name,
      in: "path",
      required: true,
      schema: { type: "string", format: "uuid" },
    })),
    {
      name: "X-Tenant-ID",
      in: "header",
      required: true,
      schema: { type: "string", format: "uuid" },
    },
    ...(input
      ? [
          {
            name: "Idempotency-Key",
            in: "header",
            required: true,
            schema: {
              type: "string",
              minLength: 16,
              maxLength: 128,
              pattern: "^[\\w:-]+$",
            },
          },
          {
            name: "X-CSRF-Token",
            in: "header",
            required: false,
            description:
              "Required for cookie-authenticated writes; native Bearer sessions use their own audience checks.",
            schema: { type: "string" },
          },
        ]
      : []),
  ],
  ...(input
    ? { requestBody: { required: true, content: content(input) } }
    : {}),
  responses: {
    [String(status)]: {
      description:
        "Current project/private-owner and source lifecycle authorization is required.",
      content: content(output),
    },
  },
});
const paths: Record<string, any> = {
  "/v1/seo/audits": {
    get: operation("listScopedSeoAudits", [], "SeoAuditList"),
    post: operation("createScopedSeoAudit", [], "SeoAudit", "SeoCreate", 202),
  },
  "/v1/seo/audits/{run}": {
    get: operation("readScopedSeoAudit", ["run"], "SeoAudit"),
  },
  "/v1/seo/audits/{run}/findings": {
    get: operation("readScopedSeoFindings", ["run"], "SeoFindingsPage"),
  },
  "/v1/seo/audits/{run}/pages": {
    get: operation("readScopedSeoPages", ["run"], "SeoPages"),
  },
  "/v1/seo/audits/{run}/documents/{document}": {
    get: operation(
      "inspectScopedSeoSource",
      ["run", "document"],
      "SeoDocument",
    ),
  },
  "/v1/seo/audits/{run}/recheck": {
    post: operation(
      "recheckScopedSeoAudit",
      ["run"],
      "SeoAudit",
      "SeoRecheck",
      202,
    ),
  },
  "/v1/seo/audits/{run}/download": {
    get: operation("downloadScopedSeoAudit", ["run"], "SeoResult"),
  },
};
paths["/v1/seo/audits"].get.parameters.push({
  name: "project_id",
  in: "query",
  required: true,
  schema: { type: "string", format: "uuid" },
});
for (const [url, max] of [
  ["/v1/seo/audits/{run}/findings", 100000],
  ["/v1/seo/audits/{run}/pages", 10000],
] as const)
  paths[url].get.parameters.push({
    name: "offset",
    in: "query",
    required: false,
    schema: { type: "integer", minimum: 0, maximum: max, default: 0 },
  });
const download = paths["/v1/seo/audits/{run}/download"].get;
download.parameters.push({
  name: "format",
  in: "query",
  required: true,
  schema: { type: "string", enum: ["json", "html"] },
});
download.responses["200"].description =
  "Immutable attachment with no-store and X-Content-SHA256; format=json returns SeoResult, format=html returns the validated Codex report. Missing output is 409, unavailable identity/source is denied. Raw source containers use the existing authorized asset-version download.";
download.responses["200"].content["text/html"] = { schema: { type: "string" } };
const document = {
  openapi: "3.1.0",
  info: {
    title: "CopyPaste scoped website SEO audits",
    version: "1.0.0",
    description:
      "Additive bounded public-HTML collection, immutable source evidence, read-bound Codex interpretation and same-scope recheck. Existing normative Task API/DTO and full TC-029/GEO acceptance remain separate requirements. Synthetic local HTTP is explicitly labelled and is not live website or public TLS qualification.",
  },
  "x-normative-source-sha256": sha(normative),
  "x-model-source-sha256": sha(
    await readFile(path.join(platform, "src/seo-model.ts")),
  ),
  "x-route-source-sha256": sha(
    await readFile(path.join(platform, "src/seo-audits.ts")),
  ),
  paths,
  components: {
    securitySchemes: {
      customerSession: { type: "apiKey", in: "cookie", name: "cp_session" },
      nativeBearer: { type: "http", scheme: "bearer" },
    },
    schemas,
  },
};
const bytes = Buffer.from(JSON.stringify(document, null, 2) + "\n");
await writeFile(
  path.join(root, "docs/contracts/scoped-seo-openapi.json"),
  bytes,
);
await writeFile(
  path.join(platform, "contracts/scoped-seo-openapi.json"),
  bytes,
);
console.log(
  JSON.stringify({
    operations: 8,
    schemas: Object.keys(schemas).length,
    sha256: sha(bytes),
    normative_unchanged: true,
  }),
);
