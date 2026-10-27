import { createWriteStream, constants } from "node:fs";
import { copyFile, unlink } from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createHash, randomUUID } from "node:crypto";
import path from "node:path";
/** Save only to the exact native dialog selection; no renderer-chosen path. */
export async function saveDownload(
  response: Response,
  destination: string,
  limit = 1024 * 1024 * 1024,
) {
  if (!response.ok || !response.body) throw new Error("Download unavailable");
  const declared = response.headers.get("content-length"),
    expectedHash = response.headers.get("x-content-sha256");
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) {
    await response.body.cancel();
    throw new Error("Download exceeds limit");
  }
  if (expectedHash && !/^[a-f0-9]{64}$/.test(expectedHash)) {
    await response.body.cancel();
    throw new Error("Invalid download checksum");
  }
  const target = path.resolve(destination),
    temporary = path.join(
      path.dirname(target),
      `.copypaste-${randomUUID()}.part`,
    );
  let bytes = 0;
  const digest = createHash("sha256");
  try {
    await pipeline(
      Readable.fromWeb(response.body as any),
      new Transform({
        transform(chunk: Buffer, _encoding, done) {
          bytes += chunk.length;
          if (bytes > limit) {
            done(new Error("Download exceeds limit"));
            return;
          }
          digest.update(chunk);
          done(null, chunk);
        },
      }),
      createWriteStream(temporary, { flags: "wx" }),
    );
    if (declared && Number(declared) !== bytes)
      throw new Error("Download size mismatch");
    if (expectedHash && digest.digest("hex") !== expectedHash)
      throw new Error("Download checksum mismatch");
    // The OS copy is bounded in memory and explicitly refuses existing files.
    await copyFile(temporary, target, constants.COPYFILE_EXCL);
    return { saved: true, bytes };
  } finally {
    await unlink(temporary).catch((e: NodeJS.ErrnoException) => {
      if (e.code !== "ENOENT") throw e;
    });
  }
}
