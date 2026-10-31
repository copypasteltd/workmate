import { crc32, inflateSync } from "node:zlib";
import { PNG } from "pngjs";
import { Problem } from "./lib.js";

/** Establish strict pixel and inflater bounds before accepting a remote frame. */
export function validateDedicatedFrame(encoded: string): Buffer {
  const invalid = () => new Problem(422, "CLOUD_RUNTIME_FRAME_INVALID", "A complete 1280 × 720 static PNG is required");
  const bytes = Buffer.from(encoded, "base64");
  if (bytes.toString("base64") !== encoded || bytes.length < 57 || bytes.length > 524288 ||
      bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" || bytes.readUInt32BE(8) !== 13 ||
      bytes.toString("latin1", 12, 16) !== "IHDR" || bytes.readUInt32BE(16) !== 1280 || bytes.readUInt32BE(20) !== 720 ||
      bytes[24] !== 8 || ![2, 6].includes(bytes[25]) || bytes[26] !== 0 || bytes[27] !== 0 || bytes[28] !== 0) throw invalid();
  let offset = 8, ended = false, seenData = false, dataEnded = false;
  const compressed: Buffer[] = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw invalid();
    const length = bytes.readUInt32BE(offset), end = offset + length + 12, kind = bytes.toString("latin1", offset + 4, offset + 8);
    if (end > bytes.length || !/^[A-Za-z]{4}$/.test(kind) || (bytes[offset + 6] & 32) !== 0 ||
        crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4) ||
        ["acTL", "fcTL", "fdAT"].includes(kind) || kind === "IHDR" && offset !== 8 ||
        !["IHDR", "IDAT", "IEND"].includes(kind) && (bytes[offset + 4] & 32) === 0) throw invalid();
    if (kind === "IDAT") {
      if (dataEnded) throw invalid();
      seenData = true; compressed.push(bytes.subarray(offset + 8, end - 4));
    } else if (seenData) dataEnded = true;
    if (kind === "IEND") {
      if (length !== 0 || !seenData || end !== bytes.length) throw invalid();
      ended = true;
    }
    offset = end;
  }
  if (!ended) throw invalid();
  const expected = 720 * (1 + 1280 * (bytes[25] === 6 ? 4 : 3)), input = Buffer.concat(compressed);
  try {
    const inflated = inflateSync(input, { maxOutputLength: expected, info: true }) as unknown as {buffer: Buffer; engine: {bytesWritten: number}};
    if (inflated.buffer.length !== expected || inflated.engine.bytesWritten !== input.length) throw invalid();
    const decoded = PNG.sync.read(bytes, { checkCRC: true });
    if (decoded.width !== 1280 || decoded.height !== 720 || decoded.data.length !== 1280 * 720 * 4) throw invalid();
  } catch { throw invalid(); }
  return bytes;
}
