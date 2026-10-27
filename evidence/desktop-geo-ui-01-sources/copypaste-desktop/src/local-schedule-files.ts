import path from "node:path";
import { constants } from "node:fs";
import { lstat, realpath, open, opendir, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolveInGrant } from "./files.js";

export const scheduleLimits = { files: 2000, entries: 10000, depth: 12, fileBytes: 20 * 1024 * 1024, scanBytes: 64 * 1024 * 1024 } as const;
export const scheduleOutput = ".copypaste-local-jobs";
export class ScheduleFileError extends Error { constructor(public readonly code: string) { super(code); } }
export interface DirectoryIdentity { path: string; device: string; inode: string }
export interface FileFingerprint { path: string; sha256: string; bytes: number; device: string; inode: string; modified: string; changed: string }
export type FileGuard = () => Promise<void>;
const sha = (bytes: Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const normalized = (value: string) => process.platform === "win32" ? value.toLowerCase() : value;
// Windows path lstat can report the unavailable-volume sentinel 0, whereas
// fstat reports the real volume serial. Inode, bytes and times must still match;
// two handle identities always require their exact non-normalized device id.
const pathDevice = (a: bigint, b: bigint) => a === b || (process.platform === "win32" && a === 0n);
const same = (a: { dev: bigint; ino: bigint; size: bigint; mtimeNs: bigint; ctimeNs: bigint }, b: typeof a, pathStat = false) =>
  (pathStat ? pathDevice(a.dev, b.dev) : a.dev === b.dev) && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;

export async function directoryIdentity(value: string): Promise<DirectoryIdentity> {
  if (!path.isAbsolute(value) || value.startsWith("\\\\") || value.includes("\0")) throw new ScheduleFileError("LOCAL_SCHEDULE_PATH_INVALID");
  const before = await lstat(value, { bigint: true }), canonical = await realpath(value), after = await lstat(value, { bigint: true });
  if (!before.isDirectory() || before.isSymbolicLink() || before.dev !== after.dev || before.ino !== after.ino
    || normalized(path.resolve(value)) !== normalized(canonical)) throw new ScheduleFileError("LOCAL_SCHEDULE_DIRECTORY_CHANGED");
  return { path: canonical, device: String(before.dev), inode: String(before.ino) };
}
export async function verifyDirectory(root: DirectoryIdentity) {
  const current = await directoryIdentity(root.path);
  if (current.device !== root.device || current.inode !== root.inode) throw new ScheduleFileError("LOCAL_SCHEDULE_DIRECTORY_CHANGED");
}
export async function selectedInput(workspace: DirectoryIdentity, selected: string) {
  await verifyDirectory(workspace);
  const relative = path.relative(workspace.path, selected);
  if (path.isAbsolute(relative) || relative.split(/[\\/]/).includes("..")) throw new ScheduleFileError("LOCAL_SCHEDULE_PATH_INVALID");
  if (relative.split(/[\\/]/).some(part => part === scheduleOutput)) throw new ScheduleFileError("LOCAL_SCHEDULE_OUTPUT_EXCLUDED");
  const checked = await resolveInGrant(workspace.path, relative || ".");
  const input = await directoryIdentity(checked);
  await verifyDirectory(workspace);
  return input;
}
export async function stableFile(root: DirectoryIdentity, relative: string, guard: FileGuard) {
  await guard(); await verifyDirectory(root);
  const target = await resolveInGrant(root.path, relative), before = await lstat(target, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || before.size > BigInt(scheduleLimits.fileBytes)) throw new ScheduleFileError("LOCAL_SCHEDULE_FILE_INVALID");
  const handle = await open(target, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const held = await handle.stat({ bigint: true });
    if (!held.isFile() || !same(before, held, true)) throw new ScheduleFileError("LOCAL_SCHEDULE_FILE_CONFLICT");
    const bytes = Buffer.alloc(Number(held.size)); let offset = 0;
    while (offset < bytes.length) {
      await guard();
      const read = await handle.read(bytes, offset, Math.min(65536, bytes.length - offset), offset);
      if (!read.bytesRead) throw new ScheduleFileError("LOCAL_SCHEDULE_FILE_CONFLICT");
      offset += read.bytesRead;
    }
    const end = await handle.stat({ bigint: true });
    await guard(); await verifyDirectory(root); await resolveInGrant(root.path, relative);
    const current = await lstat(target, { bigint: true });
    if (!same(held, end) || !same(current, held, true)) throw new ScheduleFileError("LOCAL_SCHEDULE_FILE_CONFLICT");
    return { bytes, fingerprint: { path: relative.replaceAll("\\", "/"), sha256: sha(bytes), bytes: bytes.length,
      device: String(held.dev), inode: String(held.ino), modified: String(held.mtimeNs), changed: String(held.ctimeNs) } satisfies FileFingerprint };
  } finally { await handle.close(); }
}
export async function scanFiles(root: DirectoryIdentity, extensions: string[], guard: FileGuard, cache: Map<string, FileFingerprint> = new Map()) {
  await guard(); await verifyDirectory(root);
  const result: FileFingerprint[] = []; let entries = 0, readBytes = 0;
  async function visit(relative: string, depth: number) {
    if (depth > scheduleLimits.depth) throw new ScheduleFileError("LOCAL_SCHEDULE_SCAN_LIMIT");
    await guard();
    const folder = await resolveInGrant(root.path, relative || "."), directory = await opendir(folder);
    for await (const entry of directory) {
      if (++entries > scheduleLimits.entries) throw new ScheduleFileError("LOCAL_SCHEDULE_SCAN_LIMIT");
      if ([scheduleOutput, ".git", "node_modules"].includes(entry.name.toLowerCase())) continue;
      if (entry.isSymbolicLink()) throw new ScheduleFileError("LOCAL_SCHEDULE_LINK_REJECTED");
      const child = relative ? relative + "/" + entry.name : entry.name;
      if (entry.isDirectory()) { await visit(child, depth + 1); continue; }
      if (!entry.isFile() || !extensions.includes(path.extname(entry.name).toLowerCase())) continue;
      if (result.length >= scheduleLimits.files) throw new ScheduleFileError("LOCAL_SCHEDULE_SCAN_LIMIT");
      await guard(); const target = await resolveInGrant(root.path, child), stat = await lstat(target, { bigint: true });
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > BigInt(scheduleLimits.fileBytes)) throw new ScheduleFileError("LOCAL_SCHEDULE_FILE_INVALID");
      const cached = cache.get(child);
      if (cached && pathDevice(stat.dev, BigInt(cached.device)) && cached.inode === String(stat.ino) && cached.bytes === Number(stat.size)
        && cached.modified === String(stat.mtimeNs) && cached.changed === String(stat.ctimeNs)) result.push(cached);
      else {
        if ((readBytes += Number(stat.size)) > scheduleLimits.scanBytes) throw new ScheduleFileError("LOCAL_SCHEDULE_SCAN_LIMIT");
        result.push((await stableFile(root, child, guard)).fingerprint);
      }
    }
  }
  await visit("", 0); await guard(); await verifyDirectory(root);
  result.sort((a, b) => a.path.localeCompare(b.path));
  cache.clear(); for (const item of result) cache.set(item.path, item);
  return result;
}
async function safeDirectories(root: DirectoryIdentity, relative: string, guard: FileGuard) {
  let cursor = "";
  for (const part of relative.split("/")) {
    if (!part || part === "." || part === "..") throw new ScheduleFileError("LOCAL_SCHEDULE_PATH_INVALID");
    await guard(); await verifyDirectory(root);
    cursor = cursor ? cursor + "/" + part : part;
    const target = await resolveInGrant(root.path, cursor, true);
    await mkdir(target).catch((error: NodeJS.ErrnoException) => { if (error.code !== "EEXIST") throw error; });
    await resolveInGrant(root.path, cursor);
    const stat = await lstat(target); if (!stat.isDirectory() || stat.isSymbolicLink()) throw new ScheduleFileError("LOCAL_SCHEDULE_DIRECTORY_CHANGED");
  }
}
async function exclusiveBytes(root: DirectoryIdentity, relative: string, bytes: Buffer, guard: FileGuard) {
  await guard(); await verifyDirectory(root);
  const target = await resolveInGrant(root.path, relative, true);
  let handle;
  try { handle = await open(target, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW ?? 0), 0o600); }
  catch (error: any) {
    if (error.code !== "EEXIST") throw error;
    const previous = await stableFile(root, relative, guard);
    if (!previous.bytes.equals(bytes)) throw new ScheduleFileError("LOCAL_SCHEDULE_FILE_CONFLICT");
    return;
  }
  try { await guard(); await handle.writeFile(bytes); await handle.sync(); }
  finally { await handle.close(); }
  const stored = await stableFile(root, relative, guard);
  if (!stored.bytes.equals(bytes)) throw new ScheduleFileError("LOCAL_SCHEDULE_FILE_CONFLICT");
}
export async function prepareSnapshot(workspace: DirectoryIdentity, input: DirectoryIdentity, ruleId: string, jobId: string,
  expected: FileFingerprint, guard: FileGuard) {
  if (![ruleId, jobId].every(id => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id))) throw new ScheduleFileError("LOCAL_SCHEDULE_PATH_INVALID");
  const current = await stableFile(input, expected.path, guard);
  if (current.fingerprint.sha256 !== expected.sha256 || current.fingerprint.device !== expected.device || current.fingerprint.inode !== expected.inode)
    throw new ScheduleFileError("LOCAL_SCHEDULE_FILE_CONFLICT");
  const folder = `${scheduleOutput}/${ruleId}/${jobId}`, output = folder + "/output", source = folder + "/input" + path.extname(expected.path).toLowerCase();
  await safeDirectories(workspace, output, guard);
  await exclusiveBytes(workspace, source, current.bytes, guard);
  await exclusiveBytes(workspace, folder + "/manifest.json", Buffer.from(JSON.stringify({ schema: 1, rule_id: ruleId, job_id: jobId, input: expected })), guard);
  await guard(); await verifyDirectory(input);
  return { source, output };
}
