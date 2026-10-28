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
  historicalRoles: any[] = [];
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
    this.historicalRoles = JSON.parse(
      await readFile("catalog/role-preset-history.json", "utf8"),
    );
    this.defaultAssistant = JSON.parse(
      await readFile("catalog/default-assistant.json", "utf8"),
    );
    this.skillDefinitions = c.skill_catalog;
    this.skills = JSON.parse(
      await readFile("catalog/skill-packages.json", "utf8"),
    );
    // Additive releases retain published catalog bytes and exact historical
    // role digests so already approved tasks keep their original tools.
    const effects = JSON.parse(
      await readFile("catalog/media-effects-release-v1.json", "utf8"),
    );
    const prior = this.role("video-motion");
    if (
      effects.schema !== "copypaste-role-release-1" ||
      prior.version !== "1.4.0" ||
      this.digest(prior) !== effects.previous_role_sha256 ||
      effects.role.role_key !== prior.role_key ||
      effects.role.version !== "1.5.0" ||
      this.skills.some(
        (s) =>
          s.key === effects.skill_package.key &&
          s.version === effects.skill_package.version,
      )
    )
      throw new Problem(
        503,
        "ROLE_RELEASE_INVALID",
        "The media effect release does not match its retained base",
      );
    this.historicalRoles.push(prior);
    this.roles = this.roles.map((r) =>
      r.role_key === prior.role_key ? effects.role : r,
    );
    this.skills.push(effects.skill_package);
    this.skillDefinitions.push(effects.skill_definition);
    const software = JSON.parse(
      await readFile("catalog/software-toolchain-release-v1.json", "utf8"),
    );
    if (
      software.schema !== "copypaste-software-toolchain-release-1" ||
      software.roles.length !== 6 ||
      software.skill_packages.length !== 4 ||
      software.skill_definitions.length !== 4
    )
      throw new Problem(
        503,
        "ROLE_RELEASE_INVALID",
        "Invalid software toolchain release",
      );
    const releaseRoles = new Set<string>(),
      releaseSkills = new Set<string>();
    for (const item of software.roles) {
      const prior = this.role(item.role.role_key);
      if (
        releaseRoles.has(prior.role_key) ||
        prior.version !== "1.0.0" ||
        item.role.version !== "1.1.0" ||
        this.digest(prior) !== item.previous_role_sha256 ||
        canonical(prior.tool_ids) !== canonical(item.role.tool_ids)
      )
        throw new Problem(
          503,
          "ROLE_RELEASE_INVALID",
          "Software role release does not match its retained permissions and base",
        );
      releaseRoles.add(prior.role_key);
      this.historicalRoles.push(prior);
      this.roles = this.roles.map((r) =>
        r.role_key === prior.role_key ? item.role : r,
      );
    }
    for (const item of software.skill_packages) {
      const definition = software.skill_definitions.find(
        (d: any) => d.skill_key === item.key && d.version === item.version,
      );
      if (
        releaseSkills.has(item.key) ||
        item.version !== "1.1.0" ||
        this.skills.some(
          (p) => p.key === item.key && p.version === item.version,
        ) ||
        definition?.package_sha256 !== item.sha256
      )
        throw new Problem(
          503,
          "ROLE_RELEASE_INVALID",
          "Invalid software Skill package release",
        );
      releaseSkills.add(item.key);
      this.skills.push(item);
      this.skillDefinitions.push(definition);
    }
    const scheduleRelease = JSON.parse(
      await readFile("catalog/cloud-schedule-release-v1.json", "utf8"),
    );
    const scheduleBase = this.role("workflow-consultant");
    if (
      scheduleRelease.schema !== "copypaste-cloud-schedule-release-1" ||
      scheduleBase.version !== "1.1.0" ||
      scheduleRelease.previous_role_sha256 !== this.digest(scheduleBase) ||
      scheduleRelease.role.role_key !== scheduleBase.role_key ||
      scheduleRelease.role.version !== "1.2.0" ||
      canonical(scheduleRelease.role.tool_ids) !==
        canonical(scheduleBase.tool_ids) ||
      scheduleRelease.skill_package.key !== "workflow-scheduling" ||
      scheduleRelease.skill_package.version !== "1.0.0" ||
      scheduleRelease.skill_definition.package_sha256 !==
        scheduleRelease.skill_package.sha256 ||
      this.skills.some(
        (s) =>
          s.key === scheduleRelease.skill_package.key &&
          s.version === scheduleRelease.skill_package.version,
      )
    )
      throw new Problem(
        503,
        "ROLE_RELEASE_INVALID",
        "Cloud schedule release does not match its retained role and permissions",
      );
    this.historicalRoles.push(scheduleBase);
    this.roles = this.roles.map((r) =>
      r.role_key === scheduleBase.role_key ? scheduleRelease.role : r,
    );
    this.skills.push(scheduleRelease.skill_package);
    this.skillDefinitions.push(scheduleRelease.skill_definition);
    const eventRelease = JSON.parse(
      await readFile("catalog/cloud-event-release-v1.json", "utf8"),
    );
    const eventBase = this.role("workflow-consultant");
    const eventBindings = [
      ...eventBase.skill_bindings,
      { skill_key: "workflow-events", version: "1.0.0", required: true },
    ];
    if (
      eventRelease.schema !== "copypaste-cloud-event-release-1" ||
      eventBase.version !== "1.2.0" ||
      eventRelease.previous_role_sha256 !== this.digest(eventBase) ||
      eventRelease.role.role_key !== eventBase.role_key ||
      eventRelease.role.version !== "1.3.0" ||
      canonical(eventRelease.role.tool_ids) !== canonical(eventBase.tool_ids) ||
      canonical(eventRelease.role.model_bindings) !==
        canonical(eventBase.model_bindings) ||
      canonical(eventRelease.role.skill_bindings) !==
        canonical(eventBindings) ||
      eventRelease.skill_package.key !== "workflow-events" ||
      eventRelease.skill_package.version !== "1.0.0" ||
      eventRelease.skill_package.path !==
        "skills/workflow-events/1.0.0/SKILL.md" ||
      eventRelease.skill_definition.skill_key !== "workflow-events" ||
      eventRelease.skill_definition.version !== "1.0.0" ||
      eventRelease.skill_definition.ai_network_policy !== "internal_only" ||
      eventRelease.skill_definition.package_sha256 !==
        eventRelease.skill_package.sha256 ||
      this.skills.some(
        (s) =>
          s.key === eventRelease.skill_package.key &&
          s.version === eventRelease.skill_package.version,
      )
    )
      throw new Problem(
        503,
        "ROLE_RELEASE_INVALID",
        "Cloud event release differs from retained role, Skill or permissions",
      );
    this.historicalRoles.push(eventBase);
    this.roles = this.roles.map((r) =>
      r.role_key === eventBase.role_key ? eventRelease.role : r,
    );
    this.skills.push(eventRelease.skill_package);
    this.skillDefinitions.push(eventRelease.skill_definition);
    const webRelease = JSON.parse(
      await readFile("catalog/web-analytics-release-v1.json", "utf8"),
    );
    const webBase = this.role("marketing-analyst");
    if (
      webRelease.schema !== "copypaste-web-analytics-release-1" ||
      webBase.version !== "1.1.0" ||
      webRelease.previous_role_sha256 !== this.digest(webBase) ||
      webRelease.role.role_key !== webBase.role_key ||
      webRelease.role.version !== "1.2.0" ||
      canonical(webRelease.role.tool_ids) !== canonical(webBase.tool_ids) ||
      canonical(webRelease.role.model_bindings) !==
        canonical(webBase.model_bindings) ||
      canonical(webRelease.role.skill_bindings) !==
        canonical([
          ...webBase.skill_bindings,
          { skill_key: "web-analytics", version: "1.0.0", required: true },
        ]) ||
      webRelease.skill_package.key !== "web-analytics" ||
      webRelease.skill_package.version !== "1.0.0" ||
      webRelease.skill_definition.skill_key !== "web-analytics" ||
      webRelease.skill_definition.version !== "1.0.0" ||
      webRelease.skill_definition.package_sha256 !==
        webRelease.skill_package.sha256 ||
      canonical(webRelease.skill_definition.tool_ids) !==
        canonical(["connector.read"]) ||
      this.skills.some(
        (s) => s.key === "web-analytics" && s.version === "1.0.0",
      )
    )
      throw new Problem(
        503,
        "ROLE_RELEASE_INVALID",
        "Website analysis release does not match its retained role, Skills and permissions",
      );
    this.historicalRoles.push(webBase);
    this.roles = this.roles.map((r) =>
      r.role_key === webBase.role_key ? webRelease.role : r,
    );
    this.skills.push(webRelease.skill_package);
    this.skillDefinitions.push(webRelease.skill_definition);
    const budgetRelease = JSON.parse(
      await readFile("catalog/external-budget-release-v1.json", "utf8"),
    );
    const budgetBase = this.role("marketing-analyst");
    if (
      budgetRelease.schema !== "copypaste-external-budget-release-1" ||
      budgetBase.version !== "1.2.0" ||
      budgetRelease.previous_role_sha256 !== this.digest(budgetBase) ||
      budgetRelease.role.role_key !== budgetBase.role_key ||
      budgetRelease.role.version !== "1.3.0" ||
      canonical(budgetRelease.role.model_bindings) !==
        canonical(budgetBase.model_bindings) ||
      canonical(budgetRelease.role.tool_ids) !==
        canonical(
          [
            ...budgetBase.tool_ids,
            "connector.budget.read",
            "connector.budget.prepare",
          ].sort(),
        ) ||
      canonical(budgetRelease.role.skill_bindings) !==
        canonical([
          ...budgetBase.skill_bindings,
          { skill_key: "external-budget", version: "1.0.0", required: true },
        ]) ||
      budgetRelease.skill_package.key !== "external-budget" ||
      budgetRelease.skill_package.version !== "1.0.0" ||
      budgetRelease.skill_definition.skill_key !== "external-budget" ||
      budgetRelease.skill_definition.version !== "1.0.0" ||
      budgetRelease.skill_definition.package_sha256 !==
        budgetRelease.skill_package.sha256 ||
      canonical(budgetRelease.skill_definition.tool_ids) !==
        canonical(["connector.budget.read", "connector.budget.prepare"])
    )
      throw new Problem(
        503,
        "ROLE_RELEASE_INVALID",
        "External budget release does not match its retained role, Skills and permissions",
      );
    this.historicalRoles.push(budgetBase);
    this.roles = this.roles.map((r) =>
      r.role_key === budgetBase.role_key ? budgetRelease.role : r,
    );
    this.skills.push(budgetRelease.skill_package);
    this.skillDefinitions.push(budgetRelease.skill_definition);
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
    const budgetAdmin = JSON.parse(
      await readFile("catalog/external-budget-admin-permissions.json", "utf8"),
    );
    const permissionKeys = new Set(
      this.admin.permissions.map((p: any) => p.key),
    );
    if (budgetAdmin.permissions.some((p: any) => permissionKeys.has(p.key)))
      throw new Problem(
        503,
        "PERMISSION_CATALOG_CONFLICT",
        "Duplicate external budget permission",
      );
    this.admin.permissions.push(...budgetAdmin.permissions);
    superRole.permissions.push(
      ...budgetAdmin.super_permissions_for_new_installations,
    );
    const recoveryAdmin = JSON.parse(
      await readFile("catalog/native-recovery-admin-permissions.json", "utf8"),
    );
    const currentKeys = new Set(this.admin.permissions.map((p: any) => p.key));
    if (recoveryAdmin.permissions.some((p: any) => currentKeys.has(p.key)))
      throw new Problem(
        503,
        "PERMISSION_CATALOG_CONFLICT",
        "Duplicate recovery permission",
      );
    this.admin.permissions.push(...recoveryAdmin.permissions);
    superRole.permissions.push(
      ...recoveryAdmin.super_permissions_for_new_installations,
    );
    const desktopUpdates = JSON.parse(await readFile("catalog/desktop-update-admin-permissions.json", "utf8"));
    const updatePermissionKeys = new Set(this.admin.permissions.map((p: any) => p.key));
    if (desktopUpdates.permissions.some((p: any) => updatePermissionKeys.has(p.key)))
      throw new Problem(503, "PERMISSION_CATALOG_CONFLICT", "Duplicate Desktop update permission");
    this.admin.permissions.push(...desktopUpdates.permissions);
    superRole.permissions.push(...desktopUpdates.super_permissions_for_new_installations);
    const dedicatedCloud = JSON.parse(await readFile("catalog/dedicated-cloud-admin-permissions.json", "utf8"));
    const resourcePermissionKeys = new Set(this.admin.permissions.map((p: any) => p.key));
    if (dedicatedCloud.permissions.some((p: any) => resourcePermissionKeys.has(p.key)))
      throw new Problem(503, "PERMISSION_CATALOG_CONFLICT", "Duplicate dedicated computer permission");
    this.admin.permissions.push(...dedicatedCloud.permissions);
    superRole.permissions.push(...dedicatedCloud.super_permissions_for_new_installations);
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
  role(key: string, definitionHash?: string) {
    const r =
      key === "assistant"
        ? this.defaultAssistant
        : this.roles.find((r) => r.role_key === key);
    if (!r) throw new Problem(404, "ROLE_NOT_FOUND", "Role not found");
    if (definitionHash && this.digest(r) !== definitionHash) {
      const retained = this.historicalRoles.find(
        (old) => old.role_key === key && this.digest(old) === definitionHash,
      );
      if (!retained)
        throw new Problem(
          409,
          "ROLE_VERSION_CHANGED",
          "The frozen role version is not installed",
        );
      return retained;
    }
    return r;
  }
  forTask(task: { role_key: string; role_hash?: string }) {
    return this.role(task.role_key, task.role_hash);
  }
  async ensureEnabled(tx: Tx, key: string, definitionHash?: string) {
    const role = this.role(key, definitionHash);
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
            role.skill_bindings.some(
              (b: any) => b.skill_key === s.key && b.version === s.version,
            ),
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
        image = capabilities.get("internal-image2-v1"),
        video = capabilities.get("internal-video-v1"),
        speech = capabilities.get("internal-speech-v1"),
        transcription = capabilities.get("internal-transcription-v1");
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
        AI_VIDEO_MODEL: video?.body.model_alias ?? undefined,
        AI_VIDEO_VERIFIED: !!(
          usable(video) &&
          (video.publication_id || c.AI_VIDEO_VERIFIED) &&
          video.body.wire_protocol === "company-video-jobs-v1" &&
          video.body.rates.length === 1 &&
          video.body.rates[0] > 0
        ),
        AI_VIDEO_HKD_MICROS_PER_SECOND: video?.body.rates[0] ?? undefined,
        AI_SPEECH_MODEL: speech?.body.model_alias ?? undefined,
        AI_SPEECH_VERIFIED: !!(
          usable(speech) &&
          (speech.publication_id || c.AI_SPEECH_VERIFIED)
        ),
        AI_SPEECH_HKD_MICROS_PER_CHARACTER: speech?.body.rates[0] ?? undefined,
        AI_TRANSCRIPTION_MODEL: transcription?.body.model_alias ?? undefined,
        AI_TRANSCRIPTION_VERIFIED: !!(
          usable(transcription) &&
          (transcription.publication_id || c.AI_TRANSCRIPTION_VERIFIED)
        ),
        AI_TRANSCRIPTION_HKD_MICROS_PER_MILLISECOND:
          transcription?.body.rates[0] ?? undefined,
      };
    }
    if (
      mode === "execute" &&
      role.model_bindings.some(
        (binding: any) =>
          binding.required &&
          ((binding.profile_key === "internal-speech-v1" &&
            (!c.AI_SPEECH_MODEL ||
              !c.AI_SPEECH_VERIFIED ||
              !c.AI_SPEECH_HKD_MICROS_PER_CHARACTER)) ||
            (binding.profile_key === "internal-transcription-v1" &&
              (!c.AI_TRANSCRIPTION_MODEL ||
                !c.AI_TRANSCRIPTION_VERIFIED ||
                !c.AI_TRANSCRIPTION_HKD_MICROS_PER_MILLISECOND)) ||
            (binding.profile_key === "internal-video-v1" &&
              (!c.AI_VIDEO_MODEL ||
                !c.AI_VIDEO_VERIFIED ||
                !c.AI_VIDEO_HKD_MICROS_PER_SECOND))),
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
