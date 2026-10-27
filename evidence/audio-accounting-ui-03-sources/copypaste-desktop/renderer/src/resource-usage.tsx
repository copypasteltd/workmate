import { useState } from "react";
import { RefreshCw } from "lucide-react";
import { DateText, ErrorNotice, Loading, useData, useI18n } from "./ui";

export function ResourceUsage({
  tenant,
  revision = 0,
}: {
  tenant: string;
  revision?: number;
}) {
  const { t } = useI18n(),
    [refresh, setRefresh] = useState(0);
  const { data, error, loading } = useData(
    `/v1/tenants/${tenant}/resource-usage`,
    revision + refresh,
    15000,
  );
  return (
    <section
      className="card section-block"
      aria-label={t("企業容量", "Workspace capacity")}
    >
      <div className="section-title">
        <h2>{t("企業容量", "Workspace capacity")}</h2>
        <button
          className="button secondary"
          onClick={() => setRefresh((n) => n + 1)}
        >
          <RefreshCw size={16} />
          {t("更新容量", "Refresh capacity")}
        </button>
      </div>
      <ErrorNotice error={error} />
      {loading && <Loading />}
      {data && (
        <>
          <p>
            <strong>
              {t("已用席位", "Seats used")}: {data.seats.used.toLocaleString()}{" "}
              / {data.seats.limit.toLocaleString()}
            </strong>
          </p>
          <p>
            {t("已保留檔案", "Retained files")}:{" "}
            {BigInt(data.storage.used_bytes).toLocaleString()} B ·{" "}
            {t("上傳預留", "Upload reservations")}:{" "}
            {BigInt(data.storage.reserved_bytes).toLocaleString()} B
          </p>
          <p>
            <strong>
              {t("總存儲佔用", "Total storage allocation")}:{" "}
              {BigInt(data.storage.total_bytes).toLocaleString()} /{" "}
              {BigInt(data.storage.limit_bytes).toLocaleString()} B
            </strong>
          </p>
          {(data.seats.over_limit || data.storage.over_limit) && (
            <p className="notice" role="status">
              {t(
                "目前佔用超出方案容量。已有成員和檔案會保留；請完成清理、移除成員或聯絡管理員調整企業方案，再新增佔用。",
                "Current allocation exceeds this plan. Existing members and files remain available. Complete cleanup, remove a membership or contact an administrator to change the workspace plan before adding capacity.",
              )}
            </p>
          )}
          <p className="muted">
            {t(
              "席位包含所有啟用成員；個人 VIP 不會擴大企業容量。存儲包含私人檔案、每個歷史版本、獨立副本及有效上傳預留。刪除完成清理後才釋放容量。",
              "Seats include all active memberships. Personal VIP does not enlarge workspace capacity. Storage includes private files, every retained version, independent copies and valid upload reservations. Capacity is released after deletion cleanup completes.",
            )}
          </p>
          {data.legacy_compatibility_limits && (
            <p className="muted">
              {t(
                "此企業沿用既有方案的相容上限。具體商業容量以管理員明確授予的企業方案為準。",
                "This workspace retains compatibility limits from an existing plan. Commercial capacity follows the workspace plan explicitly assigned by an administrator.",
              )}
            </p>
          )}
          <p className="muted">
            {t("伺服器確認時間", "Confirmed by server")}:{" "}
            <DateText value={data.as_of} />
          </p>
        </>
      )}
    </section>
  );
}
