// Forward-only release builder. Existing packages and published role bytes stay
// immutable; rerunning must reproduce the exact same new files.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { canonical } from "../src/lib.ts";
const base = JSON.parse(
  await readFile("catalog/role-preset-catalog.json", "utf8"),
);
const installed = JSON.parse(
  await readFile("catalog/skill-packages.json", "utf8"),
);
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function immutable(file, bytes) {
  try {
    assert.equal(
      sha(await readFile(file)),
      sha(bytes),
      "An existing release must not be overwritten: " + file,
    );
  } catch (e) {
    if (e.code !== "ENOENT") throw e;
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, bytes, { flag: "wx" });
  }
}
const keys = [
    "fullstack-engineering",
    "frontend-implementation",
    "backend-api",
    "qa-testing",
  ],
  packages = [],
  definitions = [];
for (const key of keys) {
  const original = installed.find(
      (p) => p.key === key && p.version === "1.0.0",
    ),
    definition = base.skill_catalog.find(
      (s) => s.skill_key === key && s.version === "1.0.0",
    );
  assert.ok(original && definition);
  const before = await readFile(original.path, "utf8");
  assert.equal(sha(before), original.sha256);
  const tools =
    key === "fullstack-engineering"
      ? [
          "code.read",
          "code.patch",
          "process.run.allowed",
          "api.test",
          "database.test.native",
          "browser.preview",
          "delivery.package",
        ]
      : definition.tool_ids;
  let content = before.replace("Version: 1.0.0.", "Version: 1.1.0.");
  if (key === "fullstack-engineering")
    content = content.replace(
      "Use only currently granted tool IDs: code.read, code.patch, process.run.allowed.",
      "Use only tool IDs actually granted by the current task: " +
        tools.join(", ") +
        ".",
    );
  content += `\n## Executable software toolchain / 可执行的软件检查\n\n- In cloud tasks use company tools already granted to this role: \`process_run_allowed\` runs pinned Node JS/TS without shell, network, packages or children; \`api_test\` sends real HTTP/1.1 bytes to an exported Node handler or unstarted http.Server over anonymous pipes; \`database_test_native\` executes SQL in a fresh SQLite database. No production database, external URL, npm install, TCP/TLS or PostgreSQL compatibility is implied.\n- \`browser_preview\` requires an existing task HTML entry and built local JS/CSS/assets. Provide structured interactions and exact named DOM assertions. It launches a fresh native Chromium sandbox with a bounded process job, offline routing and no outside services, workers, frames, downloads or device permissions. No arbitrary evaluation, Node code or shell executes in the controller.\n- Exercise normal, failure, empty, permission and revision states. Preserve failing receipts; fix source with its exact previous SHA-256, then repeat relevant checks. Read each actual assertion, script error, timeout, source digest and screenshot before reporting a pass. A model prediction is not a test result.\n- Use \`code_package\` after the final source revision. It includes only checks bound to those exact source bytes, including failures. API, SQLite and browser checks execute independently: they do not prove a combined live server/database/browser session. Label UI mocks and unconnected integrations explicitly; never claim deployment or customer acceptance from these component checks.\n- Desktop tasks execute Codex on the customer's own computer with its granted local command/browser permissions; cloud-only tools are absent. Follow the customer's approved permission scope and keep the actual local runtime/output evidence. Close only task-owned unused pages and processes on success, failure or cancellation.\n- 云端检查使用上述真实工具；外部服务、框架构建、真实数据库及部署须另行验证。更改源码后重跑检查，保留失败证据与版本；Desktop 使用客户本机 Codex，不以云端执行代替。本版本仍待真实客户专业验收。\n`;
  const file = `skills/${key}/1.1.0/SKILL.md`;
  await immutable(file, Buffer.from(content));
  packages.push({
    key,
    version: "1.1.0",
    sha256: sha(content),
    path: file,
    qualification: "pending_live_validation",
  });
  definitions.push({
    ...definition,
    version: "1.1.0",
    package_state: "installed",
    package_sha256: sha(content),
    tool_ids: tools,
  });
}
const roleKeys = [
  "fullstack",
  "frontend",
  "backend-api",
  "software-qa",
  "ui-ux",
  "landing-page",
];
const roles = roleKeys.map((key) => {
  const prior = base.roles.find((r) => r.role_key === key);
  assert.equal(prior.version, "1.0.0");
  const previous_role_sha256 = sha(
    canonical({
      role: prior,
      skills: installed.filter((s) =>
        prior.skill_bindings.some(
          (b) => b.skill_key === s.key && b.version === s.version,
        ),
      ),
    }),
  );
  const role = structuredClone(prior);
  role.version = "1.1.0";
  role.skill_bindings = role.skill_bindings.map((b) =>
    keys.includes(b.skill_key) ? { ...b, version: "1.1.0" } : b,
  );
  role.workflow.push({
    step_key: "exact-source-software-checks",
    instruction:
      "Use currently granted native cloud software tools to collect actual command, HTTP/SQLite and browser interaction evidence, inspect the real PNG and preserve failed assertions. Build local static assets before browser preview, rerun after source changes and deliver exact-source packages. These independent checks do not prove combined server integration, external services, deployment or professional acceptance. Desktop uses customer-local Codex permissions.",
  });
  return { previous_role_sha256, role };
});
await immutable(
  "catalog/software-toolchain-release-v1.json",
  Buffer.from(
    JSON.stringify(
      {
        schema: "copypaste-software-toolchain-release-1",
        skill_packages: packages,
        skill_definitions: definitions,
        roles,
      },
      null,
      2,
    ) + "\n",
  ),
);
console.log(
  JSON.stringify({
    status: "created_or_identical",
    new_skills: packages.length,
    new_role_versions: roles.length,
  }),
);
