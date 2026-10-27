import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
const catalog = JSON.parse(
  await readFile("catalog/role-preset-catalog.json", "utf8"),
);
const history = JSON.parse(
  await readFile("catalog/role-preset-history.json", "utf8"),
);
for (const [key, skill] of [
  ["brand-visual", "brand-system"],
  ["presentation", "presentation-production"],
]) {
  const role = catalog.roles.find((r: any) => r.role_key === key);
  assert.ok(role);
  if (role.version === "1.1.0") continue;
  assert.equal(role.version, "1.0.0");
  assert.ok(
    !history.some((r: any) => r.role_key === key && r.version === "1.0.0"),
  );
  history.push(structuredClone(role));
  role.version = "1.1.0";
  role.skill_bindings.find((b: any) => b.skill_key === skill).version = "1.1.0";
  if (key === "presentation") {
    role.skill_bindings.find((b: any) => b.skill_key === "dataviz").version =
      "1.1.0";
    role.skill_bindings.push({
      skill_key: "deterministic-metrics",
      version: "1.1.0",
      required: true,
    });
    role.tool_ids.push("dataset.read", "connector.read");
    role.tool_ids.sort();
  }
  role.readiness_evidence = [];
}
for (const key of ["brand-system", "presentation-production"]) {
  const old = catalog.skill_catalog.find(
    (s: any) => s.skill_key === key && s.version === "1.0.0",
  );
  assert.ok(old);
  if (
    !catalog.skill_catalog.some(
      (s: any) => s.skill_key === key && s.version === "1.1.0",
    )
  )
    catalog.skill_catalog.push({ ...structuredClone(old), version: "1.1.0" });
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
  "Versioned vector and presentation roles; historic roles and installed Skills are retained. Professional qualification remains pending.",
);
