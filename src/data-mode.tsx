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
          "試用額度及未接入服務使用模擬資料；獨立設定的模型會呼叫實際上游並消耗其額度。管理操作及審計會保存。",
          "Trial credit and unconfigured services are simulated. Independently configured models call their actual upstream and consume its credit. Admin changes and audits are saved.",
        )}
      </span>
    </aside>
  ) : null;
}
