import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import {
  groupCreateInput,
  groupUpdateInput,
  groupRunInput,
} from "../src/agent-group-model.js";
const original = JSON.parse(await readFile("catalog/openapi.json", "utf8"));
const json = (s: z.ZodType) => z.toJSONSchema(s);
const schemas = Object.fromEntries(
  ["GroupMember", "AgentGroup", "AgentGroupList"].map((name) => [
    name,
    original.components.schemas[name],
  ]),
);
Object.assign(schemas, {
  AgentGroupCreate: json(groupCreateInput),
  AgentGroupUpdate: json(groupUpdateInput),
  GroupRunPlan: json(groupRunInput),
  GroupRunApproval: json(
    z
      .object({
        preflight_id: z.uuid(),
        expected_version: z.number().int().positive(),
        definition_hash: z.string().regex(/^[a-f0-9]{64}$/),
        approved_budget_micros: z.number().int().positive().max(1e12),
        confirm: z.literal(true),
      })
      .strict(),
  ),
  GroupRunCancel: json(
    z.object({ expected_revision: z.number().int().positive() }).strict(),
  ),
});
const tenant = {
    name: "X-Tenant-ID",
    in: "header",
    required: true,
    schema: { type: "string", format: "uuid" },
  },
  idempotency = {
    name: "Idempotency-Key",
    in: "header",
    required: true,
    schema: { type: "string", minLength: 16, maxLength: 128 },
  },
  group = {
    name: "group",
    in: "path",
    required: true,
    schema: { type: "string", format: "uuid" },
  },
  run = { ...group, name: "run" };
const response = (schema?: string) => ({
  description: "Authenticated project team or private run result",
  ...(schema
    ? {
        content: {
          "application/json": {
            schema: { $ref: "#/components/schemas/" + schema },
          },
        },
      }
    : {}),
});
const operation = (
  id: string,
  params: any[],
  request?: string,
  output?: string,
  created = false,
) => ({
  operationId: id,
  parameters: [tenant, ...params, ...(request ? [idempotency] : [])],
  security: [{ session: [] }, { native: [] }],
  ...(request
    ? {
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/" + request },
            },
          },
        },
      }
    : {}),
  responses: {
    [created ? "201" : "200"]: response(output),
    ...Object.fromEntries(
      [400, 401, 403, 404, 409, 410, 422, 503].map((n) => [
        n,
        {
          description:
            "Rejected request; no unapproved tasks or fees are created",
        },
      ]),
    ),
  },
});
const contract = {
  openapi: "3.1.0",
  info: {
    title: "CopyPaste persisted specialist teams",
    version: "1.0.0",
    description:
      "Additive contract. Canonical AgentGroup CRUD response schemas are copied unchanged. Runs execute approved cloud Codex DAGs; Desktop tokens cannot start cloud teams. Original contracts remain immutable.",
  },
  paths: {
    "/v1/agent-groups": {
      get: operation(
        "listAgentGroups",
        [
          {
            name: "project_id",
            in: "query",
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "cursor",
            in: "query",
            schema: { type: "string", format: "uuid" },
          },
          {
            name: "limit",
            in: "query",
            schema: { type: "integer", minimum: 1, maximum: 100 },
          },
        ],
        undefined,
        "AgentGroupList",
      ),
      post: operation(
        "createAgentGroup",
        [],
        "AgentGroupCreate",
        "AgentGroup",
        true,
      ),
    },
    "/v1/agent-groups/{group}": {
      get: operation("getAgentGroup", [group], undefined, "AgentGroup"),
      patch: operation(
        "updateAgentGroup",
        [group],
        "AgentGroupUpdate",
        "AgentGroup",
      ),
    },
    "/v1/agent-groups/{group}/versions": {
      get: operation("listAgentGroupVersions", [group]),
    },
    "/v1/agent-groups/{group}/preflight": {
      post: operation("prepareAgentGroupRun", [group], "GroupRunPlan"),
    },
    "/v1/agent-groups/{group}/runs": {
      get: operation("listPrivateAgentGroupRuns", [group]),
      post: operation(
        "approveAgentGroupRun",
        [group],
        "GroupRunApproval",
        undefined,
        true,
      ),
    },
    "/v1/agent-groups/{group}/runs/{run}": {
      get: operation("getPrivateAgentGroupRun", [group, run]),
    },
    "/v1/agent-groups/{group}/runs/{run}/cancel": {
      post: operation(
        "cancelPrivateAgentGroupRun",
        [group, run],
        "GroupRunCancel",
      ),
    },
  },
  components: {
    securitySchemes: {
      session: {
        type: "apiKey",
        in: "cookie",
        name: "cp_session",
        description:
          "Browser mutations also require X-CSRF-Token and an allowed Origin",
      },
      native: {
        type: "http",
        scheme: "bearer",
        description:
          "Approved Extension tokens may call cloud APIs; Desktop tokens must execute locally",
      },
    },
    schemas,
  },
};
await writeFile(
  "contracts/agent-groups-openapi.json",
  JSON.stringify(contract, null, 2) + "\n",
);
console.log(
  JSON.stringify({
    paths: Object.keys(contract.paths).length,
    original_contracts_modified: false,
  }),
);
