import { crc32, inflateSync } from "node:zlib";
import { PNG } from "pngjs";

/** Decode the actual image, with bounds established before either inflater runs. */
export function validateVerificationPNG(bytes: Buffer) {
  if (
    bytes.length < 57 ||
    bytes.length > 52_500_000 ||
    bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a" ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString("latin1", 12, 16) !== "IHDR" ||
    bytes.readUInt32BE(16) !== 1024 ||
    bytes.readUInt32BE(20) !== 1024
  )
    throw new Error("A complete 1024-square PNG is required");
  const depth = bytes[24],
    color = bytes[25],
    interlace = bytes[28],
    channels = new Map([
      [0, 1],
      [2, 3],
      [3, 1],
      [4, 2],
      [6, 4],
    ]).get(color),
    depths =
      color === 0 ? [1, 2, 4, 8, 16] : color === 3 ? [1, 2, 4, 8] : [8, 16];
  if (
    !channels ||
    !depths.includes(depth) ||
    bytes[26] !== 0 ||
    bytes[27] !== 0 ||
    ![0, 1].includes(interlace)
  )
    throw new Error("Unsupported PNG header");

  const compressed: Buffer[] = [];
  let offset = 8,
    ended = false,
    seenData = false,
    dataEnded = false;
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) throw new Error("Truncated PNG chunk");
    const length = bytes.readUInt32BE(offset),
      end = offset + 12 + length,
      kind = bytes.toString("latin1", offset + 4, offset + 8);
    if (
      end > bytes.length ||
      !/^[A-Za-z]{4}$/.test(kind) ||
      (bytes[offset + 6] & 32) !== 0 ||
      crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)
    )
      throw new Error("Invalid PNG chunk or checksum");
    if (kind === "IHDR" && offset !== 8) throw new Error("Repeated PNG header");
    if (["acTL", "fcTL", "fdAT"].includes(kind))
      throw new Error("A single static PNG is required");
    if (kind === "IDAT") {
      if (dataEnded) throw new Error("Nonconsecutive PNG image data");
      seenData = true;
      compressed.push(bytes.subarray(offset + 8, end - 4));
    } else if (seenData) dataEnded = true;
    if (kind === "IEND") {
      if (length !== 0 || !seenData || end !== bytes.length)
        throw new Error("Invalid PNG ending");
      ended = true;
    }
    offset = end;
  }
  if (!ended) throw new Error("Missing PNG ending");

  // Adam7 pass geometry bounds even 16-bit interlaced input before pngjs
  // allocates pixel buffers. Exact scanline length rejects excess data too.
  const passes = interlace
      ? [
          [0, 0, 8, 8],
          [4, 0, 8, 8],
          [0, 4, 4, 8],
          [2, 0, 4, 4],
          [0, 2, 2, 4],
          [1, 0, 2, 2],
          [0, 1, 1, 2],
        ]
      : [[0, 0, 1, 1]],
    expected = passes.reduce((total, [x, y, dx, dy]) => {
      const width = Math.ceil((1024 - x) / dx),
        height = Math.ceil((1024 - y) / dy);
      return total + (Math.ceil((width * channels * depth) / 8) + 1) * height;
    }, 0),
    input = Buffer.concat(compressed),
    // Node's info:true result is not expressed by @types/node's sync overload.
    inflated = inflateSync(input, {
      maxOutputLength: expected,
      info: true,
    }) as unknown as {
      buffer: unknown;
      engine?: { bytesWritten: number };
    };
  if (
    !Buffer.isBuffer(inflated.buffer) ||
    inflated.buffer.length !== expected ||
    inflated.engine?.bytesWritten !== input.length
  )
    throw new Error("PNG compressed data is incomplete or contains extra data");
  const decoded = PNG.sync.read(bytes, { checkCRC: true });
  if (
    decoded.width !== 1024 ||
    decoded.height !== 1024 ||
    decoded.data.length !== 1024 * 1024 * 4
  )
    throw new Error("PNG pixel decoding is incomplete");
}
