import type { Database, Tx } from "./db.js";
import { canonical, hash, Problem } from "./lib.js";

/** Independently pinned native harness; model/rate publications remain shared. */
export const desktopRuntime = Object.freeze({
  profile_key: "codex-desktop-native-v1",
  kernel: "codex",
  pinned_version: "0.163.0-alpha.11",
  transport: "stdio",
  gateway_policy: "company_internal_only",
  automatic_fallback: false,
  windows_x64_sha256: "00c0f1e4099246fddcd67ec620ca8ed50827c7d70e113b7224f7a2933cf2d67c",
});
export const desktopRuntimeFingerprint = hash(canonical(desktopRuntime));

export async function seedDesktopRuntime(db: Database) {
  await db.tx(async (tx) => {
    await tx.query(
      `INSERT INTO codex_runtime_profiles(fingerprint,profile_key,kernel,pinned_version,transport,gateway_policy,automatic_fallback)
       VALUES($1,$2,'codex',$3,'stdio','company_internal_only',false) ON CONFLICT(fingerprint) DO NOTHING`,
      [desktopRuntimeFingerprint, desktopRuntime.profile_key, desktopRuntime.pinned_version],
    );
  }, undefined, true);
}

export async function desktopRuntimeId(tx: Tx) {
  const row = (await tx.query("SELECT id FROM codex_runtime_profiles WHERE fingerprint=$1 AND state='enabled'", [desktopRuntimeFingerprint])).rows[0];
  if (!row) throw new Problem(503, "DESKTOP_RUNTIME_UNAVAILABLE", "The pinned desktop runtime is unavailable");
  return row.id as string;
}
