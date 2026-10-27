import { useState } from "react";
import { DateText, ErrorNotice, Loading, Modal, useData, useI18n } from "./ui";

export function AdminResources({
  tenant,
  onClose,
}: {
  tenant: string;
  onClose: () => void;
}) {
  const { t } = useI18n(),
    [revision, setRevision] = useState(0);
  const { data, error, loading } = useData(
    `/v1/admin/tenants/${tenant}/resource-usage`,
    revision,
    15000,
  );
  return (
    <Modal title={t("企業容量", "Workspace capacity")} onClose={onClose}>
      <ErrorNotice error={error} />
      {loading && <Loading />}
      {data && (
        <div className="detail-card">
          <p>
            <strong>
              {t("已用席位", "Seats used")}: {data.seats.used.toLocaleString()}{" "}
              / {data.seats.limit.toLocaleString()}
            </strong>
          </p>
          <p>
            {t("已保留檔案", "Retained files")}:{" "}
            {BigInt(data.storage.used_bytes).toLocaleString()} B
          </p>
          <p>
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
                "目前超出容量；已有成員與內容保留，新增佔用已受限制。",
                "Current capacity is exceeded. Existing members and content are retained; additional allocation is restricted.",
              )}
            </p>
          )}
          <p className="muted">
            {t(
              "容量由目前有效的企業方案決定，個人 VIP 不會擴大企業容量。歷史版本、私人檔案與獨立副本均計入。內容完成刪除清理後才釋放容量。",
              "Current tenant grants determine capacity. Personal VIP does not enlarge a workspace. Retained versions, private files and independent copies count toward storage. Capacity is released after deletion cleanup completes.",
            )}
          </p>
          {data.legacy_compatibility_limits && (
            <p className="muted">
              {t(
                "沿用既有方案相容上限；這不是新增商業承諾。",
                "Existing plan compatibility limits apply; these are not a new commercial allowance.",
              )}
            </p>
          )}
          <p className="muted">
            {t("伺服器確認時間", "Confirmed by server")}:{" "}
            <DateText value={data.as_of} />
          </p>
        </div>
      )}
      <button
        className="button secondary"
        onClick={() => setRevision((n) => n + 1)}
      >
        {t("更新容量", "Refresh capacity")}
      </button>
    </Modal>
  );
}
