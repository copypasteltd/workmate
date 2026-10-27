import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { Catalog } from "../src/catalog.js";
test("forward software release retains approved historical role digests and old Skill bytes without expanding permissions or qualification", async () => {
  const catalog = new Catalog();
  await catalog.load();
  const release = JSON.parse(
      await readFile("catalog/software-toolchain-release-v1.json", "utf8"),
    ),
    base = JSON.parse(
      await readFile("catalog/role-preset-catalog.json", "utf8"),
    );
  assert.equal(release.roles.length, 6);
  assert.equal(release.skill_packages.length, 4);
  for (const item of release.roles) {
    const current = catalog.role(item.role.role_key),
      historical = catalog.forTask({
        role_key: current.role_key,
        role_hash: item.previous_role_sha256,
      });
    assert.deepEqual(
      historical,
      base.roles.find((r: any) => r.role_key === current.role_key),
    );
    assert.equal(historical.version, "1.0.0");
    assert.equal(current.version, "1.1.0");
    assert.notEqual(catalog.digest(current), item.previous_role_sha256);
    assert.deepEqual(current.tool_ids, historical.tool_ids);
    assert.deepEqual(current.readiness_evidence, []);
    assert.equal(current.qualification_cases.execution_status, "not_run");
    for (const skill of await catalog.boundSkills(historical))
      assert.equal(skill.version, "1.0.0");
    const currentSkills = await catalog.boundSkills(current);
    assert.ok(currentSkills.some((s) => s.version === "1.1.0"));
  }
  for (const p of release.skill_packages) {
    const text = await catalog.verifySkill(p);
    assert.ok(text.includes("Version: 1.1.0."));
    assert.ok(
      text.includes(
        "do not prove a combined live server/database/browser session",
      ),
    );
    assert.equal(p.qualification, "pending_live_validation");
  }
});
