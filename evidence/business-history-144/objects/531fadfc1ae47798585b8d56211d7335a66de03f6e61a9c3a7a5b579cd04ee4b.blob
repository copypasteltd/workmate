import path from "node:path";
import { lstat, readdir, unlink, rmdir } from "node:fs/promises";
import { canonicalDirectory, verifyBackup } from "./native-recovery-archive.js";

/** Verify before pruning; retain the newest valid checkpoint even after 35 days. */
export async function pruneNativeBackups(rootInput: string, key: string, now = Date.now()) {
  const root = await canonicalDirectory(rootInput), valid = [];
  for (const name of (await readdir(root)).sort()) {
    if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(name)) continue;
    const folder = path.join(root, name), st = await lstat(folder);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error("RECOVERY_PRUNE_LINK_REJECTED");
    // Corrupt or unverifiable archives are preserved for investigation.
    try { const checked = await verifyBackup(folder, key); valid.push(checked); } catch { continue; }
  }
  valid.sort((a, b) => Date.parse(b.manifest.snapshot_at) - Date.parse(a.manifest.snapshot_at));
  const removed: string[] = [], protectedSources = new Set<string>();
  for (const old of valid) {
    if (!protectedSources.has(old.manifest.source_id)) { protectedSources.add(old.manifest.source_id); continue; }
    if (Date.parse(old.manifest.snapshot_at) >= now - 35 * 86400000) continue;
    // Delete only authenticated, flat files in this exact owned UUID directory.
    const files = ["manifest.sealed", ...old.manifest.files.map(f => f.name)];
    for (const name of files) {
      const target = path.join(old.root, name), st = await lstat(target);
      if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1) throw new Error("RECOVERY_PRUNE_FILE_REJECTED");
    }
    for (const name of files.filter(n => n !== "manifest.sealed")) await unlink(path.join(old.root, name));
    await unlink(path.join(old.root, "manifest.sealed")); await rmdir(old.root); removed.push(old.manifest.id);
  }
  return { retention_days: 35, verified_before_prune: true, retained: valid.length - removed.length, removed };
}
