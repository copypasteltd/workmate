import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const catalog = JSON.parse(
  await readFile("catalog/role-preset-catalog.json", "utf8"),
);
const history = JSON.parse(
  await readFile("catalog/role-preset-history.json", "utf8"),
);
const skills = new Set(["dataviz", "deterministic-metrics", "ads-analysis"]);
for (const key of ["information-design", "marketing-analyst"]) {
  const role = catalog.roles.find((r: any) => r.role_key === key);
  assert.ok(role);
  if (role.version === "1.1.0") continue;
  assert.equal(role.version, "1.0.0");
  assert.ok(
    !history.some((r: any) => r.role_key === key && r.version === role.version),
  );
  history.push(structuredClone(role));
  role.version = "1.1.0";
  for (const binding of role.skill_bindings)
    if (skills.has(binding.skill_key)) binding.version = "1.1.0";
  role.readiness_evidence = [];
}
for (const key of skills) {
  const original = catalog.skill_catalog.find(
    (d: any) => d.skill_key === key && d.version === "1.0.0",
  );
  assert.ok(
    original,
    "Keep the reviewed definition for every installed old package",
  );
  if (
    !catalog.skill_catalog.some(
      (d: any) => d.skill_key === key && d.version === "1.1.0",
    )
  )
    catalog.skill_catalog.push({
      ...structuredClone(original),
      version: "1.1.0",
    });
}
await writeFile(
  "catalog/role-preset-history.json",
  JSON.stringify(history, null, 2) + "\n",
);
await writeFile(
  "catalog/role-preset-catalog.json",
  JSON.stringify(catalog, null, 2) + "\n",
);
console.log(
  "Versioned two analysis roles and three Skills; old package bytes and frozen role definitions are retained. Professional qualification remains separate.",
);
