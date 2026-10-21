import { useData, useI18n } from "./ui";
export function DataModeNotice() {
  const { t } = useI18n(),
    config = useData("/v1/public/config");
  return config.data?.data_mode === "simulated" ? (
    <aside className="demo-notice" role="status">
      <strong>
        {t("演示環境 · 模擬資料", "Demo environment · simulated data")}
      </strong>
      <span>
        {t(
          "模型、素材和消耗是模擬資料；管理員操作及審計會實際保存。",
          "Model content, media and usage are simulated. Administrator changes and audit records are actually saved.",
        )}
      </span>
    </aside>
  ) : null;
}
