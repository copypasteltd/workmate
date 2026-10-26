import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { canonical, hash } from "../src/lib.js";
const catalog = JSON.parse(
  await readFile("catalog/role-preset-catalog.json", "utf8"),
);
const prior = catalog.roles.find(
  (r: any) => r.role_key === "workflow-consultant",
);
assert.equal(prior.version, "1.1.0");
const path = "skills/workflow-scheduling/1.0.0/SKILL.md",
  sha256 = createHash("sha256")
    .update(await readFile(path))
    .digest("hex");
const role = structuredClone(prior);
role.version = "1.2.0";
role.skill_bindings.push({
  skill_key: "workflow-scheduling",
  version: "1.0.0",
  required: true,
});
role.readiness_evidence = [];
const release = {
  schema: "copypaste-cloud-schedule-release-1",
  previous_role_sha256: hash(canonical(prior)),
  role,
  skill_package: {
    key: "workflow-scheduling",
    version: "1.0.0",
    sha256,
    path,
    qualification: "pending_live_validation",
  },
  skill_definition: {
    skill_key: "workflow-scheduling",
    version: "1.0.0",
    purpose: "对话到私有云端计划、明确确认与触发记录",
    candidate_sources: [],
    package_state: "installed",
    package_sha256: sha256,
    ai_network_policy: "internal_only",
    tool_ids: ["workflow.validate", "workflow.run"],
    required_model_profiles: [],
    supported_clients: ["web", "extension", "desktop"],
  },
};
await writeFile(
  "catalog/cloud-schedule-release-v1.json",
  JSON.stringify(release, null, 2) + "\n",
  { flag: "wx" },
);
console.log(
  "Added workflow-consultant@1.2.0 and workflow-scheduling@1.0.0; prior published catalogs are unchanged.",
);
