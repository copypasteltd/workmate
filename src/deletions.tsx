import { useState } from "react";
import { post } from "./api";
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
export function AdminDeletions({
  canRetry,
  refresh: externalRefresh,
}: {
  canRetry: boolean;
  refresh: number;
}) {
  const { t } = useI18n(),
    [refresh, setRefresh] = useState(0),
    [retry, setRetry] = useState<any>(null);
  const jobs = useData(
    "/v1/admin/deletions?page_size=25",
    externalRefresh + refresh,
    5000,
  );
  return (
    <section
      className="card"
      aria-label={t("永久刪除與清理進度", "Permanent deletion and cleanup")}
    >
      <h2>{t("永久刪除與清理進度", "Permanent deletion and cleanup")}</h2>
      <p className="muted">
        {t(
          "檢視授權範圍內的清理狀態。永久刪除無法恢復；帳務與審計資料獨立保留。",
          "Review cleanup within your authorized scope. Permanent deletion is irreversible. Billing and audit data are retained separately.",
        )}
      </p>
      <ErrorNotice error={jobs.error} />
      {!jobs.data?.items?.length && (
        <p className="muted">
          {t("目前沒有清理記錄。", "No cleanup records yet.")}
        </p>
      )}
      {jobs.data?.items?.map((j: any) => (
        <article className="notice" key={j.id}>
          <div>
            <Badge value={j.state} />
            <p className="mono small-text">
              {j.target_type} · {j.target_id}
            </p>
            <p>
              {t("已清理項目", "Items removed")}: {j.progress.completed}/
              {j.progress.total} · <DateText value={j.created_at} />
            </p>
            {j.exceptions.length > 0 && (
              <p>
                {t("待處理原因", "Pending reason")}: {j.exceptions.join(", ")}
              </p>
            )}
            {j.failures.map((f: any) => (
              <p key={f.id} className="small-text">
                {f.kind} · {f.error_code} · {t("重試次數", "Attempts")}:{" "}
                {f.attempts}
              </p>
            ))}
            {canRetry && ["queued", "failed"].includes(j.state) && (
              <button className="button secondary" onClick={() => setRetry(j)}>
                {t("重試清理", "Retry cleanup")}
              </button>
            )}
          </div>
        </article>
      ))}
      {retry && (
        <Modal
          title={t("重試永久清理", "Retry permanent cleanup")}
          onClose={() => setRetry(null)}
        >
          <AsyncForm
            submitLabel={t("確認重試", "Confirm retry")}
            onSubmit={async (f) => {
              await post(`/v1/admin/deletions/${retry.id}/retry`, {
                reason: String(f.get("reason")),
              });
              setRetry(null);
              setRefresh((v) => v + 1);
            }}
          >
            <p className="mono small-text">{retry.target_id}</p>
            <Field label={t("原因", "Reason")}>
              <textarea name="reason" required minLength={3} maxLength={2000} />
            </Field>
          </AsyncForm>
        </Modal>
      )}
    </section>
  );
}
