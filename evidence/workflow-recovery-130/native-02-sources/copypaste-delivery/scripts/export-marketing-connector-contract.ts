import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import path from "node:path";
import assert from "node:assert/strict";
const platform = path.resolve("../copypaste-platform"),
  root = path.resolve("../.."),
  requirePlatform = createRequire(path.join(platform, "package.json")),
  { z } = requirePlatform("zod");
const m = await import(
    pathToFileURL(path.join(platform, "src/connector-model.ts")).href
  ),
  sha = (b: Buffer) => createHash("sha256").update(b).digest("hex"),
  original = await readFile(path.join(root, "docs/contracts/openapi.json"));
assert.equal(
  sha(original),
  "51dd90f26137798dd23c4e881b7f9f0b20f99ad4b9fee0cce98686e11873aab4",
);
const originalSchemas = JSON.parse(original.toString()).components.schemas;
const uuid = z.uuid(),
  time = z.iso.datetime(),
  integer = z.number().int().nonnegative(),
  mode = z.enum(["simulated", "configured_services"]),
  strings = z.array(z.string()),
  ids = z.array(uuid),
  digest = z.string().regex(/^[a-f0-9]{64}$/);
const job = m.connectorSyncDTO
  .extend({
    kind: z.enum(["discover", "sync"]),
    status: z.enum([
      "queued",
      "running",
      "complete",
      "partial",
      "failed",
      "cancelled",
    ]),
    segment: integer,
    page_count: integer,
    row_count: integer,
    raw_bytes: integer,
    attempts: integer,
    error_code: z.string().nullable(),
    limitations: strings,
    captured_at: time.nullable(),
    next_attempt_at: time,
    created_at: time,
    spec_hash: digest,
    source_mode: mode,
    retry_of: uuid.nullable(),
  })
  .strict();
const snapshot = z
  .object({
    id: uuid,
    project_id: uuid,
    state: z.enum(["complete", "partial"]),
    row_count: integer,
    captured_at: time,
    data_as_of: time.nullable(),
    spec_hash: digest,
    data_mode: mode,
    asset_id: uuid,
    dataset_ids: ids,
    limitations: strings,
  })
  .strict();
const history = z
  .object({
    jobs: z.array(job).max(20),
    snapshots: z.array(snapshot).max(20),
    next_history_cursor: uuid.nullable(),
  })
  .strict();
const detail = z
  .object({
    connection: m.connectionDTO,
    name: z.string(),
    source_mode: mode,
    api_version: z.string(),
    project_ids: ids,
    scopes: strings,
    catalog_state: z.enum([
      "pending",
      "discovering",
      "complete",
      "partial",
      "failed",
    ]),
    limitations: strings,
    accounts: z.array(m.connectorAccount),
    last_sync_at: time.nullable(),
    ...history.shape,
  })
  .strict();
const adminDetail = detail
  .omit({ accounts: true, next_history_cursor: true })
  .extend({
    tenant_id: uuid,
    project_id: uuid,
    jobs: z.array(job).max(30),
    snapshots: z.array(snapshot.omit({ spec_hash: true })),
  })
  .strict();
const facts = z
  .object({
    id: uuid,
    project_id: uuid,
    source: m.connectorProvider,
    state: z.enum(["complete", "partial"]),
    source_mode: mode,
    row_count: integer,
    captured_at: time,
    data_as_of: z.null(),
    limitations: strings,
    specification: z.record(z.string(), z.unknown()),
    spec_hash: digest,
    dataset_ids: ids,
    asset_id: uuid,
    facts: z.array(m.connectorFact).max(100),
    next_offset: integer.nullable(),
  })
  .strict();
const entries = {
  ConnectorCreate: m.connectorCreateInput,
  ConnectorScope: m.connectorUpdateInput,
  ConnectorDates: m.connectorSyncInput,
  ConnectorAccount: m.connectorAccount,
  ConnectorFact: m.connectorFact,
  ConnectorQuery: m.connectorQuery,
  ConnectorSync: m.connectorSyncDTO,
  ConnectorJob: job,
  ConnectorJobDetail: job
    .extend({
      snapshot_ids: ids,
      specification: z.record(z.string(), z.unknown()),
    })
    .strict(),
  ConnectorSnapshotHeader: snapshot,
  ConnectorHistory: history,
  ConnectorDetail: detail,
  ConnectorAdminDetail: adminDetail,
  ConnectorFacts: facts,
  ConnectorLaunch: z
    .object({ authorization_url: z.url(), source_mode: mode })
    .strict(),
  ConnectorProviders: z
    .object({
      items: z.array(
        z
          .object({
            provider: m.connectorProvider,
            name: z.string(),
            configured: z.boolean(),
            source_mode: mode,
            api_version: z.string().nullable(),
          })
          .strict(),
      ),
    })
    .strict(),
  ConnectorRevocation: z
    .object({ reason: z.string().trim().min(3).max(1000) })
    .strict(),
  ConnectorRevoked: z.object({ ok: z.literal(true) }).strict(),
  EmptyCommand: z.object({}).strict(),
};
const schemas: Record<string, any> = Object.fromEntries(
  Object.entries(entries).map(([n, s]) => [
    n,
    z.toJSONSchema(s, { target: "draft-2020-12" }),
  ]),
);
for (const name of [
  "Provider",
  "Connection",
  "ConnectionList",
  "Snapshot",
  "AdminOperation",
])
  schemas[name] = originalSchemas[name];
schemas.ConnectorDates.description =
  "Runtime additionally validates real calendar dates, from <= to, and at most 366 inclusive days.";
schemas.ConnectorQuery.description =
  "Server-frozen provider/account/report grain/dates/API version; never accepted from a user as a replacement query. Google and Meta campaign normalization has separate CSV source lineage.";
const content = (name: string) => ({
  "application/json": { schema: { $ref: "#/components/schemas/" + name } },
});
function op(
  id: string,
  params: string[],
  input: string | null,
  output: string,
  status = 200,
  admin = false,
) {
  return {
    operationId: id,
    security: [{ [admin ? "adminSession" : "customerSession"]: [] }],
    parameters: [
      ...params.map((name) => ({
        name,
        in: "path",
        required: true,
        schema: {
          type: "string",
          format: name === "state" ? undefined : "uuid",
          ...(name === "state" ? { pattern: "^[\\w-]{43}$" } : {}),
        },
      })),
      ...(!admin
        ? [
            {
              name: "X-Tenant-ID",
              in: "header",
              required: true,
              schema: { type: "string", format: "uuid" },
            },
          ]
        : []),
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
              required: true,
              schema: { type: "string", minLength: 1 },
            },
          ]
        : []),
    ],
    ...(input
      ? { requestBody: { required: true, content: content(input) } }
      : {}),
    responses: {
      [status]: {
        description: "Currently authorized, source-fenced result",
        content: content(output),
      },
    },
  };
}
const paths: Record<string, any> = {};
const put = (url: string, method: string, operation: any) => {
  (paths[url] ??= {})[method] = operation;
};
put(
  "/v1/connector-providers",
  "get",
  op("connectorProviders", [], null, "ConnectorProviders"),
);
paths["/v1/connector-providers"].get.parameters = [];
put(
  "/v1/connections",
  "get",
  op("connectorDirectory", [], null, "ConnectionList"),
);
put(
  "/v1/connections",
  "post",
  op("createConnectorAuthorization", [], "ConnectorCreate", "Connection", 201),
);
put(
  "/v1/connections/{connection}",
  "patch",
  op("confirmConnectorScope", ["connection"], "ConnectorScope", "Connection"),
);
put(
  "/v1/connections/{connection}",
  "delete",
  op("revokeConnector", ["connection"], "EmptyCommand", "ConnectorRevoked"),
);
put(
  "/v1/connections/{connection}/detail",
  "get",
  op("connectorDetail", ["connection"], null, "ConnectorDetail"),
);
put(
  "/v1/connections/{connection}/history",
  "get",
  op("connectorHistory", ["connection"], null, "ConnectorHistory"),
);
put(
  "/v1/connections/{connection}/discovery",
  "post",
  op(
    "rediscoverConnectorAccounts",
    ["connection"],
    "EmptyCommand",
    "ConnectorSync",
    202,
  ),
);
put(
  "/v1/connections/{connection}/syncs",
  "post",
  op(
    "synchronizeConnector",
    ["connection"],
    "ConnectorDates",
    "ConnectorSync",
    202,
  ),
);
put(
  "/v1/syncs/{sync}",
  "get",
  op("readConnectorSync", ["sync"], null, "ConnectorSync"),
);
put(
  "/v1/syncs/{sync}/detail",
  "get",
  op("connectorSyncDetail", ["sync"], null, "ConnectorJobDetail"),
);
for (const action of ["cancel", "retry"])
  put(
    `/v1/syncs/{sync}/${action}`,
    "post",
    op(
      action + "ConnectorSync",
      ["sync"],
      "EmptyCommand",
      "ConnectorJob",
      action === "retry" ? 202 : 200,
    ),
  );
put(
  "/v1/connector-snapshots/{snapshot}",
  "get",
  op("connectorSnapshotFacts", ["snapshot"], null, "ConnectorFacts"),
);
put(
  "/v1/tenants/{tenant}/projects/{project}/connector-snapshots/{snapshot}",
  "get",
  op(
    "projectConnectorSnapshotFacts",
    ["tenant", "project", "snapshot"],
    null,
    "ConnectorFacts",
  ),
);
put(
  "/v1/admin/connections",
  "get",
  op("adminConnectorDirectory", [], null, "ConnectionList", 200, true),
);
put(
  "/v1/admin/connections/{connection}/detail",
  "get",
  op(
    "adminConnectorDetail",
    ["connection"],
    null,
    "ConnectorAdminDetail",
    200,
    true,
  ),
);
put(
  "/v1/admin/connections/{connection}/revocations",
  "post",
  op(
    "adminRevokeConnector",
    ["connection"],
    "ConnectorRevocation",
    "AdminOperation",
    202,
    true,
  ),
);
const launch = op(
  "launchConnectorAuthorization",
  ["state"],
  null,
  "ConnectorLaunch",
);
launch.security = [];
launch.parameters = launch.parameters.filter((p: any) => p.in === "path");
put("/v1/connections/launch/{state}", "get", launch);
for (const route of ["/v1/connections", "/v1/admin/connections"]) {
  paths[route].get.parameters.push(
    ...[
      "cursor",
      "project_id",
      ...(route.includes("admin") ? ["tenant_id", "user_id"] : []),
    ].map((name) => ({
      name,
      in: "query",
      required: false,
      schema: { type: "string", format: "uuid" },
    })),
    {
      name: "limit",
      in: "query",
      required: false,
      schema: { type: "integer", minimum: 1, maximum: 100 },
    },
  );
}
paths["/v1/connections/{connection}/history"].get.parameters.push({
  name: "cursor",
  in: "query",
  required: false,
  schema: { type: "string", format: "uuid" },
});
for (const route of [
  "/v1/connector-snapshots/{snapshot}",
  "/v1/tenants/{tenant}/projects/{project}/connector-snapshots/{snapshot}",
]) {
  const operation = paths[route].get;
  operation.parameters.push(
    {
      name: "offset",
      in: "query",
      required: false,
      schema: { type: "integer", minimum: 0, maximum: 100000 },
    },
    {
      name: "limit",
      in: "query",
      required: false,
      schema: { type: "integer", minimum: 1, maximum: 100 },
    },
    {
      name: "format",
      in: "query",
      required: false,
      schema: { type: "string", enum: ["json", "csv"] },
    },
  );
  operation.responses["200"].description =
    "Without format: bounded facts page. format=json: retained full frozen snapshot JSON. format=csv: UTF-8 BOM CSV attachment with JSON dimensions/metrics; requires the same current source/project gates.";
  operation.responses["200"].content["text/csv"] = {
    schema: { type: "string" },
  };
}
const document = {
  openapi: "3.1.0",
  info: {
    title: "CopyPaste marketing connector synchronization",
    version: "1.0.0",
    description:
      "Additive account discovery, company authorization launcher, durable pagination, retry/cancel, immutable source facts/export and scoped Admin metadata/revocation. Callback and original strict Connection/Sync/Snapshot/AdminOperation remain governed by the unchanged normative contract. Protocol-shaped local HTTP fixtures are synthetic; no live provider, full role or whole-product acceptance is asserted.",
  },
  "x-normative-source-sha256": sha(original),
  "x-model-source-sha256": sha(
    await readFile(path.join(platform, "src/connector-model.ts")),
  ),
  "x-route-source-sha256": sha(
    await readFile(path.join(platform, "src/connectors.ts")),
  ),
  paths,
  components: {
    securitySchemes: {
      customerSession: { type: "apiKey", in: "cookie", name: "cp_session" },
      adminSession: { type: "apiKey", in: "cookie", name: "cp_admin_session" },
    },
    schemas,
  },
};
const bytes = JSON.stringify(document, null, 2) + "\n";
await writeFile(
  path.join(root, "docs/contracts/marketing-connector-openapi.json"),
  bytes,
);
await writeFile(
  path.join(platform, "contracts/marketing-connector-openapi.json"),
  bytes,
);
console.log(
  JSON.stringify({
    operations: Object.values(paths).reduce(
      (n: any, v: any) => n + Object.keys(v).length,
      0,
    ),
    schemas: Object.keys(schemas).length,
    sha256: sha(Buffer.from(bytes)),
    original_unchanged: true,
  }),
);
