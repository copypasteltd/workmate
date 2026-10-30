import { useEffect, useState } from "react";
import { api } from "./api";
import { useWorkspace } from "./context";
import {
  AsyncForm,
  Badge,
  DateText,
  ErrorNotice,
  Field,
  Modal,
  useData,
  useI18n,
} from "./ui";
const messages: Record<string, [string, string]> = {
  ERASURE_STORAGE_BUSY: [
    "儲存空間忙碌，系統會重試。",
    "Storage is busy. The system will retry.",
  ],
  ERASURE_IO_FAILED: [
    "檔案清理暫未完成，系統會重試。",
    "File cleanup is pending. The system will retry.",
  ],
  WAITING_FOR_EXECUTION_TO_CLOSE: [
    "等待工作結束及費用確認。",
    "Waiting for execution and billing to close.",
  ],
  WAITING_FOR_DEPENDENT_ERASURE: [
    "正在清理相關私有內容。",
    "Related private content is being removed.",
  ],
  DEPENDENT_ERASURE_FAILED: [
    "相關內容清理需要管理員處理。",
    "Related content requires administrator attention.",
  ],
};
export function DeletionProgress({ refresh }: { refresh: number }) {
  const w = useWorkspace(),
    { t } = useI18n();
  const [tick, setTick] = useState(0);
  const jobs = useData(w.base + "/deletions", refresh + tick);
  const pending = jobs.data?.items?.some((j: any) =>
    ["queued", "cleaning"].includes(j.state),
  );
  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => {
      if (!document.hidden) setTick((v) => v + 1);
    }, 5000);
    return () => clearInterval(timer);
  }, [pending, w.base]);
  if (!jobs.error && !jobs.data?.items?.length) return null;
  return (
    <section className="card" aria-label={t("刪除進度", "Deletion progress")}>
      <h2>{t("刪除進度", "Deletion progress")}</h2>
      <p className="muted">
        {t(
          "提交後立即停止存取。系統會清理檔案、私有產物及執行快取；帳務與審計記錄按保留規則保存。",
          "Access ends immediately. Files, private derivatives and execution caches are removed. Billing and audit records follow their retention rules.",
        )}
      </p>
      <ErrorNotice error={jobs.error} />
      <div className="stack">
        {jobs.data?.items?.map((j: any) => (
          <article key={j.id} className="notice">
            <div>
              <Badge value={j.state} />
              <p className="mono small-text">{j.target_id}</p>
              <p>
                {t("已清理項目", "Items removed")}: {j.progress.completed}/
                {j.progress.total} · <DateText value={j.created_at} />
              </p>
              {j.exceptions.map((code: string) => (
                <p key={code}>
                  {messages[code]
                    ? t(...messages[code])
                    : t(
                        "清理需要管理員處理。",
                        "Cleanup requires administrator attention.",
                      )}
                </p>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
export function DeleteAsset({
  asset,
  onClose,
  onDone,
}: {
  asset: any;
  onClose: () => void;
  onDone: () => void;
}) {
  const w = useWorkspace(),
    { t } = useI18n();
  return (
    <Modal
      title={t("永久刪除素材", "Permanently delete asset")}
      onClose={onClose}
    >
      <p>{asset.name}</p>
      <p className="muted">
        {t(
          "所有版本和分享連結會停止存取，並進入永久清理程序。已發佈的獨立副本需要另外刪除。",
          "All versions and share links become unavailable and enter permanent cleanup. Published independent copies require a separate deletion.",
        )}
      </p>
      <AsyncForm
        submitLabel={t("確認永久刪除", "Confirm permanent deletion")}
        onSubmit={async (f) => {
          await api(w.base + "/deletions", {
            method: "POST",
            body: JSON.stringify({
              target_type: "asset",
              target_id: asset.id,
              project_id: w.project,
              reason: String(f.get("reason")),
            }),
          });
          onDone();
          onClose();
        }}
      >
        <Field label={t("原因", "Reason")}>
          <textarea name="reason" required minLength={1} maxLength={2000} />
        </Field>
        <label className="checkbox">
          <input type="checkbox" required />
          {t(
            "我理解此操作無法復原。",
            "I understand this action cannot be undone.",
          )}
        </label>
      </AsyncForm>
    </Modal>
  );
}
