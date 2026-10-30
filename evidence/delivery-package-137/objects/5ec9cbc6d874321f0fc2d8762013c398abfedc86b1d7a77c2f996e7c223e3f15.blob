import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const catalog = JSON.parse(
  await readFile("catalog/role-preset-catalog.json", "utf8"),
);
const history = JSON.parse(
  await readFile("catalog/role-preset-history.json", "utf8"),
);
const packages = JSON.parse(
  await readFile("catalog/skill-packages.json", "utf8"),
);
const keys = ["workflow-design", "workflow-execution"];
const role = catalog.roles.find(
  (r: any) => r.role_key === "workflow-consultant",
);
assert.ok(role);
if (role.version === "1.0.0") {
  assert.ok(
    !history.some(
      (r: any) => r.role_key === role.role_key && r.version === role.version,
    ),
  );
  history.push(structuredClone(role));
  role.version = "1.1.0";
  role.tool_ids = [...new Set([...role.tool_ids, "dataset.read"])].sort();
  for (const binding of role.skill_bindings)
    if (keys.includes(binding.skill_key)) binding.version = "1.1.0";
  role.readiness_evidence = [];
} else assert.equal(role.version, "1.1.0");
for (const key of keys) {
  const original = catalog.skill_catalog.find(
    (s: any) => s.skill_key === key && s.version === "1.0.0",
  );
  assert.ok(original);
  if (
    !catalog.skill_catalog.some(
      (s: any) => s.skill_key === key && s.version === "1.1.0",
    )
  )
    catalog.skill_catalog.push({
      ...structuredClone(original),
      version: "1.1.0",
    });
  const path = `skills/${key}/1.1.0/SKILL.md`,
    bytes = await readFile(path),
    sha256 = createHash("sha256").update(bytes).digest("hex");
  const installed = packages.find(
    (s: any) => s.key === key && s.version === "1.1.0",
  );
  if (installed)
    assert.equal(
      installed.sha256,
      sha256,
      "Published Skill bytes must not change",
    );
  else
    packages.push({
      key,
      version: "1.1.0",
      sha256,
      path,
      qualification: "pending_live_validation",
    });
}
for (const [file, body] of [
  ["role-preset-catalog.json", catalog],
  ["role-preset-history.json", history],
  ["skill-packages.json", packages],
])
  await writeFile("catalog/" + file, JSON.stringify(body, null, 2) + "\n");
console.log(
  "Versioned workflow-consultant and two Skills; old role and package bytes are retained.",
);
