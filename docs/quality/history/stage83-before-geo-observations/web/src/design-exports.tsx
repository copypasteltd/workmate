import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, Download } from "lucide-react";
import { api, download, ApiError } from "./api";
import { ErrorNotice, useI18n } from "./ui";

export function DesignExports({
  base,
  design,
  refresh,
}: {
  base: string;
  design: { id: string; version: number };
  refresh: () => void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false),
    [error, setError] = useState<unknown>(null),
    [result, setResult] = useState<{ id: string; name: string } | null>(null);
  const locked = useRef(false),
    live = useRef(true),
    keys = useRef(new Map<string, string>());
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  async function render(format: string) {
    if (locked.current) return;
    locked.current = true;
    setBusy(true);
    setError(null);
    setResult(null);
    const key = keys.current.get(format) ?? crypto.randomUUID();
    keys.current.set(format, key);
    try {
      const asset = await api(base + "/creative/" + design.id + "/render", {
        method: "POST",
        headers: { "Idempotency-Key": key },
        body: JSON.stringify({
          format,
          expected_version: design.version,
          ...(format === "mp4" ? { duration: 6, effect: "fade" } : {}),
        }),
      });
      keys.current.delete(format);
      if (live.current) setResult({ id: asset.id, name: asset.name });
    } catch (e) {
      if (live.current) setError(e);
    } finally {
      locked.current = false;
      if (live.current) setBusy(false);
    }
  }
  return (
    <>
      <footer className="design-export-formats" aria-busy={busy}>
        {["svg", "png", "pdf", "mp4"].map((format) => (
          <button
            className="text-button"
            key={format}
            disabled={busy}
            onClick={() => void render(format)}
          >
            {format === "svg"
              ? t("可編輯 SVG", "Editable SVG")
              : format === "png"
                ? "PNG"
                : format === "pdf"
                  ? t("PDF 審閱稿", "PDF review copy")
                  : t("動態 MP4", "Motion MP4")}
            <ArrowUpRight size={16} />
          </button>
        ))}
      </footer>
      <ErrorNotice error={error} />
      {error instanceof ApiError && error.code === "VERSION_CONFLICT" && (
        <button className="text-button" onClick={refresh}>
          {t("重新載入設計版本", "Refresh design version")}
        </button>
      )}
      {result && (
        <div className="design-export-result" role="status">
          <span>
            {t("已儲存至素材與交付", "Saved in Assets & deliverables")}
          </span>
          <button
            className="text-button"
            onClick={() =>
              void download(
                base + "/assets/" + result.id + "/download",
                result.name,
              ).catch((e) => {
                if (live.current) setError(e);
              })
            }
          >
            <Download size={15} />
            {t("下載匯出檔案", "Download export")}
          </button>
        </div>
      )}
    </>
  );
}
