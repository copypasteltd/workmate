import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { open, type Entry, type ZipFile } from "yauzl";
import { canonical, hash, Problem } from "./lib.js";
import { creativePackageLimit, packageManifest, parseCreativeSource, creativeReferences } from "./creative-package-model.js";

type Member = { file: string; bytes: number; sha256: string };
const invalid = () => new Problem(422, "CREATIVE_PACKAGE_INVALID", "This is not a complete supported CopyPaste creative project archive");
const allowed = /^(?:manifest\.json|project\.json|preview\.svg|README\.md|SHA256SUMS|fonts\/(?:NotoSansTC-VF\.ttf|OFL\.txt)|media\/[0-9]{3}\.(?:png|wav|mp3))$/;

/** Lazy, disk-backed reader. Portable v1 uses stored entries, so there is no decompression bomb or executable extraction. */
export async function readCreativePackage(archive: string, directory: string, signal: AbortSignal) {
  const zip = await new Promise<ZipFile>((resolve, reject) => open(archive, { lazyEntries: true, autoClose: true,
    decodeStrings: true, validateEntrySizes: true, strictFileNames: true }, (e, z) => e || !z ? reject(invalid()) : resolve(z)));
  const members = new Map<string, Member>(); let total = 0;
  const interrupt = () => zip.close(); signal.throwIfAborted(); signal.addEventListener("abort", interrupt, { once: true });
  try {
    if (zip.entryCount > 110 || zip.entryCount < 4) throw invalid();
    await new Promise<void>((resolve, reject) => {
      const fail = (error: unknown) => { zip.close(); reject(error instanceof Problem ? error : invalid()); };
      zip.once("error", fail); zip.once("end", resolve); zip.once("close", () => { if (signal.aborted) reject(signal.reason); });
      zip.on("entry", (entry: Entry) => { void (async () => {
        signal.throwIfAborted();
        const mode = (entry.externalFileAttributes >>> 16) & 0xf000;
        if (!allowed.test(entry.fileName) || members.has(entry.fileName) || entry.compressionMethod !== 0
          || entry.isEncrypted() || (mode !== 0 && mode !== 0x8000) || entry.uncompressedSize !== entry.compressedSize
          || !Number.isSafeInteger(entry.uncompressedSize) || entry.uncompressedSize < 1 || entry.uncompressedSize > 30 * 1024 ** 2)
          throw invalid();
        if (!entry.fileName.startsWith("media/") && !entry.fileName.startsWith("fonts/") && entry.fileName !== "preview.svg" && entry.uncompressedSize > 4 * 1024 ** 2) throw invalid();
        total += entry.uncompressedSize; if (total > creativePackageLimit) throw invalid();
        const file = path.join(directory, "member-" + members.size), sha = createHash("sha256"); let bytes = 0;
        const input = await new Promise<import("node:stream").Readable>((yes, no) => zip.openReadStream(entry, (e, stream) => e || !stream ? no(invalid()) : yes(stream)));
        await pipeline(input, new Transform({ transform(chunk: Buffer, _encoding, done) {
          bytes += chunk.length; if (bytes > entry.uncompressedSize) { done(invalid()); return; } sha.update(chunk); done(null, chunk);
        } }), createWriteStream(file, { flags: "wx", mode: 0o600 }), { signal });
        if (bytes !== entry.uncompressedSize) throw invalid();
        members.set(entry.fileName, { file, bytes, sha256: sha.digest("hex") }); zip.readEntry();
      })().catch(fail); }); zip.readEntry();
    });
    signal.throwIfAborted();
    const text = async (name: string) => { const member = members.get(name); if (!member || member.bytes > 4 * 1024 ** 2) throw invalid(); return readFile(member.file, "utf8"); };
    let manifest, definition;
    try { manifest = packageManifest.parse(JSON.parse(await text("manifest.json"))); definition = parseCreativeSource(manifest.kind, JSON.parse(await text("project.json"))); }
    catch (e) { if (e instanceof Problem) throw e; throw invalid(); }
    const declared = new Set<string>();
    for (const member of manifest.files) {
      const actual = members.get(member.path);
      if (declared.has(member.path) || !actual || actual.bytes !== member.bytes || actual.sha256 !== member.sha256) throw invalid();
      declared.add(member.path);
    }
    if (!declared.has("project.json") || [...members.keys()].some(n => !["manifest.json", "README.md", "SHA256SUMS"].includes(n) && !declared.has(n))) throw invalid();
    const checks = (await text("SHA256SUMS")).trimEnd().split("\n"), checked = new Set<string>();
    for (const line of checks) {
      const match = /^([a-f0-9]{64})  (.+)$/.exec(line), actual = match && members.get(match[2]);
      if (!match || !actual || match[2] === "SHA256SUMS" || checked.has(match[2]) || actual.sha256 !== match[1]) throw invalid(); checked.add(match[2]);
    }
    if (checked.size !== members.size - 1 || !members.has("README.md")) throw invalid();
    const refs = creativeReferences(manifest.kind, definition), mapped = new Set<string>(), mediaPaths = new Set<string>();
    for (const media of manifest.media) {
      const key = media.asset_id + ":" + media.version;
      if (!/^media\//.test(media.path) || !declared.has(media.path) || mapped.has(key) || mediaPaths.has(media.path)
        || !refs.some(r => r.asset_id === media.asset_id && r.version === media.version)
        || !media.path.endsWith(media.mime_type === "image/png" ? ".png" : media.mime_type === "audio/wav" ? ".wav" : ".mp3")
        || members.get(media.path)!.bytes > (media.mime_type === "image/png" ? 8_000_000 : 30_000_000)) throw invalid();
      mapped.add(key); mediaPaths.add(media.path);
      // Check content signatures as well as the MIME label and digest before any database writes.
      const member = members.get(media.path)!;
      const handle = createReadStream(member.file, { start: 0, end: 31 }); const chunks: Buffer[] = [];
      for await (const chunk of handle) chunks.push(Buffer.from(chunk)); const head = Buffer.concat(chunks);
      if (media.mime_type === "image/png" && (head.length < 24 || head.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a"
        || head.readUInt32BE(16) < 1 || head.readUInt32BE(20) < 1 || head.readUInt32BE(16) > 4096 || head.readUInt32BE(20) > 4096)) throw invalid();
      if (media.mime_type === "audio/wav" && (head.toString("ascii", 0, 4) !== "RIFF" || head.toString("ascii", 8, 12) !== "WAVE")) throw invalid();
      if (media.mime_type === "audio/mpeg" && !(head.toString("ascii", 0, 3) === "ID3" || head[0] === 255 && (head[1] & 0xe0) === 0xe0)) throw invalid();
    }
    if (mapped.size !== refs.length || [...declared].filter(p => p.startsWith("media/")).length !== mediaPaths.size) throw invalid();
    if (manifest.kind === "video" && (!declared.has("fonts/NotoSansTC-VF.ttf") || !declared.has("fonts/OFL.txt"))) throw invalid();
    return { manifest, definition, members, total_bytes: total,
      preview_hash: hash(canonical({ manifest, source_sha256: members.get("project.json")!.sha256 })) };
  } finally { signal.removeEventListener("abort", interrupt); zip.close(); }
}
