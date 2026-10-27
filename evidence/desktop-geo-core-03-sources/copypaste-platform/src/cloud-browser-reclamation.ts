import { lstat, readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { removeOwnedUUIDDirectory } from "./owned-directory-cleanup.js";
import { inspectCloudBrowserJob } from "./cloud-browser-runtime.js";

/** Reap only our UUID profiles after both owner processes exited and an
 * independent native inspection confirms an empty/destroyed job. */
export async function reclaimCloudBrowserProfiles(dataDir: string) {
  const parent = path.resolve(dataDir, "cloud-browsers");
  let entries;
  try {
    entries = await readdir(parent, { withFileTypes: true });
  } catch (e: any) {
    if (e.code === "ENOENT") return [];
    throw e;
  }
  if ((await lstat(parent)).isSymbolicLink())
    throw new Error("BROWSER_RECLAIM_REPARSE_PARENT");
  const removed: string[] = [];
  for (const entry of entries.slice(0, 100)) {
    if (
      !entry.isDirectory() ||
      entry.isSymbolicLink() ||
      !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(entry.name)
    )
      continue;
    const root = path.join(parent, entry.name);
    let owner: any, host: any;
    try {
      owner = JSON.parse(await readFile(path.join(root, "owner.json"), "utf8"));
      host = JSON.parse(
        await readFile(path.join(root, "host-receipt.json"), "utf8"),
      );
    } catch {
      continue;
    }
    if (
      owner.schema !== 1 ||
      owner.boundary !== "chromium-native-sandbox-nested-job-v1" ||
      owner.execution_id !== entry.name ||
      !Number.isInteger(owner.controller_pid) ||
      owner.controller_pid <= 0 ||
      owner.controller_pid === process.pid ||
      !Number.isInteger(host.host_pid) ||
      host.host_pid <= 0 ||
      host.job_name !== "Local\\CopyPasteBrowser-" + entry.name
    )
      continue;
    let gone = false;
    try {
      process.kill(owner.controller_pid, 0);
    } catch (e: any) {
      gone = e.code === "ESRCH";
    }
    if (!gone) continue; // PID reuse or access denial conservatively retains it.
    try {
      process.kill(host.host_pid, 0);
      continue;
    } catch (e: any) {
      if (e.code !== "ESRCH") continue;
    }
    let inspected;
    try {
      inspected = await inspectCloudBrowserJob(root);
    } catch {
      continue;
    }
    if (!inspected.job_empty) continue;
    await removeOwnedUUIDDirectory(parent, entry.name);
    removed.push(entry.name);
  }
  return removed;
}
