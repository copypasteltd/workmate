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
  defaultAssistant: any;
  admin: any;
  runtimeProfile: any;
  capabilityVersions = new Map<string, any>();
  /** Bootstrap identities remain a fallback until a controlled publication.
   * Published heads are read per transaction, never cached in a Worker. */
  async currentCapabilities(tx: Tx) {
    await tx.query(
      "SELECT pg_advisory_xact_lock_shared(hashtextextended('capability-heads:'||current_setting('app.data_mode'),0))",
    );
    const fallback = (
      await tx.query(
        "SELECT * FROM internal_capability_versions WHERE id=ANY($1::uuid[])",
        [[...this.capabilityVersions.values()].map((row) => row.id)],
      )
    ).rows;
    const result = new Map<string, any>(
      fallback.map((row) => [row.profile_key, row]),
    );
    const published = (
      await tx.query(
        "SELECT * FROM current_internal_capabilities WHERE data_mode=current_setting('app.data_mode')",
      )
    ).rows;
    for (const row of published) {
      if (row.runtime_profile_id !== this.runtimeProfile.id)
        throw new Problem(
          409,
          "CAPABILITY_RUNTIME_CHANGED",
          "The published capability requires its validated Codex runtime",
        );
      result.set(row.profile_key, row);
    }
    return result;
  }
  async availableFor(
    tx: Tx,
    c: Config,
    role: any,
    mode: "execute" | "ask" | "plan" = "execute",
  ) {
    return this.available(c, role, mode, await this.currentCapabilities(tx));
  }
  async load() {
    const c = JSON.parse(
      await readFile("catalog/role-preset-catalog.json", "utf8"),
    );
    this.roles = c.roles;
    this.defaultAssistant = JSON.parse(
      await readFile("catalog/default-assistant.json", "utf8"),
    );
    this.skillDefinitions = c.skill_catalog;
    this.skills = JSON.parse(
      await readFile("catalog/skill-packages.json", "utf8"),
    );
    this.admin = JSON.parse(
      await readFile("catalog/admin-permission-catalog.json", "utf8"),
    );
    const providerAdmin = JSON.parse(
      await readFile("catalog/provider-admin-permissions.json", "utf8"),
    );
    const registered = new Set(this.admin.permissions.map((p: any) => p.key));
    if (providerAdmin.permissions.some((p: any) => registered.has(p.key)))
      throw new Problem(
        503,
        "PERMISSION_CATALOG_CONFLICT",
        "Duplicate provider permission",
      );
    this.admin.permissions.push(...providerAdmin.permissions);
    const superRole = this.admin.roles.find((r: any) => r.id === "super_admin");
    if (!superRole)
      throw new Problem(
        503,
        "PERMISSION_CATALOG_INVALID",
        "Missing initial administrator role",
      );
    // seedRoles uses ON CONFLICT DO NOTHING: existing installed roles are not expanded.
    superRole.permissions.push(
      ...providerAdmin.super_permissions_for_new_installations,
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
    const r =
      key === "assistant"
        ? this.defaultAssistant
        : this.roles.find((r) => r.role_key === key);
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
  async publicConfigured(tx: Tx, c: Config, includeDefault = false) {
    const capabilities = await this.currentCapabilities(tx);
    const rows = (
      await tx.query(
        "SELECT kind,key,body FROM catalog_entries WHERE state='published' AND kind IN ('role','skill')",
      )
    ).rows;
    return this.public(c, includeDefault).map((r) => {
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
        ...this.available(c, r, "execute", capabilities),
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
    capabilities?: Map<string, any>,
  ) {
    if (capabilities) {
      const text = capabilities.get("internal-text-v1"),
        image = capabilities.get("internal-image2-v1");
      const usable = (v: any) =>
        v?.ready &&
        !v.revoked &&
        v.body.data_mode ===
          (c.DEMO_MODE ? "simulated" : "configured_services") &&
        v.body.gateway_fingerprint ===
          createHash("sha256")
            .update(
              c.DEMO_MODE
                ? "synthetic-local-gateway-v1"
                : (c.AI_BASE_URL ?? ""),
            )
            .digest("hex");
      c = {
        ...c,
        AI_MODEL: text?.body.model_alias ?? undefined,
        AI_REASONING_EFFORT:
          text?.body.reasoning_effort ?? c.AI_REASONING_EFFORT,
        AI_VERIFIED: !!(usable(text) && (text.publication_id || c.AI_VERIFIED)),
        AI_INPUT_HKD_MICROS_PER_MILLION: text?.body.rates[0] ?? undefined,
        AI_OUTPUT_HKD_MICROS_PER_MILLION: text?.body.rates[1] ?? undefined,
        AI_IMAGE_MODEL: image?.body.model_alias ?? undefined,
        AI_IMAGE_VERIFIED: !!(
          usable(image) &&
          (image.publication_id || c.AI_IMAGE_VERIFIED)
        ),
        AI_IMAGE_HKD_MICROS_PER_IMAGE: image?.body.rates[0] ?? undefined,
      };
    }
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
  public(c: Config, includeDefault = false) {
    return (
      includeDefault ? [this.defaultAssistant, ...this.roles] : this.roles
    ).map((r) => ({
      ...r,
      definition_hash: this.digest(r),
      package_state: "installed",
      qualification: "pending_live_validation",
      data_mode: c.DEMO_MODE ? "simulated" : "configured_services",
      ...this.available(c, r),
    }));
  }
}
