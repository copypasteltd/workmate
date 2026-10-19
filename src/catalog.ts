import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import type { Config } from "./config.js";
import { canonical, Problem } from "./lib.js";
import type { Tx } from "./db.js";
export interface SkillPackage {
  key: string;
  version: string;
  sha256: string;
  path: string;
  qualification: string;
}
export class Catalog {
  roles: any[] = [];
  skills: SkillPackage[] = [];
  skillDefinitions: any[] = [];
  admin: any;
  async load() {
    const c = JSON.parse(
      await readFile("catalog/role-preset-catalog.json", "utf8"),
    );
    this.roles = c.roles;
    this.skillDefinitions = c.skill_catalog;
    this.skills = JSON.parse(
      await readFile("catalog/skill-packages.json", "utf8"),
    );
    this.admin = JSON.parse(
      await readFile("catalog/admin-permission-catalog.json", "utf8"),
    );
    for (const p of this.skills) await this.verifySkill(p);
  }
  async verifySkill(p: SkillPackage) {
    const content = await readFile(path.resolve(p.path), "utf8");
    if (createHash("sha256").update(content).digest("hex") !== p.sha256)
      throw new Problem(
        503,
        "SKILL_INTEGRITY_FAILED",
        `Skill package failed integrity: ${p.key}`,
      );
    return content;
  }
  role(key: string) {
    const r = this.roles.find((r) => r.role_key === key);
    if (!r) throw new Problem(404, "ROLE_NOT_FOUND", "Role not found");
    return r;
  }
  async ensureEnabled(tx: Tx, key: string) {
    const role = this.role(key);
    const rows = (
      await tx.query(
        "SELECT kind,key,body FROM catalog_entries WHERE state='published' AND kind IN ('role','skill')",
      )
    ).rows;
    if (
      rows.some(
        (e) =>
          e.body.enabled === false &&
          ((e.kind === "role" && e.key === key) ||
            (e.kind === "skill" &&
              role.skill_bindings.some((s: any) => s.skill_key === e.key))),
      )
    )
      throw new Problem(
        403,
        "ROLE_DISABLED",
        "This role or one of its required Skills has been disabled",
      );
  }
  async publicConfigured(tx: Tx, c: Config) {
    const rows = (
      await tx.query(
        "SELECT kind,key,body FROM catalog_entries WHERE state='published' AND kind IN ('role','skill')",
      )
    ).rows;
    return this.public(c).map((r) => {
      const presentation = rows.find(
        (e) => e.kind === "role" && e.key === r.role_key,
      )?.body;
      const disabled = rows.some(
        (e) =>
          e.body.enabled === false &&
          ((e.kind === "role" && e.key === r.role_key) ||
            (e.kind === "skill" &&
              r.skill_bindings.some((s: any) => s.skill_key === e.key))),
      );
      return {
        ...r,
        ...(presentation?.display_name
          ? { display_name: presentation.display_name }
          : {}),
        ...(presentation?.description
          ? { description: presentation.description }
          : {}),
        ...(disabled ? { available: false, reason: "ROLE_DISABLED" } : {}),
      };
    });
  }
  digest(role: any) {
    return createHash("sha256")
      .update(
        canonical({
          role,
          skills: this.skills.filter((s) =>
            role.skill_bindings.some((b: any) => b.skill_key === s.key),
          ),
        }),
      )
      .digest("hex");
  }
  async boundSkills(role: any) {
    const out = [];
    for (const binding of role.skill_bindings) {
      const p = this.skills.find(
        (s) => s.key === binding.skill_key && s.version === binding.version,
      );
      if (!p)
        throw new Problem(
          503,
          "SKILL_MISSING",
          "Required role method is not installed",
        );
      out.push({ ...p, content: await this.verifySkill(p) });
    }
    return out;
  }
  available(
    c: Config,
    role: any,
    mode: "execute" | "ask" | "plan" = "execute",
  ) {
    if (
      mode === "execute" &&
      role.tool_ids.some((id: string) =>
        ["video.generate.internal", "speech.generate.internal"].includes(id),
      )
    )
      return { available: false, reason: "MEDIA_CAPABILITY_SETUP_REQUIRED" };
    if (!c.AI_BASE_URL || !c.AI_API_KEY || !c.AI_MODEL || !c.AI_VERIFIED)
      return { available: false, reason: "AI_SETUP_REQUIRED" };
    if (
      c.AI_INPUT_HKD_MICROS_PER_MILLION === undefined ||
      c.AI_OUTPUT_HKD_MICROS_PER_MILLION === undefined
    )
      return { available: false, reason: "PRICING_SETUP_REQUIRED" };
    if (
      mode === "execute" &&
      role.model_bindings.some((b: any) =>
        JSON.stringify(b).includes("internal-image2"),
      ) &&
      (!c.AI_IMAGE_MODEL ||
        !c.AI_IMAGE_VERIFIED ||
        c.AI_IMAGE_HKD_MICROS_PER_IMAGE === undefined)
    )
      return { available: false, reason: "IMAGE2_SETUP_REQUIRED" };
    return { available: true, reason: null };
  }
  public(c: Config) {
    return this.roles.map((r) => ({
      ...r,
      definition_hash: this.digest(r),
      package_state: "installed",
      qualification: "pending_live_validation",
      data_mode: c.DEMO_MODE ? "simulated" : "configured_services",
      ...this.available(c, r),
    }));
  }
}
