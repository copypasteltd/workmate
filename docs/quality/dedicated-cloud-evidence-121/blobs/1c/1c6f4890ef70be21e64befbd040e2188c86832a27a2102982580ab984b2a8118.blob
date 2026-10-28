import { lstat, readFile, realpath, rm } from "node:fs/promises";
import path from "node:path";
import { atomicFile } from "./files.js";

export const removalMarker = "desktop-disconnected.json";
export async function removalMarked(root: string) {
  try {
    await lstat(path.join(root, removalMarker));
    return true;
  } catch (error: any) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}
export async function assertLocalEnabled(root: string) {
  if (await removalMarked(root)) throw new Error("DESKTOP_DISCONNECTED");
}
export async function markRemoved(root: string) {
  await atomicFile(
    path.join(root, removalMarker),
    Buffer.from(
      JSON.stringify({
        protocol: "copypaste.desktop-removal.v1",
        local_disabled: true,
      }) + "\n",
    ),
  );
}
/** Only a new, explicitly confirmed customer sign-in calls this. */
export async function clearRemovalMarker(root: string) {
  const file = path.join(root, removalMarker);
  const info = await lstat(file).catch((error: any) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info) return;
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("REMOVAL_MARKER_INVALID");
  const value = JSON.parse(await readFile(file, "utf8"));
  if (
    value.protocol !== "copypaste.desktop-removal.v1" ||
    value.local_disabled !== true
  )
    throw new Error("REMOVAL_MARKER_INVALID");
  await rm(file);
}
export async function removeOwnedUpdateCache(root: string) {
  const resolved = path.resolve(root),
    base = await lstat(resolved);
  if (
    base.isSymbolicLink() ||
    !base.isDirectory() ||
    (await realpath(resolved)).toLowerCase() !== resolved.toLowerCase()
  )
    throw new Error("CACHE_ROOT_INVALID");
  const target = path.join(resolved, "update-cache");
  const info = await lstat(target).catch((error: any) => {
    if (error.code === "ENOENT") return null;
    throw error;
  });
  if (!info) return;
  if (
    info.isSymbolicLink() ||
    !info.isDirectory() ||
    (await realpath(target)).toLowerCase() !== target.toLowerCase() ||
    path.dirname(target) !== resolved
  )
    throw new Error("CACHE_ROOT_INVALID");
  // Node rm does not follow descendant symlinks/junctions. Never use a workspace,
  // a customer download path, or any path supplied by the renderer here.
  await rm(target, { recursive: true, force: false });
}
