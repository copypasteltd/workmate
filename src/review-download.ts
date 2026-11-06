/** Bound streaming allocation before producing a user-visible file. */
export async function readReviewBlob(response: Response, current: () => void): Promise<Blob> {
  const limit = 8 * 1024 ** 2, declared = response.headers.get("content-length"), reader = response.body?.getReader();
  if (!reader) throw new Error("Review download is empty");
  let bytes = 0;
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  try {
    if (declared && (!/^\d+$/.test(declared) || Number(declared) > limit)) throw new Error("Review download exceeds limit");
    for (;;) {
      current(); const { done, value } = await reader.read(); current();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > limit) throw new Error("Review download exceeds limit");
      chunks.push(new Uint8Array(value));
    }
    if (!bytes || (declared && bytes !== Number(declared))) throw new Error("Review download size mismatch");
    return new Blob(chunks, { type: response.headers.get("content-type") ?? "application/octet-stream" });
  } catch (error) { await reader.cancel().catch(() => {}); throw error; }
  finally { reader.releaseLock(); }
}
