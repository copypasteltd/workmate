import { createCipheriv, createDecipheriv, createHash, hkdfSync, randomBytes } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, readFile, readdir, realpath, open } from "node:fs/promises";
import path from "node:path";
import { Readable, Transform, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import { canonical, hash, seal, unseal } from "./lib.js";

const uuid = z.string().uuid(), sha = z.string().regex(/^[a-f0-9]{64}$/);
const clock = z.string().datetime({ offset: true });
export const recoveryTargets = ["assets", "tasks", "agents", "conversations", "memories", "brand_profiles", "analytics_datasets", "creative_mappings", "creative_feedback_reports", "geo_experiments", "geo_runs", "geo_samples", "workflows", "workflow_runs", "workflow_schedules", "creative_projects", "workspace_nodes", "agent_groups", "agent_group_runs"] as const;
export const ledgerSchema = z.object({
  protocol: z.literal("copypaste-erasure-ledger/1"), id: uuid, source_id: uuid, observed_at: clock,
  targets: z.array(z.object({ type: z.enum(recoveryTargets), id: uuid, tenant_id: uuid }).strict()).max(1_000_000),
  objects: z.array(z.string().regex(/^objects\/[a-f0-9-]{36}$/)).max(1_000_000),
}).strict();
export type ErasureLedger = z.infer<typeof ledgerSchema>;
export const archiveEntry = z.object({
  name: z.string().regex(/^\d{8}\.enc$/),
  kind: z.enum(["database", "object", "receipt"]),
  locator: z.string().max(200), bytes: z.number().int().nonnegative().safe(), sha256: sha,
  encrypted_sha256: sha, nonce: z.string().regex(/^[a-f0-9]{24}$/), tag: z.string().regex(/^[a-f0-9]{32}$/),
}).strict();
export type ArchiveEntry = z.infer<typeof archiveEntry>;
export const manifestSchema = z.object({
  protocol: z.literal("copypaste-native-backup/1"), id: uuid, source_id: uuid,
  snapshot_at: clock, completed_at: clock, source_owner: z.string().regex(/^[a-zA-Z_][a-zA-Z0-9_]{0,62}$/),
  postgres_major: z.literal(18), master_key_sha256: sha,
  migrations: z.array(z.object({ version: z.number().int().positive(), source_sha256: sha.nullable() }).strict()),
  ledger: ledgerSchema, files: z.array(archiveEntry).min(1).max(1_000_000),
  excluded: z.array(z.string()),
}).strict();
export type BackupManifest = z.infer<typeof manifestSchema>;

export function recoveryKey(value: string) {
  if (!/^[a-f0-9]{64}$/i.test(value) || /^0+$/.test(value)) throw new Error("RECOVERY_KEY_INVALID");
  return value.toLowerCase();
}
function subkey(key: string, id: string, purpose: string) {
  return Buffer.from(hkdfSync("sha256", Buffer.from(recoveryKey(key), "hex"), id, "copypaste-recovery/1/" + purpose, 32));
}
export function sealRecovery(key: string, id: string, kind: "manifest" | "ledger", body: unknown) {
  uuid.parse(id);
  return canonical({ protocol: "copypaste-recovery-envelope/1", id, kind,
    sealed: seal(subkey(key, id, kind).toString("hex"), canonical(body)) }) + "\n";
}
export function openRecovery(key: string, text: string, kind: "manifest" | "ledger") {
  if (Buffer.byteLength(text) > 64_000_000) throw new Error("RECOVERY_ENVELOPE_TOO_LARGE");
  const envelope = z.object({ protocol: z.literal("copypaste-recovery-envelope/1"), id: uuid,
    kind: z.literal(kind), sealed: z.string().max(64_000_000) }).strict().parse(JSON.parse(text));
  const value = JSON.parse(unseal(subkey(key, envelope.id, kind).toString("hex"), envelope.sealed));
  if (value.id !== envelope.id) throw new Error("RECOVERY_ENVELOPE_ID_MISMATCH");
  return value;
}

/** Reject junctions, symbolic links and hard-linked input files throughout the path. */
export async function canonicalDirectory(input: string) {
  if (!path.isAbsolute(input)) throw new Error("RECOVERY_ABSOLUTE_PATH_REQUIRED");
  const absolute = path.resolve(input), parts = absolute.slice(path.parse(absolute).root.length).split(path.sep);
  let cursor = path.parse(absolute).root;
  for (const part of parts) {
    cursor = path.join(cursor, part);
    const st = await lstat(cursor);
    if (!st.isDirectory() || st.isSymbolicLink()) throw new Error("RECOVERY_DIRECTORY_LINK_REJECTED");
  }
  if ((await realpath(absolute)).toLowerCase() !== absolute.toLowerCase()) throw new Error("RECOVERY_DIRECTORY_ALIAS_REJECTED");
  return absolute;
}
export async function checkedFile(file: string, max = Number.MAX_SAFE_INTEGER) {
  await canonicalDirectory(path.dirname(file));
  const st = await lstat(file);
  if (!st.isFile() || st.isSymbolicLink() || st.nlink !== 1 || st.size > max) throw new Error("RECOVERY_FILE_REJECTED");
  return st;
}
export async function durableWrite(file: string, bytes: string | Buffer) {
  const h = await open(file, "wx", 0o600);
  try { await h.writeFile(bytes); await h.sync(); } finally { await h.close(); }
}
export async function streamDigest(file: string) {
  const h = createHash("sha256");
  for await (const b of createReadStream(file)) h.update(b);
  return h.digest("hex");
}
export async function encryptEntry(root: string, key: string, id: string, index: number,
  kind: ArchiveEntry["kind"], locator: string, source: Readable,
  expected?: { bytes: number; sha256: string }): Promise<ArchiveEntry> {
  const name = String(index).padStart(8, "0") + ".enc", nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", subkey(key, id, "files"), nonce);
  cipher.setAAD(Buffer.from(id + ":" + name + ":" + kind + ":" + locator));
  const h = createHash("sha256"); let bytes = 0;
  const counter = new Transform({ transform(chunk, _encoding, done) {
    bytes += chunk.length;
    if (!Number.isSafeInteger(bytes) || (expected && bytes > expected.bytes)) return done(new Error("RECOVERY_SOURCE_SIZE_CHANGED"));
    h.update(chunk); done(null, chunk);
  } });
  const target = path.join(root, name);
  await pipeline(source, counter, cipher, createWriteStream(target, { flags: "wx", mode: 0o600 }));
  const digest = h.digest("hex");
  if (expected && (bytes !== expected.bytes || digest !== expected.sha256)) throw new Error("RECOVERY_SOURCE_INTEGRITY_FAILED");
  const handle = await open(target, "r+"); try { await handle.sync(); } finally { await handle.close(); }
  return { name, kind, locator, bytes, sha256: digest, encrypted_sha256: await streamDigest(target), nonce: nonce.toString("hex"), tag: cipher.getAuthTag().toString("hex") };
}
export async function decryptEntry(root: string, key: string, id: string, entry: ArchiveEntry, output?: Writable) {
  const file = path.join(root, entry.name); await checkedFile(file, entry.bytes + 1);
  if (await streamDigest(file) !== entry.encrypted_sha256) throw new Error("RECOVERY_ENCRYPTED_INTEGRITY_FAILED");
  const decipher = createDecipheriv("aes-256-gcm", subkey(key, id, "files"), Buffer.from(entry.nonce, "hex"));
  decipher.setAAD(Buffer.from(id + ":" + entry.name + ":" + entry.kind + ":" + entry.locator));
  decipher.setAuthTag(Buffer.from(entry.tag, "hex"));
  let bytes = 0; const digest = createHash("sha256");
  const counter = new Transform({ transform(chunk, _encoding, done) {
    bytes += chunk.length; if (bytes > entry.bytes) return done(new Error("RECOVERY_DECRYPTED_SIZE_MISMATCH"));
    digest.update(chunk); done(null, chunk);
  } });
  await pipeline(createReadStream(file), decipher, counter, output ?? new Writable({ write(_b, _e, done) { done(); } }));
  if (bytes !== entry.bytes || digest.digest("hex") !== entry.sha256) throw new Error("RECOVERY_DECRYPTED_INTEGRITY_FAILED");
}
export async function loadBackup(folder: string, key: string) {
  const root = await canonicalDirectory(folder); uuid.parse(path.basename(root));
  const file = path.join(root, "manifest.sealed"); await checkedFile(file, 64_000_000);
  const raw = await readFile(file, "utf8"), m = manifestSchema.parse(openRecovery(key, raw, "manifest"));
  if (m.id !== path.basename(root) || m.ledger.source_id !== m.source_id || Date.parse(m.ledger.observed_at) !== Date.parse(m.snapshot_at)) throw new Error("RECOVERY_MANIFEST_SCOPE_INVALID");
  if (m.files.filter(f => f.kind === "database").length !== 1 || m.files[0].kind !== "database" || m.files[0].locator !== "database") throw new Error("RECOVERY_DATABASE_ENTRY_INVALID");
  const locators = new Set<string>(), names = new Set<string>();
  for (const f of m.files) {
    if (names.has(f.name) || locators.has(f.kind + ":" + f.locator)) throw new Error("RECOVERY_DUPLICATE_ENTRY");
    names.add(f.name); locators.add(f.kind + ":" + f.locator);
    if ((f.kind === "object" && !/^objects\/[a-f0-9-]{36}$/.test(f.locator)) ||
        (f.kind === "receipt" && !/^external-budget-receipts\/[a-f0-9-]{36}-[a-f0-9]{64}\.sealed$/.test(f.locator))) throw new Error("RECOVERY_LOCATOR_INVALID");
  }
  const actual = (await readdir(root)).sort(), expected = ["manifest.sealed", ...names].sort();
  if (canonical(actual) !== canonical(expected)) throw new Error("RECOVERY_UNEXPECTED_ARCHIVE_ENTRIES");
  return { root, manifest: m, manifest_sha256: hash(raw) };
}
export async function verifyBackup(folder: string, key: string) {
  const result = await loadBackup(folder, key);
  for (const entry of result.manifest.files) await decryptEntry(result.root, key, result.manifest.id, entry);
  return result;
}
