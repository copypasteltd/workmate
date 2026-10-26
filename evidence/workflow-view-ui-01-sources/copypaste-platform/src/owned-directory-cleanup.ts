import { lstat, readdir, rmdir, unlink } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";
import path from "node:path";

async function emptyThenRemove(directory: string): Promise<void> {
  let entries;
  try {
    entries = await readdir(directory);
  } catch (error: any) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  for (const name of entries) {
    const child = path.join(directory, name);
    try {
      const info = await lstat(child);
      if (info.isDirectory() && !info.isSymbolicLink())
        await emptyThenRemove(child);
      else await unlink(child);
    } catch (error: any) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  try {
    await rmdir(directory);
  } catch (error: any) {
    if (error.code !== "ENOENT") throw error;
  }
}

/** Remove only one caller-owned UUID child. Retry whole passes instead of
 * multiplying fs.rm's Windows retries across every nested directory. A final
 * failure keeps the remaining files and propagates to the caller's receipt.
 */
export async function removeOwnedUUIDDirectory(
  parentPath: string,
  id: string,
  options: { retry?: boolean } = {},
) {
  if (
    !/^(?:[a-f0-9]{32}|[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12})$/.test(id)
  )
    throw new Error("Owned cleanup requires a UUID child name");
  const parent = path.resolve(parentPath),
    directory = path.resolve(parent, id);
  if (path.dirname(directory) !== parent)
    throw new Error("Owned cleanup must remain inside its parent");
  let lastError: unknown;
  for (const pause of options.retry === false
    ? [0]
    : [0, 250, 750, 1500, 2500, 4000]) {
    if (pause) await delay(pause);
    try {
      const info = await lstat(directory);
      if (!info.isDirectory() || info.isSymbolicLink())
        throw new Error("Owned cleanup refuses a replaced directory");
      // Empty children before rmdir: Windows can return EBUSY instead of
      // ENOTEMPTY for a populated Codex directory. Never follow nested links.
      await emptyThenRemove(directory);
      return;
    } catch (error: any) {
      if (error.code === "ENOENT") return;
      if (!["EBUSY", "EPERM", "ENOTEMPTY"].includes(error.code)) throw error;
      lastError = error;
    }
  }
  throw lastError;
}
