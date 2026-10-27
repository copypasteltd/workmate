import path from "node:path";
import { loadConfig } from "../src/config.js";
import { createNativeBackup, exportErasureLedger, restoreNativeBackup, type RecoveryOptions } from "../src/native-recovery.js";
import { verifyBackup, recoveryKey } from "../src/native-recovery-archive.js";
import { pruneNativeBackups } from "../src/native-recovery-retention.js";

const [action, ...raw] = process.argv.slice(2), args = new Map<string, string>();
for (let i = 0; i < raw.length; i += 2) {
  if (!/^--[a-z-]+$/.test(raw[i]) || !raw[i + 1] || args.has(raw[i])) throw new Error("RECOVERY_ARGUMENT_INVALID");
  args.set(raw[i], raw[i + 1]);
}
const allowed: Record<string, string[]> = {
  backup: ["--archive-root"], ledger: ["--archive-root"], verify: ["--backup"], prune: ["--archive-root"],
  restore: ["--backup", "--ledger", "--incident-at", "--database-name", "--target-data-dir", "--acknowledge-isolation"],
  watch: ["--archive-root"],
};
if (!allowed[action] || [...args.keys()].some(k => !allowed[action].includes(k)) || allowed[action].some(k => !args.has(k))) throw new Error("RECOVERY_ARGUMENT_INVALID");
const key = recoveryKey(process.env.RECOVERY_BACKUP_KEY ?? ""), get = (k: string) => args.get(k)!;
const options = (): RecoveryOptions => ({ config: loadConfig(), ownerURL: process.env.OWNER_DATABASE_URL ?? "", backupKey: key,
  pgBinDir: process.env.RECOVERY_PG_BIN_DIR ?? path.resolve(".data/recovery-tools/bin") });
try {
  if (action === "backup") console.log(JSON.stringify(await createNativeBackup(options(), get("--archive-root"))));
  if (action === "ledger") console.log(JSON.stringify(await exportErasureLedger(options(), get("--archive-root"))));
  if (action === "verify") {
    const v = await verifyBackup(get("--backup"), key); console.log(JSON.stringify({ status: "verified", id: v.manifest.id, snapshot_at: v.manifest.snapshot_at, file_count: v.manifest.files.length, manifest_sha256: v.manifest_sha256 }));
  }
  if (action === "prune") console.log(JSON.stringify(await pruneNativeBackups(get("--archive-root"), key)));
  if (action === "restore") {
    if (get("--acknowledge-isolation") !== "true") throw new Error("RECOVERY_ISOLATION_ACKNOWLEDGEMENT_REQUIRED");
    console.log(JSON.stringify(await restoreNativeBackup(options(), { backup: get("--backup"), ledger: get("--ledger"), incidentAt: get("--incident-at"),
      databaseName: get("--database-name"), targetDataDir: get("--target-data-dir"), acknowledgeIsolation: true })));
  }
  if (action === "watch") {
    // One serial owner loop; no Docker, service installation or OS scheduler mutation.
    let stopped = false, lastBackup = 0, lastLedger = 0;
    const stop = () => { stopped = true; }; process.once("SIGINT", stop); process.once("SIGTERM", stop);
    process.on("message", m => { if ((m as any)?.action === "shutdown") stop(); });
    while (!stopped) {
      const now = Date.now();
      if (now - lastLedger >= 60_000) {
        try { const r = await exportErasureLedger(options(), get("--archive-root")); lastLedger = now; console.log(JSON.stringify({ kind: "ledger", id: r.id, observed_at: r.observed_at })); }
        catch { lastLedger = now; console.error(JSON.stringify({ kind: "ledger", status: "failed" })); }
      }
      if (!stopped && now - lastBackup >= 15 * 60_000) {
        try { const r = await createNativeBackup(options(), get("--archive-root")); lastBackup = now; console.log(JSON.stringify({ kind: "backup", id: r.id, snapshot_at: r.snapshot_at })); await pruneNativeBackups(get("--archive-root"), key); }
        catch { lastBackup = now; console.error(JSON.stringify({ kind: "backup", status: "failed" })); }
      }
      if (!stopped) await new Promise(r => setTimeout(r, 1000));
    }
  }
} catch (e) {
  // Keep DSNs, SQL, source file names, encryption material and provider bodies off stdout.
  const code = e instanceof Error && /^RECOVERY_[A-Z_]+$/.test(e.message) ? e.message : "RECOVERY_OPERATION_FAILED";
  console.error(JSON.stringify({ status: "failed", code })); process.exitCode = 1;
}
