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
const schemasModule = await import(
  pathToFileURL(path.join(platform, "src/agent-adoption.ts")).href
);
const sha = (b: Buffer) => createHash("sha256").update(b).digest("hex");
const normative = await readFile(
  path.join(root, "docs/contracts/openapi.json"),
);
assert.equal(
  sha(normative),
  "51dd90f26137798dd23c4e881b7f9f0b20f99ad4b9fee0cce98686e11873aab4",
);
const exported: Record<string, string> = {
  AgentVersionProposal: "agentVersionProposal",
  ConversationAdoptionProposal: "conversationAdoptionProposal",
  AdoptionComparison: "adoptionComparison",
  AdoptionPreview: "adoptionPreview",
  AdoptionConfirmation: "adoptionConfirmation",
  AdoptionResult: "adoptionResult",
};
const schemas = Object.fromEntries(
  Object.entries(exported).map(([name, key]) => [
    name,
    z.toJSONSchema(schemasModule[key], { target: "draft-2020-12" }),
  ]),
);
const ref = (name: string) => ({ $ref: "#/components/schemas/" + name }),
  content = (name: string) => ({ "application/json": { schema: ref(name) } });
const parameters = ["tenant", "project", "id"].map((name) => ({
  name,
  in: "path",
  required: true,
  schema: { type: "string", format: "uuid" },
}));
const operation = (
  operationId: string,
  input: string | null,
  output: string,
  status = "200",
) => ({
  operationId,
  parameters: [
    ...parameters,
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
        ]
      : []),
  ],
  ...(input
    ? { requestBody: { required: true, content: content(input) } }
    : {}),
  responses: {
    [status]: {
      description: "Current authorized comparison or confirmed adoption",
      content: content(output),
    },
  },
});
const base = "/v1/tenants/{tenant}/projects/{project}";
const document = {
  openapi: "3.1.0",
  info: {
    title: "CopyPaste explicit agent adoption supplement",
    version: "0.5.0",
    description:
      "Additive customer comparison and confirmation flows. Does not replace or assert compliance for original Agent/Conversation CRUD.",
  },
  "x-normative-source-sha256": sha(normative),
  "x-implementation-sha256": sha(
    await readFile(path.join(platform, "src/agent-adoption.ts")),
  ),
  paths: {
    [base + "/agents/{id}/version-previews"]: {
      post: operation(
        "previewAgentVersion",
        "AgentVersionProposal",
        "AdoptionPreview",
        "201",
      ),
    },
    [base + "/conversations/{id}/adoption-previews"]: {
      post: operation(
        "previewConversationAdoption",
        "ConversationAdoptionProposal",
        "AdoptionPreview",
        "201",
      ),
    },
    [base + "/version-adoption-previews/{id}"]: {
      get: operation("readAdoptionPreview", null, "AdoptionPreview"),
    },
    [base + "/version-adoption-previews/{id}/confirmations"]: {
      post: operation(
        "confirmAgentAdoption",
        "AdoptionConfirmation",
        "AdoptionResult",
      ),
    },
  },
  components: { schemas },
};
const destination = path.join(
    root,
    "docs/contracts/agent-adoption.openapi.json",
  ),
  bytes = JSON.stringify(document, null, 2) + "\n";
await writeFile(destination, bytes);
console.log(
  JSON.stringify({
    paths: 4,
    schemas: Object.keys(schemas).length,
    sha256: sha(Buffer.from(bytes)),
    original_unchanged: true,
  }),
);
