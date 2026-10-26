import { sha256 } from "@noble/hashes/sha2.js";
import { api } from "./api";
const hex = (v: Uint8Array) =>
  [...v].map((n) => n.toString(16).padStart(2, "0")).join("");
const encode = (v: Uint8Array) => {
  let s = "";
  for (let i = 0; i < v.length; i += 32768)
    s += String.fromCharCode(...v.subarray(i, i + 32768));
  return btoa(s);
};
/** JSON parts also travel through the native bridge. Persist the allocation key
 * before sending so an unknown reply can be retried without another asset. */
export async function uploadCampaignFile(
  file: File,
  w: { base: string; tenant: string; project: string; user: string },
  signal: AbortSignal,
) {
  if (
    !/\.(csv|xlsx)$/i.test(file.name) ||
    !file.size ||
    file.size > 5_000_000 ||
    file.name.length > 200
  )
    throw new Error(
      "Choose a CSV or XLSX up to 5 MB, with a file name up to 200 characters.",
    );
  const bytes = new Uint8Array(await file.arrayBuffer()),
    checksum = hex(sha256(bytes));
  signal.throwIfAborted();
  const storageKey = `cp_campaign_upload:${w.user}:${w.tenant}:${w.project}:${encodeURIComponent(file.name)}:${file.size}:${checksum}`;
  let saved: any;
  try {
    saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
  } catch {
    localStorage.removeItem(storageKey);
  }
  if (!saved || saved.expires <= Date.now()) {
    saved = { key: crypto.randomUUID(), expires: Date.now() + 86_400_000 };
    localStorage.setItem(storageKey, JSON.stringify(saved));
  }
  let session: any;
  if (saved.upload_id) {
    try {
      session = await api(w.base + "/uploads/" + saved.upload_id, { signal });
    } catch (e) {
      if (![404, 410].includes((e as any).status)) throw e;
      saved = { key: crypto.randomUUID(), expires: Date.now() + 86_400_000 };
      localStorage.setItem(storageKey, JSON.stringify(saved));
    }
  }
  if (!session) {
    const created = await api(w.base + "/uploads", {
      method: "POST",
      signal,
      headers: { "Idempotency-Key": saved.key },
      body: JSON.stringify({
        project_id: w.project,
        filename: file.name,
        content_type: /\.xlsx$/i.test(file.name)
          ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          : "text/csv",
        size_bytes: file.size,
        sha256: checksum,
      }),
    });
    saved = { ...saved, ...created };
    localStorage.setItem(storageKey, JSON.stringify(saved));
    session = await api(w.base + "/uploads/" + saved.upload_id, { signal });
  }
  signal.throwIfAborted();
  if (session.state !== "completed") {
    const parts = new Map(
      session.parts.map((p: any) => [p.part_index, p.sha256]),
    );
    const size = saved.part_size_bytes ?? 4 * 1024 * 1024;
    for (
      let offset = 0, index = 0;
      offset < bytes.length;
      offset += size, index++
    ) {
      signal.throwIfAborted();
      const part = bytes.subarray(offset, offset + size),
        digest = hex(sha256(part));
      if (parts.get(index) !== digest)
        await api(`${w.base}/uploads/${saved.upload_id}/parts/${index}`, {
          method: "POST",
          signal,
          body: JSON.stringify({ base64: encode(part), sha256: digest }),
        });
    }
  }
  signal.throwIfAborted();
  const asset = await api(`${w.base}/uploads/${saved.upload_id}/complete`, {
    method: "POST",
    signal,
    body: JSON.stringify({ sha256: checksum, size_bytes: bytes.length }),
  });
  signal.throwIfAborted();
  return {
    asset_id: asset.id,
    asset_version_id: asset.version.id,
    filename: file.name,
    source_sha256: checksum,
  };
}
