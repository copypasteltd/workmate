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
const model = await import(
    pathToFileURL(path.join(platform, "src/creative-matrix-model.ts")).href
  ),
  sha = (b: Buffer) => createHash("sha256").update(b).digest("hex"),
  original = await readFile(path.join(root, "docs/contracts/openapi.json"));
assert.equal(
  sha(original),
  "51dd90f26137798dd23c4e881b7f9f0b20f99ad4b9fee0cce98686e11873aab4",
);
const entries = {
  MatrixCreate: "matrixCreate",
  MatrixEdit: "matrixEdit",
  MatrixRetry: "matrixRetry",
  MatrixCancel: "matrixCancel",
  MatrixCreated: "matrixCreated",
  MatrixUpdated: "matrixUpdated",
  MatrixCancelled: "matrixCancelled",
  MatrixList: "matrixList",
  MatrixDetail: "matrixDetail",
};
const schemas = Object.fromEntries(
  Object.entries(entries).map(([name, key]) => [
    name,
    z.toJSONSchema(model[key], { target: "draft-2020-12" }),
  ]),
);
schemas.MatrixCreate.description =
  "Runtime additionally rejects duplicate creative/size/language axes, requires exactly one copy per selected language, and enforces creatives × languages × sizes <= 60 before persistence. No AI translation or generation is performed.";
const content = (name: string) => ({
  "application/json": { schema: { $ref: "#/components/schemas/" + name } },
});
function op(
  id: string,
  params: string[],
  input: string | null,
  output: string,
) {
  return {
    operationId: id,
    security: [{ customerSession: [] }],
    parameters: [
      ...params.map((name) => ({
        name,
        in: "path",
        required: true,
        schema: { type: "string", format: "uuid" },
      })),
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
      "200": {
        description: "Current project-authorized result",
        content: content(output),
      },
    },
  };
}
const base = "/v1/tenants/{tenant}/projects/{project}/creative-batches",
  parents = ["tenant", "project"],
  batch = [...parents, "batch"],
  unit = [...batch, "unit"];
const listing = op("listCreativeMatrices", parents, null, "MatrixList");
listing.parameters.push({
  name: "before",
  in: "query",
  required: false,
  schema: { type: "string", format: "uuid" },
});
const document = {
  openapi: "3.1.0",
  info: {
    title: "CopyPaste creative production matrices",
    version: "0.5.0",
    description:
      "Additive project design batch contract. Deterministic local layout; six operations, independent immutable input revisions, explicit per-unit retries and actual PNG/SVG/JSON files. Original OpenAPI remains unchanged.",
  },
  "x-normative-source-sha256": sha(original),
  "x-model-source-sha256": sha(
    await readFile(path.join(platform, "src/creative-matrix-model.ts")),
  ),
  "x-route-source-sha256": sha(
    await readFile(path.join(platform, "src/creative-matrices.ts")),
  ),
  paths: {
    [base]: {
      get: listing,
      post: op(
        "createCreativeMatrix",
        parents,
        "MatrixCreate",
        "MatrixCreated",
      ),
    },
    [base + "/{batch}"]: {
      get: op("readCreativeMatrix", batch, null, "MatrixDetail"),
    },
    [base + "/{batch}/units/{unit}/edit"]: {
      post: op("editCreativeMatrixUnit", unit, "MatrixEdit", "MatrixUpdated"),
    },
    [base + "/{batch}/units/{unit}/retry"]: {
      post: op("retryCreativeMatrixUnit", unit, "MatrixRetry", "MatrixUpdated"),
    },
    [base + "/{batch}/cancel"]: {
      post: op(
        "cancelCreativeMatrix",
        batch,
        "MatrixCancel",
        "MatrixCancelled",
      ),
    },
  },
  components: {
    securitySchemes: {
      customerSession: { type: "apiKey", in: "cookie", name: "cp_session" },
    },
    schemas,
  },
};
const bytes = JSON.stringify(document, null, 2) + "\n";
await writeFile(
  path.join(root, "docs/contracts/creative-matrix-openapi.json"),
  bytes,
);
await writeFile(
  path.join(platform, "contracts/creative-matrix-openapi.json"),
  bytes,
);
console.log(
  JSON.stringify({
    operations: 6,
    schemas: Object.keys(schemas).length,
    sha256: sha(Buffer.from(bytes)),
    original_unchanged: true,
  }),
);
