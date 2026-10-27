import { useEffect, useRef, useState } from "react";
import { sha256 } from "@noble/hashes/sha2.js";
import { api } from "./api";
import { useWorkspace } from "./context";
import { ErrorNotice, Field, useI18n } from "./ui";
const chunkSize = 4 * 1024 * 1024;
const hex = (b: Uint8Array) =>
  [...b].map((v) => v.toString(16).padStart(2, "0")).join("");
const encode = (b: Uint8Array) => {
  let s = "";
  for (let i = 0; i < b.length; i += 32768)
    s += String.fromCharCode(...b.subarray(i, i + 32768));
  return btoa(s);
};
export function ResumableUpload({
  asset,
  conversationId,
  onDone,
}: {
  asset?: any;
  conversationId?: string;
  onDone: () => void;
}) {
  const { t } = useI18n(),
    w = useWorkspace(),
    [file, setFile] = useState<File | null>(null),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState(0),
    [stage, setStage] = useState(""),
    [error, setError] = useState<Error | null>(null),
    controller = useRef<AbortController | null>(null);
  const [pending, setPending] = useState<{ id: string; key: string } | null>(
    null,
  );
  useEffect(() => () => controller.current?.abort(), []);
  const start = async () => {
    if (!file) return;
    const c = new AbortController();
    controller.current = c;
    setBusy(true);
    setError(null);
    setProgress(0);
    try {
      const media = /^(audio|video)\//.test(file.type),
        limit = media ? 1024 * 1024 * 1024 : 100 * 1024 * 1024;
      if (!file.size || file.size > limit)
        throw new Error(
          t(
            "一般檔案上限 100 MiB，媒體上限 1 GiB。",
            "Files are limited to 100 MiB; media to 1 GiB.",
          ),
        );
      setStage(t("正在計算檔案校驗值", "Calculating file checksum"));
      const digest = sha256.create();
      for (let offset = 0; offset < file.size; offset += chunkSize) {
        c.signal.throwIfAborted();
        digest.update(
          new Uint8Array(
            await file.slice(offset, offset + chunkSize).arrayBuffer(),
          ),
        );
        setProgress(
          Math.min(100, Math.round(((offset + chunkSize) / file.size) * 100)),
        );
        await new Promise<void>((r) => setTimeout(r, 0));
      }
      const checksum = hex(digest.digest()),
        mime = file.type || "application/octet-stream";
      const storageKey = `cp_upload:${w.me.user.id}:${w.tenant}:${w.project}:${conversationId ?? "project"}:${asset?.id ?? "new"}:${asset?.current_version ?? 0}:${encodeURIComponent(file.name)}:${checksum}:${file.size}:${mime}`;
      let saved: any;
      try {
        saved = JSON.parse(localStorage.getItem(storageKey) ?? "null");
      } catch {
        localStorage.removeItem(storageKey);
      }
      if (saved && new Date(saved.expires_at) <= new Date()) {
        localStorage.removeItem(storageKey);
        localStorage.removeItem(storageKey + ":request");
        saved = null;
      }
      let session: any;
      if (saved) {
        try {
          session = await api(w.base + "/uploads/" + saved.upload_id, {
            signal: c.signal,
          });
        } catch (e) {
          if ((e as any).status === 404 || (e as any).status === 410) {
            localStorage.removeItem(storageKey);
            localStorage.removeItem(storageKey + ":request");
            saved = null;
          } else throw e;
        }
      }
      if (!saved) {
        // Persist the request key before issuing create. A lost response can be
        // replayed without allocating a second session or reserving more disk.
        let request: any;
        try {
          request = JSON.parse(
            localStorage.getItem(storageKey + ":request") ?? "null",
          );
        } catch {}
        if (!request || request.expires <= Date.now())
          request = {
            key: crypto.randomUUID(),
            expires: Date.now() + 86_400_000,
          };
        const requestKey = request.key;
        localStorage.setItem(storageKey + ":request", JSON.stringify(request));
        saved = await api(w.base + "/uploads", {
          method: "POST",
          signal: c.signal,
          headers: { "Idempotency-Key": requestKey },
          body: JSON.stringify({
            project_id: w.project,
            filename: file.name,
            content_type: mime,
            size_bytes: file.size,
            sha256: checksum,
            ...(conversationId ? { conversation_id: conversationId } : {}),
            ...(asset
              ? { asset_id: asset.id, expected_version: asset.current_version }
              : {}),
          }),
        });
        localStorage.setItem(storageKey, JSON.stringify(saved));
        session = await api(w.base + "/uploads/" + saved.upload_id, {
          signal: c.signal,
        });
      }
      setPending({ id: saved.upload_id, key: storageKey });
      const existing = new Map<number, string>(
        session.parts.map((p: any) => [p.part_index, p.sha256]),
      );
      setStage(
        t(
          "分片上傳中，可暫停後選取同一檔案繼續",
          "Uploading parts. Pause and reselect the same file to resume",
        ),
      );
      setProgress(0);
      for (
        let index = 0, offset = 0;
        offset < file.size;
        index++, offset += saved.part_size_bytes ?? chunkSize
      ) {
        c.signal.throwIfAborted();
        if (session.state !== "completed") {
          const bytes = new Uint8Array(
              await file
                .slice(offset, offset + (saved.part_size_bytes ?? chunkSize))
                .arrayBuffer(),
            ),
            partHash = hex(sha256(bytes));
          if (existing.get(index) !== partHash)
            await api(`${w.base}/uploads/${saved.upload_id}/parts/${index}`, {
              method: "POST",
              signal: c.signal,
              body: JSON.stringify({ base64: encode(bytes), sha256: partHash }),
            });
        }
        setProgress(
          Math.min(
            100,
            Math.round(
              ((offset + (saved.part_size_bytes ?? chunkSize)) / file.size) *
                100,
            ),
          ),
        );
      }
      c.signal.throwIfAborted();
      setStage(
        t("伺服器正在核對完整檔案", "Server is verifying the complete file"),
      );
      await api(`${w.base}/uploads/${saved.upload_id}/complete`, {
        method: "POST",
        signal: c.signal,
        body: JSON.stringify({ sha256: checksum, size_bytes: file.size }),
      });
      localStorage.removeItem(storageKey);
      localStorage.removeItem(storageKey + ":request");
      setPending(null);
      onDone();
    } catch (e) {
      if (c.signal.aborted)
        setStage(
          t(
            "已暫停。選取同一檔案可繼續。",
            "Paused. Select the same file to resume.",
          ),
        );
      else setError(e as Error);
    } finally {
      setBusy(false);
      controller.current = null;
    }
  };
  const cancel = async () => {
    if (!pending) return;
    setBusy(true);
    setError(null);
    try {
      try {
        await api(`${w.base}/uploads/${pending.id}`, { method: "DELETE" });
      } catch (e) {
        if (![404, 410].includes((e as any).status)) throw e;
      }
      localStorage.removeItem(pending.key);
      localStorage.removeItem(pending.key + ":request");
      setPending(null);
      setProgress(0);
      setStage(
        t(
          "已取消上傳，暫存分片將由伺服器清理。",
          "Upload cancelled. The server will remove staged parts.",
        ),
      );
    } catch (e) {
      setError(e as Error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="form-stack">
      <p className="muted">
        {t(
          "一般檔案 100 MiB · 媒體 1 GiB · 分片校驗。中斷後可在 24 小時內選取同一檔案續傳。",
          "Files 100 MiB · media 1 GiB · verified parts. Reselect the same file within 24 hours to resume.",
        )}
      </p>
      <ErrorNotice error={error} />
      <Field label={t("檔案", "File")}>
        <input
          type="file"
          disabled={busy}
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null);
            setPending(null);
            setStage("");
            setProgress(0);
            setError(null);
          }}
          required
        />
      </Field>
      {stage && (
        <div role="status">
          <p>{stage}</p>
          <progress
            max={100}
            value={progress}
            aria-label={t("上傳進度", "Upload progress")}
          />
          <span> {progress}%</span>
        </div>
      )}
      <div className="row-actions">
        <button
          className="button primary"
          disabled={!file || busy}
          onClick={() => void start()}
        >
          {t("上傳或續傳", "Upload or resume")}
        </button>
        {busy && controller.current && (
          <button
            className="button secondary"
            onClick={() => controller.current?.abort()}
          >
            {t("暫停", "Pause")}
          </button>
        )}
        {!busy && pending && (
          <button className="button secondary" onClick={() => void cancel()}>
            {t("取消此上傳", "Cancel this upload")}
          </button>
        )}
      </div>
    </div>
  );
}
